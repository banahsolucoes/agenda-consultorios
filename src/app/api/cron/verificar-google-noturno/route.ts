import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { obterCalendarDaClinica, marcarFalhaTokenSeRevogado } from "@/lib/google";

const DIA_MS = 24 * 60 * 60 * 1000;
const JANELA_DIAS = 60;

// GET /api/cron/verificar-google-noturno — checagem noturna de sincronização
// com o Google Calendar, protegida por CRON_SECRET (chamada só pelo Vercel
// Cron, nunca por usuário logado). Não corrige nada — só reporta (loga) e
// marca googleSyncStatus: FALHOU quando encontra divergência, pro operador
// (ou um bloco de correção separado, como fizemos com Maura/Fábio) agir
// depois. Dois níveis:
//   1. Agendamento futuro (AGENDADA/REAGENDADA) com googleSyncStatus
//      diferente de SINCRONIZADO — não precisa chamar o Google, já é sinal
//      de problema conhecido pelo próprio banco.
//   2. Para clínicas conectadas, uma chamada events.list por calendário
//      (não por evento) na janela hoje..+60 dias, comparando contra os
//      Agendamento locais por googleEventId — evento ausente ou com
//      horário divergente do banco vira log de drift + FALHOU.
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  }

  const agora = new Date();
  const limite = new Date(agora.getTime() + JANELA_DIAS * DIA_MS);

  const clinicas = await prisma.clinica.findMany();
  const resumo: {
    clinicaId: string;
    nome: string;
    semSyncStatus: number;
    driftsEncontrados: number;
  }[] = [];

  for (const clinica of clinicas) {
    // Nível 1 — sinal já conhecido pelo banco, sem chamar o Google.
    const semSync = await prisma.agendamento.findMany({
      where: {
        paciente: { clinicaId: clinica.id },
        status: { in: ["AGENDADA", "REAGENDADA"] },
        inicio: { gt: agora },
        googleSyncStatus: { not: "SINCRONIZADO" },
      },
      select: { id: true, numeroSessao: true, totalPacote: true, inicio: true, googleSyncStatus: true, pacienteId: true },
      orderBy: { inicio: "asc" },
    });
    console.log(
      `[cron-google] ${clinica.nome} (${clinica.id}): ${semSync.length} agendamento(s) futuro(s) com googleSyncStatus != SINCRONIZADO`
    );
    for (const s of semSync) {
      console.log(
        `[cron-google]   - ${s.id} paciente=${s.pacienteId} sessão ${s.numeroSessao}/${s.totalPacote} início=${s.inicio.toISOString()} status=${s.googleSyncStatus}`
      );
    }

    let driftsEncontrados = 0;

    if (clinica.googleConectado) {
      const calendar = await obterCalendarDaClinica(clinica).catch(() => null);
      if (calendar) {
        const futuros = await prisma.agendamento.findMany({
          where: {
            paciente: { clinicaId: clinica.id },
            status: { in: ["AGENDADA", "REAGENDADA"] },
            // Restrito à mesma janela do events.list abaixo — sem isso, todo
            // agendamento além de +60 dias aparece como "evento ausente"
            // (falso positivo: nunca foi buscado no Google, não é que sumiu).
            inicio: { gt: agora, lte: limite },
            googleEventId: { not: null },
          },
          include: { tipoSessao: true },
          orderBy: { inicio: "asc" },
        });

        // Agrupa por calendário — uma chamada events.list por calendário
        // distinto, nunca uma por evento.
        const porCalendario = new Map<string, typeof futuros>();
        for (const a of futuros) {
          const calendarId =
            a.googleCalendarId ?? a.tipoSessao?.googleCalendarId ?? clinica.googleCalendarId ?? "primary";
          if (!porCalendario.has(calendarId)) porCalendario.set(calendarId, []);
          porCalendario.get(calendarId)!.push(a);
        }

        for (const [calendarId, agendamentosDoCalendario] of porCalendario) {
          let eventos: { id?: string | null; start?: { dateTime?: string | null } | null }[] = [];
          try {
            const { data } = await calendar.events.list({
              calendarId,
              timeMin: agora.toISOString(),
              timeMax: limite.toISOString(),
              singleEvents: true,
            });
            eventos = data.items ?? [];
          } catch (err) {
            console.error(
              `[cron-google] Falha ao listar eventos do calendário ${calendarId} (clínica ${clinica.id}):`,
              err
            );
            await marcarFalhaTokenSeRevogado(clinica.id, err);
            continue;
          }

          const eventoPorId = new Map(eventos.filter((e) => e.id).map((e) => [e.id as string, e]));

          for (const a of agendamentosDoCalendario) {
            const evento = eventoPorId.get(a.googleEventId!);
            if (!evento) {
              console.log(
                `[cron-google] DRIFT (evento ausente): agendamento ${a.id} (evento ${a.googleEventId}) não encontrado no calendário ${calendarId}`
              );
              await prisma.agendamento.update({ where: { id: a.id }, data: { googleSyncStatus: "FALHOU" } });
              driftsEncontrados++;
              continue;
            }
            const dataGoogle = evento.start?.dateTime ? new Date(evento.start.dateTime).getTime() : null;
            if (dataGoogle !== a.inicio.getTime()) {
              console.log(
                `[cron-google] DRIFT (horário divergente): agendamento ${a.id} banco=${a.inicio.toISOString()} google=${evento.start?.dateTime}`
              );
              await prisma.agendamento.update({ where: { id: a.id }, data: { googleSyncStatus: "FALHOU" } });
              driftsEncontrados++;
            }
          }
        }
      }
    }

    resumo.push({ clinicaId: clinica.id, nome: clinica.nome, semSyncStatus: semSync.length, driftsEncontrados });
  }

  return NextResponse.json({ ok: true, resumo });
}
