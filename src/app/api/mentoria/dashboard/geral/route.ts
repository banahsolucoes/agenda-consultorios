import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { exigirAcessoMentoria, arred2, numOrZero } from "@/lib/mentoria";

// GET /api/mentoria/dashboard/geral — indicadores globais, independentes de
// mês: contratosAtivos e totalAReceberGeral (carteira futura inteira). Só leitura.
export async function GET() {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  const erroAcesso = await exigirAcessoMentoria(usuario);
  if (erroAcesso) return erroAcesso;

  const [contratosAtivos, parcelasAbertas] = await Promise.all([
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
  ]);

  const totalAReceberGeral = arred2(parcelasAbertas.reduce((soma, p) => soma + numOrZero(p.valorBruto), 0));

  return NextResponse.json({ contratosAtivos, totalAReceberGeral });
}
