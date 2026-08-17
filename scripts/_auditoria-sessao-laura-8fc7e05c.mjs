// Somente leitura. Auditoria do agendamento 8fc7e05c-49d1-45ea-8b5f-ec728087634b
// (Laura Alvarenga, sessão 10/38) — arquivado e depois reativado via UPDATE
// direto no Supabase, fora da camada de serviço. Nenhum UPDATE/INSERT/DELETE
// é executado por este script.
//
// Uso: node scripts/_auditoria-sessao-laura-8fc7e05c.mjs

import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { google } from "googleapis";

if (!process.env.DIRECT_URL) {
  console.error("DIRECT_URL não definida no ambiente.");
  process.exit(1);
}

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL });
const prisma = new PrismaClient({ adapter });

const AGENDAMENTO_ID = "8fc7e05c-49d1-45ea-8b5f-ec728087634b";

async function main() {
  console.log("=== 1. SELECT completo do agendamento ===");
  const sessao = await prisma.agendamento.findUnique({
    where: { id: AGENDAMENTO_ID },
    include: { paciente: true, pacote: true, tipoSessao: true },
  });
  if (!sessao) {
    console.error("Agendamento não encontrado — abortando.");
    process.exit(1);
  }
  console.log(JSON.stringify(sessao, null, 2));

  console.log("\n=== 2. Todas as sessões do pacote (numeração) ===");
  const irmas = await prisma.agendamento.findMany({
    where: { pacoteId: sessao.pacoteId },
    orderBy: { numeroSessao: "asc" },
    select: {
      id: true,
      numeroSessao: true,
      totalPacote: true,
      status: true,
      arquivada: true,
      inicio: true,
    },
  });
  for (const s of irmas) {
    console.log(
      `#${s.numeroSessao}/${s.totalPacote}  id=${s.id}  status=${s.status}  arquivada=${s.arquivada}  inicio=${s.inicio.toISOString()}`
    );
  }
  const numeros = irmas.map((s) => s.numeroSessao);
  const duplicadas = numeros.filter((n, i) => numeros.indexOf(n) !== i);
  console.log("Total de sessões no pacote:", irmas.length);
  console.log("Duplicatas de numeroSessao:", [...new Set(duplicadas)]);
  const esperado = Array.from({ length: sessao.totalPacote }, (_, i) => i + 1);
  const faltando = esperado.filter((n) => !numeros.includes(n));
  console.log("Números esperados (1..totalPacote) ausentes:", faltando);

  console.log("\n=== 3. Pacote e paciente ===");
  console.log(JSON.stringify(sessao.pacote, null, 2));
  console.log("Paciente:", sessao.paciente.nome, "| statusGeral:", sessao.paciente.statusGeral, "| clinicaId:", sessao.paciente.clinicaId);

  console.log("\n=== 4. Logs de auditoria relacionados (por texto na descrição) ===");
  const logs = await prisma.logAuditoria.findMany({
    where: {
      clinicaId: sessao.paciente.clinicaId,
      OR: [
        { detalhe: { contains: sessao.paciente.nome } },
        { detalhe: { contains: AGENDAMENTO_ID } },
      ],
    },
    orderBy: { criadoEm: "asc" },
  });
  for (const l of logs) {
    console.log(`[${l.criadoEm.toISOString()}] ${l.acao} — ${l.detalhe}`);
  }
  if (logs.length === 0) console.log("(nenhum log encontrado)");

  console.log("\n=== 5. Clínica / conexão Google ===");
  const clinica = await prisma.clinica.findUnique({ where: { id: sessao.paciente.clinicaId } });
  console.log(
    "googleConectado:", clinica?.googleConectado,
    "| googleTokenValido:", clinica?.googleTokenValido,
    "| googleCalendarId (clínica):", clinica?.googleCalendarId
  );
  console.log("tipoSessao:", sessao.tipoSessao?.nome, "| ehOnline:", sessao.tipoSessao?.ehOnline, "| googleCalendarId (tipo):", sessao.tipoSessao?.googleCalendarId);

  console.log("\n=== 6. Estado do evento no Google Calendar ===");
  if (!sessao.googleEventId) {
    console.log("googleEventId vazio — nada a checar no Google.");
  } else if (!clinica?.googleConectado || !clinica.googleRefreshToken) {
    console.log("Clínica sem Google conectado — não é possível checar o evento real.");
  } else {
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
    const calendar = google.calendar({ version: "v3", auth: client });
    const calendarId = sessao.googleCalendarId ?? sessao.tipoSessao?.googleCalendarId ?? clinica.googleCalendarId ?? "primary";
    try {
      const evento = await calendar.events.get({ calendarId, eventId: sessao.googleEventId });
      console.log("Evento encontrado. status:", evento.data.status, "| summary:", evento.data.summary);
      console.log("hangoutLink:", evento.data.hangoutLink ?? "(nenhum)");
      console.log("start:", JSON.stringify(evento.data.start), "end:", JSON.stringify(evento.data.end));
    } catch (err) {
      console.log("Falha ao buscar evento (provável 404/deletado):", err.message ?? err);
    }
  }

  console.log("\n=== 7. Query da grid da agenda (GET /api/agenda) aplicada a este registro ===");
  const apareceNaGrid = await prisma.agendamento.findFirst({
    where: {
      id: AGENDAMENTO_ID,
      paciente: { clinicaId: sessao.paciente.clinicaId },
      status: { not: "CANCELADA" },
      arquivada: false,
    },
  });
  console.log("Aparece no filtro da grid (status != CANCELADA, arquivada = false)?", Boolean(apareceNaGrid));
  console.log("status atual:", sessao.status, "| arquivada atual:", sessao.arquivada);
}

main()
  .catch((err) => {
    console.error("Falha no script:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
