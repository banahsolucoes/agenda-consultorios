import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });

  const { id: pacienteId } = await ctx.params;
  const paciente = await prisma.paciente.findUnique({ where: { id: pacienteId } });
  if (!paciente || paciente.clinicaId !== usuario.clinicaId) {
    return NextResponse.json({ erro: "paciente não encontrado" }, { status: 404 });
  }

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
