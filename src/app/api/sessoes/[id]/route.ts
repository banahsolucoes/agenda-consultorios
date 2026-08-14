import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { verificarFinalizacao } from "@/lib/finalizacao";
import { enfileirar, enfileirarRemocaoDeAgendamento } from "@/lib/sincronizacao";
import { nomeSessao } from "@/lib/blocoAgenda";
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

// Gate leve pra decidir se vale a pena enfileirar um CALENDAR_ATUALIZAR/CRIAR
// — só um SELECT do campo booleano, sem montar client OAuth (isso o worker
// faz na hora de processar). Enfileirar sem checar geraria itens fadados a
// FALHA depois de 5 tentativas pra clínica que nunca conectou o Google.
async function clinicaGoogleConectada(clinicaId: string): Promise<boolean> {
  const clinica = await prisma.clinica.findUnique({ where: { id: clinicaId }, select: { googleConectado: true } });
  return clinica?.googleConectado ?? false;
}

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
    include: { paciente: true, aluno: true, tipoSessao: true },
  });
  if (!sessao || sessao.clinicaId !== usuario.clinicaId) {
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

      // Remove o evento do Google Calendar da clínica (se houver um vinculado)
      // via outbox — CALENDAR_REMOVER, com supersede de qualquer
      // CALENDAR_CRIAR/ATUALIZAR pendente pra esta mesma sessão, pra nunca
      // deixar um evento fantasma (ver enfileirarRemocaoDeAgendamento).
      // Chamado incondicionalmente: mesmo sem googleEventId ainda pode haver
      // um CRIAR pendente que precisa ser superseded. Falha na integração
      // nunca impede o cancelamento local — o Google fica "melhor esforço".
      await enfileirarRemocaoDeAgendamento(usuario.clinicaId, sessao.id);

      const atualizada = await prisma.agendamento.update({
        where: { id },
        data: { status: "CANCELADA", motivoCancelamento: motivo, ...(arquivar ? { arquivada: true } : {}) },
      });
      await registrarLog(
        usuario.clinicaId,
        usuario.id,
        "CANCELAR_SESSAO",
        `Cancelou${arquivar ? " e arquivou" : ""} a sessão ${sessao.numeroSessao} de ${nomeSessao(sessao)} — motivo: ${motivo}`
      );
      const finalizou = sessao.pacoteId ? await verificarFinalizacao(sessao.pacoteId, usuario.id) : false;
      return NextResponse.json({ ...atualizada, pacoteFinalizado: finalizou });
    }

    const validacaoStatus = validarStatusSessao(body.status, sessao.inicio);
    if (!validacaoStatus.valido) {
      return NextResponse.json({ erro: validacaoStatus.erro }, { status: 400 });
    }

    let atualizada = await prisma.agendamento.update({
      where: { id }, data: { status: body.status },
    });
    await registrarLog(
      usuario.clinicaId,
      usuario.id,
      "STATUS_SESSAO",
      `Marcou a sessão ${sessao.numeroSessao} de ${nomeSessao(sessao)} como ${statusLabel(body.status)}`
    );

    // Reflete a mudança de status no título do evento do Google, se a sessão
    // tiver evento vinculado — via outbox (o worker relê status/confirmada já
    // atualizados e monta o título com o sufixo certo, ver
    // sincronizacao.ts:construirTitulo). Falha nunca desfaz a mudança de
    // status já commitada no banco.
    if (sessao.googleEventId && (await clinicaGoogleConectada(usuario.clinicaId))) {
      atualizada = await prisma.agendamento.update({
        where: { id },
        data: { googleSyncStatus: "PENDENTE" },
      });
      await enfileirar(usuario.clinicaId, "CALENDAR_ATUALIZAR", { agendamentoId: id });
    }

    const finalizou = sessao.pacoteId ? await verificarFinalizacao(sessao.pacoteId, usuario.id) : false;
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

    // Reunião avulsa de mentorado não tem pacote — "esta e as futuras" não
    // existe pra ela, mesmo que o body peça (cai em "esta" silenciosamente).
    const escopo = body.escopo === "ESTA_E_FUTURAS" && sessao.pacoteId ? "ESTA_E_FUTURAS" : "ESTA";

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
      where: { clinicaId: sessao.clinicaId },
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
          numeroSessao: { gt: sessao.numeroSessao ?? 0 },
          status: "AGENDADA",
          arquivada: false,
        },
        include: { paciente: true, tipoSessao: true },
        orderBy: { numeroSessao: "asc" },
      });

      // Isolamento de tenant: toda irmã precisa pertencer à mesma clínica do
      // usuário logado (garantido estruturalmente por pacoteId->paciente,
      // mas confirmado aqui de forma explícita).
      if (irmas.some((irma) => irma.clinicaId !== usuario.clinicaId)) {
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
          novoInicio: new Date(novaData.getTime() + ((irma.numeroSessao ?? 0) - (sessao.numeroSessao ?? 0)) * 7 * DIA_MS),
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
        `Editou a sessão ${sessao.numeroSessao} de ${nomeSessao(sessao)} e realinhou ${irmas.length} sessão(ões) seguinte(s) a partir de ${formatarDataHoraSP(novaData)}`
      );

      // Reflete o novo horário de cada sessão movida com evento vinculado no
      // Google Calendar — um item CALENDAR_ATUALIZAR por sessão movida, na
      // mesma ordem em que os updates locais acabaram de ser commitados
      // acima (não paraleliza: enfileirar() é sequencial neste for). Falha
      // na integração nunca desfaz o que já foi movido no banco.
      const movimentosComEvento = movimentos.filter((mov) => mov.googleEventId);
      if (movimentosComEvento.length > 0 && (await clinicaGoogleConectada(sessao.clinicaId))) {
        for (const mov of movimentosComEvento) {
          await enfileirar(sessao.clinicaId, "CALENDAR_ATUALIZAR", { agendamentoId: mov.id });
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

    // Conflito de semana: nenhuma outra sessão (não cancelada) desta mesma
    // pessoa — paciente ou mentorado — pode cair na mesma semana (segunda a
    // domingo, calendário de São Paulo) da nova data. Validado aqui no
    // backend — não confiamos apenas na checagem já feita no front.
    // `pacienteId: sessao.pacienteId` sozinho quebraria pra mentorado
    // (pacienteId null casaria com todo agendamento sem paciente, de
    // qualquer clínica) — por isso o filtro é sempre por quem é dono desta
    // sessão especificamente.
    const outrasSessoesMesmaPessoa = await prisma.agendamento.findMany({
      where: sessao.alunoId
        ? { alunoId: sessao.alunoId, id: { not: sessao.id } }
        : { pacienteId: sessao.pacienteId, id: { not: sessao.id } },
      select: { id: true, inicio: true, status: true },
    });
    if (existeConflitoDeSemana(novaData, outrasSessoesMesmaPessoa)) {
      return NextResponse.json(
        { erro: `Não é possível: já existe uma sessão deste${sessao.alunoId ? " mentorado" : " paciente"} nesta semana.` },
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
      `Editou a sessão ${sessao.numeroSessao} de ${nomeSessao(sessao)} para ${formatarDataHoraSP(novaData)}`
    );

    // Reflete o novo horário no Google Calendar, se a sessão tiver evento
    // vinculado — via outbox. Falha aqui nunca desfaz a mudança local.
    if (sessao.googleEventId && (await clinicaGoogleConectada(sessao.clinicaId))) {
      await enfileirar(sessao.clinicaId, "CALENDAR_ATUALIZAR", { agendamentoId: id });
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
      where: { clinicaId: sessao.clinicaId },
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
      `Alterou a duração da sessão ${sessao.numeroSessao} de ${nomeSessao(sessao)} de ${sessao.duracaoMin} para ${novaDuracaoMin} minutos`
    );

    // Reflete o novo fim do evento no Google Calendar, se a sessão tiver
    // evento vinculado — via outbox. Falha aqui nunca desfaz a mudança local.
    if (sessao.googleEventId && (await clinicaGoogleConectada(sessao.clinicaId))) {
      await enfileirar(sessao.clinicaId, "CALENDAR_ATUALIZAR", { agendamentoId: id });
    }

    return NextResponse.json(atualizada);
  }

  if (body.tipoSessaoId) {
    if (STATUS_CONSUMIDOS.includes(sessao.status)) {
      return NextResponse.json({ erro: "sessão consumida não pode ser editada" }, { status: 400 });
    }

    const novoTipo = await prisma.tipoSessao.findUnique({ where: { id: body.tipoSessaoId } });
    if (!novoTipo || novoTipo.clinicaId !== sessao.clinicaId) {
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

    const precisaCriarMeet = !eraOnline && ficaOnline && !sessao.linkMeet;
    const precisaGoogle = precisaCriarMeet || Boolean(sessao.googleEventId);
    const conectada = precisaGoogle && (await clinicaGoogleConectada(sessao.clinicaId));

    let avisoMeet: string | null = null;
    if (precisaCriarMeet && !conectada) {
      avisoMeet = "Google não conectado — não foi possível gerar o Meet";
    }

    // O Calendar não permite "upar" conferenceData num evento existente via
    // patch — por isso presencial->online sempre nasce como evento novo (via
    // CALENDAR_CRIAR), nunca um patch do evento presencial antigo. Zeramos
    // aqui os campos do evento antigo (se havia um) pra: 1) a idempotência
    // do CALENDAR_CRIAR no worker (que pula se já houver googleEventId) não
    // achar que já está sincronizado, e 2) a checagem noturna não comparar
    // contra um evento que vai ficar órfão no Google — mesmo efeito líquido
    // do código anterior, que sobrescrevia esses campos assim que o novo
    // evento fosse criado.
    const camposParaLimpar = precisaCriarMeet
      ? { googleEventId: null, googleCalendarId: null, linkMeet: null }
      : {};
    const googleSyncStatus = precisaGoogle && conectada ? "PENDENTE" : undefined;

    const atualizada = await prisma.agendamento.update({
      where: { id },
      data: {
        tipoSessaoId: novoTipo.id,
        duracaoMin: novaDuracaoMin,
        ...camposParaLimpar,
        ...(googleSyncStatus ? { googleSyncStatus } : {}),
      },
      include: { tipoSessao: true },
    });

    if (conectada) {
      // Título, cor e (quando aplicável) calendário de mentoria são
      // resolvidos pelo worker ao reler o agendamento — já reflete
      // tipoSessaoId novo, gravado acima antes de enfileirar.
      await enfileirar(sessao.clinicaId, precisaCriarMeet ? "CALENDAR_CRIAR" : "CALENDAR_ATUALIZAR", {
        agendamentoId: id,
      });
    }

    return NextResponse.json({ ...atualizada, avisoMeet });
  }

  if (typeof body.confirmada === "boolean") {
    // Confirmação de presença é independente do status — não interfere na
    // máquina de status da sessão, mas replica o mesmo ✅ do bloco na agenda
    // no título do evento do Google (via outbox — worker relê `confirmada`
    // já atualizada), já que é por lá que a Pâmela acompanha.
    const atualizada = await prisma.agendamento.update({
      where: { id },
      data: { confirmada: body.confirmada },
    });

    if (sessao.googleEventId && (await clinicaGoogleConectada(sessao.clinicaId))) {
      await enfileirar(sessao.clinicaId, "CALENDAR_ATUALIZAR", { agendamentoId: id });
    }

    return NextResponse.json(atualizada);
  }

  return NextResponse.json({ erro: "nada para atualizar" }, { status: 400 });
}
