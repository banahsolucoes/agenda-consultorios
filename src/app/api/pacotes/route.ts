import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { obterCalendarDaClinica, criarEventoGoogleMeet } from "@/lib/google";
import { primeiroUltimoNome } from "@/lib/nomes";

const TOTAL_POR_TIPO: Record<string, number> = {
  AVULSA: 1, MENSAL: 4, BIMESTRAL: 8, TRIMESTRAL: 12,
};
const DIA_NUM: Record<string, number> = {
  DOMINGO: 0, SEGUNDA: 1, TERCA: 2, QUARTA: 3, QUINTA: 4, SEXTA: 5, SABADO: 6,
};
const HORA_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATA_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;

// Constrói uma Date a partir de "YYYY-MM-DD" usando componentes locais, para
// não sofrer o deslocamento de fuso que "new Date('YYYY-MM-DD')" (UTC) causa
// dependendo do timezone do servidor.
function parseDataLocal(dataStr: string): Date | null {
  const m = DATA_REGEX.exec(dataStr);
  if (!m) return null;
  const [, ano, mes, dia] = m;
  return new Date(Number(ano), Number(mes) - 1, Number(dia));
}

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

  if (body.horario && !HORA_REGEX.test(body.horario)) {
    return NextResponse.json({ erro: "horario deve estar no formato HH:MM" }, { status: 400 });
  }
  const dataEscolhida = body.dataInicial ? parseDataLocal(body.dataInicial) : null;
  if (body.dataInicial && !dataEscolhida) {
    return NextResponse.json({ erro: "dataInicial deve estar no formato YYYY-MM-DD" }, { status: 400 });
  }

  const [hPadrao, mPadrao] = paciente.horarioFixo.split(":").map(Number);
  const [h, m] = body.horario ? body.horario.split(":").map(Number) : [hPadrao, mPadrao];

  let primeira: Date;
  if (dataEscolhida) {
    // Dia escolhido explicitamente na criação do atendimento: a primeira
    // sessão cai exatamente nessa data, sem procurar o dia preferido do
    // paciente (o usuário está decidindo o dia de propósito).
    primeira = dataEscolhida;
    primeira.setHours(h, m, 0, 0);
  } else {
    // Sem data escolhida: mantém o comportamento padrão — parte de hoje e
    // avança até o próximo dia da semana preferido do paciente.
    const diaAlvo = DIA_NUM[paciente.diaPreferido];
    primeira = new Date();
    primeira.setHours(h, m, 0, 0);
    while (primeira.getDay() !== diaAlvo) {
      primeira.setDate(primeira.getDate() + 1);
    }
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
        titulo: `${primeiroUltimoNome(paciente.nome)} — sessão ${sessao.numeroSessao}/${sessao.totalPacote}`,
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
