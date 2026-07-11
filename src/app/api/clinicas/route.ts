import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";

// GET /api/clinicas — retorna só a clínica do usuário logado. Nunca lista
// outros tenants (antes listava TODAS as clínicas do sistema, vazando
// clinicaId de outras clínicas para qualquer usuário autenticado).
export async function GET() {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });

  const clinicas = await prisma.clinica.findMany({
    where: { id: usuario.clinicaId },
  });

  return NextResponse.json(clinicas);
}

// POST /api/clinicas — cria uma clínica nova (uso administrativo). Exige
// estar autenticado; para criar a primeira clínica + o admin dela sem login
// prévio, use /api/auth/signup com clinicaNome.
export async function POST(req: NextRequest) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });

  const body = await req.json();

  if (!body.nome || !body.slug) {
    return NextResponse.json(
      { erro: "nome e slug são obrigatórios" },
      { status: 400 }
    );
  }

  const clinica = await prisma.clinica.create({
    data: { nome: body.nome, slug: body.slug },
  });

  return NextResponse.json(clinica, { status: 201 });
}
