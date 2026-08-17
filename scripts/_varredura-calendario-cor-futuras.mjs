// Varredura read-mostly nos Agendamento de hoje em diante com googleEventId:
// 1) Se o evento estiver no calendário errado (comparado ao
//    TipoSessao.googleCalendarId — mentorado nunca realocado, sempre fica no
//    calendário de mentoria), move via events.move (preserva o mesmo
//    googleEventId, nunca deleta/recria) e atualiza Agendamento.googleCalendarId
//    (único write no banco desta varredura).
// 2) Se o evento tiver colorId preenchido, limpa via events.patch({colorId:null}).
// Nunca aborta no meio: falha num evento é registrada e a varredura segue.
// Uso: node scripts/_varredura-calendario-cor-futuras.mjs
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

const CALENDAR_MENTORIA_ID =
  "c_8c7a8a487847433ebcac52b67b3be7fdc90ddf1717dfed23c9014c82d6ce5111@group.calendar.google.com";

function inicioHojeSP() {
  const agora = new Date();
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [ano, mes, dia] = fmt.format(agora).split("-").map(Number);
  // America/Sao_Paulo é UTC-3 fixo (sem horário de verão desde 2019).
  return new Date(Date.UTC(ano, mes - 1, dia, 3, 0, 0));
}

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
  const desde = inicioHojeSP();
  const sessoes = await prisma.agendamento.findMany({
    where: { googleEventId: { not: null }, inicio: { gte: desde } },
    include: { tipoSessao: true },
    orderBy: { inicio: "asc" },
  });
  console.log(`Janela: a partir de ${desde.toISOString()} (00:00 SP hoje). Total de sessões: ${sessoes.length}`);

  const clinicaIds = [...new Set(sessoes.map((s) => s.clinicaId))];
  const clinicas = new Map();
  for (const id of clinicaIds) {
    const clinica = await prisma.clinica.findUnique({ where: { id } });
    if (!clinica?.googleConectado) {
      console.error(`Clínica ${id} não conectada ao Google — sessões dela puladas.`);
      continue;
    }
    clinicas.set(id, criarClienteGoogle(clinica));
  }

  const movidos = [];
  const coresLimpas = [];
  const semAlvo = [];
  const falhas = [];

  for (const s of sessoes) {
    const calendar = clinicas.get(s.clinicaId);
    if (!calendar) {
      falhas.push({ agendamentoId: s.id, googleEventId: s.googleEventId, erro: "clínica sem Google conectado" });
      continue;
    }

    const ehMentorado = s.alunoId != null;
    const calendarAtual = s.googleCalendarId ?? null;
    const calendarCorreto = ehMentorado ? CALENDAR_MENTORIA_ID : s.tipoSessao?.googleCalendarId ?? null;

    if (!calendarAtual) {
      falhas.push({ agendamentoId: s.id, googleEventId: s.googleEventId, erro: "sem googleCalendarId persistido — não dá pra saber onde o evento está" });
      continue;
    }
    if (!calendarCorreto) {
      semAlvo.push({ agendamentoId: s.id, googleEventId: s.googleEventId, motivo: "sem TipoSessao/googleCalendarId configurado para comparar" });
      continue;
    }

    // Lê o evento de onde achamos que ele está, pra saber se tem colorId
    // ANTES de qualquer move (colorId sobrevive ao move, então dá pra
    // decidir a limpeza já aqui e aplicar no calendário final depois).
    let colorIdOriginal;
    try {
      const { data } = await calendar.events.get({ calendarId: calendarAtual, eventId: s.googleEventId, fields: "id,colorId" });
      colorIdOriginal = data.colorId ?? null;
    } catch (err) {
      const status = err?.code ?? err?.response?.status ?? "??";
      falhas.push({ agendamentoId: s.id, googleEventId: s.googleEventId, calendarId: calendarAtual, etapa: "get", erro: `HTTP ${status}: ${err?.message}` });
      continue;
    }

    let calendarFinal = calendarAtual;
    if (calendarAtual !== calendarCorreto) {
      try {
        await calendar.events.move({ calendarId: calendarAtual, eventId: s.googleEventId, destination: calendarCorreto });
        await prisma.agendamento.update({ where: { id: s.id }, data: { googleCalendarId: calendarCorreto } });
        calendarFinal = calendarCorreto;
        movidos.push({ agendamentoId: s.id, googleEventId: s.googleEventId, de: calendarAtual, para: calendarCorreto, mentorado: ehMentorado });
      } catch (err) {
        const status = err?.code ?? err?.response?.status ?? "??";
        falhas.push({ agendamentoId: s.id, googleEventId: s.googleEventId, etapa: "move", de: calendarAtual, para: calendarCorreto, erro: `HTTP ${status}: ${err?.message}` });
        continue; // não tenta limpar cor se o move (necessário) falhou
      }
    }

    if (colorIdOriginal) {
      try {
        await calendar.events.patch({ calendarId: calendarFinal, eventId: s.googleEventId, requestBody: { colorId: null } });
        coresLimpas.push({ agendamentoId: s.id, googleEventId: s.googleEventId, calendarId: calendarFinal, colorIdAnterior: colorIdOriginal });
      } catch (err) {
        const status = err?.code ?? err?.response?.status ?? "??";
        falhas.push({ agendamentoId: s.id, googleEventId: s.googleEventId, etapa: "patch-cor", calendarId: calendarFinal, erro: `HTTP ${status}: ${err?.message}` });
      }
    }
  }

  console.log(`\n=== Resultado ===`);
  console.log(`Sessões avaliadas: ${sessoes.length}`);
  console.log(`Movidas de calendário: ${movidos.length}`);
  if (movidos.length > 0) console.log(JSON.stringify(movidos, null, 2));
  console.log(`Cores limpas: ${coresLimpas.length}`);
  if (coresLimpas.length > 0) console.log(JSON.stringify(coresLimpas, null, 2));
  console.log(`Sem alvo de comparação (puladas, não é falha): ${semAlvo.length}`);
  if (semAlvo.length > 0) console.log(JSON.stringify(semAlvo, null, 2));
  console.log(`Falhas: ${falhas.length}`);
  if (falhas.length > 0) console.log(JSON.stringify(falhas, null, 2));

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("Erro fatal:", err);
  await prisma.$disconnect();
  process.exit(1);
});
