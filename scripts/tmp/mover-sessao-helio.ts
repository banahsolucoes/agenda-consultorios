// CORREÇÃO PONTUAL (2026-10-27) — move a sessão 1/4 do pacote atual do
// paciente "Helio" (clínica pamela-rachid) de 27/10/2026 17:00 para
// 26/10/2026 17:00 (America/Sao_Paulo), mesma duração. Erro operacional de
// agendamento (Dai). Script temporário, não commitável.
//
// Default = DRY-RUN (somente leitura: nenhum write no banco, nenhuma chamada
// de escrita no Google, nenhum enfileiramento). Com --apply:
//   1) numa transação: atualiza `inicio` (duracaoMin intacta — `Agendamento`
//      não tem coluna `fim`), mantém googleEventId/googleCalendarId/status,
//      grava LogAuditoria e enfileira CALENDAR_ATUALIZAR em
//      SincronizacaoPendente (mesmo tipo usado por sessoes/[id] ao editar
//      horário — o worker faz PATCH no evento existente, não recria);
//   2) drena a fila agora com processarPendentes (src/lib/sincronizacao.ts);
//   3) confere o evento direto via events.get na Google Calendar API.
//
// Lembretes WhatsApp: não existe fila/registro de lembrete pendente no
// schema — o cron diário (cron/whatsapp-lembretes) escolhe as sessões pela
// janela de `inicio` futura (24h-72h para o lembrete de 48h, "hoje" para a
// mensagem do dia). Sessão movida para o passado sai das duas janelas
// sozinha; o script só reporta o estado (lembreteWhatsappEnviadoEm e
// mensagens meet_dia de hoje), não há o que cancelar.
//
// Conecta via DIRECT_URL (porta 5432), nunca o pooler: DATABASE_URL é
// sobrescrita antes de importar @/lib/prisma (imports dinâmicos abaixo).
//
// Uso: npx tsx scripts/tmp/mover-sessao-helio.ts [--apply]
import "dotenv/config";

if (!process.env.DIRECT_URL) {
  console.error("DIRECT_URL não definida no ambiente.");
  process.exit(1);
}
process.env.DATABASE_URL = process.env.DIRECT_URL;

const APLICAR = process.argv.includes("--apply");
const SLUG_CLINICA = "pamela-rachid";
const TERMO_NOME = "helio";
const NUMERO_SESSAO = 1;
const TOTAL_PACOTE = 4;
const MOTIVO = "Correção manual: erro de agendamento (Dai) — movida para 26/10 17:00";

const semAcento = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

