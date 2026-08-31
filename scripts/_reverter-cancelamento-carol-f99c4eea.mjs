// One-off: reverte o cancelamento indevido do agendamento f99c4eea-128e-
// 45ce-b912-f727c1546e23 (Carol Fantini Gobbi, sessão 4/4, 31/08 11:30) —
// status CANCELADA -> AGENDADA, e recria o evento/Meet no Google Calendar
// (o cancelamento já tinha removido o evento: googleEventId/linkMeet/
// googleCalendarId estavam zerados).
//
// Segue o mesmo padrão do outbox (src/lib/sincronizacao.ts): grava um item
// CALENDAR_CRIAR em SincronizacaoPendente e processa ele mesmo aqui,
// replicando processarCalendarCriar/criarEventoGoogleMeet — não é possível
// importar esses módulos TS direto num script plain-node neste ambiente
// (sem transpilador instalado; mesma nota em resync-jadir-sessoes-futuras.mjs).
// Assim o estado final no outbox fica idêntico ao que o worker real teria
// deixado (CONCLUIDO), em vez de um item pendente esperando o cron de 10min.
//
// Escopo: SOMENTE este id. Nenhuma sessão irmã é tocada.
//
// Conecta via DIRECT_URL (porta 5432), nunca o pooler — mesma regra das
// migrations.
//
// Uso: node scripts/_reverter-cancelamento-carol-f99c4eea.mjs

import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { google } from "googleapis";
import crypto from "node:crypto";

if (!process.env.DIRECT_URL) {
  console.error("DIRECT_URL não definida no ambiente.");
  process.exit(1);
}

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL });
const prisma = new PrismaClient({ adapter });

const AGENDAMENTO_ID = "f99c4eea-128e-45ce-b912-f727c1546e23";
const TIMEZONE = "America/Sao_Paulo";

function primeiroUltimoNome(nome) {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length <= 1) return partes[0] ?? "";
  return `${partes[0]} ${partes[partes.length - 1]}`;
}

function construirTitulo(agendamento) {
  const nome = primeiroUltimoNome(agendamento.paciente.nome);
  const base = `${nome} (${agendamento.numeroSessao}/${agendamento.totalPacote})`;
  return `${base}${agendamento.confirmada ? " ✅" : ""}`; // AGENDADA não leva sufixo de status
}

