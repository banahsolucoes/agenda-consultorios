import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { componentesSP, criarDataSP } from "@/lib/timezone";
import { registrarLog } from "@/lib/auditoria";
import { obterClinicaECalendar, sincronizarEventoGoogle, criarEventoGoogleMeet } from "@/lib/google";
import { primeiroUltimoNome } from "@/lib/nomes";

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
const DIA_MS = 24 * 60 * 60 * 1000;

// Marcador (meia-noite UTC do dia de calendário) da segunda-feira da semana
// que contém `data`, calculado no calendário de São Paulo — usado só para
// achar o dia de calendário alvo, nunca exposto como instante real.
function inicioDaSemana(data: Date): Date {
  const c = componentesSP(data);
  const distSeg = c.diaSemana === 0 ? 6 : c.diaSemana - 1;
  return new Date(Date.UTC(c.ano, c.mes - 1, c.dia) - distSeg * DIA_MS);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  if (!pode(usuario.papel, "operarAgenda")) {
    return NextResponse.json({ erro: "sem permissão para esta ação" }, { status: 403 });
  }

  const { id: pacienteId } = await ctx.params;
  const paciente = await prisma.paciente.findUnique({ where: { id: pacienteId } });
  if (!paciente || paciente.clinicaId !== usuario.clinicaId) {
    return NextResponse.json({ erro: "paciente não encontrado" }, { status: 404 });
  }

  const body = await req.json();
  const semanas = Math.max(0, Math.min(10, Number(body.semanas) || 0));

  // novoDia/novoHorario são opcionais — quando informados, além de (opcionalmente)
  // empurrar N semanas, o dia da semana e o horário de cada sessão também são
  // trocados, mantendo a semana (segunda-domingo) de cada sessão.
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

  // Com semanas=0 é preciso ao menos mudar dia/horário — senão não há o que fazer.
  if (semanas === 0 && diaAlvo === null) {
    return NextResponse.json({ erro: "informe semanas entre 1 e 10" }, { status: 400 });
  }

  const agora = new Date();
  const hojeSP = componentesSP(agora);
  const hojeZero = criarDataSP(hojeSP.ano, hojeSP.mes, hojeSP.dia, 0, 0, 0);

  const sessoes = await prisma.agendamento.findMany({
    where: { pacienteId, status: { notIn: ["CANCELADA"] } },
    orderBy: { numeroSessao: "asc" },
    include: { tipoSessao: true },
  });

  const movimentos: {
    id: string;
    novaData: Date;
    googleEventId: string | null;
    googleCalendarId: string | null;
    duracaoMin: number;
    numeroSessao: number;
    totalPacote: number;
    ehOnline: boolean;
    tipoSessaoGoogleCalendarId: string | null;
  }[] = [];
  for (const s of sessoes) {
    if (s.inicio < agora) continue;
    let novaData = new Date(s.inicio.getTime() + semanas * 7 * DIA_MS);

    if (diaAlvo !== null && horaAlvo) {
      const semana = inicioDaSemana(novaData);
      const diaCalendario = new Date(semana.getTime() + diaAlvo * DIA_MS);
      novaData = criarDataSP(
        diaCalendario.getUTCFullYear(),
        diaCalendario.getUTCMonth() + 1,
        diaCalendario.getUTCDate(),
        horaAlvo.h,
        horaAlvo.m
      );
    }

    if (novaData < hojeZero) {
      return NextResponse.json(
        { erro: `Operação bloqueada: sessão ${s.numeroSessao} cairia antes de hoje. Nada foi movido.` },
        { status: 400 }
      );
    }
    movimentos.push({
      id: s.id,
      novaData,
      googleEventId: s.googleEventId,
      googleCalendarId: s.googleCalendarId,
      duracaoMin: s.duracaoMin,
      numeroSessao: s.numeroSessao,
      totalPacote: s.totalPacote,
      ehOnline: s.tipoSessao?.ehOnline ?? false,
      tipoSessaoGoogleCalendarId: s.tipoSessao?.googleCalendarId ?? null,
    });
  }

  if (movimentos.length === 0) {
    return NextResponse.json({ erro: "nenhuma sessão futura para mover" }, { status: 400 });
  }

  // Regra de conflito: nenhuma sessão movida pode cair na mesma semana
  // (segunda a domingo) de uma sessão do mesmo paciente que não será movida
  // (sessões passadas). Se colidir, bloqueia a operação inteira — tudo ou nada.
  const naoMovidas = sessoes.filter((s) => s.inicio < agora);
  const semanasNaoMovidas = new Set(naoMovidas.map((s) => inicioDaSemana(s.inicio).getTime()));
  const colisao = movimentos.some((mov) => semanasNaoMovidas.has(inicioDaSemana(mov.novaData).getTime()));
  if (colisao) {
    return NextResponse.json(
      { erro: "Não é possível empurrar: já existe uma sessão nesta semana. Nada foi movido." },
      { status: 400 }
    );
  }

  await prisma.$transaction([
    ...movimentos.map((mov) =>
      prisma.agendamento.update({
        where: { id: mov.id },
        data: { inicio: mov.novaData, status: "AGENDADA" },
      })
    ),
    ...(body.novoDia && body.novoHorario
      ? [
          prisma.paciente.update({
            where: { id: pacienteId },
            data: { diaPreferido: body.novoDia, horarioFixo: body.novoHorario },
          }),
        ]
      : []),
  ]);

  // Reflete a nova data/hora no Google Calendar de cada sessão movida —
  // atualiza o evento já existente, ou cria um novo se a sessão nunca teve
  // evento (mesmo gate de criação de POST /api/pacotes: clínica conectada,
  // Meet só quando o tipo de atendimento é online). Melhor esforço — busca o
  // client uma única vez para o lote todo, e falha na integração nunca
  // desfaz o que já foi movido no banco; grava googleSyncStatus pra
  // distinguir sucesso de falha em vez de deixar como se nada tivesse
  // acontecido (achado da auditoria de 2026-07-23: sessões do paciente Jadir
  // ficaram com a data desatualizada no Google porque a falha aqui era só
  // logada e nunca registrada).
  const google = await obterClinicaECalendar(usuario.clinicaId);
  if (google) {
    for (const mov of movimentos) {
      if (mov.googleEventId) {
        const ok = await sincronizarEventoGoogle(
          google.calendar,
          mov.googleCalendarId ?? mov.tipoSessaoGoogleCalendarId ?? google.clinica.googleCalendarId ?? "primary",
          mov.googleEventId,
          { inicio: mov.novaData, duracaoMin: mov.duracaoMin },
          google.clinica.id
        );
        await prisma.agendamento.update({
          where: { id: mov.id },
          data: { googleSyncStatus: ok ? "SINCRONIZADO" : "FALHOU" },
        });
      } else {
        const dadosGoogle = await criarEventoGoogleMeet(
          google.calendar,
          mov.tipoSessaoGoogleCalendarId ?? google.clinica.googleCalendarId ?? "primary",
          {
            titulo: `${primeiroUltimoNome(paciente.nome)} (${mov.numeroSessao}/${mov.totalPacote})`,
            inicio: mov.novaData,
            duracaoMin: mov.duracaoMin,
          },
          mov.ehOnline,
          google.clinica.id
        );
        await prisma.agendamento.update({
          where: { id: mov.id },
          data: { ...dadosGoogle, googleSyncStatus: dadosGoogle.googleEventId ? "SINCRONIZADO" : "FALHOU" },
        });
      }
    }
  }

  const sessaoOuSessoes = movimentos.length === 1 ? "sessão" : "sessões";
  const semanaOuSemanas = semanas === 1 ? "semana" : "semanas";
  await registrarLog(
    usuario.clinicaId,
    usuario.id,
    "EMPURRAR",
    `Empurrou ${movimentos.length} ${sessaoOuSessoes} de ${paciente.nome} em ${semanas} ${semanaOuSemanas}`
  );

  return NextResponse.json({ empurradas: movimentos.length, semanas });
}
