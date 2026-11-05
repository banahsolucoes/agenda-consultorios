// AUDITORIA SOMENTE LEITURA (2026-11-02) — sessões do paciente "Gabriel"
// ausentes no Google Calendar + varredura de sessões futuras.
//
// NENHUMA escrita: só SELECT (Prisma findMany / $queryRaw SELECT) e GET na
// API do Google (events.get, events.list, calendarList.list).
// NÃO usa obterCalendarDaClinica/obterClienteGoogleDaClinica (google.ts),
// porque esse helper registra client.on("tokens") e GRAVA o token renovado
// em Clinica — aqui o OAuth2Client é montado sem listener, o refresh fica só
// em memória.
//
// Uso: npx tsx scripts/tmp/auditoria-gabriel.ts [gabriel|saude|varredura|tudo]
import "dotenv/config";
import { google, calendar_v3 } from "googleapis";
import { prisma } from "@/lib/prisma";
import type { Clinica } from "@/generated/prisma";

const MEET_CODE = "pze-hdve-wyv";
const ALVO_UTC = new Date("2026-11-03T20:00:00.000Z");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const fmtSP = (d: Date | null | undefined) =>
  d
    ? new Intl.DateTimeFormat("pt-BR", {
        timeZone: "America/Sao_Paulo",
        weekday: "short",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      }).format(d)
    : "-";
const fmtUTC = (d: Date | null | undefined) => (d ? d.toISOString().replace(".000Z", "Z") : "-");
const mascararCpf = (cpf: string | null) => (cpf ? `***${cpf.replace(/\D/g, "").slice(-4)}` : "(sem cpf)");

// ---------- Google (somente leitura, sem persistir token) ----------
const calendarios = new Map<string, calendar_v3.Calendar>();
function calendarDaClinica(clinica: Clinica): calendar_v3.Calendar | null {
  if (!clinica.googleConectado || !clinica.googleRefreshToken) return null;
  if (calendarios.has(clinica.id)) return calendarios.get(clinica.id)!;
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
  // propositalmente SEM client.on("tokens") — nada é gravado no banco
  const cal = google.calendar({ version: "v3", auth: client });
  calendarios.set(clinica.id, cal);
  return cal;
}

type ResultadoGet =
  | { estado: "EXISTE" | "CANCELLED"; evento: calendar_v3.Schema$Event }
  | { estado: "404" | "410" }
  | { estado: "ERRO"; erro: string };

async function getEvento(cal: calendar_v3.Calendar, calendarId: string, eventId: string): Promise<ResultadoGet> {
  try {
    const { data } = await cal.events.get({ calendarId, eventId });
    return { estado: data.status === "cancelled" ? "CANCELLED" : "EXISTE", evento: data };
  } catch (err) {
    const e = err as { code?: number; response?: { status?: number; data?: unknown }; message?: string };
    const st = e.code ?? e.response?.status;
    if (st === 404) return { estado: "404" };
    if (st === 410) return { estado: "410" };
    return { estado: "ERRO", erro: `HTTP ${st}: ${JSON.stringify(e.response?.data ?? e.message)}` };
  }
}

function meetDoEvento(ev: calendar_v3.Schema$Event | undefined): string | null {
  if (!ev) return null;
  return (
    ev.hangoutLink ??
    ev.conferenceData?.entryPoints?.find((p) => p.entryPointType === "video")?.uri ??
    null
  );
}

