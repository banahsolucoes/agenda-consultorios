import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { registrarLog } from "@/lib/auditoria";

const RECORRENCIAS_VALIDAS = ["NENHUMA", "MENSAL"];
const CAMPOS_EDITAVEIS = ["titulo", "descricao", "dataVencimento", "dataAviso", "recorrencia"] as const;

function parseDataOpcional(valor: unknown): Date | null | undefined {
  if (valor === undefined) return undefined;
  if (valor === null || valor === "") return null;
  const data = new Date(valor as string);
  return Number.isNaN(data.getTime()) ? undefined : data;
}

function proximaOcorrenciaMensal(dataVencimento: Date, dataAviso: Date | null) {
  const proximaVencimento = new Date(dataVencimento);
  proximaVencimento.setMonth(proximaVencimento.getMonth() + 1);

  if (!dataAviso) return { proximaVencimento, proximaAviso: null };

  const deltaMs = dataVencimento.getTime() - dataAviso.getTime();
  const proximaAviso = new Date(proximaVencimento.getTime() - deltaMs);
  return { proximaVencimento, proximaAviso };
}

// PATCH /api/tarefas/[id] — conclui (status: "CONCLUIDA", gera a próxima
// ocorrência se MENSAL) ou edita campos (titulo, descricao, dataVencimento,
// dataAviso, recorrencia) de uma tarefa da clínica logada. Tarefas
// RENOVACAO são system-owned: só admitem conclusão, nunca edição de campos.
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });

  const { id } = await ctx.params;
  const tarefa = await prisma.tarefa.findUnique({ where: { id } });
  if (!tarefa || tarefa.clinicaId !== usuario.clinicaId) {
    return NextResponse.json({ erro: "tarefa não encontrada" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ erro: "corpo da requisição inválido" }, { status: 400 });

  if (body.status === "CONCLUIDA") {
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

  // Edição de campos — RENOVACAO é system-owned, nunca editável manualmente.
  if (tarefa.tipo === "RENOVACAO") {
    return NextResponse.json(
      { erro: "tarefas de renovação são geradas pelo sistema e não podem ser editadas" },
      { status: 403 }
    );
  }

  if (body.recorrencia !== undefined && !RECORRENCIAS_VALIDAS.includes(body.recorrencia)) {
    return NextResponse.json({ erro: "recorrencia inválida" }, { status: 400 });
  }
  if (body.titulo !== undefined && (!body.titulo || typeof body.titulo !== "string")) {
    return NextResponse.json({ erro: "titulo não pode ser vazio" }, { status: 400 });
  }

  const dataVencimento = parseDataOpcional(body.dataVencimento);
  if (dataVencimento === undefined && body.dataVencimento !== undefined) {
    return NextResponse.json({ erro: "dataVencimento inválida" }, { status: 400 });
  }
  const dataAviso = parseDataOpcional(body.dataAviso);
  if (dataAviso === undefined && body.dataAviso !== undefined) {
    return NextResponse.json({ erro: "dataAviso inválida" }, { status: 400 });
  }

  const dataVencimentoFinal = body.dataVencimento !== undefined ? dataVencimento : tarefa.dataVencimento;
  const dataAvisoFinal = body.dataAviso !== undefined ? dataAviso : tarefa.dataAviso;
  if (dataAvisoFinal && dataVencimentoFinal && dataAvisoFinal.getTime() > dataVencimentoFinal.getTime()) {
    return NextResponse.json({ erro: "dataAviso não pode ser depois de dataVencimento" }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (body.titulo !== undefined) data.titulo = body.titulo;
  if (body.descricao !== undefined) data.descricao = body.descricao || null;
  if (body.dataVencimento !== undefined) data.dataVencimento = dataVencimento;
  if (body.dataAviso !== undefined) data.dataAviso = dataAviso;
  if (body.recorrencia !== undefined) data.recorrencia = body.recorrencia;

  const camposAlterados = Object.keys(data);
  if (camposAlterados.length === 0) {
    return NextResponse.json({ erro: "nenhum campo para atualizar" }, { status: 400 });
  }

  const atualizada = await prisma.tarefa.update({ where: { id }, data });

  await registrarLog(
    usuario.clinicaId,
    usuario.id,
    "EDITAR_TAREFA",
    `Editou a tarefa "${atualizada.titulo}" (campos: ${camposAlterados.filter((c) => (CAMPOS_EDITAVEIS as readonly string[]).includes(c)).join(", ")})`
  );

  return NextResponse.json(atualizada);
}

// DELETE /api/tarefas/[id] — arquivamento lógico (status=ARQUIVADA), nunca
// remove fisicamente e nunca gera a próxima ocorrência de uma recorrente
// (corta a série). RENOVACAO nunca se arquiva à mão — some sozinha pela
// transição de statusGeral do paciente.
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });

  const { id } = await ctx.params;
  const tarefa = await prisma.tarefa.findUnique({ where: { id } });
  if (!tarefa || tarefa.clinicaId !== usuario.clinicaId) {
    return NextResponse.json({ erro: "tarefa não encontrada" }, { status: 404 });
  }

  if (tarefa.tipo === "RENOVACAO") {
    return NextResponse.json(
      { erro: "tarefas de renovação não podem ser arquivadas manualmente" },
      { status: 403 }
    );
  }
  if (tarefa.status === "ARQUIVADA") {
    return NextResponse.json({ erro: "tarefa já está arquivada" }, { status: 409 });
  }

  const arquivada = await prisma.tarefa.update({ where: { id }, data: { status: "ARQUIVADA" } });

  await registrarLog(usuario.clinicaId, usuario.id, "ARQUIVAR_TAREFA", `Arquivou a tarefa "${arquivada.titulo}"`);

  return NextResponse.json(arquivada);
}
