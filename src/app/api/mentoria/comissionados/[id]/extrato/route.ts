import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { exigirAcessoMentoria, calcularBaseComissionavel, calcularValorComissao, arred2, numOrZero } from "@/lib/mentoria";

// GET /api/mentoria/comissionados/[id]/extrato — extrato do que o
// comissionado tem a receber, por contrato/parcela. Cálculo derivado (mesma
// regra da Fase 6B), nunca persistido. Só leitura.
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  const erroAcesso = await exigirAcessoMentoria(usuario);
  if (erroAcesso) return erroAcesso;

  const { id } = await ctx.params;
  const comissionado = await prisma.comissionado.findUnique({ where: { id } });
  if (!comissionado || comissionado.clinicaId !== usuario.clinicaId) {
    return NextResponse.json({ erro: "comissionado não encontrado" }, { status: 404 });
  }

  const comissoes = await prisma.mentoriaComissao.findMany({
    where: {
      comissionadoId: id,
      clinicaId: usuario.clinicaId,
      status: { not: "ESTORNADO" },
      contrato: { status: { not: "CANCELADO" } },
    },
    include: {
      contrato: {
        select: {
          id: true,
          valorTotal: true,
          taxaImpostoPct: true,
          assinaturaContrato: true,
          status: true,
          totalParcelas: true,
          aluno: { select: { nomeCompleto: true } },
          parcelas: { orderBy: { numero: "asc" } },
        },
      },
    },
    orderBy: { criadoEm: "asc" },
  });

  const linhasAdiantado: {
    contratoId: string;
    alunoNome: string;
    valorContrato: number;
    baseComissionavel: number;
    percentual: number;
    valorComissao: number;
    dataReferencia: Date;
    status: "PENDENTE" | "PAGO";
  }[] = [];

  const aReceber: {
    contratoId: string;
    alunoNome: string;
    parcelaNumero: number;
    registro: string;
    valorLiquidoParcela: number;
    percentual: number;
    comissaoParcela: number;
    dataPagamentoParcela: Date;
  }[] = [];

  const previsto: {
    contratoId: string;
    alunoNome: string;
    parcelaNumero: number;
    registro: string;
    valorLiquidoPrevisto: number;
    percentual: number;
    comissaoPrevista: number;
    vencimento: Date;
  }[] = [];

  // Devido no mês (só o que entra no total devido): dataPagamentoParcela
  // (por parcela) ou assinaturaContrato para adiantado ainda não pago.
  const totalPorMes = new Map<string, number>();
  function acumularMes(data: Date, valor: number) {
    const chave = `${data.getUTCFullYear()}${String(data.getUTCMonth() + 1).padStart(2, "0")}`;
    totalPorMes.set(chave, arred2((totalPorMes.get(chave) ?? 0) + valor));
  }

  let totalAReceber = 0;
  let totalPrevisto = 0;

  for (const c of comissoes) {
    const percentual = Number(c.percentual);
    const alunoNome = c.contrato.aluno.nomeCompleto;

    if (c.formaRecebimento === "ADIANTADO") {
      const base = calcularBaseComissionavel(Number(c.contrato.valorTotal), Number(c.contrato.taxaImpostoPct));
      const valorComissao = calcularValorComissao(base, percentual);
      linhasAdiantado.push({
        contratoId: c.contrato.id,
        alunoNome,
        valorContrato: Number(c.contrato.valorTotal),
        baseComissionavel: base,
        percentual,
        valorComissao,
        dataReferencia: c.contrato.assinaturaContrato,
        status: c.status as "PENDENTE" | "PAGO",
      });
      if (c.status !== "PAGO") {
        totalAReceber = arred2(totalAReceber + valorComissao);
        acumularMes(c.contrato.assinaturaContrato, valorComissao);
      }
      continue;
    }

    // POR_PARCELA
    for (const p of c.contrato.parcelas) {
      const registro = `${p.numero} de ${c.contrato.totalParcelas}`;
      const paga = p.dataPagamento !== null && p.estornoEm === null;
      const aberta = p.dataPagamento === null && p.estornoEm === null && c.contrato.status === "ATIVO";

      if (paga) {
        const valorLiquido = numOrZero(p.valorLiquido);
        const comissaoParcela = arred2(valorLiquido * percentual);
        aReceber.push({
          contratoId: c.contrato.id,
          alunoNome,
          parcelaNumero: p.numero,
          registro,
          valorLiquidoParcela: valorLiquido,
          percentual,
          comissaoParcela,
          dataPagamentoParcela: p.dataPagamento as Date,
        });
        totalAReceber = arred2(totalAReceber + comissaoParcela);
        acumularMes(p.dataPagamento as Date, comissaoParcela);
      } else if (aberta) {
        const valorLiquidoPrevisto = numOrZero(p.valorLiquido);
        const comissaoPrevista = arred2(valorLiquidoPrevisto * percentual);
        previsto.push({
          contratoId: c.contrato.id,
          alunoNome,
          parcelaNumero: p.numero,
          registro,
          valorLiquidoPrevisto,
          percentual,
          comissaoPrevista,
          vencimento: p.vencimento,
        });
        totalPrevisto = arred2(totalPrevisto + comissaoPrevista);
      }
    }
  }

  const resumoMensal = Array.from(totalPorMes.entries())
    .map(([mesReferencia, totalDoMes]) => ({ mesReferencia, totalDoMes }))
    .sort((a, b) => a.mesReferencia.localeCompare(b.mesReferencia));

  return NextResponse.json({
    comissionado: {
      id: comissionado.id,
      nome: comissionado.nome,
      percentualComissao: comissionado.percentualComissao,
      formaRecebimento: comissionado.formaRecebimento,
    },
    linhasAdiantado,
    porParcela: { aReceber, previsto },
    totalAReceber,
    totalPrevisto,
    resumoMensal,
  });
}
