import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { verificarFinalizacao } from "@/lib/finalizacao";
import { obterClinicaECalendar, criarEventoGoogleMeet, sincronizarEventoGoogle } from "@/lib/google";
import { primeiroUltimoNome } from "@/lib/nomes";
import { componentesSP, criarDataSP, formatarDataHoraSP } from "@/lib/timezone";
import { existeConflitoDeSemana } from "@/lib/conflitoSemana";
import { registrarLog } from "@/lib/auditoria";
import { statusLabel } from "@/lib/labels";
import { pode } from "@/lib/permissoes";
import { validarStatusSessao } from "@/lib/validacaoSessao";

// Sessões nesses status são somente-leitura — nem data/horário nem tipo de
// atendimento podem mudar.
const STATUS_CONSUMIDOS = ["REALIZADA", "NAO_REALIZADA", "CANCELADA"];
const DIA_NOME_POR_NUM: Record<number, string> = {
  0: "DOMINGO", 1: "SEGUNDA", 2: "TERCA", 3: "QUARTA", 4: "QUINTA", 5: "SEXTA", 6: "SABADO",
};
const DIA_MS = 24 * 60 * 60 * 1000;

// Mesma regra usada tanto ao mover quanto ao redimensionar uma sessão: um dia
// sem faixa cadastrada está fechado quando a clínica já configurou algum
// horário; só cai na grade padrão 08:00–19:30 quando a clínica ainda não
// configurou horário nenhum.
function dentroDoExpediente(
  todosHorarios: { diaSemana: string; horaInicio: string; horaFim: string }[],
  diaSemanaNome: string,
  inicioMin: number,
  fimMin: number
): boolean {
  const horariosDia = todosHorarios.filter((hr) => hr.diaSemana === diaSemanaNome);
  return todosHorarios.length > 0
    ? horariosDia.some((hr) => {
        const [hi, mi] = hr.horaInicio.split(":").map(Number);
        const [hf, mf] = hr.horaFim.split(":").map(Number);
        return inicioMin >= hi * 60 + mi && fimMin <= hf * 60 + mf;
      })
    : inicioMin >= 8 * 60 && fimMin <= 19 * 60 + 30;
}

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
      const arquivar = body.arquivar === true;

      // Remove o evento do Google Calendar da clínica, se houver um vinculado
      // a esta sessão. Falha na integração nunca deve impedir o cancelamento
      // local — o Google fica "melhor esforço".
      if (sessao.googleEventId) {
        const google = await obterClinicaECalendar(usuario.clinicaId);
        if (google) {
          await google.calendar.events
            .delete({
              calendarId: sessao.googleCalendarId ?? sessao.tipoSessao?.googleCalendarId ?? google.clinica.googleCalendarId ?? "primary",
              eventId: sessao.googleEventId,
            })
            .catch((err) => console.error("Falha ao remover evento do Google Calendar:", err));
        }
      }

      const atualizada = await prisma.agendamento.update({
        where: { id },
        data: { status: "CANCELADA", motivoCancelamento: motivo, ...(arquivar ? { arquivada: true } : {}) },
      });
      await registrarLog(
        usuario.clinicaId,
        usuario.id,
        "CANCELAR_SESSAO",
        `Cancelou${arquivar ? " e arquivou" : ""} a sessão ${sessao.numeroSessao} de ${sessao.paciente.nome} — motivo: ${motivo}`
      );
      const finalizou = await verificarFinalizacao(sessao.pacoteId, usuario.id);
      return NextResponse.json({ ...atualizada, pacoteFinalizado: finalizou });
    }

    const validacaoStatus = validarStatusSessao(body.status, sessao.inicio);
    if (!validacaoStatus.valido) {
      return NextResponse.json({ erro: validacaoStatus.erro }, { status: 400 });
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
    // Nenhuma rota de move fazia esse gate até agora; passa a ser exigido
    // aqui porque o escopo ESTA_E_FUTURAS expande a ação para lote.
    if (!pode(usuario.papel, "operarAgenda")) {
      return NextResponse.json({ erro: "sem permissão para esta ação" }, { status: 403 });
    }

    if (STATUS_CONSUMIDOS.includes(sessao.status)) {
      return NextResponse.json({ erro: "sessão consumida não pode ser editada" }, { status: 400 });
    }

    const escopo = body.escopo === "ESTA_E_FUTURAS" ? "ESTA_E_FUTURAS" : "ESTA";

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
    if (!dentroDoExpediente(todosHorarios, diaSemanaNome, inicioMin, fimMin)) {
      return NextResponse.json({ erro: "horário fora do expediente da clínica" }, { status: 400 });
    }

    if (novaData.getTime() < Date.now()) {
      return NextResponse.json({ erro: "não é possível mover a sessão para o passado" }, { status: 400 });
    }

    if (escopo === "ESTA_E_FUTURAS") {
      // Sessões seguintes do mesmo pacote, ainda não consumidas nem
      // canceladas — REALIZADA/NAO_REALIZADA/CANCELADA/REAGENDADA ficam de
      // fora por não estarem em status "AGENDADA".
      const irmas = await prisma.agendamento.findMany({
        where: {
          pacoteId: sessao.pacoteId,
          numeroSessao: { gt: sessao.numeroSessao },
          status: "AGENDADA",
          arquivada: false,
        },
        include: { paciente: true, tipoSessao: true },
        orderBy: { numeroSessao: "asc" },
      });

      // Isolamento de tenant: toda irmã precisa pertencer à mesma clínica do
      // usuário logado (garantido estruturalmente por pacoteId->paciente,
      // mas confirmado aqui de forma explícita).
      if (irmas.some((irma) => irma.paciente.clinicaId !== usuario.clinicaId)) {
        return NextResponse.json({ erro: "sessão não encontrada" }, { status: 404 });
      }

      // TODO: cadência semanal fixa; parametrizar quando pacote suportar quinzenal/múltiplas por semana.
      const movimentos = [
        {
          id: sessao.id,
          numeroSessao: sessao.numeroSessao,
          novoInicio: novaData,
          duracaoMin: sessao.duracaoMin,
          googleEventId: sessao.googleEventId,
          googleCalendarId: sessao.googleCalendarId ?? sessao.tipoSessao?.googleCalendarId ?? null,
        },
        ...irmas.map((irma) => ({
          id: irma.id,
          numeroSessao: irma.numeroSessao,
          novoInicio: new Date(novaData.getTime() + (irma.numeroSessao - sessao.numeroSessao) * 7 * DIA_MS),
          duracaoMin: irma.duracaoMin,
          googleEventId: irma.googleEventId,
          googleCalendarId: irma.googleCalendarId ?? irma.tipoSessao?.googleCalendarId ?? null,
        })),
      ];

      const idsConjunto = movimentos.map((mov) => mov.id);

      // Conflito de semana contra sessões do paciente que NÃO fazem parte do
      // conjunto em movimento — mesmo padrão de "colisão contra as não
      // movidas" usado em pacientes/[id]/empurrar/route.ts.
      const outrasSessoesForaDoConjunto = await prisma.agendamento.findMany({
        where: { pacienteId: sessao.pacienteId, id: { notIn: idsConjunto } },
        select: { id: true, inicio: true, status: true },
      });

      for (const mov of movimentos) {
        if (mov.novoInicio.getTime() < Date.now()) {
          return NextResponse.json(
            { erro: `Não é possível: a sessão ${mov.numeroSessao} (${formatarDataHoraSP(mov.novoInicio)}) cairia no passado.` },
            { status: 400 }
          );
        }

        const componentesMov = componentesSP(mov.novoInicio);
        const diaSemanaNomeMov = DIA_NOME_POR_NUM[componentesMov.diaSemana];
        const inicioMinMov = componentesMov.hora * 60 + componentesMov.minuto;
        const fimMinMov = inicioMinMov + mov.duracaoMin;
        if (!dentroDoExpediente(todosHorarios, diaSemanaNomeMov, inicioMinMov, fimMinMov)) {
          return NextResponse.json(
            { erro: `Não é possível: o horário da sessão ${mov.numeroSessao} (${formatarDataHoraSP(mov.novoInicio)}) fica fora do expediente da clínica.` },
            { status: 400 }
          );
        }

        if (existeConflitoDeSemana(mov.novoInicio, outrasSessoesForaDoConjunto)) {
          return NextResponse.json(
            { erro: `Não é possível: já existe uma sessão deste paciente na semana da sessão ${mov.numeroSessao} (${formatarDataHoraSP(mov.novoInicio)}).` },
            { status: 409 }
          );
        }
      }

      await prisma.$transaction(
        movimentos.map((mov) =>
          prisma.agendamento.update({
            where: { id: mov.id },
            data:
              mov.id === sessao.id
                ? { inicio: mov.novoInicio, status: "AGENDADA" }
                : { inicio: mov.novoInicio },
          })
        )
      );

      await registrarLog(
        usuario.clinicaId,
        usuario.id,
        "EDITAR_SESSAO",
        `Editou a sessão ${sessao.numeroSessao} de ${sessao.paciente.nome} e realinhou ${irmas.length} sessão(ões) seguinte(s) a partir de ${formatarDataHoraSP(novaData)}`
      );

      // Reflete o novo horário de cada sessão movida com evento vinculado no
      // Google Calendar. Melhor esforço — busca o client uma única vez para o
      // lote todo, e falha na integração nunca desfaz o que já foi movido.
      const movimentosComEvento = movimentos.filter((mov) => mov.googleEventId);
      if (movimentosComEvento.length > 0) {
        const google = await obterClinicaECalendar(sessao.paciente.clinicaId);
        if (google) {
          for (const mov of movimentosComEvento) {
            await sincronizarEventoGoogle(
              google.calendar,
              mov.googleCalendarId ?? google.clinica.googleCalendarId ?? "primary",
              mov.googleEventId!,
              { inicio: mov.novoInicio, duracaoMin: mov.duracaoMin },
              google.clinica.id
            );
          }
        }
      }

      return NextResponse.json({
        movidas: movimentos.length,
        ids: movimentos.map((mov) => mov.id),
        sessoes: movimentos.map((mov) => ({
          id: mov.id,
          numeroSessao: mov.numeroSessao,
          inicio: mov.novoInicio,
        })),
      });
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
      const google = await obterClinicaECalendar(sessao.paciente.clinicaId);
      if (google) {
        await sincronizarEventoGoogle(
          google.calendar,
          sessao.googleCalendarId ?? sessao.tipoSessao?.googleCalendarId ?? google.clinica.googleCalendarId ?? "primary",
          sessao.googleEventId,
          { inicio: novaData, duracaoMin: sessao.duracaoMin },
          google.clinica.id
        );
      }
    }

    return NextResponse.json(atualizada);
  }

  if (typeof body.duracaoMin === "number") {
    if (STATUS_CONSUMIDOS.includes(sessao.status)) {
      return NextResponse.json({ erro: "sessão consumida não pode ser editada" }, { status: 400 });
    }

    const novaDuracaoMin = body.duracaoMin;
    if (!Number.isInteger(novaDuracaoMin) || novaDuracaoMin < 15 || novaDuracaoMin % 15 !== 0) {
      return NextResponse.json(
        { erro: "duracaoMin deve ser um número inteiro múltiplo de 15, de no mínimo 15" },
        { status: 400 }
      );
    }

    // Expediente é checado contra o início já existente da sessão — só a
    // duração está mudando, o dia/horário de início continuam os mesmos.
    const inicioComponentes = componentesSP(sessao.inicio);
    const diaSemanaNome = DIA_NOME_POR_NUM[inicioComponentes.diaSemana];
    const inicioMin = inicioComponentes.hora * 60 + inicioComponentes.minuto;
    const fimMin = inicioMin + novaDuracaoMin;
    const todosHorarios = await prisma.horarioTrabalho.findMany({
      where: { clinicaId: sessao.paciente.clinicaId },
    });
    if (!dentroDoExpediente(todosHorarios, diaSemanaNome, inicioMin, fimMin)) {
      return NextResponse.json({ erro: "duração ultrapassa o expediente da clínica" }, { status: 400 });
    }

    const atualizada = await prisma.agendamento.update({
      where: { id }, data: { duracaoMin: novaDuracaoMin },
    });

    await registrarLog(
      usuario.clinicaId,
      usuario.id,
      "ALTERAR_DURACAO_SESSAO",
      `Alterou a duração da sessão ${sessao.numeroSessao} de ${sessao.paciente.nome} de ${sessao.duracaoMin} para ${novaDuracaoMin} minutos`
    );

    // Reflete o novo fim do evento no Google Calendar, se a sessão tiver
    // evento vinculado. Melhor esforço — falha aqui nunca desfaz a mudança local.
    if (sessao.googleEventId) {
      const google = await obterClinicaECalendar(sessao.paciente.clinicaId);
      if (google) {
        await sincronizarEventoGoogle(
          google.calendar,
          sessao.googleCalendarId ?? sessao.tipoSessao?.googleCalendarId ?? google.clinica.googleCalendarId ?? "primary",
          sessao.googleEventId,
          { inicio: sessao.inicio, duracaoMin: novaDuracaoMin },
          google.clinica.id
        );
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
    // A duração da sessão segue o padrão do tipo escolhido (mesma regra da
    // criação do atendimento) — o Google precisa refletir isso no fim do
    // evento, mesmo quando o Meet em si não muda.
    const novaDuracaoMin = novoTipo.duracaoPadraoMin;

    let dadosGoogle: { googleEventId?: string | null; googleCalendarId?: string | null; linkMeet?: string | null } = {};
    let avisoMeet: string | null = null;

    const precisaGoogle = (!eraOnline && ficaOnline && !sessao.linkMeet) || Boolean(sessao.googleEventId);
    const google = precisaGoogle ? await obterClinicaECalendar(sessao.paciente.clinicaId) : null;

    // Título independe do tipo — a troca nunca deve alterar o nome/numeração
    // já usados na criação, só recompomos aqui pra garantir consistência
    // caso o evento precise ser (re)criado ou tenha o fim atualizado abaixo.
    const titulo = `${primeiroUltimoNome(sessao.paciente.nome)} (${sessao.numeroSessao}/${sessao.totalPacote})${sessao.confirmada ? " ✅" : ""}`;

    if (!eraOnline && ficaOnline && !sessao.linkMeet) {
      if (google) {
        const resultado = await criarEventoGoogleMeet(
          google.calendar,
          novoTipo.googleCalendarId ?? google.clinica.googleCalendarId ?? "primary",
          { titulo, inicio: sessao.inicio, duracaoMin: novaDuracaoMin, cor: novoTipo.cor },
          true,
          google.clinica.id
        );
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
      data: { tipoSessaoId: novoTipo.id, duracaoMin: novaDuracaoMin, ...dadosGoogle },
      include: { tipoSessao: true },
    });

    // Evento que já existia antes desta troca (não foi criado agora pelo
    // bloco acima) — sincroniza duração, título e cor do novo tipo. Sempre
    // dispara (não só quando a duração muda): a cor pode ser diferente entre
    // dois tipos com a mesma duração.
    if (!dadosGoogle.googleEventId && sessao.googleEventId && google) {
      await sincronizarEventoGoogle(
        google.calendar,
        sessao.googleCalendarId ?? sessao.tipoSessao?.googleCalendarId ?? google.clinica.googleCalendarId ?? "primary",
        sessao.googleEventId,
        { inicio: sessao.inicio, duracaoMin: novaDuracaoMin, titulo, cor: novoTipo.cor },
        google.clinica.id
      );
    }

    return NextResponse.json({ ...atualizada, avisoMeet });
  }

  if (typeof body.confirmada === "boolean") {
    // Confirmação de presença é independente do status — não interfere na
    // máquina de status da sessão, mas replica o mesmo ✅ do bloco na agenda
    // no título do evento do Google, já que é por lá que a Pâmela acompanha.
    const atualizada = await prisma.agendamento.update({
      where: { id },
      data: { confirmada: body.confirmada },
    });

    if (sessao.googleEventId) {
      const google = await obterClinicaECalendar(sessao.paciente.clinicaId);
      if (google) {
        const titulo = `${primeiroUltimoNome(sessao.paciente.nome)} (${sessao.numeroSessao}/${sessao.totalPacote})${body.confirmada ? " ✅" : ""}`;
        await sincronizarEventoGoogle(
          google.calendar,
          sessao.googleCalendarId ?? sessao.tipoSessao?.googleCalendarId ?? google.clinica.googleCalendarId ?? "primary",
          sessao.googleEventId,
          { inicio: sessao.inicio, duracaoMin: sessao.duracaoMin, titulo },
          google.clinica.id
        );
      }
    }

    return NextResponse.json(atualizada);
  }

  return NextResponse.json({ erro: "nada para atualizar" }, { status: 400 });
}
