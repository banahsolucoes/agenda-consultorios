import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";

// Offset em dias a partir da segunda-feira (0) de cada dia da semana
const DIA_OFFSET: Record<string, number> = {
  SEGUNDA: 0,
  TERCA: 1,
  QUARTA: 2,
  QUINTA: 3,
  SEXTA: 4,
  SABADO: 5,
  DOMINGO: 6,
};
const HORA_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

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
  const semanas = Math.max(0, Math.min(10, Number(body.semanas) || 0));
  if (semanas === 0) {
    return NextResponse.json({ erro: "informe semanas entre 1 e 10" }, { status: 400 });
  }

  // novoDia/novoHorario são opcionais — quando informados, além de empurrar N
  // semanas, o dia da semana e o horário de cada sessão também são trocados.
  let diaAlvo: number | null = null;
  let horaAlvo: { h: number; m: number } | null = null;
  if (body.novoDia || body.novoHorario) {
    if (!body.novoDia || !(body.novoDia in DIA_OFFSET)) {
      return NextResponse.json({ erro: "novoDia inválido" }, { status: 400 });
    }
    if (!body.novoHorario || !HORA_REGEX.test(body.novoHorario)) {
      return NextResponse.json({ erro: "novoHorario deve estar no formato HH:MM" }, { status: 400 });
    }
    diaAlvo = DIA_OFFSET[body.novoDia];
    const [h, m] = body.novoHorario.split(":").map(Number);
    horaAlvo = { h, m };
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
    let novaData = new Date(s.inicio);
    novaData.setDate(novaData.getDate() + semanas * 7);

    if (diaAlvo !== null && horaAlvo) {
      const semana = inicioDaSemana(novaData);
      novaData = new Date(semana);
      novaData.setDate(semana.getDate() + diaAlvo);
      novaData.setHours(horaAlvo.h, horaAlvo.m, 0, 0);
    }

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

  await prisma.$transaction(
    movimentos.map((mov) =>
      prisma.agendamento.update({
        where: { id: mov.id },
        data: { inicio: mov.novaData, status: "AGENDADA" },
      })
    )
  );

  return NextResponse.json({ empurradas: movimentos.length, semanas });
}
