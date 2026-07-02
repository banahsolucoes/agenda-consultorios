import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET /api/pacientes?clinicaId=xxx — lista pacientes da clínica
export async function GET(req: NextRequest) {
  const clinicaId = req.nextUrl.searchParams.get("clinicaId");

  if (!clinicaId) {
    return NextResponse.json(
      { erro: "clinicaId é obrigatório" },
      { status: 400 }
    );
  }

  const pacientes = await prisma.paciente.findMany({
    where: { clinicaId },
    orderBy: { nome: "asc" },
  });

  return NextResponse.json(pacientes);
}

// POST /api/pacientes — cadastra paciente
export async function POST(req: NextRequest) {
  const body = await req.json();

  const obrigatorios = ["clinicaId", "nome", "diaPreferido", "horarioFixo", "tipoSessao"];
  for (const campo of obrigatorios) {
    if (!body[campo]) {
      return NextResponse.json(
        { erro: `${campo} é obrigatório` },
        { status: 400 }
      );
    }
  }

  const paciente = await prisma.paciente.create({
    data: {
      clinicaId: body.clinicaId,
      nome: body.nome,
      telefone: body.telefone ?? null,
      email: body.email ?? null,
      diaPreferido: body.diaPreferido,
      horarioFixo: body.horarioFixo,
      tipoSessao: body.tipoSessao,
    },
  });

  return NextResponse.json(paciente, { status: 201 });
}
