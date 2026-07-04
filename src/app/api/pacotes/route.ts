import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { obterCalendarDaClinica } from "@/lib/google";
import type { calendar_v3 } from "googleapis";

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

  const paciente = await prisma.paciente.findUnique({
    where: { id: pacienteId },
    include: { tipoSessao: true },
  });
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

  // Renovação: um pacote novo reativa o paciente, saindo de Finalizado/Cancelado
  if (paciente.statusGeral !== "ATIVO") {
    await prisma.paciente.update({
      where: { id: pacienteId },
      data: { statusGeral: "ATIVO", finalizadoEm: null },
    });
  }

  const sessoes = [];
  for (let i = 0; i < total; i++) {
    const inicio = new Date(primeira);
    inicio.setDate(primeira.getDate() + i * 7);
    sessoes.push({
      pacoteId: pacote.id, pacienteId,
      numeroSessao: i + 1, totalPacote: total,
      inicio, duracaoMin: 45,
      tipoSessaoId: paciente.tipoSessaoId,
    });
  }

  // Sessão online + clínica com Google conectado: cria um evento (com Meet)
  // por sessão e grava o link/id junto do agendamento. Fora desse caso, segue
  // o caminho local de sempre — a integração nunca pode travar a criação da
  // sessão em si.
  const clinica = paciente.tipoSessao?.ehOnline
    ? await prisma.clinica.findUnique({ where: { id: usuario.clinicaId } })
    : null;
  const calendar = clinica ? await obterCalendarDaClinica(clinica).catch(() => null) : null;

  if (calendar && clinica) {
    for (const sessao of sessoes) {
      const dadosGoogle = await criarEventoGoogleMeet(calendar, clinica.googleCalendarId ?? "primary", {
        titulo: `${paciente.nome} — sessão ${sessao.numeroSessao}/${sessao.totalPacote}`,
        inicio: sessao.inicio,
        duracaoMin: sessao.duracaoMin,
      });
      await prisma.agendamento.create({ data: { ...sessao, ...dadosGoogle } });
    }
  } else {
    await prisma.agendamento.createMany({ data: sessoes });
  }

  return NextResponse.json({ pacote, sessoesGeradas: total }, { status: 201 });
}

// Cria o evento no Google Calendar com Meet automático. Retorna os campos
// prontos para gravar no Agendamento — ou tudo null se a chamada falhar,
// para nunca impedir a criação da sessão local.
async function criarEventoGoogleMeet(
  calendar: calendar_v3.Calendar,
  googleCalendarId: string,
  dados: { titulo: string; inicio: Date; duracaoMin: number }
) {
  try {
    const fim = new Date(dados.inicio.getTime() + dados.duracaoMin * 60_000);
    const { data: evento } = await calendar.events.insert({
      calendarId: googleCalendarId,
      conferenceDataVersion: 1,
      requestBody: {
        summary: dados.titulo,
        start: { dateTime: dados.inicio.toISOString() },
        end: { dateTime: fim.toISOString() },
        conferenceData: {
          createRequest: {
            requestId: crypto.randomUUID(),
            conferenceSolutionKey: { type: "hangoutsMeet" },
          },
        },
      },
    });

    return {
      googleEventId: evento.id ?? null,
      googleCalendarId,
      linkMeet: evento.hangoutLink ?? null,
    };
  } catch (err) {
    console.error("Falha ao criar evento no Google Calendar:", err);
    return { googleEventId: null, googleCalendarId: null, linkMeet: null };
  }
}
