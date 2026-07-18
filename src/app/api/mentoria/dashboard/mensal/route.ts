import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import {
  exigirAcessoMentoria,
  parseMesParam,
  calcularAgregadosMensais,
  derivarStatusParcela,
  numOrZero,
  arred2,
} from "@/lib/mentoria";

// GET /api/mentoria/dashboard/mensal?mes=YYYYMM — só leitura, consolida os
// números do mês (default: mês atual).
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

  // Agregados do mês e a lista completa de parcelas do mês não dependem um
  // do outro — rodam em paralelo em vez de esperar o primeiro pra só então
  // começar o segundo (achado 3 da auditoria de performance).
  const [agregados, parcelas] = await Promise.all([
    calcularAgregadosMensais(usuario.clinicaId, mesInfo.inicio, mesInfo.fim),
    prisma.mentoriaParcela.findMany({
      where: { clinicaId: usuario.clinicaId, vencimento: { gte: mesInfo.inicio, lt: mesInfo.fim } },
      include: {
        contrato: {
          select: {
            status: true,
            totalParcelas: true,
            taxaImpostoPct: true,
            aluno: { select: { nomeCompleto: true } },
            comissoes: {
              where: { formaRecebimento: "POR_PARCELA", status: { not: "ESTORNADO" } },
              include: { comissionado: { select: { id: true, nome: true } } },
            },
          },
        },
      },
      orderBy: { vencimento: "asc" },
    }),
  ]);

  // Comissão gerada por parcela — derivada, nunca persistida. Estornada ou
  // contrato CANCELADO: nenhuma comissão.
  const parcelasDoMes = parcelas.map((p) => {
    const parcelaEstornada = p.estornoEm !== null;
    const contratoCancelado = p.contrato.status === "CANCELADO";
    const valorLiquido = numOrZero(p.valorLiquido);
    const taxaImposto = Number(p.contrato.taxaImpostoPct);
    const comissoesDaParcela =
      parcelaEstornada || contratoCancelado
        ? []
        : p.contrato.comissoes.map((c) => ({
            comissionadoId: c.comissionadoId,
            comissionadoNome: c.comissionado.nome,
            percentual: Number(c.percentual),
            valor: arred2(valorLiquido * (1 - taxaImposto) * Number(c.percentual)),
            devida: p.dataPagamento !== null && p.estornoEm === null,
          }));
    const totalComissaoParcela = arred2(comissoesDaParcela.reduce((soma, c) => soma + c.valor, 0));

    return {
      parcelaId: p.id,
      numero: p.numero,
      alunoNome: p.contrato.aluno.nomeCompleto,
      contratoId: p.contratoId,
      registro: `${p.numero} de ${p.contrato.totalParcelas}`,
      vencimento: p.vencimento,
      valorBruto: numOrZero(p.valorBruto),
      valorLiquido: p.valorLiquido === null ? null : valorLiquido,
      statusDerivado: derivarStatusParcela(p, p.contrato.status),
      comissoesDaParcela,
      totalComissaoParcela,
    };
  });

  return NextResponse.json({
    mes: `${mesInfo.ano}${String(mesInfo.mes).padStart(2, "0")}`,
    ...agregados,
    parcelasDoMes,
  });
}
