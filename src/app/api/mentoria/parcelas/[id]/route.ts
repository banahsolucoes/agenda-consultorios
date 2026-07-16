import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { registrarLog } from "@/lib/auditoria";
import { exigirAcessoMentoria } from "@/lib/mentoria";

function parseData(valor: unknown): Date | null {
  if (valor === undefined || valor === null || valor === "") return null;
  const data = new Date(valor as string);
  return Number.isNaN(data.getTime()) ? null : data;
}

// PATCH /api/mentoria/parcelas/[id] — edita valorBruto e/ou vencimento de uma
// parcela em aberto (não paga, não estornada, contrato ainda ATIVO).
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  const erroAcesso = await exigirAcessoMentoria(usuario);
  if (erroAcesso) return erroAcesso;

  const { id } = await ctx.params;
  const parcela = await prisma.mentoriaParcela.findUnique({
    where: { id },
    include: { contrato: { select: { status: true } } },
  });
  if (!parcela || parcela.clinicaId !== usuario.clinicaId) {
    return NextResponse.json({ erro: "parcela não encontrada" }, { status: 404 });
  }

  const aberta = parcela.dataPagamento === null && parcela.estornoEm === null && parcela.contrato.status === "ATIVO";
  if (!aberta) {
    return NextResponse.json(
      { erro: "parcela não pode ser editada: já paga, estornada, ou contrato não está ativo" },
      { status: 409 }
    );
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ erro: "corpo da requisição inválido" }, { status: 400 });

  const data: Record<string, unknown> = {};
  if (body.valorBruto !== undefined) {
    if (typeof body.valorBruto !== "number" || !(body.valorBruto > 0)) {
      return NextResponse.json({ erro: "valorBruto deve ser um número maior que zero" }, { status: 400 });
    }
    data.valorBruto = body.valorBruto;
  }
  if (body.vencimento !== undefined) {
    const vencimento = parseData(body.vencimento);
    if (!vencimento) {
      return NextResponse.json({ erro: "vencimento deve ser uma data válida" }, { status: 400 });
    }
    data.vencimento = vencimento;
  }

  const camposAlterados = Object.keys(data);
  if (camposAlterados.length === 0) {
    return NextResponse.json({ erro: "nenhum campo para atualizar" }, { status: 400 });
  }

  const atualizada = await prisma.mentoriaParcela.update({ where: { id }, data });

  await registrarLog(
    usuario.clinicaId,
    usuario.id,
    "EDITAR_PARCELA_MENTORIA",
    `Editou a parcela ${atualizada.numero} do contrato ${atualizada.contratoId} (campos: ${camposAlterados.join(", ")})`
  );

  return NextResponse.json(atualizada);
}
