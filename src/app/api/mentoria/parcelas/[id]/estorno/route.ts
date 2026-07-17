import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { registrarLog } from "@/lib/auditoria";
import { exigirAcessoMentoria } from "@/lib/mentoria";

// POST /api/mentoria/parcelas/[id]/estorno — reverte a baixa de uma parcela
// paga. Histórico preservado: dataPagamento/valorLiquido/formaPagamento não
// são apagados, só marca estornoEm + valorEstornado.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  const erroAcesso = await exigirAcessoMentoria(usuario);
  if (erroAcesso) return erroAcesso;

  const { id } = await ctx.params;
  const parcela = await prisma.mentoriaParcela.findUnique({ where: { id } });
  if (!parcela || parcela.clinicaId !== usuario.clinicaId) {
    return NextResponse.json({ erro: "parcela não encontrada" }, { status: 404 });
  }

  const paga = parcela.dataPagamento !== null && parcela.estornoEm === null;
  if (!paga) {
    return NextResponse.json({ erro: "parcela não está paga ou já foi estornada" }, { status: 409 });
  }

  const body = await req.json().catch(() => ({}));

  let valorEstornado: number;
  if (body?.valorEstornado !== undefined) {
    if (typeof body.valorEstornado !== "number" || !(body.valorEstornado > 0)) {
      return NextResponse.json({ erro: "valorEstornado deve ser um número maior que zero" }, { status: 400 });
    }
    valorEstornado = body.valorEstornado;
  } else {
    valorEstornado = Number(parcela.valorLiquido);
  }

  const atualizada = await prisma.mentoriaParcela.update({
    where: { id },
    data: { estornoEm: new Date(), valorEstornado },
  });

  await registrarLog(
    usuario.clinicaId,
    usuario.id,
    "ESTORNAR_PARCELA_MENTORIA",
    `Estornou a parcela ${atualizada.numero} do contrato ${atualizada.contratoId} (valor estornado ${valorEstornado})`
  );

  return NextResponse.json(atualizada);
}
