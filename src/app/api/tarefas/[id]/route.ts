import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { registrarLog } from "@/lib/auditoria";

function proximaOcorrenciaMensal(dataVencimento: Date, dataAviso: Date | null) {
  const proximaVencimento = new Date(dataVencimento);
  proximaVencimento.setMonth(proximaVencimento.getMonth() + 1);

  if (!dataAviso) return { proximaVencimento, proximaAviso: null };

  const deltaMs = dataVencimento.getTime() - dataAviso.getTime();
  const proximaAviso = new Date(proximaVencimento.getTime() - deltaMs);
  return { proximaVencimento, proximaAviso };
}

// PATCH /api/tarefas/[id] — conclui uma tarefa da clínica logada; se a
// tarefa concluída for recorrente (MENSAL), gera a próxima ocorrência.
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });

  const { id } = await ctx.params;
  const tarefa = await prisma.tarefa.findUnique({ where: { id } });
  if (!tarefa || tarefa.clinicaId !== usuario.clinicaId) {
    return NextResponse.json({ erro: "tarefa não encontrada" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  if (body?.status !== "CONCLUIDA") {
    return NextResponse.json({ erro: "operação não suportada — só é possível concluir a tarefa" }, { status: 400 });
  }
  if (tarefa.status === "CONCLUIDA") {
    return NextResponse.json({ erro: "tarefa já está concluída" }, { status: 409 });
  }

  const geraProxima = tarefa.recorrencia === "MENSAL" && tarefa.dataVencimento !== null;

  const { concluida, proxima } = await prisma.$transaction(async (tx) => {
    const concluida = await tx.tarefa.update({
      where: { id },
      data: { status: "CONCLUIDA", concluidoPor: usuario.id, concluidoEm: new Date() },
    });

    if (!geraProxima) return { concluida, proxima: null };

    const { proximaVencimento, proximaAviso } = proximaOcorrenciaMensal(
      tarefa.dataVencimento as Date,
      tarefa.dataAviso
    );
    const proxima = await tx.tarefa.create({
      data: {
        clinicaId: tarefa.clinicaId,
        tipo: tarefa.tipo,
        origem: tarefa.origem,
        titulo: tarefa.titulo,
        descricao: tarefa.descricao,
        pacienteId: tarefa.pacienteId,
        recorrencia: tarefa.recorrencia,
        status: "PENDENTE",
        dataVencimento: proximaVencimento,
        dataAviso: proximaAviso,
      },
    });
    return { concluida, proxima };
  });

  await registrarLog(usuario.clinicaId, usuario.id, "CONCLUIR_TAREFA", `Concluiu a tarefa "${concluida.titulo}"`);
  if (proxima) {
    await registrarLog(
      usuario.clinicaId,
      usuario.id,
      "GERAR_TAREFA_RECORRENTE",
      `Gerou a próxima ocorrência da tarefa "${proxima.titulo}" (vencimento em ${proxima.dataVencimento?.toISOString()})`
    );
  }

  return NextResponse.json({ concluida, proxima });
}