// ---------- PASSOS 1-4 + 7 ----------
async function passoGabriel() {
  console.log("\n================ PASSO 1 — Pacientes 'gabriel' ================");
  const pacientes = await prisma.paciente.findMany({
    where: { nome: { contains: "gabriel", mode: "insensitive" } },
    include: { clinica: { select: { slug: true } }, tipoSessao: { select: { nome: true } } },
    orderBy: { criadoEm: "asc" },
  });
  for (const p of pacientes) {
    console.log(
      `clinica=${p.clinica.slug} (${p.clinicaId}) | id=${p.id} | nome=${p.nome} | cpf=${mascararCpf(p.cpf)} | criadoEm=${fmtUTC(p.criadoEm)} | status=${p.statusGeral} | tipoPadrao=${p.tipoSessao?.nome ?? "-"}`
    );
  }

  console.log("\n================ PASSO 2 — Pacotes e sessões ================");
  const janelaIni = new Date("2026-10-01T00:00:00Z");
  const janelaFim = new Date("2027-01-01T00:00:00Z");
  const todasSessoesGabriel: Array<{ id: string; clinicaId: string }> = [];

  for (const p of pacientes) {
    const temNaJanela = await prisma.agendamento.count({
      where: { pacienteId: p.id, inicio: { gte: janelaIni, lt: janelaFim } },
    });
    const pacotes = await prisma.pacote.findMany({ where: { pacienteId: p.id }, orderBy: { criadoEm: "asc" } });
    console.log(`\n### ${p.nome} (${p.id}) — sessões em out–dez/2026: ${temNaJanela} | pacotes: ${pacotes.length}`);
    for (const pk of pacotes) {
      console.log(
        `  Pacote ${pk.id} | tipo=${pk.tipo} | total=${pk.totalSessoes} | status=${pk.status} | dataInicial=${fmtUTC(pk.dataInicial)} | criadoEm=${fmtUTC(pk.criadoEm)}`
      );
    }
    if (temNaJanela === 0 && pacotes.length === 0) continue;

    const sessoes = await prisma.agendamento.findMany({
      where: { pacienteId: p.id },
      include: { tipoSessao: { select: { nome: true, ehOnline: true, ehAtendimentoUnico: true, googleCalendarId: true } } },
      orderBy: [{ inicio: "asc" }],
    });
    for (const s of sessoes) {
      todasSessoesGabriel.push({ id: s.id, clinicaId: s.clinicaId });
      console.log(
        [
          `  - ${s.id}`,
          `pacote=${s.pacoteId?.slice(0, 8) ?? "-"}`,
          `n=${s.numeroSessao}/${s.totalPacote}`,
          `UTC=${fmtUTC(s.inicio)}`,
          `SP=${fmtSP(s.inicio)}`,
          `dur=${s.duracaoMin}`,
          `tipo=${s.tipoSessao?.nome ?? "(nulo)"}${s.tipoSessao?.ehOnline ? "[online]" : "[presencial]"}`,
          `status=${s.status}`,
          `arquivada=${s.arquivada}`,
          `confirmada=${s.confirmada}`,
          `evt=${s.googleEventId ?? "NULL"}`,
          `cal=${s.googleCalendarId ?? "NULL"}`,
          `meet=${s.linkMeet ?? "NULL"}`,
          `sync=${s.googleSyncStatus}`,
          `criadoEm=${fmtUTC(s.criadoEm)}`,
          `updatedAt=${fmtUTC(s.updatedAt)}`,
        ].join(" | ")
      );
    }
    const alvo = sessoes.find((s) => s.inicio.getTime() === ALVO_UTC.getTime());
    console.log(
      alvo
        ? `  >> Sessão em 2026-11-03T20:00Z EXISTE: ${alvo.id} n=${alvo.numeroSessao}/${alvo.totalPacote} status=${alvo.status}`
        : `  >> NÃO há sessão deste paciente em 2026-11-03T20:00Z`
    );
  }

  console.log(`\n--- Busca de "${MEET_CODE}" ---`);
  const porMeet = await prisma.$queryRaw<Array<{ id: string; clinicaId: string; pacienteId: string | null; inicio: Date; linkMeet: string }>>`
    SELECT id, "clinicaId", "pacienteId", inicio, "linkMeet" FROM "Agendamento" WHERE "linkMeet" ILIKE ${"%" + MEET_CODE + "%"}`;
  console.log(`Agendamento.linkMeet: ${porMeet.length} ocorrência(s)`, porMeet);
  const porMsg = await prisma.$queryRaw<Array<{ id: string; conversaId: string; direcao: string; criadoEm: Date; texto: string }>>`
    SELECT id, "conversaId", direcao, "criadoEm", left(texto, 300) AS texto FROM "MensagemWhatsapp" WHERE texto ILIKE ${"%" + MEET_CODE + "%"}`;
  console.log(`MensagemWhatsapp.texto: ${porMsg.length} ocorrência(s)`);
  for (const m of porMsg) console.log(`  ${m.id} conv=${m.conversaId} ${m.direcao} ${fmtUTC(m.criadoEm)} :: ${m.texto.replace(/\s+/g, " ")}`);
  const porLog = await prisma.$queryRaw<Array<{ id: string; acao: string; criadoEm: Date }>>`
    SELECT id, acao, "criadoEm" FROM "LogAuditoria" WHERE detalhe ILIKE ${"%" + MEET_CODE + "%"}`;
  console.log(`LogAuditoria.detalhe: ${porLog.length} ocorrência(s)`, porLog);
  const porFila = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "SincronizacaoPendente" WHERE payload::text ILIKE ${"%" + MEET_CODE + "%"} OR coalesce("ultimoErro",'') ILIKE ${"%" + MEET_CODE + "%"}`;
  console.log(`SincronizacaoPendente: ${porFila.length} ocorrência(s)`);

  // Mensagens WhatsApp do(s) Gabriel(is) — para ver qual link/sessão foi enviada
  console.log("\n--- Mensagens WhatsApp recentes dos pacientes Gabriel (últimas 30, desde 2026-10-01) ---");
  for (const p of pacientes) {
    const msgs = await prisma.$queryRaw<Array<{ criadoEm: Date; direcao: string; tipo: string; texto: string }>>`
      SELECT m."criadoEm", m.direcao, m.tipo, left(m.texto, 400) AS texto
      FROM "MensagemWhatsapp" m JOIN "ConversaWhatsapp" c ON c.id = m."conversaId"
      WHERE c."pacienteId" = ${p.id} AND m."criadoEm" >= '2026-10-01'
      ORDER BY m."criadoEm" DESC LIMIT 30`;
    if (msgs.length) console.log(`# ${p.nome}`);
    for (const m of msgs) console.log(`  ${fmtUTC(m.criadoEm)} ${m.direcao}/${m.tipo}: ${m.texto.replace(/\s+/g, " ")}`);
  }

  console.log("\n================ PASSO 3 — Fila por sessão ================");
  const idsSemFila: string[] = [];
  for (const s of todasSessoesGabriel) {
    const itens = await prisma.$queryRaw<
      Array<{ id: string; tipo: string; status: string; tentativas: number; proximaTentativaEm: Date; ultimoErro: string | null; createdAt: Date; updatedAt: Date }>
    >`SELECT id, tipo::text, status::text, tentativas, "proximaTentativaEm", "ultimoErro", "createdAt", "updatedAt"
      FROM "SincronizacaoPendente" WHERE payload->>'agendamentoId' = ${s.id} ORDER BY "createdAt"`;
    if (!itens.length) {
      idsSemFila.push(s.id);
      continue;
    }
    console.log(`Sessão ${s.id}:`);
    for (const i of itens)
      console.log(
        `   ${i.id} | ${i.tipo} | ${i.status} | tent=${i.tentativas} | prox=${fmtUTC(i.proximaTentativaEm)} | criado=${fmtUTC(i.createdAt)} | atualizado(≈processado)=${fmtUTC(i.updatedAt)} | erro=${i.ultimoErro ?? "-"}`
      );
  }
  console.log(`Sessões SEM nenhum item de fila (${idsSemFila.length}):`, idsSemFila);

  console.log("\n================ PASSO 4 — Verdade no Google ================");
  const sessoesComEvt = await prisma.agendamento.findMany({
    where: { id: { in: todasSessoesGabriel.map((s) => s.id) } },
    include: { clinica: true, tipoSessao: true },
    orderBy: { inicio: "asc" },
  });
  for (const s of sessoesComEvt) {
    const esperado = s.tipoSessao?.googleCalendarId ?? s.clinica.googleCalendarId ?? "primary";
    if (!s.googleEventId) {
      console.log(`${s.id} n=${s.numeroSessao} ${fmtSP(s.inicio)} | SEM googleEventId | calendário que o roteamento atual usaria: ${esperado}`);
      continue;
    }
    const cal = calendarDaClinica(s.clinica);
    if (!cal) {
      console.log(`${s.id} | clínica sem Google conectado`);
      continue;
    }
    const r = await getEvento(cal, s.googleCalendarId ?? esperado, s.googleEventId);
    let extra = "";
    if (r.estado === "EXISTE" || r.estado === "CANCELLED") {
      const ini = r.evento.start?.dateTime ? new Date(r.evento.start.dateTime) : null;
      const meet = meetDoEvento(r.evento);
      extra = ` | inicioGoogle=${fmtUTC(ini)} ${ini && ini.getTime() !== s.inicio.getTime() ? "≠ BANCO" : "= banco"} | meetGoogle=${meet ?? "-"} ${meet !== s.linkMeet ? "≠ BANCO" : "= banco"} | summary="${r.evento.summary}"`;
    } else if (r.estado === "ERRO") extra = ` | ${r.erro}`;
    console.log(
      `${s.id} n=${s.numeroSessao} ${fmtSP(s.inicio)} | evt=${s.googleEventId} | calGravado=${s.googleCalendarId} | calEsperado=${esperado} ${s.googleCalendarId === esperado ? "OK" : "DIVERGE"} | Google=${r.estado}${extra}`
    );
    await sleep(120);
  }

  // Reuso de googleEventId
  const evts = sessoesComEvt.map((s) => s.googleEventId).filter((x): x is string => !!x);
  if (evts.length) {
    const reuso = await prisma.agendamento.findMany({
      where: { googleEventId: { in: evts }, id: { notIn: sessoesComEvt.map((s) => s.id) } },
      select: { id: true, pacienteId: true, googleEventId: true, inicio: true, status: true },
    });
    console.log(`\nReuso de googleEventId em OUTRAS sessões: ${reuso.length}`, reuso);
  } else {
    console.log("\nReuso de googleEventId: n/a (nenhuma sessão do Gabriel tem googleEventId)");
  }

  console.log("\n================ PASSO 7 — Log de auditoria ================");
  for (const p of pacientes) {
    const logs = await prisma.$queryRaw<Array<{ criadoEm: Date; acao: string; detalhe: string | null; usuario: string | null }>>`
      SELECT l."criadoEm", l.acao, left(l.detalhe, 500) AS detalhe, u.nome AS usuario
      FROM "LogAuditoria" l LEFT JOIN "Usuario" u ON u.id = l."usuarioId"
      WHERE l."clinicaId" = ${p.clinicaId} AND (l.detalhe ILIKE ${"%" + p.id + "%"} OR l.detalhe ILIKE ${"%" + p.nome + "%"}
        OR l.detalhe ILIKE ANY (SELECT '%' || a.id || '%' FROM "Agendamento" a WHERE a."pacienteId" = ${p.id})
        OR l.detalhe ILIKE ANY (SELECT '%' || k.id || '%' FROM "Pacote" k WHERE k."pacienteId" = ${p.id}))
      ORDER BY l."criadoEm"`;
    console.log(`# ${p.nome}: ${logs.length} log(s)`);
    for (const l of logs) console.log(`  ${fmtUTC(l.criadoEm)} | ${l.usuario ?? "-"} | ${l.acao} | ${(l.detalhe ?? "").replace(/\s+/g, " ")}`);
  }
}

