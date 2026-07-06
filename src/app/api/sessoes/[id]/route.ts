import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { verificarFinalizacao } from "@/lib/finalizacao";
import { obterCalendarDaClinica, criarEventoGoogleMeet } from "@/lib/google";
import { primeiroUltimoNome } from "@/lib/nomes";
import { componentesSP, criarDataSP, formatarDataHoraSP, TIMEZONE } from "@/lib/timezone";
import { existeConflitoDeSemana } from "@/lib/conflitoSemana";
import { registrarLog } from "@/lib/auditoria";
import { statusLabel } from "@/lib/labels";

// Sessões nesses status são somente-leitura — nem data/horário nem tipo de
// atendimento podem mudar.
const STATUS_CONSUMIDOS = ["REALIZADA", "NAO_REALIZADA", "CANCELADA"];
const DIA_NOME_POR_NUM: Record<number, string> = {
  0: "DOMINGO", 1: "SEGUNDA", 2: "TERCA", 3: "QUARTA", 4: "QUINTA", 5: "SEXTA", 6: "SABADO",
};

export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });

  const { id } = await ctx.params;
  const sessao = await prisma.agendamento.findUnique({
    where: { id },
    include: { paciente: true, tipoSessao: true },
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
      await registrarLog(
        usuario.clinicaId,
        usuario.id,
        "CANCELAR_SESSAO",
        `Cancelou a sessão ${sessao.numeroSessao} de ${sessao.paciente.nome} — motivo: ${motivo}`
      );
      const finalizou = await verificarFinalizacao(sessao.pacoteId, usuario.id);
      return NextResponse.json({ ...atualizada, pacoteFinalizado: finalizou });
    }

    const atualizada = await prisma.agendamento.update({
      where: { id }, data: { status: body.status },
    });
    await registrarLog(
      usuario.clinicaId,
      usuario.id,
      "STATUS_SESSAO",
      `Marcou a sessão ${sessao.numeroSessao} de ${sessao.paciente.nome} como ${statusLabel(body.status)}`
    );
    const finalizou = await verificarFinalizacao(sessao.pacoteId, usuario.id);
    return NextResponse.json({ ...atualizada, pacoteFinalizado: finalizou });
  }

  if (body.novaData && body.novoHorario) {
    if (STATUS_CONSUMIDOS.includes(sessao.status)) {
      return NextResponse.json({ erro: "sessão consumida não pode ser editada" }, { status: 400 });
    }

    const dataMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(body.novaData);
    if (!dataMatch) return NextResponse.json({ erro: "data inválida" }, { status: 400 });
    const [, anoStr, mesStr, diaStr] = dataMatch;
    const ano = Number(anoStr);
    const mes = Number(mesStr);
    const dia = Number(diaStr);

    const horaMatch = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(body.novoHorario);
    if (!horaMatch) return NextResponse.json({ erro: "horário inválido" }, { status: 400 });
    const h = Number(horaMatch[1]);
    const m = Number(horaMatch[2]);

    // Constrói o instante (UTC) a partir do horário de parede em São Paulo, e
    // confere se os componentes voltam batendo — protege contra datas
    // inexistentes no calendário (ex.: 31/02).
    const novaData = criarDataSP(ano, mes, dia, h, m);
    const confirmacao = componentesSP(novaData);
    if (confirmacao.ano !== ano || confirmacao.mes !== mes || confirmacao.dia !== dia) {
      return NextResponse.json({ erro: "data inválida" }, { status: 400 });
    }

    // Valida contra o horário de trabalho configurado da clínica. Se a
    // clínica já configurou horários, um dia sem faixa cadastrada está
    // fechado (ex.: fim de semana); só cai na grade padrão 08:00–19:30
    // quando a clínica ainda não configurou horário nenhum.
    const diaSemanaNome = DIA_NOME_POR_NUM[confirmacao.diaSemana];
    const inicioMin = h * 60 + m;
    const fimMin = inicioMin + sessao.duracaoMin;
    const todosHorarios = await prisma.horarioTrabalho.findMany({
      where: { clinicaId: sessao.paciente.clinicaId },
    });
    const horariosDia = todosHorarios.filter((hr) => hr.diaSemana === diaSemanaNome);
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

    if (novaData.getTime() < Date.now()) {
      return NextResponse.json({ erro: "não é possível mover a sessão para o passado" }, { status: 400 });
    }

    // Conflito de semana: nenhuma outra sessão (não cancelada) deste mesmo
    // paciente pode cair na mesma semana (segunda a domingo, calendário de
    // São Paulo) da nova data. Validado aqui no backend — não confiamos
    // apenas na checagem já feita no front.
    const outrasSessoesPaciente = await prisma.agendamento.findMany({
      where: { pacienteId: sessao.pacienteId, id: { not: sessao.id } },
      select: { id: true, inicio: true, status: true },
    });
    if (existeConflitoDeSemana(novaData, outrasSessoesPaciente)) {
      return NextResponse.json(
        { erro: "Não é possível: já existe uma sessão deste paciente nesta semana." },
        { status: 409 }
      );
    }

    const atualizada = await prisma.agendamento.update({
      where: { id }, data: { inicio: novaData, status: "AGENDADA" },
    });

    await registrarLog(
      usuario.clinicaId,
      usuario.id,
      "EDITAR_SESSAO",
      `Editou a sessão ${sessao.numeroSessao} de ${sessao.paciente.nome} para ${formatarDataHoraSP(novaData)}`
    );

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
              start: { dateTime: novaData.toISOString(), timeZone: TIMEZONE },
              end: { dateTime: fimEvento.toISOString(), timeZone: TIMEZONE },
            },
          })
          .catch((err) => console.error("Falha ao atualizar evento no Google Calendar:", err));
      }
    }

    return NextResponse.json(atualizada);
  }

  if (body.tipoSessaoId) {
    if (STATUS_CONSUMIDOS.includes(sessao.status)) {
      return NextResponse.json({ erro: "sessão consumida não pode ser editada" }, { status: 400 });
    }

    const novoTipo = await prisma.tipoSessao.findUnique({ where: { id: body.tipoSessaoId } });
    if (!novoTipo || novoTipo.clinicaId !== sessao.paciente.clinicaId) {
      return NextResponse.json({ erro: "tipo de atendimento inválido" }, { status: 400 });
    }

    // Regra de Meet ao trocar tipo, baseada no caráter (ehOnline) de cada
    // lado: presencial -> online gera o Meet (reaproveitando um link já
    // existente, se houver); online -> presencial mantém o que já estiver
    // gravado; entre dois tipos de mesmo caráter não mexe em nada disso.
    const eraOnline = sessao.tipoSessao?.ehOnline ?? false;
    const ficaOnline = novoTipo.ehOnline;

    let dadosGoogle: { googleEventId?: string | null; googleCalendarId?: string | null; linkMeet?: string | null } = {};
    let avisoMeet: string | null = null;

    if (!eraOnline && ficaOnline && !sessao.linkMeet) {
      const clinica = await prisma.clinica.findUnique({ where: { id: sessao.paciente.clinicaId } });
      const calendar = clinica ? await obterCalendarDaClinica(clinica).catch(() => null) : null;
      if (calendar && clinica) {
        const resultado = await criarEventoGoogleMeet(calendar, clinica.googleCalendarId ?? "primary", {
          titulo: `${primeiroUltimoNome(sessao.paciente.nome)} (${sessao.numeroSessao}/${sessao.totalPacote})`,
          inicio: sessao.inicio,
          duracaoMin: sessao.duracaoMin,
        });
        if (resultado.linkMeet) {
          dadosGoogle = resultado;
        } else {
          avisoMeet = "não foi possível gerar o link do Meet";
        }
      } else {
        avisoMeet = "Google não conectado — não foi possível gerar o Meet";
      }
    }

    const atualizada = await prisma.agendamento.update({
      where: { id },
      data: { tipoSessaoId: novoTipo.id, ...dadosGoogle },
      include: { tipoSessao: true },
    });

    return NextResponse.json({ ...atualizada, avisoMeet });
  }

  return NextResponse.json({ erro: "nada para atualizar" }, { status: 400 });
}
