import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";

// Início (segunda-feira, 00:00 local) da semana que contém a data informada
function inicioDaSemana(data: Date): Date {
  const d = new Date(data.getFullYear(), data.getMonth(), data.getDate());
  const diaSem = d.getDay(); // 0 = domingo ... 6 = sábado
  const distSeg = diaSem === 0 ? 6 : diaSem - 1;
  d.setDate(d.getDate() - distSeg);
  return d;
}

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

  const anteriores = sessoes.filter((s) => s.numeroSessao < corte.numeroSessao);
  const aMover = sessoes.filter((s) => s.numeroSessao >= corte.numeroSessao);

  // Regra de conflito: a sessão de corte recuada 7 dias não pode cair na mesma
  // semana (segunda a domingo) de uma sessão anterior que não será movida.
  // Se colidir, bloqueia a operação inteira — nada é movido.
  const novaSemanaCorte = inicioDaSemana(
    new Date(corte.inicio.getTime() - 7 * 24 * 60 * 60 * 1000)
  ).getTime();
  const colide = anteriores.some((s) => inicioDaSemana(s.inicio).getTime() === novaSemanaCorte);
  if (colide) {
    return NextResponse.json(
      { erro: "Não é possível adiar: já existe uma sessão nesta semana." },
      { status: 400 }
    );
  }

  await prisma.$transaction(
    aMover.map((s) => {
      const novaData = new Date(s.inicio);
      novaData.setDate(novaData.getDate() - 7);
      return prisma.agendamento.update({
        where: { id: s.id },
        data: { inicio: novaData, status: "AGENDADA" },
      });
    })
  );

  return NextResponse.json({ adiadas: aMover.length, aPartirDe: corte.numeroSessao });
}