// ---------- PASSO 5 ----------
async function passoSaude() {
  console.log("\n================ PASSO 5 — Saúde da integração ================");
  const clinicas = await prisma.clinica.findMany({ orderBy: { criadoEm: "asc" } });
  for (const c of clinicas) {
    console.log(
      `\n# ${c.slug} | conectado=${c.googleConectado} | refreshToken=${c.googleRefreshToken ? "presente" : "AUSENTE"} | accessToken=${c.googleAccessToken ? "presente" : "ausente"} | tokenExpiry=${fmtUTC(c.googleTokenExpiry)} | tokenValido=${c.googleTokenValido} | ultimaFalhaEm=${fmtUTC(c.googleUltimaFalhaEm)} | ultimoErro=${c.googleUltimoErro ?? "-"} @ ${fmtUTC(c.googleUltimoErroEm)} | updatedAt=${fmtUTC((c as { updatedAt?: Date }).updatedAt)}`
    );
    const tipos = await prisma.tipoSessao.findMany({ where: { clinicaId: c.id }, select: { nome: true, ehOnline: true, googleCalendarId: true } });
    for (const t of tipos) console.log(`   tipo "${t.nome}" online=${t.ehOnline} -> ${t.googleCalendarId ?? "(nulo, cai em clinica.googleCalendarId=" + c.googleCalendarId + ")"}`);
    const cal = calendarDaClinica(c);
    if (!cal) continue;
    try {
      const { data } = await cal.calendarList.list({ maxResults: 50 });
      console.log(`   calendarList.list OK — ${data.items?.length ?? 0} calendários:`);
      for (const it of data.items ?? []) console.log(`     ${it.id} | ${it.summary} | role=${it.accessRole}`);
    } catch (err) {
      const e = err as { code?: number; response?: { data?: unknown }; message?: string };
      console.log(`   calendarList.list FALHOU: HTTP ${e.code} ${JSON.stringify(e.response?.data ?? e.message)}`);
    }
  }

  const desde = new Date(Date.now() - 14 * 86400_000);
  console.log(`\n--- Fila desde ${fmtUTC(desde)} (por createdAt) ---`);
  const porStatus = await prisma.$queryRaw<Array<{ status: string; tipo: string; n: bigint }>>`
    SELECT status::text, tipo::text, count(*) AS n FROM "SincronizacaoPendente" WHERE "createdAt" >= ${desde} GROUP BY 1,2 ORDER BY 1,2`;
  for (const r of porStatus) console.log(`  ${r.status.padEnd(12)} ${r.tipo.padEnd(18)} ${r.n}`);
  const globalStatus = await prisma.$queryRaw<Array<{ status: string; n: bigint }>>`
    SELECT status::text, count(*) AS n FROM "SincronizacaoPendente" GROUP BY 1 ORDER BY 1`;
  console.log("  (histórico total por status):", globalStatus.map((r) => `${r.status}=${r.n}`).join(" "));
  const pend = await prisma.$queryRaw<Array<{ id: string; tipo: string; status: string; tentativas: number; createdAt: Date; proximaTentativaEm: Date; ultimoErro: string | null }>>`
    SELECT id, tipo::text, status::text, tentativas, "createdAt", "proximaTentativaEm", "ultimoErro" FROM "SincronizacaoPendente"
    WHERE status IN ('PENDENTE','PROCESSANDO') ORDER BY "createdAt" ASC LIMIT 10`;
  console.log(`  Pendentes/processando mais antigos (${pend.length}):`);
  for (const p of pend) console.log(`   ${p.id} ${p.tipo} ${p.status} tent=${p.tentativas} criado=${fmtUTC(p.createdAt)} prox=${fmtUTC(p.proximaTentativaEm)} erro=${p.ultimoErro ?? "-"}`);
  const erros = await prisma.$queryRaw<Array<{ ultimoErro: string; n: bigint; ultimo: Date }>>`
    SELECT "ultimoErro", count(*) AS n, max("updatedAt") AS ultimo FROM "SincronizacaoPendente"
    WHERE "ultimoErro" IS NOT NULL GROUP BY 1 ORDER BY max("updatedAt") DESC LIMIT 10`;
  console.log("  10 últimos erros distintos:");
  for (const e of erros) console.log(`   [${fmtUTC(e.ultimo)}] x${e.n} ${e.ultimoErro}`);
  const ultimoOk = await prisma.$queryRaw<Array<{ ultimo: Date | null }>>`
    SELECT max("updatedAt") AS ultimo FROM "SincronizacaoPendente" WHERE status = 'CONCLUIDO'`;
  const ultimoCriado = await prisma.$queryRaw<Array<{ ultimo: Date | null }>>`SELECT max("createdAt") AS ultimo FROM "SincronizacaoPendente"`;
  console.log(`  Último item CONCLUIDO (updatedAt): ${fmtUTC(ultimoOk[0]?.ultimo)} | último item criado: ${fmtUTC(ultimoCriado[0]?.ultimo)}`);
}

