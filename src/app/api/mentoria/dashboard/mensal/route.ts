import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { exigirAcessoMentoria, parseMesParam, calcularAgregadosMensais, derivarStatusParcela, numOrZero } from "@/lib/mentoria";

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

  const agregados = await calcularAgregadosMensais(usuario.clinicaId, mesInfo.inicio, mesInfo.fim);

  // Todas as parcelas com vencimento no mês, qualquer status — visão completa do mês.
  const parcelas = await prisma.mentoriaParcela.findMany({
    where: { clinicaId: usuario.clinicaId, vencimento: { gte: mesInfo.inicio, lt: mesInfo.fim } },
    include: {
      contrato: { select: { status: true, totalParcelas: true, aluno: { select: { nomeCompleto: true } } } },
    },
    orderBy: { vencimento: "asc" },
  });

  const parcelasDoMes = parcelas.map((p) => ({
    parcelaId: p.id,
    numero: p.numero,
    alunoNome: p.contrato.aluno.nomeCompleto,
    contratoId: p.contratoId,
    registro: `${p.numero} de ${p.contrato.totalParcelas}`,
    vencimento: p.vencimento,
    valorBruto: numOrZero(p.valorBruto),
    valorLiquido: p.valorLiquido === null ? null : numOrZero(p.valorLiquido),
    statusDerivado: derivarStatusParcela(p, p.contrato.status),
  }));

  return NextResponse.json({
    mes: `${mesInfo.ano}${String(mesInfo.mes).padStart(2, "0")}`,
    ...agregados,
    parcelasDoMes,
  });
}
