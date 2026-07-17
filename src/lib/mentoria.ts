import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Papéis liberados para o módulo Mentoria — não existe capacidade
// correspondente em permissoes.ts (é um par de papéis, não uma capacidade),
// então a checagem é direta contra usuario.papel, como já se faz em outros
// pontos do código (ex.: POST /api/auth/signup).
const PAPEIS_MENTORIA = ["PROFISSIONAL", "ADMIN"];

// Guarda de acesso comum a todas as rotas de /api/mentoria/**: exige papel
// PROFISSIONAL/ADMIN e a clínica com o módulo ativado (Clinica.mentoriaAtivada).
// Retorna a NextResponse de erro (403) pra rota devolver direto, ou null se liberado.
export async function exigirAcessoMentoria(usuario: { clinicaId: string; papel: string }): Promise<NextResponse | null> {
  if (!PAPEIS_MENTORIA.includes(usuario.papel)) {
    return NextResponse.json({ erro: "sem permissão para o módulo Mentoria" }, { status: 403 });
  }

  const clinica = await prisma.clinica.findUnique({
    where: { id: usuario.clinicaId },
    select: { mentoriaAtivada: true },
  });
  if (!clinica?.mentoriaAtivada) {
    return NextResponse.json({ erro: "módulo Mentoria não está ativado para esta clínica" }, { status: 403 });
  }

  return null;
}

export type ResultadoValidacaoSoma =
  | { ok: true }
  | { ok: false; esperado: number; informado: number; diferenca: number };

// Regra de negócio: a soma dos valorLiquido de todas as parcelas de um
// contrato tem que bater com valorTotal, com tolerância de arredondamento de
// ±R$0,01. valorBruto fica de fora dessa checagem — a diferença bruto x
// líquido é a taxa de cartão, esperada e nunca validada contra o total.
export function validarSomaLiquido(parcelas: { valorLiquido: number }[], valorTotal: number): ResultadoValidacaoSoma {
  const somaBruta = parcelas.reduce((soma, p) => soma + p.valorLiquido, 0);
  const informado = Math.round(somaBruta * 100) / 100;
  const diferenca = Math.round((informado - valorTotal) * 100) / 100;
  if (Math.abs(diferenca) > 0.01) {
    return { ok: false, esperado: valorTotal, informado, diferenca };
  }
  return { ok: true };
}