// ---------- PASSO 6 ----------
async function passoVarredura() {
  console.log("\n================ PASSO 6 — Varredura de sessões futuras ================");
  const agora = new Date();
  const futuras = await prisma.agendamento.findMany({
    where: { inicio: { gte: agora }, arquivada: false, status: { not: "CANCELADA" } },
    include: { clinica: true, tipoSessao: true, paciente: { select: { nome: true } }, aluno: { select: { nomeCompleto: true } } },
    orderBy: { inicio: "asc" },
  });
  const semEvt = futuras.filter((s) => !s.googleEventId);
  console.log(`Total futuras (não arquivadas, não canceladas): ${futuras.length}`);
  console.log(`Por clínica:`, Object.entries(futuras.reduce<Record<string, number>>((a, s) => ((a[s.clinica.slug] = (a[s.clinica.slug] ?? 0) + 1), a), {})));
  console.log(`Sem googleEventId: ${semEvt.length}`);

  let alvo = futuras.filter((s) => s.googleEventId);
  if (alvo.length > 300) {
    const lim = new Date(agora.getTime() + 7 * 86400_000);
    console.log(`Com googleEventId: ${alvo.length} (>300) — checando só até ${fmtUTC(lim)}`);
    alvo = alvo.filter((s) => s.inicio < lim);
  }
  console.log(`Checando ${alvo.length} eventos na API do Google...`);

  type Div = { s: (typeof futuras)[number]; motivo: string };
  const divergentes: Div[] = semEvt.map((s) => ({ s, motivo: "SEM_EVENT_ID" }));
  const contagem: Record<string, number> = {};
  for (const s of alvo) {
    const cal = calendarDaClinica(s.clinica);
    if (!cal) {
      contagem["CLINICA_SEM_GOOGLE"] = (contagem["CLINICA_SEM_GOOGLE"] ?? 0) + 1;
      divergentes.push({ s, motivo: "CLINICA_SEM_GOOGLE" });
      continue;
    }
    const r = await getEvento(cal, s.googleCalendarId ?? "primary", s.googleEventId!);
    let motivo: string = r.estado;
    if (r.estado === "EXISTE") {
      const ini = r.evento.start?.dateTime ? new Date(r.evento.start.dateTime) : null;
      if (ini && ini.getTime() !== s.inicio.getTime()) motivo = `HORARIO_DIVERGENTE(google=${fmtSP(ini)})`;
    } else if (r.estado === "ERRO") motivo = `ERRO ${r.erro}`;
    contagem[motivo.split("(")[0]] = (contagem[motivo.split("(")[0]] ?? 0) + 1;
    if (motivo !== "EXISTE") divergentes.push({ s, motivo });
    await sleep(100);
  }
  console.log("Resultado da checagem:", contagem);

  console.log(`\nDivergentes (${divergentes.length}):`);
  for (const { s, motivo } of divergentes) {
    const ult = await prisma.$queryRaw<Array<{ tipo: string; status: string; ultimoErro: string | null; createdAt: Date }>>`
      SELECT tipo::text, status::text, "ultimoErro", "createdAt" FROM "SincronizacaoPendente"
      WHERE payload->>'agendamentoId' = ${s.id} ORDER BY "createdAt" DESC LIMIT 1`;
    const u = ult[0];
    console.log(
      `  ${s.clinica.slug} | ${s.paciente?.nome ?? s.aluno?.nomeCompleto ?? "-"} | ${s.numeroSessao ?? "-"}/${s.totalPacote ?? "-"} | ${fmtSP(s.inicio)} | ${s.tipoSessao?.nome ?? "-"} | ${s.status} | sync=${s.googleSyncStatus} | ${motivo} | id=${s.id} | criadoEm=${fmtUTC(s.criadoEm)} | fila=${u ? `${u.tipo}/${u.status} @${fmtUTC(u.createdAt)} erro=${u.ultimoErro ?? "-"}` : "NENHUM ITEM"}`
    );
  }
}

