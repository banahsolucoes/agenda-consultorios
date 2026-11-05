// RESTAURAÇÃO PONTUAL (2026-11-02) — evento da sessão 5/12 do Gabriel de
// Jesus da Silva Pompeu, cancelado no Google mas ativo no banco.
//
// Sem --executar: DRY-RUN, só leitura (SELECT + events.get).
// Com --executar: events.patch {status:"confirmed"} no MESMO eventId (mantém
// o link Meet), confere com events.get e só então grava
// googleSyncStatus=SINCRONIZADO na sessão. Sem plano B automático: qualquer
// divergência PARA sem gravar nada no banco.
//
// Não zera IDs, não recria evento, não enfileira nada. OAuth2Client montado
// sem listener "tokens" (nada de token é gravado no banco).
//
// Uso: npx tsx scripts/tmp/restaurar-gabriel.ts [--executar]
import "dotenv/config";
import { google, calendar_v3 } from "googleapis";
import { prisma } from "@/lib/prisma";

const PACIENTE_ID = "e39c07c5-5385-44b3-a2d6-1fe9f089bbee";
const SESSAO_ID = "547d29b6-b52a-4926-a2d4-c07bd776d41f";
const CALENDAR_ID = "contato@pamelarachid.com.br";
const EVENT_ID = "nkjh1mhi1ihugt4njluj7bosuc";
const MEET_CODE = "pze-hdve-wyv";
const INICIO_ESPERADO = new Date("2026-11-03T20:00:00.000Z");
const EXECUTAR = process.argv.includes("--executar");

const fmtSP = (d: Date | null | undefined) =>
  d
    ? new Intl.DateTimeFormat("pt-BR", {
        timeZone: "America/Sao_Paulo", weekday: "short", day: "2-digit", month: "2-digit",
        year: "numeric", hour: "2-digit", minute: "2-digit",
      }).format(d)
    : "-";

async function obterCalendar(): Promise<calendar_v3.Calendar> {
  const sessao = await prisma.agendamento.findUniqueOrThrow({ where: { id: SESSAO_ID }, include: { clinica: true } });
  const c = sessao.clinica;
  if (!c.googleConectado || !c.googleRefreshToken) throw new Error("Clínica sem Google conectado");
  const client = new google.auth.OAuth2(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_REDIRECT_URI);
  client.setCredentials({
    refresh_token: c.googleRefreshToken,
    access_token: c.googleAccessToken ?? undefined,
    expiry_date: c.googleTokenExpiry?.getTime(),
  });
  // propositalmente SEM client.on("tokens")
  return google.calendar({ version: "v3", auth: client });
}

type Linha = { id: string; n: string; status: string; problema: boolean };

async function tabela(cal: calendar_v3.Calendar): Promise<Linha[]> {
  const sessoes = await prisma.agendamento.findMany({
    where: { pacienteId: PACIENTE_ID, status: { not: "CANCELADA" }, arquivada: false },
    include: { tipoSessao: { select: { nome: true } } },
    orderBy: { inicio: "asc" },
  });
  const agora = new Date();
  const res: Linha[] = [];
  console.log("| nº | tipo | data SP (banco) | status banco | sync banco | googleEventId | status Google | data SP (Google) | data = | Meet Google | Meet = | quando |");
  console.log("|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const s of sessoes) {
    let stG = "-", dataG: Date | null = null, meetG: string | null = null;
    if (!s.googleEventId || !s.googleCalendarId) stG = "SEM_EVENT_ID";
    else {
      try {
        const { data } = await cal.events.get({ calendarId: s.googleCalendarId, eventId: s.googleEventId });
        stG = data.status ?? "?";
        dataG = data.start?.dateTime ? new Date(data.start.dateTime) : null;
        meetG = data.hangoutLink ?? data.conferenceData?.entryPoints?.find((p) => p.entryPointType === "video")?.uri ?? null;
      } catch (err) {
        const e = err as { code?: number; response?: { status?: number } };
        stG = `ERRO HTTP ${e.code ?? e.response?.status}`;
      }
    }
    const dataOk = dataG ? dataG.getTime() === s.inicio.getTime() : false;
    const meetOk = meetG === s.linkMeet;
    const n = `${s.numeroSessao}/${s.totalPacote}`;
    console.log(
      `| ${n} | ${s.tipoSessao?.nome ?? "-"} | ${fmtSP(s.inicio)} | ${s.status} | ${s.googleSyncStatus} | ${s.googleEventId ?? "-"} | ${stG} | ${fmtSP(dataG)} | ${dataOk ? "sim" : "NÃO"} | ${meetG ?? "-"} | ${meetOk ? "sim" : "NÃO"} | ${s.inicio >= agora ? "futura" : "passada"} |`
    );
    res.push({ id: s.id, n, status: stG, problema: stG !== "confirmed" || !dataOk || !meetOk });
    await new Promise((r) => setTimeout(r, 120));
  }
  return res;
}

