// AUDITORIA READ-ONLY (2026-09-02) — diagnóstico de divergência Agenda ↔ Google
// Calendar para a clínica Fono Pâmela Rachid. NENHUM write no banco, NENHUMA
// criação/edição/exclusão de evento no Google, NENHUM enfileiramento em
// SincronizacaoPendente. Script temporário, não commitável.
//
// Reutiliza obterCalendarDaClinica (src/lib/google.ts) para autenticação —
// não reimplementa OAuth. A resolução de "calendário esperado" segue o mesmo
// padrão usado em src/app/api/cron/verificar-google-noturno/route.ts:
// tipoSessao?.googleCalendarId ?? clinica.googleCalendarId ?? "primary".
//
// Uso: npx tsx scripts/tmp/auditoria-sync.ts
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { obterCalendarDaClinica } from "@/lib/google";
import { componentesSP, criarDataSP, formatarDataHoraSP } from "@/lib/timezone";
import type { calendar_v3 } from "googleapis";

const DELAY_MS = 150;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Classificacao =
  | "SEM_EVENT_ID"
  | "AUSENTE_NO_GOOGLE"
  | "CALENDARIO_INCORRETO"
  | "CANCELADO_NO_GOOGLE"
  | "HORARIO_DIVERGENTE"
  | "OK";

interface LinhaRelatorio {
  inicioBanco: Date;
  paciente: string;
  tipo: string;
  modalidade: string;
  classificacao: Classificacao;
  googleSyncStatus: string;
  detalhe: string;
}

async function buscarEvento(
  calendar: calendar_v3.Calendar,
  calendarId: string,
  eventId: string
): Promise<calendar_v3.Schema$Event | null> {
  try {
    const { data } = await calendar.events.get({ calendarId, eventId });
    return data;
  } catch (err) {
    const status = (err as { code?: number; response?: { status?: number } })?.code ??
      (err as { response?: { status?: number } })?.response?.status;
    if (status === 404 || status === 410) return null;
    console.error(`  [erro inesperado] calendar=${calendarId} eventId=${eventId}:`, (err as Error)?.message ?? err);
    return null;
  }
}