// ---------- Detalhe do evento cancelado + vizinhança no calendário ----------
async function passoEvento() {
  console.log("\n================ DETALHE — evento da sessão 5/12 ================");
  const s = await prisma.agendamento.findUniqueOrThrow({
    where: { id: "547d29b6-b52a-4926-a2d4-c07bd776d41f" },
    include: { clinica: true },
  });
  const cal = calendarDaClinica(s.clinica)!;
  const r = await getEvento(cal, s.googleCalendarId!, s.googleEventId!);
  if ("evento" in r) {
    const e = r.evento;
    console.log(
      JSON.stringify(
        {
          status: e.status, created: e.created, updated: e.updated, summary: e.summary,
          start: e.start, end: e.end, organizer: e.organizer, creator: e.creator,
          hangoutLink: e.hangoutLink, sequence: e.sequence, recurringEventId: e.recurringEventId,
        },
        null,
        2
      )
    );
  } else console.log(r);

  console.log("\n--- events.list (showDeleted) q='Gabriel' 2026-10-20..2026-11-15 em", s.googleCalendarId, "---");
  const { data } = await cal.events.list({
    calendarId: s.googleCalendarId!,
    q: "Gabriel",
    showDeleted: true,
    singleEvents: true,
    timeMin: "2026-10-20T00:00:00Z",
    timeMax: "2026-11-15T00:00:00Z",
    maxResults: 100,
  });
  for (const e of data.items ?? [])
    console.log(`  ${e.id} | ${e.status} | start=${e.start?.dateTime} | updated=${e.updated} | created=${e.created} | ${e.summary} | ${e.hangoutLink ?? "-"}`);

  console.log("\n--- events.list (showDeleted) TODOS os eventos 03/11 19:00–22:00Z ---");
  const viz = await cal.events.list({
    calendarId: s.googleCalendarId!,
    showDeleted: true,
    singleEvents: true,
    timeMin: "2026-11-03T19:00:00Z",
    timeMax: "2026-11-03T22:00:00Z",
  });
  for (const e of viz.data.items ?? [])
    console.log(`  ${e.id} | ${e.status} | start=${e.start?.dateTime} | updated=${e.updated} | ${e.summary}`);

  // Eventos cancelados recentemente no calendário inteiro (updatedMin = 7 dias)
  console.log("\n--- events.list (showDeleted, updatedMin=2026-10-26) status=cancelled em", s.googleCalendarId, "---");
  let pageToken: string | undefined;
  const cancelados: calendar_v3.Schema$Event[] = [];
  do {
    const resp = await cal.events.list({
      calendarId: s.googleCalendarId!,
      showDeleted: true,
      updatedMin: "2026-10-26T00:00:00Z",
      maxResults: 250,
      pageToken,
    });
    cancelados.push(...(resp.data.items ?? []).filter((e) => e.status === "cancelled"));
    pageToken = resp.data.nextPageToken ?? undefined;
  } while (pageToken);
  const ids = cancelados.map((e) => e.id!).filter(Boolean);
  const locais = await prisma.agendamento.findMany({
    where: { googleEventId: { in: ids } },
    include: { paciente: { select: { nome: true } } },
  });
  const porEvt = new Map(locais.map((a) => [a.googleEventId!, a]));
  for (const e of cancelados.sort((a, b) => (a.updated ?? "").localeCompare(b.updated ?? ""))) {
    const a = porEvt.get(e.id!);
    console.log(
      `  ${e.id} | updated=${e.updated} | ${a ? `BANCO: ${a.paciente?.nome} ${a.numeroSessao}/${a.totalPacote} ${fmtSP(a.inicio)} status=${a.status} sync=${a.googleSyncStatus}` : "(sem agendamento local apontando)"}`
    );
  }
}

