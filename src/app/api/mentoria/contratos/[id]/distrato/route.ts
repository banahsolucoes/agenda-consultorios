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

// POST /api/mentoria/contratos/[id]/distrato — cancela o contrato e, na
// mesma transação, estorna as parcelas já pagas (se pedido) e SEMPRE estorna
// todas as comissões do contrato ainda não estornadas. Atômico: qualquer
// falha desfaz tudo.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  const erroAcesso = await exigirAcessoMentoria(usuario);
  if (erroAcesso) return erroAcesso;

  const { id } = await ctx.params;
  const contrato = await prisma.mentoriaContrato.findUnique({
    where: { id },
    include: { parcelas: true, comissoes: true },
  });
  if (!contrato || contrato.clinicaId !== usuario.clinicaId) {
    return NextResponse.json({ erro: "contrato não encontrado" }, { status: 404 });
  }
  if (contrato.status !== "ATIVO") {
    return NextResponse.json({ erro: "contrato não está ativo — só é possível distratar um contrato ativo" }, { status: 409 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ erro: "corpo da requisição inválido" }, { status: 400 });

  if (!body.motivoCancelamento || typeof body.motivoCancelamento !== "string") {
    return NextResponse.json({ erro: "motivoCancelamento é obrigatório" }, { status: 400 });
  }

  let dataDistrato = new Date();
  if (body.dataDistrato !== undefined) {
    const parsed = parseData(body.dataDistrato);
    if (!parsed) {
      return NextResponse.json({ erro: "dataDistrato deve ser uma data válida" }, { status: 400 });
    }
    dataDistrato = parsed;
  }

  const estornarParcelasPagas = body.estornarParcelasPagas === undefined ? true : Boolean(body.estornarParcelasPagas);

  const parcelasPagas = contrato.parcelas.filter((p) => p.dataPagamento !== null && p.estornoEm === null);
  const comissoesAEstornar = contrato.comissoes.filter((c) => c.status !== "ESTORNADO");

  await prisma.$transaction(async (tx) => {
    await tx.mentoriaContrato.update({
      where: { id },
      data: { status: "CANCELADO", canceladoEm: dataDistrato, motivoCancelamento: body.motivoCancelamento },
    });

    if (estornarParcelasPagas) {
      for (const parcela of parcelasPagas) {
        await tx.mentoriaParcela.update({
          where: { id: parcela.id },
          data: { estornoEm: dataDistrato, valorEstornado: parcela.valorLiquido },
        });
      }
    }

    if (comissoesAEstornar.length > 0) {
      await tx.mentoriaComissao.updateMany({
        where: { id: { in: comissoesAEstornar.map((c) => c.id) } },
        data: { status: "ESTORNADO", estornoEm: dataDistrato },
      });
    }
  });

  const qtdParcelasEstornadas = estornarParcelasPagas ? parcelasPagas.length : 0;
  await registrarLog(
    usuario.clinicaId,
    usuario.id,
    "DISTRATAR_CONTRATO_MENTORIA",
    `Distratou o contrato "${contrato.pacote}" (motivo: ${body.motivoCancelamento}) — ${qtdParcelasEstornadas} parcela(s) estornada(s), ${comissoesAEstornar.length} comissão(ões) estornada(s)`
  );

  return NextResponse.json({
    ok: true,
    parcelasEstornadas: qtdParcelasEstornadas,
    comissoesEstornadas: comissoesAEstornar.length,
  });
}
