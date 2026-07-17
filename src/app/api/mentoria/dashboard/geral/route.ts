import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { exigirAcessoMentoria, arred2, numOrZero, parseMesParam } from "@/lib/mentoria";

// GET /api/mentoria/dashboard/geral?mes=YYYYMM — indicadores do topo:
// contratosAtivos e totalAReceberGeral (carteira futura inteira, sempre
// independentes do mês) e fechadosNoMes (contagem + valor dos contratos
// assinados no mês selecionado — este sim acompanha o seletor). Só leitura.
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

  const [contratosAtivos, parcelasAbertas, contratosFechadosNoMes] = await Promise.all([
    prisma.mentoriaContrato.count({ where: { clinicaId: usuario.clinicaId, status: "ATIVO" } }),
    prisma.mentoriaParcela.findMany({
      where: {
        clinicaId: usuario.clinicaId,
        dataPagamento: null,
        estornoEm: null,
        contrato: { status: "ATIVO" },
      },
      select: { valorBruto: true },
    }),
    prisma.mentoriaContrato.findMany({
      where: { clinicaId: usuario.clinicaId, assinaturaContrato: { gte: mesInfo.inicio, lt: mesInfo.fim } },
      select: { valorTotal: true },
    }),
  ]);

  const totalAReceberGeral = arred2(parcelasAbertas.reduce((soma, p) => soma + numOrZero(p.valorBruto), 0));
  const fechadosNoMesQtd = contratosFechadosNoMes.length;
  const fechadosNoMesValor = arred2(contratosFechadosNoMes.reduce((soma, c) => soma + numOrZero(c.valorTotal), 0));

  return NextResponse.json({ contratosAtivos, totalAReceberGeral, fechadosNoMesQtd, fechadosNoMesValor });
}