// ---------- Janela 28/10 20:50Z → 29/10 11:35Z (clínica pamela-rachid) ----------
async function passoJanela() {
  const ini = new Date("2026-10-28T20:50:00Z");
  const fim = new Date("2026-10-29T11:35:00Z");
  console.log(`\n================ JANELA ${fmtUTC(ini)} → ${fmtUTC(fim)} ================`);
  const logs = await prisma.$queryRaw<Array<{ criadoEm: Date; acao: string; detalhe: string | null; usuario: string | null }>>`
    SELECT l."criadoEm", l.acao, left(l.detalhe, 250) AS detalhe, u.nome AS usuario
    FROM "LogAuditoria" l LEFT JOIN "Usuario" u ON u.id = l."usuarioId"
    WHERE l."criadoEm" BETWEEN ${ini} AND ${fim} ORDER BY l."criadoEm"`;
  console.log(`LogAuditoria (${logs.length}):`);
  for (const l of logs) console.log(`  ${fmtUTC(l.criadoEm)} | ${l.usuario ?? "-"} | ${l.acao} | ${(l.detalhe ?? "").replace(/\s+/g, " ")}`);
  const fila = await prisma.$queryRaw<Array<{ id: string; tipo: string; status: string; ag: string | null; createdAt: Date; updatedAt: Date; ultimoErro: string | null }>>`
    SELECT id, tipo::text, status::text, payload->>'agendamentoId' AS ag, "createdAt", "updatedAt", "ultimoErro"
    FROM "SincronizacaoPendente" WHERE "createdAt" BETWEEN ${ini} AND ${fim} ORDER BY "createdAt"`;
  console.log(`\nFila (${fila.length}):`);
  for (const f of fila) {
    const a = f.ag
      ? await prisma.agendamento.findUnique({ where: { id: f.ag }, select: { numeroSessao: true, totalPacote: true, paciente: { select: { nome: true } } } })
      : null;
    console.log(`  ${fmtUTC(f.createdAt)} → ${fmtUTC(f.updatedAt)} | ${f.tipo} | ${f.status} | ${a?.paciente?.nome ?? "-"} ${a?.numeroSessao ?? ""}/${a?.totalPacote ?? ""} | ag=${f.ag} | erro=${f.ultimoErro ?? "-"}`);
  }
  const msgs = await prisma.$queryRaw<Array<{ criadoEm: Date; direcao: string; nome: string | null; texto: string }>>`
    SELECT m."criadoEm", m.direcao, p.nome, left(m.texto, 160) AS texto FROM "MensagemWhatsapp" m
    JOIN "ConversaWhatsapp" c ON c.id = m."conversaId" LEFT JOIN "Paciente" p ON p.id = c."pacienteId"
    WHERE m."criadoEm" BETWEEN ${new Date("2026-10-29T11:20:00Z")} AND ${fim} ORDER BY m."criadoEm"`;
  console.log(`\nWhatsApp 29/10 11:20–11:35Z (${msgs.length}):`);
  for (const m of msgs) console.log(`  ${fmtUTC(m.criadoEm)} ${m.direcao} ${m.nome ?? "-"}: ${m.texto.replace(/\s+/g, " ")}`);
}

