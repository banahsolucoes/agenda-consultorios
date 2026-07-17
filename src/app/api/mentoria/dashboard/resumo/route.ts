import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import {
  exigirAcessoMentoria,
  parseMesParam,
  calcularAgregadosMensais,
  calcularValorComissaoVinculo,
  calcularImpostoNoMes,
  calcularComissaoNoMes,
  calcularComissaoPendenteNoMes,
  calcularInadimplenciaAtual,
  arred2,
} from "@/lib/mentoria";

// GET /api/mentoria/dashboard/resumo?mes=YYYYMM — consolidado do topo do
// dashboard (default: mês atual). Só leitura.
export async function GET(req: NextRequest) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  const erroAcesso = await exigirAcessoMentoria(usuario);
  if (erroAcesso) return erroAcesso;

  const { searchParams } = new URL(req.url);
  const mesInfo = parseMesParam(searchParams.get("mes"));
  if (!mesInfo) {
    return NextResponse.json({ erro: "mes inválido — use o formato YYYYMM" }, { status: 400 });
  }

  const { recebidoLiquidoNoMes, aReceberNoMes, inadimplenteNoMes } = await calcularAgregadosMensais(
    usuario.clinicaId,
    mesInfo.inicio,
    mesInfo.fim
  );

  const [comissoesPendentes, impostoNoMes, comissaoLiberadaNoMes, comissaoPendenteNoMes, inadimplenciaAtual] =
    await Promise.all([
      prisma.mentoriaComissao.findMany({
        where: { clinicaId: usuario.clinicaId, status: "PENDENTE" },
        include: {
          contrato: {
            select: {
              valorTotal: true,
              taxaImpostoPct: true,
              status: true,
              parcelas: { where: { dataPagamento: { not: null }, estornoEm: null }, select: { valorLiquido: true } },
            },
          },
        },
      }),
      calcularImpostoNoMes(usuario.clinicaId, mesInfo.inicio, mesInfo.fim),
      calcularComissaoNoMes(usuario.clinicaId, mesInfo.inicio, mesInfo.fim),
      calcularComissaoPendenteNoMes(usuario.clinicaId, mesInfo.inicio, mesInfo.fim),
      calcularInadimplenciaAtual(usuario.clinicaId),
    ]);

  // Saldo de dívida — comissões PENDENTE, independente do mês selecionado.
  const totalComissoesAPagar = arred2(
    comissoesPendentes.reduce((soma, c) => {
      const parcelasPagas = c.contrato.parcelas.map((p) => ({ valorLiquido: Number(p.valorLiquido) }));
      return (
        soma +
        calcularValorComissaoVinculo(
          { status: c.status, formaRecebimento: c.formaRecebimento, percentual: Number(c.percentual) },
          { valorTotal: Number(c.contrato.valorTotal), taxaImpostoPct: Number(c.contrato.taxaImpostoPct), status: c.contrato.status },
          parcelasPagas
        )
      );
    }, 0)
  );

  // Líquido Pâmela por competência: recebido líquido do mês, menos imposto e
  // comissão devidos naquele mês (independe de a comissão já ter sido
  // repassada). Cálculo mantido no backend mas não exibido no dashboard.
  const liquidoPamelaNoMes = arred2(recebidoLiquidoNoMes - impostoNoMes - comissaoLiberadaNoMes);

  return NextResponse.json({
    mes: `${mesInfo.ano}${String(mesInfo.mes).padStart(2, "0")}`,
    recebidoLiquidoNoMes,
    aReceberNoMes,
    inadimplenteNoMes,
    totalComissoesAPagar,
    impostoNoMes,
    liquidoPamelaNoMes,
    comissaoLiberadaNoMes,
    comissaoPendenteNoMes,
    inadimplenciaAtual,
  });
}
