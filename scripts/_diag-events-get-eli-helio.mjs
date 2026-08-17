// DIAGNÓSTICO READ-ONLY (2026-08-17) — apenas events.get, nenhuma escrita de evento.
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { google } from "googleapis";

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

function criarOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

async function obterClienteGoogleDaClinica(clinica) {
  if (!clinica.googleConectado || !clinica.googleRefreshToken) return null;
  const client = criarOAuthClient();
  client.setCredentials({
    refresh_token: clinica.googleRefreshToken,
    access_token: clinica.googleAccessToken ?? undefined,
    expiry_date: clinica.googleTokenExpiry?.getTime(),
  });
  const expiraEm = clinica.googleTokenExpiry?.getTime() ?? 0;
  if (expiraEm < Date.now() + 60_000) {
    await client.getAccessToken();
  }
  return client;
}

const EVENTOS = [
  { paciente: "Eli Lima", agendamentoId: "553b32c8-5266-4530-8bb0-7ae743e34c81", calendarId: "contato@pamelarachid.com.br", eventId: "fuh995n1sqbehfijopmjshg8pg" },
  { paciente: "Eli Lima", agendamentoId: "0d63d2cd-e4d6-49d3-b6a8-e80021aacf95", calendarId: "contato@pamelarachid.com.br", eventId: "o0uitgm0evaoirlukjlm7ipngk" },
  { paciente: "Helio",    agendamentoId: "fe928f31-22de-443b-b877-3eb3ef422b2a", calendarId: "contato@pamelarachid.com.br", eventId: "v968jn200sc96e1srqudfi9au4" },
  { paciente: "Helio",    agendamentoId: "6bb0165b-b221-41b9-ae03-ebb7547bfc2f", calendarId: "contato@pamelarachid.com.br", eventId: "72v0cknop1rrf1etvvm6t7aefk" },
];

async function main() {
  const clinica = await prisma.clinica.findUnique({ where: { id: "14cc29f9-7cb6-4b93-88fc-e5d868770895" } });
  const auth = await obterClienteGoogleDaClinica(clinica);
  if (!auth) {
    console.error("Clínica sem integração Google conectada.");
    process.exit(1);
  }
  const calendar = google.calendar({ version: "v3", auth });

  for (const ev of EVENTOS) {
    try {
      const { data } = await calendar.events.get({ calendarId: ev.calendarId, eventId: ev.eventId });
      console.log({
        paciente: ev.paciente,
        agendamentoId: ev.agendamentoId,
        eventId: ev.eventId,
        status: data.status,
        start: data.start,
        end: data.end,
        updated: data.updated,
      });
    } catch (err) {
      console.log({
        paciente: ev.paciente,
        agendamentoId: ev.agendamentoId,
        eventId: ev.eventId,
        erro: err?.message ?? String(err),
      });
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
