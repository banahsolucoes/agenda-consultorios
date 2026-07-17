import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { registrarLog } from "@/lib/auditoria";
import { exigirAcessoMentoria, calcularBaseComissionavel, calcularValorComissaoVinculo } from "@/lib/mentoria";

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

  const [comissoes, parcelasPagas] = await Promise.all([
    prisma.mentoriaComissao.findMany({
      where: { contratoId: id },
      include: { comissionado: { select: { id: true, nome: true } } },
      orderBy: { criadoEm: "asc" },
    }),
    prisma.mentoriaParcela.findMany({
      where: { contratoId: id, dataPagamento: { not: null }, estornoEm: null },
      select: { valorLiquido: true },
    }),
  ]);

  const contratoParaCalculo = {
    valorTotal: Number(contrato.valorTotal),
    taxaImpostoPct: Number(contrato.taxaImpostoPct),
    status: contrato.status,
  };
  const parcelasPagasNum = parcelasPagas.map((p) => ({ valorLiquido: Number(p.valorLiquido) }));

  const baseComissionavel = calcularBaseComissionavel(contratoParaCalculo.valorTotal, contratoParaCalculo.taxaImpostoPct);
  const comissoesCalculadas = comissoes.map((c) => ({
    ...c,
    valorComissao: calcularValorComissaoVinculo(
      { status: c.status, formaRecebimento: c.formaRecebimento, percentual: Number(c.percentual) },
      contratoParaCalculo,
      parcelasPagasNum
    ),
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

  const { comissionadoId, papel } = body;
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
  // Percentual e forma de recebimento são atributos fixos do comissionado —
  // copiados e travados no vínculo, nunca aceitos do corpo da requisição.
  if (comissionado.percentualComissao === null) {
    return NextResponse.json(
      { erro: "este comissionado não tem percentual de comissão definido — complete o cadastro dele antes de vincular" },
      { status: 422 }
    );
  }
  const percentual = Number(comissionado.percentualComissao);

  const comissao = await prisma.mentoriaComissao.create({
    data: {
      clinicaId: usuario.clinicaId,
      contratoId: id,
      comissionadoId,
      papel,
      percentual,
      formaRecebimento: comissionado.formaRecebimento,
    },
  });

  await registrarLog(
    usuario.clinicaId,
    usuario.id,
    "CRIAR_COMISSAO_MENTORIA",
    `Vinculou comissão de ${comissionado.nome} (${papel}, ${percentual * 100}%, ${comissionado.formaRecebimento}) ao contrato "${contrato.pacote}"`
  );

  return NextResponse.json(comissao, { status: 201 });
}
