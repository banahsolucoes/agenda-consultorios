import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

const STATUS_CONSUMIDOS = ["REALIZADA", "NAO_REALIZADA"];

// POST /api/pacientes/[id]/empurrar  body: { semanas: number }
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id: pacienteId } = await ctx.params;
  const body = await req.json();
  const semanas = Math.max(0, Math.min(10, Number(body.semanas) || 0));

  if (semanas === 0) {
    return NextResponse.json({ erro: "informe semanas entre 1 e 10" }, { status: 400 });
  }

  const agora = new Date();
  const hojeZero = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());

  const sessoes = await prisma.agendamento.findMany({
    where: { pacienteId, status: { notIn: ["CANCELADA"] } },
    orderBy: { numeroSessao: "asc" },
  });

  // passo 1: calcula, validação tudo-ou-nada
  const movimentos: { id: string; novaData: Date }[] = [];
  for (const s of sessoes) {
    if (s.inicio < agora) continue; // passadas nunca se movem
    const novaData = new Date(s.inicio);
    novaData.setDate(novaData.getDate() + semanas * 7);
    if (novaData < hojeZero) {
      return NextResponse.json(
        { erro: `Operação bloqueada: sessão ${s.numeroSessao} cairia antes de hoje. Nada foi movido.` },
        { status: 400 }
      );
    }
    movimentos.push({ id: s.id, novaData });
  }

  if (movimentos.length === 0) {
    return NextResponse.json({ erro: "nenhuma sessão futura para mover" }, { status: 400 });
  }

  // passo 2: aplica
  for (const mov of movimentos) {
    await prisma.agendamento.update({
      where: { id: mov.id },
      data: { inicio: mov.novaData, status: "AGENDADA" },
    });
  }

  return NextResponse.json({ empurradas: movimentos.length, semanas });
}
