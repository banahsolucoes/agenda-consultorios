import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// POST /api/pacientes/[id]/adiar  body: { sessaoCorteId: string }
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id: pacienteId } = await ctx.params;
  const body = await req.json();
  const { sessaoCorteId } = body;

  if (!sessaoCorteId) {
    return NextResponse.json({ erro: "sessaoCorteId é obrigatório" }, { status: 400 });
  }

  const sessoes = await prisma.agendamento.findMany({
    where: { pacienteId, status: { notIn: ["CANCELADA"] } },
    orderBy: { numeroSessao: "asc" },
  });

  const corte = sessoes.find((s) => s.id === sessaoCorteId);
  if (!corte) {
    return NextResponse.json({ erro: "sessão de corte não encontrada" }, { status: 404 });
  }

  // corte + todas as seguintes (por número) voltam 7 dias
  let adiadas = 0;
  for (const s of sessoes) {
    if (s.numeroSessao < corte.numeroSessao) continue;
    const novaData = new Date(s.inicio);
    novaData.setDate(novaData.getDate() - 7);
    await prisma.agendamento.update({
      where: { id: s.id },
      data: { inicio: novaData, status: "AGENDADA" },
    });
    adiadas++;
  }

  return NextResponse.json({ adiadas, aPartirDe: corte.numeroSessao });
}
