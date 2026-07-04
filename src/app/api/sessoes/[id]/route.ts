import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { verificarFinalizacao } from "@/lib/finalizacao";
import { obterCalendarDaClinica } from "@/lib/google";

const STATUS_CONSUMIDOS = ["REALIZADA", "NAO_REALIZADA"];
const DIA_NUM: Record<string, number> = {
  DOMINGO: 0, SEGUNDA: 1, TERCA: 2, QUARTA: 3, QUINTA: 4, SEXTA: 5, SABADO: 6,
};

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });

  const { id } = await ctx.params;
  const sessao = await prisma.agendamento.findUnique({
    where: { id },
    include: { paciente: true },
  });
  if (!sessao || sessao.paciente.clinicaId !== usuario.clinicaId) {
    return NextResponse.json({ erro: "sessão não encontrada" }, { status: 404 });
  }

  const body = await req.json();

  if (body.status) {
    const validos = ["AGENDADA", "REAGENDADA", "REALIZADA", "NAO_REALIZADA", "CANCELADA"];
    if (!validos.includes(body.status)) {
      return NextResponse.json({ erro: "status inválido" }, { status: 400 });
    }

    if (body.status === "CANCELADA") {
      const motivo = typeof body.motivoCancelamento === "string" ? body.motivoCancelamento.trim() : "";
      if (!motivo) {
        return NextResponse.json({ erro: "motivo do cancelamento é obrigatório" }, { status: 400 });
      }

      // Remove o evento do Google Calendar da clínica, se houver um vinculado
      // a esta sessão. Falha na integração nunca deve impedir o cancelamento
      // local — o Google fica "melhor esforço".
      if (sessao.googleEventId) {
        const clinica = await prisma.clinica.findUnique({ where: { id: usuario.clinicaId } });
        const calendar = clinica ? await obterCalendarDaClinica(clinica).catch(() => null) : null;
        if (calendar) {
          await calendar.events
            .delete({
              calendarId: sessao.googleCalendarId ?? clinica?.googleCalendarId ?? "primary",
              eventId: sessao.googleEventId,
            })
            .catch((err) => console.error("Falha ao remover evento do Google Calendar:", err));
        }
      }

      const atualizada = await prisma.agendamento.update({
        where: { id }, data: { status: "CANCELADA", motivoCancelamento: motivo },
      });
      const finalizou = await verificarFinalizacao(sessao.pacoteId);
      return NextResponse.json({ ...atualizada, pacoteFinalizado: finalizou });
    }

    const atualizada = await prisma.agendamento.update({
      where: { id }, data: { status: body.status },
    });
    const finalizou = await verificarFinalizacao(sessao.pacoteId);
    return NextResponse.json({ ...atualizada, pacoteFinalizado: finalizou });
  }

  if (body.novoDia && body.novoHorario) {
    if (STATUS_CONSUMIDOS.includes(sessao.status)) {
      return NextResponse.json({ erro: "sessão consumida não pode ser editada" }, { status: 400 });
    }
    const diaAlvo = DIA_NUM[body.novoDia];
    if (diaAlvo === undefined) return NextResponse.json({ erro: "dia inválido" }, { status: 400 });

    const [h, m] = body.novoHorario.split(":").map(Number);
    if (isNaN(h) || isNaN(m)) {
      return NextResponse.json({ erro: "horário inválido" }, { status: 400 });
    }

    // Valida contra o horário de trabalho configurado da clínica. Se a
    // clínica já configurou horários, um dia sem faixa cadastrada está
    // fechado (ex.: fim de semana); só cai na grade padrão 08:00–19:30
    // quando a clínica ainda não configurou horário nenhum.
    const inicioMin = h * 60 + m;
    const fimMin = inicioMin + sessao.duracaoMin;
    const todosHorarios = await prisma.horarioTrabalho.findMany({
      where: { clinicaId: sessao.paciente.clinicaId },
    });
    const horariosDia = todosHorarios.filter((hr) => hr.diaSemana === body.novoDia);
    const dentroExpediente =
      todosHorarios.length > 0
        ? horariosDia.some((hr) => {
            const [hi, mi] = hr.horaInicio.split(":").map(Number);
            const [hf, mf] = hr.horaFim.split(":").map(Number);
            return inicioMin >= hi * 60 + mi && fimMin <= hf * 60 + mf;
          })
        : inicioMin >= 8 * 60 && fimMin <= 19 * 60 + 30;
    if (!dentroExpediente) {
      return NextResponse.json({ erro: "horário fora do expediente da clínica" }, { status: 400 });
    }

    const d = new Date(sessao.inicio);
    const diaSem = d.getDay();
    const distSeg = diaSem === 0 ? 6 : diaSem - 1;
    const segunda = new Date(d);
    segunda.setDate(d.getDate() - distSeg);

    // Deslocamento em relação à segunda-feira: DOMINGO (diaAlvo 0) fica no
    // fim da semana (segunda + 6), os demais dias seguem diaAlvo - 1.
    const offsetSegunda = diaAlvo === 0 ? 6 : diaAlvo - 1;
    const novaData = new Date(segunda);
    novaData.setDate(segunda.getDate() + offsetSegunda);
    novaData.setHours(h, m, 0, 0);

    if (novaData.getTime() < Date.now()) {
      return NextResponse.json({ erro: "não é possível mover a sessão para o passado" }, { status: 400 });
    }

    const atualizada = await prisma.agendamento.update({
      where: { id }, data: { inicio: novaData, status: "AGENDADA" },
    });

    // Reflete o novo horário no Google Calendar, se a sessão tiver evento
    // vinculado. Melhor esforço — falha aqui nunca desfaz a mudança local.
    if (sessao.googleEventId) {
      const clinica = await prisma.clinica.findUnique({ where: { id: sessao.paciente.clinicaId } });
      const calendar = clinica ? await obterCalendarDaClinica(clinica).catch(() => null) : null;
      if (calendar) {
        const fimEvento = new Date(novaData.getTime() + sessao.duracaoMin * 60_000);
        await calendar.events
          .patch({
            calendarId: sessao.googleCalendarId ?? clinica?.googleCalendarId ?? "primary",
            eventId: sessao.googleEventId,
            requestBody: {
              start: { dateTime: novaData.toISOString() },
              end: { dateTime: fimEvento.toISOString() },
            },
          })
          .catch((err) => console.error("Falha ao atualizar evento no Google Calendar:", err));
      }
    }

    return NextResponse.json(atualizada);
  }

  return NextResponse.json({ erro: "nada para atualizar" }, { status: 400 });
}