async function main() {
  const sessao = await prisma.agendamento.findUnique({
    where: { id: AGENDAMENTO_ID },
    include: { paciente: true, tipoSessao: true },
  });
  if (!sessao) {
    console.error("Agendamento não encontrado — abortando sem alterar nada.");
    process.exit(1);
  }
  if (sessao.status !== "CANCELADA") {
    console.error(`Status atual é ${sessao.status}, não CANCELADA — abortando sem alterar nada (execução manual duplicada?).`);
    process.exit(1);
  }
  if (sessao.alunoId) {
    console.error("Agendamento tem alunoId (mentoria) — fora do escopo esperado. Abortando.");
    process.exit(1);
  }

  const clinica = await prisma.clinica.findUnique({ where: { id: sessao.clinicaId } });
  if (!clinica) {
    console.error("Clínica não encontrada — abortando.");
    process.exit(1);
  }

  console.log("=== Estado antes ===");
  console.log({
    status: sessao.status,
    motivoCancelamento: sessao.motivoCancelamento,
    arquivada: sessao.arquivada,
    googleEventId: sessao.googleEventId,
    googleCalendarId: sessao.googleCalendarId,
    linkMeet: sessao.linkMeet,
  });

  // 1) Reverte para ABERTA/AGENDADA — só este registro.
  const revertida = await prisma.agendamento.update({
    where: { id: AGENDAMENTO_ID },
    data: {
      status: "AGENDADA",
      motivoCancelamento: null,
      arquivada: false,
      googleSyncStatus: "PENDENTE",
    },
  });

  await prisma.logAuditoria.create({
    data: {
      clinicaId: sessao.clinicaId,
      usuarioId: null,
      acao: "REVERTER_CANCELAMENTO",
      detalhe: `Reverteu cancelamento indevido da sessão ${sessao.numeroSessao}/${sessao.totalPacote} de ${sessao.paciente.nome} (correção manual pontual, script _reverter-cancelamento-carol-f99c4eea.mjs)`,
    },
  });
  console.log("\nStatus revertido para AGENDADA, motivo/arquivamento limpos.");

  // 2) Enfileira CALENDAR_CRIAR (mesmo padrão do outbox) — evento foi
  // removido no cancelamento, então precisa nascer de novo.
  const itemFila = await prisma.sincronizacaoPendente.create({
    data: { clinicaId: sessao.clinicaId, tipo: "CALENDAR_CRIAR", payload: { agendamentoId: AGENDAMENTO_ID } },
  });

  if (!clinica.googleConectado || !clinica.googleRefreshToken) {
    console.log("\nClínica sem Google conectado — item fica PENDENTE no outbox para quando reconectar. Nenhum evento criado.");
    return;
  }

  // 3) Processa o item agora (replicando processarCalendarCriar), para não
  // depender do cron de 10min e já reportar o link do Meet.
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  client.setCredentials({
    refresh_token: clinica.googleRefreshToken,
    access_token: clinica.googleAccessToken ?? undefined,
    expiry_date: clinica.googleTokenExpiry ? new Date(clinica.googleTokenExpiry).getTime() : undefined,
  });
  client.on("tokens", (tokens) => {
    prisma.clinica
      .update({
        where: { id: clinica.id },
        data: {
          ...(tokens.access_token ? { googleAccessToken: tokens.access_token } : {}),
          ...(tokens.expiry_date ? { googleTokenExpiry: new Date(tokens.expiry_date) } : {}),
          ...(tokens.refresh_token ? { googleRefreshToken: tokens.refresh_token } : {}),
        },
      })
      .catch((err) => console.error("Falha ao persistir tokens renovados do Google:", err));
  });
  const calendar = google.calendar({ version: "v3", auth: client });

  // Mesma cadeia de fallback de sincronizacao.ts:311-313 para paciente
  // (não-mentoria): tipo de sessão -> calendário padrão da clínica -> "primary".
  const googleCalendarId = sessao.tipoSessao?.googleCalendarId ?? clinica.googleCalendarId ?? "primary";
  const comMeet = sessao.tipoSessao?.ehOnline ?? false;
  const titulo = construirTitulo(sessao);
  const fim = new Date(sessao.inicio.getTime() + sessao.duracaoMin * 60_000);

  try {
    const { data: evento } = await calendar.events.insert({
      calendarId: googleCalendarId,
      ...(comMeet ? { conferenceDataVersion: 1 } : {}),
      requestBody: {
        summary: titulo,
        start: { dateTime: sessao.inicio.toISOString(), timeZone: TIMEZONE },
        end: { dateTime: fim.toISOString(), timeZone: TIMEZONE },
        ...(comMeet
          ? { conferenceData: { createRequest: { requestId: crypto.randomUUID(), conferenceSolutionKey: { type: "hangoutsMeet" } } } }
          : {}),
      },
    });

    if (!evento.id) throw new Error("Google não retornou id do evento criado");

    await prisma.agendamento.update({
      where: { id: AGENDAMENTO_ID },
      data: {
        googleEventId: evento.id,
        googleCalendarId,
        linkMeet: evento.hangoutLink ?? null,
        googleSyncStatus: "SINCRONIZADO",
      },
    });
    await prisma.sincronizacaoPendente.update({
      where: { id: itemFila.id },
      data: { status: "CONCLUIDO", ultimoErro: null },
    });
    await prisma.clinica.update({
      where: { id: clinica.id },
      data: { googleUltimoErro: null, googleUltimoErroEm: null },
    });

    console.log("\n=== Evento recriado no Google Calendar ===");
    console.log({
      googleEventId: evento.id,
      googleCalendarId,
      linkMeet: evento.hangoutLink ?? null,
      titulo,
    });
  } catch (err) {
    const mensagem = err?.message ?? String(err);
    await prisma.sincronizacaoPendente.update({
      where: { id: itemFila.id },
      data: { status: "PENDENTE", tentativas: 1, ultimoErro: mensagem.slice(0, 500), proximaTentativaEm: new Date(Date.now() + 60_000) },
    });
    await prisma.clinica.update({
      where: { id: clinica.id },
      data: { googleUltimoErro: mensagem.slice(0, 500), googleUltimoErroEm: new Date() },
    });
    console.error("\nFalha ao criar evento no Google — status local já revertido para AGENDADA, item fica PENDENTE no outbox para retry automático (backoff 1min).");
    console.error("Detalhe do erro:", mensagem);
  }
}

main()
  .catch((err) => {
    console.error("Falha no script:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
