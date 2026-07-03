import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// GET /api/agendamentos?pacienteId=xxx
export async function GET(req: NextRequest) {
  const pacienteId = req.nextUrl.searchParams.get("pacienteId");
  if (!pacienteId) {
    return NextResponse.json({ erro: "pacienteId é obrigatório" }, { status: 400 });
  }
  const sessoes = await prisma.agendamento.findMany({
    where: { pacienteId },
    orderBy: { numeroSessao: "asc" },
  });
  return NextResponse.json(sessoes);
}