async function main() {
  const cal = await obterCalendar();
  console.log(`\n=== ${EXECUTAR ? "EXECUÇÃO" : "DRY-RUN"} — situação atual ===\n`);
  const linhas = await tabela(cal);

  const problemas = linhas.filter((l) => l.problema);
  console.log(`\nSessões com problema: ${problemas.map((p) => `${p.n} (${p.id}, Google=${p.status})`).join(", ") || "nenhuma"}`);
  const soA5 = problemas.length === 1 && problemas[0].id === SESSAO_ID && problemas[0].status === "cancelled";
  if (!soA5) {
    console.log("\n>>> PARADA: o conjunto de sessões com problema não é exatamente a 5/12 cancelada. Nada será feito.");
    return;
  }
  console.log("OK: a única sessão com problema é a 5/12 (cancelled no Google).");

  console.log("\n--- Ações planejadas ---");
  console.log(`1) calendar.events.patch({ calendarId: "${CALENDAR_ID}", eventId: "${EVENT_ID}", sendUpdates: "none", requestBody: { status: "confirmed" } })`);
  console.log(`2) Conferência via events.get: status=confirmed, início=${fmtSP(INICIO_ESPERADO)} (${INICIO_ESPERADO.toISOString()}), hangoutLink contém "${MEET_CODE}"`);
  console.log(`3) Somente se (2) passar — banco:`);
  console.log(`   UPDATE "Agendamento" SET "googleSyncStatus" = 'SINCRONIZADO' (updatedAt automático)`);
  console.log(`   WHERE id = '${SESSAO_ID}' AND "googleEventId" = '${EVENT_ID}' AND "googleCalendarId" = '${CALENDAR_ID}' AND "googleSyncStatus" = 'FALHOU'`);
  console.log(`   (não existe campo de timestamp de sincronização no schema)`);

  if (!EXECUTAR) {
    console.log("\nDRY-RUN: nada foi alterado. Rode com --executar após autorização.");
    return;
  }

  // ---------- FASE 2 ----------
  console.log("\n>>> Executando events.patch...");
  try {
    await cal.events.patch({ calendarId: CALENDAR_ID, eventId: EVENT_ID, sendUpdates: "none", requestBody: { status: "confirmed" } });
  } catch (err) {
    const e = err as { code?: number; response?: { data?: unknown }; message?: string };
    console.log(`>>> PARADA: patch falhou — HTTP ${e.code}: ${JSON.stringify(e.response?.data ?? e.message)}. Banco NÃO alterado.`);
    return;
  }

  const { data: ev } = await cal.events.get({ calendarId: CALENDAR_ID, eventId: EVENT_ID });
  const ini = ev.start?.dateTime ? new Date(ev.start.dateTime) : null;
  const meet = ev.hangoutLink ?? "";
  console.log(`events.get pós-patch: status=${ev.status} | início=${fmtSP(ini)} | hangoutLink=${meet} | updated=${ev.updated}`);
  const ok = ev.status === "confirmed" && ini?.getTime() === INICIO_ESPERADO.getTime() && meet.includes(MEET_CODE);
  if (!ok) {
    console.log(">>> PARADA: conferência pós-patch não passou. Banco NÃO alterado.");
    return;
  }

  const r = await prisma.agendamento.updateMany({
    where: { id: SESSAO_ID, googleEventId: EVENT_ID, googleCalendarId: CALENDAR_ID, googleSyncStatus: "FALHOU" },
    data: { googleSyncStatus: "SINCRONIZADO" },
  });
  console.log(`UPDATE googleSyncStatus: ${r.count} linha(s) afetada(s).`);

  console.log("\n=== Situação final ===\n");
  const finais = await tabela(cal);
  const ruins = finais.filter((l) => l.problema);
  console.log(`\nSessões com problema após a correção: ${ruins.map((p) => `${p.n} (Google=${p.status})`).join(", ") || "nenhuma"}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
