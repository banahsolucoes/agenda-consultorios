// One-off: move a sessão 6/12 da Lara Barreto (pacote
// 51225b8a-ba79-4a0f-b797-d4e9cfd0a570) de hoje 21/07/2026 14:45 pra hoje
// 21/07/2026 10:15 — mesma data, só corrige o horário. Pedido direto da
// clínica; a paciente/operadora não conseguia fazer isso pelo painel porque
// PATCH /api/sessoes/[id] bloqueia mover sessão pra um horário que já ficou
// no passado (src/app/api/sessoes/[id]/route.ts:165-167,
// `if (novaData.getTime() < Date.now())`), e 10:15 de hoje já passou no
// momento em que a paciente tentou (a correção está sendo feita mais tarde
// no dia).
//
// A validação de passado está misturada direto no corpo do handler da rota,
// não numa função de serviço separada — não dá pra chamar "a mesma função
// pulando só essa checagem". Por isso este script faz UPDATE direto no
// Agendamento (só `inicio`, resto intocado) e chama isoladamente a mesma
// operação que sincronizarEventoGoogle (src/lib/google.ts) faz —
// calendar.events.patch com start/end novos — já que essa função não pode
// ser importada direto num script plain-node (é TS, sem transpilação
// disponível neste ambiente); a chamada abaixo replica exatamente o mesmo
// requestBody que ela monta, sem título/cor (não estamos mudando isso).
//
// Execução única, não faz parte do fluxo normal da aplicação. Não editar a
// validação da rota — ela continua correta pro uso normal do painel.
//
// Conecta via DIRECT_URL (porta 5432), nunca o pooler — mesma regra das
// migrations.
//
// Uso: node scripts/corrigir-sessao-lara.mjs

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

const AGENDAMENTO_ID = "bbff29c7-1ba6-45ed-96ff-d45b43866c36"; // Lara Barreto, sessão 6/12, pacote 51225b8a-...
const NOVO_INICIO = new Date("2026-07-21T13:15:00.000Z"); // 10:15 Brasília (UTC-3, sem horário de verão)
const TIMEZONE = "America/Sao_Paulo";

async function main() {
  const antes = await prisma.agendamento.findUnique({ where: { id: AGENDAMENTO_ID } });
  if (!antes) {
    console.error("Agendamento não encontrado — abortando.");
    process.exit(1);
  }
  console.log("Antes:", antes.inicio.toISOString(), "status:", antes.status);

  const atualizado = await prisma.agendamento.update({
    where: { id: AGENDAMENTO_ID },
    data: { inicio: NOVO_INICIO },
  });
  console.log("Depois:", atualizado.inicio.toISOString(), "status:", atualizado.status);

  if (!atualizado.googleEventId) {
    console.log("Sem googleEventId — nada a sincronizar no Google Calendar.");
    return;
  }

  // Agendamento não guarda clinicaId direto — vem do paciente.
  const paciente = await prisma.paciente.findUnique({ where: { id: atualizado.pacienteId }, select: { clinicaId: true } });
  const clinicaConectada = await prisma.clinica.findUnique({ where: { id: paciente.clinicaId } });

  if (!clinicaConectada?.googleConectado || !clinicaConectada.googleRefreshToken) {
    console.log("Clínica sem Google conectado — não foi possível sincronizar o evento.");
    return;
  }

  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
  client.setCredentials({
    refresh_token: clinicaConectada.googleRefreshToken,
    access_token: clinicaConectada.googleAccessToken ?? undefined,
    expiry_date: clinicaConectada.googleTokenExpiry ? new Date(clinicaConectada.googleTokenExpiry).getTime() : undefined,
  });
  const calendar = google.calendar({ version: "v3", auth: client });

  const fim = new Date(NOVO_INICIO.getTime() + atualizado.duracaoMin * 60_000);
  try {
    await calendar.events.patch({
      calendarId: atualizado.googleCalendarId ?? clinicaConectada.googleCalendarId ?? "primary",
      eventId: atualizado.googleEventId,
      requestBody: {
        start: { dateTime: NOVO_INICIO.toISOString(), timeZone: TIMEZONE },
        end: { dateTime: fim.toISOString(), timeZone: TIMEZONE },
      },
    });
    console.log("Evento do Google Calendar sincronizado com sucesso:", atualizado.googleEventId);
  } catch (err) {
    console.error("Falha ao sincronizar evento no Google Calendar:", err.message ?? err);
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