async function main() {
  const clinica = await prisma.clinica.findFirst({
    where: { nome: { contains: "Pâmela", mode: "insensitive" } },
  });
  if (!clinica) {
    console.error("Clínica Fono Pâmela Rachid não encontrada.");
    process.exit(1);
  }

  const calendar = await obterCalendarDaClinica(clinica);
  if (!calendar) {
    console.error("Clínica sem integração Google conectada — abortando auditoria.");
    process.exit(1);
  }

  const c = componentesSP(new Date());
  const hoje00 = criarDataSP(c.ano, c.mes, c.dia, 0, 0, 0);

  const agendamentos = await prisma.agendamento.findMany({
    where: {
      clinicaId: clinica.id,
      inicio: { gte: hoje00 },
      status: { not: "CANCELADA" },
    },
    include: { paciente: true, tipoSessao: true },
    orderBy: { inicio: "asc" },
  });

  console.log(`Auditando ${agendamentos.length} agendamento(s) da clínica ${clinica.nome} (${clinica.id}) a partir de ${formatarDataHoraSP(hoje00)}.\n`);

  // Os 4 calendários conhecidos da clínica (um por combinação modalidade x tipo),
  // derivados do próprio cadastro de TipoSessao — nunca hardcoded.
  const tiposDaClinica = await prisma.tipoSessao.findMany({ where: { clinicaId: clinica.id } });
  const calendariosClinica = [
    ...new Set(tiposDaClinica.map((t) => t.googleCalendarId).filter((x): x is string => !!x)),
  ];

  const linhas: LinhaRelatorio[] = [];

  for (const a of agendamentos) {
    const paciente = a.paciente?.nome ?? (a.alunoId ? "(mentorado)" : "(sem paciente)");
    const modalidade = a.tipoSessao?.ehOnline ? "online" : "presencial";
    const tipo = a.tipoSessao?.ehAtendimentoUnico ? "avaliação" : "sessão";
    const calendarEsperado = a.tipoSessao?.googleCalendarId ?? clinica.googleCalendarId ?? "primary";
    const fimBanco = new Date(a.inicio.getTime() + a.duracaoMin * 60_000);

    if (!a.googleEventId) {
      linhas.push({
        inicioBanco: a.inicio,
        paciente,
        tipo,
        modalidade,
        classificacao: "SEM_EVENT_ID",
        googleSyncStatus: a.googleSyncStatus,
        detalhe: "googleEventId vazio/nulo",
      });
      continue;
    }

    await sleep(DELAY_MS);
    let evento = await buscarEvento(calendar, calendarEsperado, a.googleEventId);

    if (!evento) {
      // Não encontrado no calendário esperado — tenta os demais calendários da clínica.
      let encontradoEm: string | null = null;
      let eventoEncontrado: calendar_v3.Schema$Event | null = null;
      for (const cal of calendariosClinica) {
        if (cal === calendarEsperado) continue;
        await sleep(DELAY_MS);
        const ev = await buscarEvento(calendar, cal, a.googleEventId);
        if (ev) {
          encontradoEm = cal;
          eventoEncontrado = ev;
          break;
        }
      }

      if (encontradoEm) {
        linhas.push({
          inicioBanco: a.inicio,
          paciente,
          tipo,
          modalidade,
          classificacao: "CALENDARIO_INCORRETO",
          googleSyncStatus: a.googleSyncStatus,
          detalhe: `esperado=${calendarEsperado} | encontrado em=${encontradoEm} | evento.status=${eventoEncontrado?.status}`,
        });
      } else {
        linhas.push({
          inicioBanco: a.inicio,
          paciente,
          tipo,
          modalidade,
          classificacao: "AUSENTE_NO_GOOGLE",
          googleSyncStatus: a.googleSyncStatus,
          detalhe: `eventId=${a.googleEventId} não encontrado em nenhum dos ${calendariosClinica.length} calendários (esperado=${calendarEsperado})`,
        });
      }
      continue;
    }

    if (evento.status === "cancelled") {
      linhas.push({
        inicioBanco: a.inicio,
        paciente,
        tipo,
        modalidade,
        classificacao: "CANCELADO_NO_GOOGLE",
        googleSyncStatus: a.googleSyncStatus,
        detalhe: `calendario=${calendarEsperado}`,
      });
      continue;
    }

    const inicioGoogle = evento.start?.dateTime ? new Date(evento.start.dateTime) : null;
    const fimGoogle = evento.end?.dateTime ? new Date(evento.end.dateTime) : null;
    const inicioDivergente = !inicioGoogle || inicioGoogle.getTime() !== a.inicio.getTime();
    const fimDivergente = !fimGoogle || fimGoogle.getTime() !== fimBanco.getTime();

    if (inicioDivergente || fimDivergente) {
      linhas.push({
        inicioBanco: a.inicio,
        paciente,
        tipo,
        modalidade,
        classificacao: "HORARIO_DIVERGENTE",
        googleSyncStatus: a.googleSyncStatus,
        detalhe:
          `banco: ${formatarDataHoraSP(a.inicio)}–${formatarDataHoraSP(fimBanco)} | ` +
          `google: ${inicioGoogle ? formatarDataHoraSP(inicioGoogle) : "?"}–${fimGoogle ? formatarDataHoraSP(fimGoogle) : "?"}`,
      });
      continue;
    }

    linhas.push({
      inicioBanco: a.inicio,
      paciente,
      tipo,
      modalidade,
      classificacao: "OK",
      googleSyncStatus: a.googleSyncStatus,
      detalhe: "",
    });
  }

  // ── Relatório ────────────────────────────────────────────────
  const ordem: Classificacao[] = [
    "SEM_EVENT_ID",
    "AUSENTE_NO_GOOGLE",
    "CALENDARIO_INCORRETO",
    "CANCELADO_NO_GOOGLE",
    "HORARIO_DIVERGENTE",
    "OK",
  ];

  for (const classe of ordem) {
    const doGrupo = linhas.filter((l) => l.classificacao === classe).sort((a, b) => a.inicioBanco.getTime() - b.inicioBanco.getTime());
    if (doGrupo.length === 0) continue;
    console.log(`\n=== ${classe} (${doGrupo.length}) ===`);
    console.log("data/hora (banco)       | paciente                     | tipo      | modalidade  | googleSyncStatus | detalhe");
    for (const l of doGrupo) {
      const destaque = l.paciente.toLowerCase().includes("maura") ? " <<< MAURA DIANA" : "";
      console.log(
        `${formatarDataHoraSP(l.inicioBanco).padEnd(24)} | ${l.paciente.padEnd(28)} | ${l.tipo.padEnd(9)} | ${l.modalidade.padEnd(11)} | ${l.googleSyncStatus.padEnd(17)} | ${l.detalhe}${destaque}`
      );
    }
  }

  console.log("\n=== RESUMO ===");
  for (const classe of ordem) {
    console.log(`${classe}: ${linhas.filter((l) => l.classificacao === classe).length}`);
  }
  console.log(`TOTAL AUDITADO: ${linhas.length}`);

  const maura = linhas.filter((l) => l.paciente.toLowerCase().includes("maura"));
  if (maura.length > 0) {
    console.log("\n=== LINHA(S) DA PACIENTE MAURA DIANA ===");
    for (const l of maura) {
      console.log(
        `${formatarDataHoraSP(l.inicioBanco)} | ${l.tipo} | ${l.modalidade} | classificação=${l.classificacao} | googleSyncStatus=${l.googleSyncStatus} | ${l.detalhe}`
      );
    }
  } else {
    console.log("\nNenhum agendamento futuro/não-cancelado encontrado para Maura Diana no período auditado.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
