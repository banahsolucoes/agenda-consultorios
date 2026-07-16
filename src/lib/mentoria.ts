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
