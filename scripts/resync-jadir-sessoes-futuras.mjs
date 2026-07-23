// One-off: corrige a data/hora do evento no Google Calendar de 7 sessões do
// paciente Jadir Silva (sessões 6 a 12 do pacote 433ac7af-a65d-425b-a835-
// d2779757fa30) que ficaram atrasadas em 7 dias em relação ao banco.
//
// Diagnóstico: o banco já estava correto (bate com um `empurrar` de 1
// semana aplicado com sucesso); o evento no Google nunca refletiu esse
// empurrão — cada uma das 7 sessões estava exatamente 7 dias atrás do valor
// correto. `googleSyncStatus` mostrava SINCRONIZADO nessas linhas, mas isso
// veio do backfill de status anterior (só checava "tem googleEventId", não
// se a data batia de verdade) — comparação direta contra a API confirmou o
// desvio.
//
// Ação: só UPDATE do evento existente no Google (nunca cria evento novo,
// nunca altera a data no banco — o banco é a fonte da verdade, a correção
// vai só nessa direção). Replica exatamente o mesmo requestBody que
// sincronizarEventoGoogle (src/lib/google.ts) monta — não é possível
// importar esse módulo TS direto num script plain-node neste ambiente (sem
// transpilador instalado), então a chamada abaixo é a mesma operação, feita
// aqui pra poder capturar sucesso/falha por linha (a função original
// engole o erro e só loga, então não dava pra saber o resultado por sessão
// sem essa réplica).
//
// Execução única, não faz parte do fluxo normal da aplicação.
//
// Conecta via DIRECT_URL (porta 5432), nunca o pooler — mesma regra das
// migrations.
//
// Uso: node scripts/resync-jadir-sessoes-futuras.mjs

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
const TIMEZONE = "America/Sao_Paulo";
const IDS_ALVO = [
  "aedced4d-2f99-4cf5-882a-90c603e063ea", // sessão 6
  "edd3288c-7696-44f8-9027-238c938d41d5", // sessão 7
  "bd8707fc-51cd-49ee-8472-7df800aa6a0f", // sessão 8
  "1352e46a-8070-4790-afad-c36cb2446062", // sessão 9
  "f097cb7d-335e-4166-a6aa-dc93bde9cb20", // sessão 10
  "c8839145-edeb-410e-8158-35059ff9f1f4", // sessão 11
  "9b0a551d-513d-4ef4-9884-1737240d97c3", // sessão 12
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

  const rows = await prisma.agendamento.findMany({ where: { id: { in: IDS_ALVO } } });

  const sucesso = [];
  const falha = [];

  for (const r of rows) {
    const fim = new Date(r.inicio.getTime() + r.duracaoMin * 60_000);
    try {
      await calendar.events.patch({
        calendarId: r.googleCalendarId ?? clinica.googleCalendarId ?? "primary",
        eventId: r.googleEventId,
        requestBody: {
          start: { dateTime: r.inicio.toISOString(), timeZone: TIMEZONE },
          end: { dateTime: fim.toISOString(), timeZone: TIMEZONE },
        },
      });
      await prisma.agendamento.update({ where: { id: r.id }, data: { googleSyncStatus: "SINCRONIZADO" } });
      sucesso.push({ numeroSessao: r.numeroSessao, id: r.id });
    } catch (err) {
      await prisma.agendamento.update({ where: { id: r.id }, data: { googleSyncStatus: "FALHOU" } });
      falha.push({ numeroSessao: r.numeroSessao, id: r.id, motivo: err.message ?? String(err) });
    }
  }

  console.log(`Sincronizados com sucesso: ${sucesso.length} de ${rows.length}`);
  for (const s of sucesso) console.log(`  - sessão ${s.numeroSessao} (${s.id})`);
  if (falha.length > 0) {
    console.log(`\nFalhas: ${falha.length}`);
    for (const f of falha) console.log(`  - sessão ${f.numeroSessao} (${f.id}): ${f.motivo}`);
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
