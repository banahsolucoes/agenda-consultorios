import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import {
  exigirAcessoMentoria,
  parseMesParam,
  calcularAgregadosMensais,
  calcularBaseComissionavel,
  calcularValorComissao,
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

  const [comissoesPendentes, comissoesPagasNoMes] = await Promise.all([
    prisma.mentoriaComissao.findMany({
      where: { clinicaId: usuario.clinicaId, status: "PENDENTE" },
      include: { contrato: { select: { valorTotal: true, taxaImpostoPct: true } } },
    }),
    prisma.mentoriaComissao.findMany({
      where: { clinicaId: usuario.clinicaId, status: "PAGO", dataPagamento: { gte: mesInfo.inicio, lt: mesInfo.fim } },
      include: { contrato: { select: { valorTotal: true, taxaImpostoPct: true } } },
    }),
  ]);

  const somaComissoes = (lista: typeof comissoesPendentes) =>
    lista.reduce((soma, c) => {
      const base = calcularBaseComissionavel(Number(c.contrato.valorTotal), Number(c.contrato.taxaImpostoPct));
      return soma + calcularValorComissao(base, Number(c.percentual));
    }, 0);

  const totalComissoesAPagar = arred2(somaComissoes(comissoesPendentes));
  const totalComissoesPagasNoMes = somaComissoes(comissoesPagasNoMes);
  const liquidoPamelaNoMes = arred2(recebidoLiquidoNoMes - totalComissoesPagasNoMes);

  return NextResponse.json({
    mes: `${mesInfo.ano}${String(mesInfo.mes).padStart(2, "0")}`,
    recebidoLiquidoNoMes,
    aReceberNoMes,
    inadimplenteNoMes,
    totalComissoesAPagar,
    liquidoPamelaNoMes,
  });
}
