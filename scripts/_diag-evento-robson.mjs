import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { google } from "googleapis";

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

function criarOAuthClient() {
  return new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REDIRECT_URI);
}

async function main() {
  const clinica = await prisma.clinica.findUnique({ where: { id: "14cc29f9-7cb6-4b93-88fc-e5d868770895" } });
  const client = criarOAuthClient();
  client.setCredentials({ refresh_token: clinica.googleRefreshToken, access_token: clinica.googleAccessToken ?? undefined, expiry_date: clinica.googleTokenExpiry?.getTime() });
  await client.getAccessToken();
  const calendar = google.calendar({ version: "v3", auth: client });

  const ag = await prisma.agendamento.findFirst({
    where: { googleEventId: "aahm81ps3f1nj8qas0rr6mngjs" },
    include: { paciente: true },
  });
  console.log("Agendamento DB:", ag && { id: ag.id, paciente: ag.paciente?.nome, inicio: ag.inicio, googleCalendarId: ag.googleCalendarId, googleEventId: ag.googleEventId, googleSyncStatus: ag.googleSyncStatus });

  try {
    const { data } = await calendar.events.get({ calendarId: "primary", eventId: "aahm81ps3f1nj8qas0rr6mngjs" });
    console.log("Evento no Google:", { status: data.status, organizer: data.organizer, creator: data.creator, start: data.start, end: data.end, summary: data.summary });
  } catch (err) {
    console.log("Erro no events.get:", err?.response?.data ?? err.message);
  }
}
main().catch(console.error).finally(() => prisma.$disconnect());
