// One-off: os 12 eventos do pacote a6fdcbbd-7b72-469f-bc70-220ec432fe27
// (Maura Marques Oliveira Diana, 12 sessões presenciais) foram criados
// manualmente no Google Calendar da clínica, direto no calendário "Sessões
// Online" (id = e-mail da própria conta, contato@pamelarachid.com.br) em vez
// de "Sessões Presenciais". Este script:
//   1. Localiza, por janela de tempo (±10min ao redor do início de cada
//      sessão), o evento correspondente no calendário de origem — sem
//      adivinhar por posição/nome quando a janela retorna mais de 1 evento
//      (havia sessões de outras pacientes no mesmo horário; resolvidas por
//      confirmação manual em conversa antes deste script rodar).
//   2. Move cada evento pra "Sessões Presenciais" via calendar.events.move.
//   3. Grava o resultado no Agendamento correspondente: googleEventId,
//      googleCalendarId (o de destino) e googleSyncStatus: SINCRONIZADO —
//      antes estava FALHOU (nunca tinha sido criado pelo sistema; o bug do
//      gate por tipoSessaoEhOnline, corrigido em 2026-07-21, impediu a
//      criação automática desses 12 quando o pacote foi criado).
//
// Já rodado uma vez (2026-07-21) com sucesso: 12/12 movidos, todos sem
// attendees (nenhum risco de notificação via sendUpdates, que não foi
// alterado do default da API). Mantido no repo como registro — não é
// endpoint nem rota, não deve ser reexecutado sem revisar os eventIds
// hardcoded abaixo (já foram todos movidos, rodar de novo daria 404).
//
// Conecta via DIRECT_URL (porta 5432), nunca o pooler — mesma regra das
// migrations. Usa os tokens OAuth já persistidos em Clinica (mesma lógica de
// obterClienteGoogleDaClinica em src/lib/google.ts).
//
// Uso: node scripts/mover-eventos-maura-para-presencial.mjs

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

const CLINICA_ID = "14cc29f9-7cb6-4b93-88fc-e5d868770895"; // Fono Pâmela Rachid
const PACOTE_ID = "a6fdcbbd-7b72-469f-bc70-220ec432fe27"; // Maura Marques Oliveira Diana
const CALENDAR_ONLINE = "contato@pamelarachid.com.br"; // "Sessões Online" — é o e-mail da própria conta
const CALENDAR_PRESENCIAL = "c_4d0c121ab130a948a0ea36d13454f197eec493bd3cd55388970ee0538b5a69e0@group.calendar.google.com"; // "Sessões Presenciais"

// eventIds confirmados na Etapa 1 (busca por janela ±10min + confirmação
// manual das 3 janelas que retornaram mais de 1 evento — outras pacientes
// coincidindo no mesmo horário).
const EVENTOS_CONFIRMADOS = [
  { numeroSessao: 1, eventId: "r8n7esck5dmej6q6aj3diqlomo" },
  { numeroSessao: 2, eventId: "hc228u7bjc0l75qpog78m635o4" },
  { numeroSessao: 3, eventId: "nvi4tvonpafvt4oia3pqoc29q8" },
  { numeroSessao: 4, eventId: "q9nten8opk4gl9srni15eo15dk" },
  { numeroSessao: 5, eventId: "b7qps2vjndauohh1imr4nmpg7c" },
  { numeroSessao: 6, eventId: "5nps2dsscjosd63fvalrg264cc" },
  { numeroSessao: 7, eventId: "5nbupbb76un2iher927t6vrdu0" },
  { numeroSessao: 8, eventId: "u4ldqcne8ft2ncfjd5d8kqh900" },
  { numeroSessao: 9, eventId: "tskpo4t40p0n9e3end5k60j5r4" },
  { numeroSessao: 10, eventId: "0dte7bgi8omvebgkin9ndjusss" },
  { numeroSessao: 11, eventId: "b0ma81kfmd669jqkqhb7hvjjqg" },
  { numeroSessao: 12, eventId: "m6l4mi83refc1oaqj5fptbskmc" },
];

async function main() {
  const clinica = await prisma.clinica.findUnique({ where: { id: CLINICA_ID } });
  if (!clinica?.googleConectado || !clinica.googleRefreshToken) {
    console.error("Clínica não está conectada ao Google — abortando.");
    process.exit(1);
  }

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

  const rows = await prisma.agendamento.findMany({
    where: { pacoteId: PACOTE_ID },
    select: { id: true, numeroSessao: true },
  });
  const agendamentoPorNumero = new Map(rows.map((r) => [r.numeroSessao, r]));

  const sucesso = [];
  const falha = [];

  for (const item of EVENTOS_CONFIRMADOS) {
    try {
      const { data } = await calendar.events.move({
        calendarId: CALENDAR_ONLINE,
        eventId: item.eventId,
        destination: CALENDAR_PRESENCIAL,
      });
      const novoEventId = data.id || item.eventId;
      const agendamento = agendamentoPorNumero.get(item.numeroSessao);
      await prisma.agendamento.update({
        where: { id: agendamento.id },
        data: { googleEventId: novoEventId, googleCalendarId: CALENDAR_PRESENCIAL, googleSyncStatus: "SINCRONIZADO" },
      });
      sucesso.push({ numeroSessao: item.numeroSessao, eventId: novoEventId });
    } catch (err) {
      falha.push({ numeroSessao: item.numeroSessao, eventId: item.eventId, motivo: err.message ?? String(err) });
    }
  }

  console.log(`Movidos com sucesso: ${sucesso.length} de ${EVENTOS_CONFIRMADOS.length}`);
  for (const s of sucesso) console.log(`  - sessão ${s.numeroSessao}: ${s.eventId}`);
  if (falha.length > 0) {
    console.log(`\nFalhas: ${falha.length}`);
    for (const f of falha) console.log(`  - sessão ${f.numeroSessao} (${f.eventId}): ${f.motivo}`);
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
