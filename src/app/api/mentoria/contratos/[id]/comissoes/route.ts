import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { registrarLog } from "@/lib/auditoria";
import { exigirAcessoMentoria, calcularBaseComissionavel, calcularValorComissao } from "@/lib/mentoria";

const PAPEIS_COMISSAO = ["SELLER", "CLOSER", "PRODUTOR"];

// GET /api/mentoria/contratos/[id]/comissoes — comissões do contrato, com o
// valorComissao calculado (nunca persistido) e o resumo financeiro.
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  const erroAcesso = await exigirAcessoMentoria(usuario);
  if (erroAcesso) return erroAcesso;

  const { id } = await ctx.params;
  const contrato = await prisma.mentoriaContrato.findUnique({ where: { id } });
  if (!contrato || contrato.clinicaId !== usuario.clinicaId) {
    return NextResponse.json({ erro: "contrato não encontrado" }, { status: 404 });
  }

  const comissoes = await prisma.mentoriaComissao.findMany({
    where: { contratoId: id },
    include: { comissionado: { select: { id: true, nome: true } } },
    orderBy: { criadoEm: "asc" },
  });

  const baseComissionavel = calcularBaseComissionavel(Number(contrato.valorTotal), Number(contrato.taxaImpostoPct));
  const comissoesCalculadas = comissoes.map((c) => ({
    ...c,
    valorComissao: calcularValorComissao(baseComissionavel, Number(c.percentual)),
  }));
  const somaComissoes = comissoesCalculadas.reduce((soma, c) => soma + c.valorComissao, 0);
  const liquidoPamela = Math.round((baseComissionavel - somaComissoes) * 100) / 100;

  return NextResponse.json({
    comissoes: comissoesCalculadas,
    baseComissionavel,
    somaComissoes: Math.round(somaComissoes * 100) / 100,
    liquidoPamela,
  });
}

// POST /api/mentoria/contratos/[id]/comissoes — vincula uma comissão ao contrato
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  const erroAcesso = await exigirAcessoMentoria(usuario);
  if (erroAcesso) return erroAcesso;

  const { id } = await ctx.params;
  const contrato = await prisma.mentoriaContrato.findUnique({ where: { id } });
  if (!contrato || contrato.clinicaId !== usuario.clinicaId) {
    return NextResponse.json({ erro: "contrato não encontrado" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ erro: "corpo da requisição inválido" }, { status: 400 });

  const { comissionadoId, papel, percentual } = body;
  if (!comissionadoId || typeof comissionadoId !== "string") {
    return NextResponse.json({ erro: "comissionadoId é obrigatório" }, { status: 400 });
  }
  const comissionado = await prisma.comissionado.findUnique({ where: { id: comissionadoId } });
  if (!comissionado || comissionado.clinicaId !== usuario.clinicaId) {
    return NextResponse.json({ erro: "comissionado não encontrado" }, { status: 404 });
  }
  if (!PAPEIS_COMISSAO.includes(papel)) {
    return NextResponse.json({ erro: "papel é obrigatório e deve ser um valor válido" }, { status: 400 });
  }
  if (typeof percentual !== "number" || !(percentual > 0) || percentual > 1) {
    return NextResponse.json({ erro: "percentual deve ser um número maior que zero e menor ou igual a 1" }, { status: 400 });
  }

  const comissao = await prisma.mentoriaComissao.create({
    data: {
      clinicaId: usuario.clinicaId,
      contratoId: id,
      comissionadoId,
      papel,
      percentual,
    },
  });

  await registrarLog(
    usuario.clinicaId,
    usuario.id,
    "CRIAR_COMISSAO_MENTORIA",
    `Vinculou comissão de ${comissionado.nome} (${papel}, ${percentual * 100}%) ao contrato "${contrato.pacote}"`
  );

  return NextResponse.json(comissao, { status: 201 });
}
