import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";

const DIAS_VALIDOS = [
  "SEGUNDA", "TERCA", "QUARTA", "QUINTA", "SEXTA", "SABADO", "DOMINGO",
];
const HORA_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

// GET /api/clinica/horarios — lista as faixas de horário de trabalho da clínica
export async function GET() {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });

  const horarios = await prisma.horarioTrabalho.findMany({
    where: { clinicaId: usuario.clinicaId },
    orderBy: [{ diaSemana: "asc" }, { horaInicio: "asc" }],
  });

  return NextResponse.json(horarios);
}

// POST /api/clinica/horarios — cria uma faixa de atendimento num dia da semana
export async function POST(req: NextRequest) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });

  const body = await req.json();
  const { diaSemana, horaInicio, horaFim } = body;

  if (!DIAS_VALIDOS.includes(diaSemana)) {
    return NextResponse.json({ erro: "diaSemana inválido" }, { status: 400 });
  }
  if (!HORA_REGEX.test(horaInicio) || !HORA_REGEX.test(horaFim)) {
    return NextResponse.json({ erro: "horaInicio/horaFim devem estar no formato HH:MM" }, { status: 400 });
  }
  if (horaInicio >= horaFim) {
    return NextResponse.json({ erro: "horaInicio deve ser antes de horaFim" }, { status: 400 });
  }

  const horario = await prisma.horarioTrabalho.create({
    data: { clinicaId: usuario.clinicaId, diaSemana, horaInicio, horaFim },
  });

  return NextResponse.json(horario, { status: 201 });
}

// DELETE /api/clinica/horarios?id=... — remove uma faixa de atendimento
export async function DELETE(req: NextRequest) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ erro: "id é obrigatório" }, { status: 400 });

  const horario = await prisma.horarioTrabalho.findUnique({ where: { id } });
  if (!horario || horario.clinicaId !== usuario.clinicaId) {
    return NextResponse.json({ erro: "horário não encontrado" }, { status: 404 });
  }

  await prisma.horarioTrabalho.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
