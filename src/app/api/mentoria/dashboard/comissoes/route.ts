import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { exigirAcessoMentoria, arred2, calcularValorComissaoVinculo } from "@/lib/mentoria";

// GET /api/mentoria/dashboard/comissoes — total a pagar por comissionado
// ativo (só as comissões PENDENTE contam; PAGO e ESTORNADO ficam de fora).
export async function GET() {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  const erroAcesso = await exigirAcessoMentoria(usuario);
  if (erroAcesso) return erroAcesso;

  const comissionados = await prisma.comissionado.findMany({
    where: { clinicaId: usuario.clinicaId, ativo: true },
    include: {
      comissoes: {
        where: { status: "PENDENTE" },
        include: {
          contrato: {
            select: {
              id: true,
              valorTotal: true,
              taxaImpostoPct: true,
              status: true,
              parcelas: { where: { dataPagamento: { not: null }, estornoEm: null }, select: { valorLiquido: true } },
            },
          },
        },
      },
    },
    orderBy: { nome: "asc" },
  });

  let totalGeralAPagar = 0;
  const linhas = comissionados.map((c) => {
    const contratosSet = new Set<string>();
    let totalAPagar = 0;
    for (const comissao of c.comissoes) {
      const parcelasPagas = comissao.contrato.parcelas.map((p) => ({ valorLiquido: Number(p.valorLiquido) }));
      totalAPagar += calcularValorComissaoVinculo(
        { status: comissao.status, formaRecebimento: comissao.formaRecebimento, percentual: Number(comissao.percentual) },
        {
          valorTotal: Number(comissao.contrato.valorTotal),
          taxaImpostoPct: Number(comissao.contrato.taxaImpostoPct),
          status: comissao.contrato.status,
        },
        parcelasPagas
      );
      contratosSet.add(comissao.contrato.id);
    }
    totalAPagar = arred2(totalAPagar);
    totalGeralAPagar += totalAPagar;

    return { id: c.id, nome: c.nome, totalAPagar, qtdContratos: contratosSet.size };
  });

  return NextResponse.json({ comissionados: linhas, totalGeralAPagar: arred2(totalGeralAPagar) });
}
