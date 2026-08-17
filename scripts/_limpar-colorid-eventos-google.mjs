// Read-only discovery + patch pontual: remove colorId dos eventos do Google
// Calendar que ainda carregam a cor forçada de quando mapearCorParaGoogleColorId
// existia (revertido em 2026-08-14 — ver ARCHITECTURE.md §9). Para cada
// Agendamento com googleEventId, consulta o evento real (events.get); se
// colorId estiver presente, faz events.patch({ colorId: null }) no mesmo
// calendarId já persistido na sessão (nunca move nem recria o evento).
// Nunca aborta no meio: falha em um evento é registrada e o script segue
// pros demais. Uso: node scripts/_limpar-colorid-eventos-google.mjs
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

function criarClienteGoogle(clinica) {
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  client.setCredentials({
    refresh_token: clinica.googleRefreshToken,
    access_token: clinica.googleAccessToken ?? undefined,
    expiry_date: clinica.googleTokenExpiry?.getTime(),
  });
  return google.calendar({ version: "v3", auth: client });
}

async function main() {
  const sessoes = await prisma.agendamento.findMany({
    where: { googleEventId: { not: null } },
    select: { id: true, clinicaId: true, googleEventId: true, googleCalendarId: true },
  });
  console.log(`Total de Agendamento com googleEventId: ${sessoes.length}`);

  const clinicaIds = [...new Set(sessoes.map((s) => s.clinicaId))];
  const clinicas = new Map();
  for (const id of clinicaIds) {
    const clinica = await prisma.clinica.findUnique({ where: { id } });
    if (!clinica?.googleConectado) {
      console.error(`Clínica ${id} não está conectada ao Google — sessões dela serão puladas.`);
      continue;
    }
    clinicas.set(id, criarClienteGoogle(clinica));
  }

  // Etapa 1 — descoberta (só leitura): quais eventos têm colorId de verdade.
  const comCor = [];
  const contagemPorCalendario = {};
  const falhasLeitura = [];

  for (const s of sessoes) {
    const calendar = clinicas.get(s.clinicaId);
    if (!calendar) continue;
    const calendarId = s.googleCalendarId ?? "primary";
    try {
      const { data } = await calendar.events.get({ calendarId, eventId: s.googleEventId, fields: "id,colorId" });
      if (data.colorId) {
        comCor.push({ agendamentoId: s.id, googleEventId: s.googleEventId, calendarId });
        contagemPorCalendario[calendarId] = (contagemPorCalendario[calendarId] ?? 0) + 1;
      }
    } catch (err) {
      const status = err?.code ?? err?.response?.status ?? "??";
      falhasLeitura.push({ agendamentoId: s.id, googleEventId: s.googleEventId, calendarId, erro: `HTTP ${status}: ${err?.message}` });
    }
  }

  console.log(`\n=== Etapa 1 — eventos com colorId preenchido ===`);
  console.log(`Total: ${comCor.length}`);
  console.log("Por calendário:", JSON.stringify(contagemPorCalendario, null, 2));
  if (falhasLeitura.length > 0) {
    console.log(`Falhas ao LER (events.get), não contam como "sem cor" — reportadas à parte: ${falhasLeitura.length}`);
    console.log(JSON.stringify(falhasLeitura, null, 2));
  }

  // Etapa 2 — limpeza: events.patch({ colorId: null }) só nos que têm cor.
  const limpos = [];
  const falhasPatch = [];
  for (const item of comCor) {
    const calendar = clinicas.get(sessoes.find((s) => s.id === item.agendamentoId).clinicaId);
    try {
      await calendar.events.patch({
        calendarId: item.calendarId,
        eventId: item.googleEventId,
        requestBody: { colorId: null },
      });
      limpos.push(item);
    } catch (err) {
      const status = err?.code ?? err?.response?.status ?? "??";
      falhasPatch.push({ ...item, erro: `HTTP ${status}: ${err?.message}` });
    }
  }

  console.log(`\n=== Etapa 2 — resultado da limpeza ===`);
  console.log(`Limpos com sucesso: ${limpos.length}`);
  console.log(`Falhas: ${falhasPatch.length}`);
  if (falhasPatch.length > 0) console.log(JSON.stringify(falhasPatch, null, 2));

  // Etapa 3 — reconfirmação: relê exatamente os que tentamos limpar.
  const aindaComCor = [];
  for (const item of comCor) {
    try {
      const { data } = await calendar_get_retry(clinicas.get(sessoes.find((s) => s.id === item.agendamentoId).clinicaId), item.calendarId, item.googleEventId);
      if (data.colorId) aindaComCor.push({ ...item, colorIdAtual: data.colorId });
    } catch (err) {
      const status = err?.code ?? err?.response?.status ?? "??";
      aindaComCor.push({ ...item, erroReconfirmacao: `HTTP ${status}: ${err?.message}` });
    }
  }

  console.log(`\n=== Etapa 3 — reconfirmação ===`);
  console.log(`Ainda com colorId (ou erro ao reconfirmar): ${aindaComCor.length}`);
  if (aindaComCor.length > 0) console.log(JSON.stringify(aindaComCor, null, 2));
  else console.log("Nenhum evento restante com colorId, dos que foram processados.");

  await prisma.$disconnect();
}

async function calendar_get_retry(calendar, calendarId, eventId) {
  return calendar.events.get({ calendarId, eventId, fields: "id,colorId" });
}

main().catch(async (err) => {
  console.error("Erro fatal:", err);
  await prisma.$disconnect();
  process.exit(1);
});
