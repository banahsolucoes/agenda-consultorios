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

  const movimentos: { id: string; novaData: Date }[] = [];
  for (const s of sessoes) {
    if (s.inicio < agora) continue;
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

  for (const mov of movimentos) {
    await prisma.agendamento.update({
      where: { id: mov.id },
      data: { inicio: mov.novaData, status: "AGENDADA" },
    });
  }

  return NextResponse.json({ empurradas: movimentos.length, semanas });
}
