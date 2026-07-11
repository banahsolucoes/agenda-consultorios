import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { pode } from "@/lib/permissoes";

// GET /api/usuarios — lista os usuários da clínica do usuário logado. Só
// ADMIN (capacidade gerirUsuarios) — mesma regra de quem pode criar usuário
// em /api/auth/signup. clinicaId sempre de getUsuarioLogado(), nunca do body.
export async function GET() {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  if (!pode(usuario.papel, "gerirUsuarios")) {
    return NextResponse.json({ erro: "sem permissão para esta ação" }, { status: 403 });
  }

  const usuarios = await prisma.usuario.findMany({
    where: { clinicaId: usuario.clinicaId },
    select: { id: true, nome: true, email: true, papel: true, criadoEm: true },
    orderBy: { criadoEm: "asc" },
  });

  return NextResponse.json(usuarios);
}
