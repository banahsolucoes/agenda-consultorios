import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";

const TOTAL_POR_TIPO: Record<string, number> = {
  AVULSA: 1, MENSAL: 4, BIMESTRAL: 8, TRIMESTRAL: 12,
};
const DIA_NUM: Record<string, number> = {
  DOMINGO: 0, SEGUNDA: 1, TERCA: 2, QUARTA: 3, QUINTA: 4, SEXTA: 5, SABADO: 6,
};

export async function POST(req: NextRequest) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });

  const body = await req.json();
  const { pacienteId, tipo } = body;
  if (!pacienteId || !tipo) {
    return NextResponse.json({ erro: "pacienteId e tipo são obrigatórios" }, { status: 400 });
  }

  const paciente = await prisma.paciente.findUnique({ where: { id: pacienteId } });
  if (!paciente || paciente.clinicaId !== usuario.clinicaId) {
    return NextResponse.json({ erro: "paciente não encontrado" }, { status: 404 });
  }

  const total = tipo === "PERSONALIZADO" ? Number(body.totalSessoes) : TOTAL_POR_TIPO[tipo];
  if (!total || total < 1) {
    return NextResponse.json({ erro: "totalSessoes inválido" }, { status: 400 });
  }

  const dataInicial = body.dataInicial ? new Date(body.dataInicial) : new Date();
  const [h, m] = paciente.horarioFixo.split(":").map(Number);
  const diaAlvo = DIA_NUM[paciente.diaPreferido];

  const primeira = new Date(dataInicial);
  primeira.setHours(h, m, 0, 0);
  while (primeira.getDay() !== diaAlvo) {
    primeira.setDate(primeira.getDate() + 1);
  }

  const pacote = await prisma.pacote.create({
    data: { pacienteId, tipo, totalSessoes: total, dataInicial: primeira },
  });

  const sessoes = [];
  for (let i = 0; i < total; i++) {
    const inicio = new Date(primeira);
    inicio.setDate(primeira.getDate() + i * 7);
    sessoes.push({
      pacoteId: pacote.id, pacienteId,
      numeroSessao: i + 1, totalPacote: total,
      inicio, duracaoMin: 45,
    });
  }
  await prisma.agendamento.createMany({ data: sessoes });

  return NextResponse.json({ pacote, sessoesGeradas: total }, { status: 201 });
}
