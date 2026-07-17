import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { exigirAcessoMentoria, arred2, calcularBaseComissionavel, calcularValorComissao } from "@/lib/mentoria";

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
        include: { contrato: { select: { id: true, valorTotal: true, taxaImpostoPct: true } } },
      },
    },
    orderBy: { nome: "asc" },
  });

  let totalGeralAPagar = 0;
  const linhas = comissionados.map((c) => {
    const contratosSet = new Set<string>();
    let totalAPagar = 0;
    for (const comissao of c.comissoes) {
      const base = calcularBaseComissionavel(Number(comissao.contrato.valorTotal), Number(comissao.contrato.taxaImpostoPct));
      totalAPagar += calcularValorComissao(base, Number(comissao.percentual));
      contratosSet.add(comissao.contrato.id);
    }
    totalAPagar = arred2(totalAPagar);
    totalGeralAPagar += totalAPagar;

    return { nome: c.nome, totalAPagar, qtdContratos: contratosSet.size };
  });

  return NextResponse.json({ comissionados: linhas, totalGeralAPagar: arred2(totalGeralAPagar) });
}