async function main() {
  const modo = process.argv[2] ?? "tudo";
  if (modo === "remover") {
    const rs = await prisma.$queryRaw<Array<{ id: string; ag: string; status: string; createdAt: Date; updatedAt: Date; ultimoErro: string | null }>>`
      SELECT id, payload->>'agendamentoId' AS ag, status::text, "createdAt", "updatedAt", "ultimoErro" FROM "SincronizacaoPendente"
      WHERE tipo = 'CALENDAR_REMOVER' AND "createdAt" >= '2026-09-28' ORDER BY "createdAt"`;
    for (const r of rs) {
      const a = await prisma.agendamento.findUnique({
        where: { id: r.ag },
        select: { numeroSessao: true, totalPacote: true, status: true, inicio: true, googleEventId: true, paciente: { select: { nome: true } } },
      });
      console.log(`${fmtUTC(r.createdAt)} → ${fmtUTC(r.updatedAt)} | ${r.status} | ${a?.paciente?.nome} ${a?.numeroSessao}/${a?.totalPacote} ${fmtSP(a?.inicio)} status=${a?.status} evtAtual=${a?.googleEventId ?? "NULL"} | erro=${r.ultimoErro ?? "-"}`);
    }
  }
  if (modo === "janela") await passoJanela();
  if (modo === "evento") await passoEvento();
  if (modo === "gabriel" || modo === "tudo") await passoGabriel();
  if (modo === "saude" || modo === "tudo") await passoSaude();
  if (modo === "varredura" || modo === "tudo") await passoVarredura();
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
