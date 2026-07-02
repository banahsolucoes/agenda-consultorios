import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET /api/clinicas — lista todas
export async function GET() {
  const clinicas = await prisma.clinica.findMany({
    orderBy: { criadoEm: "desc" },
  });
  return NextResponse.json(clinicas);
}

// POST /api/clinicas — cria uma
export async function POST(req: NextRequest) {
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