async function main() {
  const { prisma } = await import("@/lib/prisma");
  const { criarDataSP, formatarDataHoraSP, componentesSP } = await import("@/lib/timezone");
  const { existeConflitoDeSemana } = await import("@/lib/conflitoSemana");

  const ORIGEM = criarDataSP(2026, 10, 27, 17, 0);
  const DESTINO = criarDataSP(2026, 10, 26, 17, 0);
  if (DESTINO.toISOString() !== "2026-10-26T20:00:00.000Z") {
    throw new Error(`DESTINO calculado inesperado: ${DESTINO.toISOString()}`);
  }

  const fmt = (d: Date) => `${formatarDataHoraSP(d)} (${d.toISOString()})`;
  const fimDe = (inicio: Date, duracaoMin: number) => new Date(inicio.getTime() + duracaoMin * 60_000);

  console.log(`=== MODO: ${APLICAR ? "APPLY" : "DRY-RUN (somente leitura)"} ===\n`);

  const clinica = await prisma.clinica.findUnique({ where: { slug: SLUG_CLINICA } });
  if (!clinica) throw new Error(`Clínica ${SLUG_CLINICA} não encontrada`);
  console.log(`Clínica: ${clinica.nome} (${clinica.id}) — googleConectado=${clinica.googleConectado}\n`);

  // Busca accent/case-insensitive em memória (Postgres sem unaccent garantido).
  const todosPacientes = await prisma.paciente.findMany({
    where: { clinicaId: clinica.id },
    select: { id: true, nome: true, statusGeral: true, telefone: true },
  });
  const pacientes = todosPacientes.filter((p) => semAcento(p.nome).includes(TERMO_NOME));
  console.log(`Pacientes cujo nome contém "Helio": ${pacientes.length}`);

  for (const p of pacientes) {
    console.log(`\n── Paciente ${p.nome} | id=${p.id} | statusGeral=${p.statusGeral}`);
    const pacotes = await prisma.pacote.findMany({
      where: { pacienteId: p.id },
      orderBy: { dataInicial: "asc" },
      include: { agendamentos: { orderBy: { inicio: "asc" }, include: { tipoSessao: true } } },
    });
    for (const pc of pacotes) {
      console.log(`   Pacote ${pc.id} | tipo=${pc.tipo} | status=${pc.status} | totalSessoes=${pc.totalSessoes} | dataInicial=${fmt(pc.dataInicial)}`);
      for (const a of pc.agendamentos) {
        console.log(
          `     • ${a.numeroSessao}/${a.totalPacote} | id=${a.id}\n` +
            `       inicio=${fmt(a.inicio)} | fim=${fmt(fimDe(a.inicio, a.duracaoMin))} | duracaoMin=${a.duracaoMin}\n` +
            `       status=${a.status} | confirmada=${a.confirmada} | arquivada=${a.arquivada} | tipo=${a.tipoSessao?.nome ?? "-"}\n` +
            `       googleEventId=${a.googleEventId ?? "-"} | googleCalendarId=${a.googleCalendarId ?? "-"} | googleSyncStatus=${a.googleSyncStatus}\n` +
            `       linkMeet=${a.linkMeet ?? "-"} | lembreteWhatsappEnviadoEm=${a.lembreteWhatsappEnviadoEm ? fmt(a.lembreteWhatsappEnviadoEm) : "-"}`
        );
      }
    }
  }

  // ── Alvo: exatamente 1 sessão 1/4 em 27/10 17:00 local.
  const candidatos = await prisma.agendamento.findMany({
    where: {
      clinicaId: clinica.id,
      pacienteId: { in: pacientes.map((p) => p.id) },
      numeroSessao: NUMERO_SESSAO,
      totalPacote: TOTAL_PACOTE,
      inicio: ORIGEM,
    },
    include: { paciente: true, tipoSessao: true },
  });
  console.log(`\n=== Sessões que batem (Helio, ${NUMERO_SESSAO}/${TOTAL_PACOTE}, ${fmt(ORIGEM)}): ${candidatos.length} ===`);
  if (candidatos.length !== 1) {
    console.error("ABORTANDO: esperado exatamente 1 candidato.");
    for (const c of candidatos) console.error(`  - ${c.id} (${c.paciente?.nome})`);
    process.exitCode = 1;
    return;
  }
  const alvo = candidatos[0];
  const novoFim = fimDe(DESTINO, alvo.duracaoMin);

  // ── Conflitos no destino: qualquer sessão não cancelada da clínica que
  // se sobreponha a [DESTINO, novoFim).
  const doDia = await prisma.agendamento.findMany({
    where: {
      clinicaId: clinica.id,
      id: { not: alvo.id },
      status: { not: "CANCELADA" },
      inicio: { gte: criarDataSP(2026, 10, 26, 0, 0), lt: criarDataSP(2026, 10, 27, 0, 0) },
    },
    include: { paciente: { select: { nome: true } }, aluno: { select: { nomeCompleto: true } } },
    orderBy: { inicio: "asc" },
  });
  const sobrepostas = doDia.filter((a) => a.inicio < novoFim && fimDe(a.inicio, a.duracaoMin) > DESTINO);
  console.log(`\n=== Agenda da clínica em 26/10 (não canceladas): ${doDia.length} sessão(ões) ===`);
  for (const a of doDia) {
    const quem = a.paciente?.nome ?? a.aluno?.nomeCompleto ?? "-";
    const marca = sobrepostas.includes(a) ? "  <<< CONFLITO" : "";
    console.log(`  ${formatarDataHoraSP(a.inicio)}–${componentesSP(fimDe(a.inicio, a.duracaoMin)).hora}:${String(componentesSP(fimDe(a.inicio, a.duracaoMin)).minuto).padStart(2, "0")} | ${quem} | ${a.status}${marca}`);
  }

  // Regra do app (sessoes/[id]): 1 sessão por paciente por semana.
  const outrasDoPaciente = await prisma.agendamento.findMany({
    where: { pacienteId: alvo.pacienteId, id: { not: alvo.id } },
    select: { id: true, inicio: true, status: true },
  });
  const conflitoSemana = existeConflitoDeSemana(DESTINO, outrasDoPaciente);
  console.log(`\nConflito de semana (mesmo paciente) no destino: ${conflitoSemana ? "SIM" : "não"}`);

  if (sobrepostas.length > 0 || conflitoSemana) {
    console.error("ABORTANDO: destino conflita com outra sessão.");
    process.exitCode = 1;
    return;
  }

  // ── WhatsApp: estado (não há registro de lembrete pendente para cancelar).
  const conversas = await prisma.conversaWhatsapp.findMany({
    where: { clinicaId: clinica.id, pacienteId: alvo.pacienteId },
    select: { id: true, telefone: true, estado: true },
  });
  const inicioHoje = criarDataSP(2026, 10, 27, 0, 0);
  const msgsHoje = await prisma.mensagemWhatsapp.findMany({
    where: { conversaId: { in: conversas.map((c) => c.id) }, criadoEm: { gte: inicioHoje } },
    select: { tipo: true, direcao: true, criadoEm: true },
    orderBy: { criadoEm: "asc" },
  });
  console.log(`\n=== WhatsApp ===`);
  console.log(`  lembreteWhatsappEnviadoEm (48h): ${alvo.lembreteWhatsappEnviadoEm ? fmt(alvo.lembreteWhatsappEnviadoEm) : "null (não enviado)"}`);
  console.log(`  conversas do paciente: ${conversas.length} | mensagens hoje: ${msgsHoje.map((m) => `${m.tipo}/${m.direcao}@${formatarDataHoraSP(m.criadoEm)}`).join(", ") || "nenhuma"}`);
  console.log(`  Fila de lembrete: não existe no schema — cron seleciona por janela de inicio futura; em 26/10 a sessão sai das janelas.`);

  // ── Outbox existente para este agendamento.
  const filaExistente = await prisma.sincronizacaoPendente.findMany({
    where: { clinicaId: clinica.id, payload: { path: ["agendamentoId"], equals: alvo.id } },
    orderBy: { createdAt: "asc" },
  });
  console.log(`\n=== Outbox existente p/ ${alvo.id}: ${filaExistente.length} item(ns) ===`);
  for (const f of filaExistente) console.log(`  ${f.tipo} | ${f.status} | tentativas=${f.tentativas} | ${fmt(f.createdAt)}${f.ultimoErro ? ` | erro=${f.ultimoErro}` : ""}`);

  // ── Diff.
  console.log(`\n=== DIFF (agendamento ${alvo.id} — ${alvo.paciente?.nome}) ===`);
  console.log(`  inicio: ${fmt(alvo.inicio)}  →  ${fmt(DESTINO)}`);
  console.log(`  fim:    ${fmt(fimDe(alvo.inicio, alvo.duracaoMin))}  →  ${fmt(novoFim)}   (derivado: duracaoMin=${alvo.duracaoMin}, inalterada)`);
  console.log(`  googleSyncStatus: ${alvo.googleSyncStatus}  →  PENDENTE (até o worker concluir)`);
  console.log(`  status: ${alvo.status} (inalterado) | googleEventId/googleCalendarId/linkMeet: inalterados`);
  console.log(`  Outbox: +1 SincronizacaoPendente { tipo: "CALENDAR_ATUALIZAR", payload: { agendamentoId: "${alvo.id}" } }`);
  console.log(`  LogAuditoria: { acao: "EDITAR_SESSAO", usuarioId: null, detalhe: "...${MOTIVO}" }`);

  if (!APLICAR) {
    console.log("\nDRY-RUN concluído. Nada foi alterado. Rode com --apply para aplicar.");
    return;
  }

  // ════════════════════════════ APPLY ════════════════════════════
  if (!alvo.googleEventId || !alvo.googleCalendarId) {
    throw new Error("Sessão sem googleEventId/googleCalendarId — CALENDAR_ATUALIZAR seria no-op. Abortando.");
  }

  const detalhe =
    `Editou a sessão ${alvo.numeroSessao}/${alvo.totalPacote} de ${alvo.paciente?.nome} de ` +
    `${formatarDataHoraSP(alvo.inicio)} para ${formatarDataHoraSP(DESTINO)}. ${MOTIVO} ` +
    `(script scripts/tmp/mover-sessao-helio.ts)`;

  const itemFila = await prisma.$transaction(async (tx) => {
    // Guarda contra execução dupla: só move se ainda estiver na origem.
    const r = await tx.agendamento.updateMany({
      where: { id: alvo.id, inicio: ORIGEM },
      data: { inicio: DESTINO, googleSyncStatus: "PENDENTE" },
    });
    if (r.count !== 1) throw new Error("Agendamento não está mais em 27/10 17:00 — abortando transação.");
    await tx.logAuditoria.create({
      data: { clinicaId: clinica.id, usuarioId: null, acao: "EDITAR_SESSAO", detalhe },
    });
    return tx.sincronizacaoPendente.create({
      data: { clinicaId: clinica.id, tipo: "CALENDAR_ATUALIZAR", payload: { agendamentoId: alvo.id } },
    });
  });
  console.log(`\nTransação OK. Outbox item ${itemFila.id} criado (PENDENTE).`);

  const { processarPendentes } = await import("@/lib/sincronizacao");
  const resultado = await processarPendentes(25);
  console.log("processarPendentes:", resultado);

  const itemFinal = await prisma.sincronizacaoPendente.findUnique({ where: { id: itemFila.id } });
  const agFinal = await prisma.agendamento.findUnique({ where: { id: alvo.id } });
  console.log(`Outbox item: status=${itemFinal?.status} tentativas=${itemFinal?.tentativas} erro=${itemFinal?.ultimoErro ?? "-"}`);
  console.log(`Agendamento: inicio=${fmt(agFinal!.inicio)} status=${agFinal!.status} googleSyncStatus=${agFinal!.googleSyncStatus} googleEventId=${agFinal!.googleEventId}`);

  // ── Verificação direta na Google Calendar API.
  const { obterCalendarDaClinica } = await import("@/lib/google");
  const clinicaAtual = await prisma.clinica.findUniqueOrThrow({ where: { id: clinica.id } });
  const calendar = await obterCalendarDaClinica(clinicaAtual);
  if (!calendar) throw new Error("Google não conectado — não foi possível verificar o evento.");
  const { data: ev } = await calendar.events.get({
    calendarId: agFinal!.googleCalendarId!,
    eventId: agFinal!.googleEventId!,
  });
  const inicioGoogle = new Date(ev.start?.dateTime ?? "");
  const fimGoogle = new Date(ev.end?.dateTime ?? "");
  const ok = inicioGoogle.getTime() === DESTINO.getTime() && fimGoogle.getTime() === novoFim.getTime() && ev.status !== "cancelled";
  console.log("\n=== Google Calendar (events.get) ===");
  console.log({ status: ev.status, summary: ev.summary, start: ev.start, end: ev.end, updated: ev.updated, hangoutLink: ev.hangoutLink });
  console.log(ok ? "VERIFICADO: evento em 26/10 17:00 com a mesma duração." : "DIVERGENTE: evento não bate com 26/10 17:00!");
  if (!ok) process.exitCode = 1;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    const { prisma } = await import("@/lib/prisma");
    await prisma.$disconnect();
  });
