import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { enfileirar } from "@/lib/sincronizacao";
import { componentesSP, criarDataSP } from "@/lib/timezone";
import { registrarLog } from "@/lib/auditoria";
import { tipoPacoteLabel } from "@/lib/labels";
import { sincronizarTarefaRenovacao } from "@/lib/tarefas";
import { pode } from "@/lib/permissoes";
import { validarCadenciaLote, INTERVALO_MINIMO_DIAS } from "@/lib/conflitoSemana";
import {
  ErroCadencia,
  lerForcarCadencia,
  OPCOES_TRANSACAO_CADENCIA,
  registrarExcecaoCadencia,
  respostaCadencia,
  travarPaciente,
} from "@/lib/excecaoCadencia";

const TOTAL_POR_TIPO: Record<string, number> = {
  AVULSA: 1, MENSAL: 4, BIMESTRAL: 8, TRIMESTRAL: 12,
};
const HORA_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATA_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;
const DIA_MS = 24 * 60 * 60 * 1000;
// Offset em dias a partir da segunda-feira (0) — mesmo mapa de empurrar/route.ts.
const DIA_OFFSET: Record<string, number> = {
  SEGUNDA: 0, TERCA: 1, QUARTA: 2, QUINTA: 3, SEXTA: 4, SABADO: 5, DOMINGO: 6,
};

// Componentes {ano, mes, dia} a partir de "YYYY-MM-DD", sem envolver Date
// (que sofreria o deslocamento de fuso ao interpretar a string).
function parseDataLocal(dataStr: string): { ano: number; mes: number; dia: number } | null {
  const m = DATA_REGEX.exec(dataStr);
  if (!m) return null;
  const [, ano, mes, dia] = m;
  return { ano: Number(ano), mes: Number(mes), dia: Number(dia) };
}

export async function POST(req: NextRequest) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  if (!pode(usuario.papel, "operarAgenda")) {
    return NextResponse.json({ erro: "sem permissão para esta ação" }, { status: 403 });
  }

  const body = await req.json();
  const { pacienteId, tipo } = body;
  if (!pacienteId || !tipo) {
    return NextResponse.json({ erro: "pacienteId e tipo são obrigatórios" }, { status: 400 });
  }

  const paciente = await prisma.paciente.findUnique({
    where: { id: pacienteId },
    include: { tipoSessao: true },
  });
  if (!paciente || paciente.clinicaId !== usuario.clinicaId) {
    return NextResponse.json({ erro: "paciente não encontrado" }, { status: 404 });
  }

  const total = tipo === "PERSONALIZADO" ? Number(body.totalSessoes) : TOTAL_POR_TIPO[tipo];
  if (!total || total < 1) {
    return NextResponse.json({ erro: "totalSessoes inválido" }, { status: 400 });
  }

  if (!body.dataInicial || !body.horario) {
    return NextResponse.json({ erro: "dataInicial e horario são obrigatórios" }, { status: 400 });
  }
  if (!HORA_REGEX.test(body.horario)) {
    return NextResponse.json({ erro: "horario deve estar no formato HH:MM" }, { status: 400 });
  }
  const dataEscolhida = parseDataLocal(body.dataInicial);
  if (!dataEscolhida) {
    return NextResponse.json({ erro: "dataInicial deve estar no formato YYYY-MM-DD" }, { status: 400 });
  }

  const [h, m] = body.horario.split(":").map(Number);

  // O dia e o horário da 1ª sessão são sempre os informados na criação do
  // atendimento (o operador está decidindo de propósito) — não há mais
  // fallback para o dia preferido/horário fixo cadastrados no paciente.
  const primeira = criarDataSP(dataEscolhida.ano, dataEscolhida.mes, dataEscolhida.dia, h, m);

  // Tipo de sessão escolhido no modal — pré-selecionado com o do cadastro do
  // paciente, mas o operador pode trocar (ex.: uma avaliação avulsa online
  // para um paciente cujo atendimento normal é presencial).
  let tipoSessaoId = paciente.tipoSessaoId;
  let tipoSessaoEhAtendimentoUnico = paciente.tipoSessao?.ehAtendimentoUnico ?? false;
  let tipoSessaoNome = paciente.tipoSessao?.nome ?? null;
  let tipoSessaoDuracaoMin = paciente.tipoSessao?.duracaoPadraoMin ?? 45;
  if (body.tipoSessaoId !== undefined) {
    const tipoSessao = await prisma.tipoSessao.findUnique({ where: { id: body.tipoSessaoId } });
    if (!tipoSessao || tipoSessao.clinicaId !== usuario.clinicaId) {
      return NextResponse.json({ erro: "tipoSessaoId inválido" }, { status: 400 });
    }
    tipoSessaoId = tipoSessao.id;
    tipoSessaoEhAtendimentoUnico = tipoSessao.ehAtendimentoUnico;
    tipoSessaoNome = tipoSessao.nome;
    tipoSessaoDuracaoMin = tipoSessao.duracaoPadraoMin;
  }

  // Tipo de sessão de atendimento único (ex.: avaliação) só pode ser usado
  // num pacote Avulsa — nunca em pacotes recorrentes.
  if (tipoSessaoEhAtendimentoUnico && tipo !== "AVULSA") {
    return NextResponse.json(
      { erro: "este tipo de atendimento é de atendimento único — só permite recorrência Avulsa" },
      { status: 400 }
    );
  }

  // Frequência semanal (1 = padrão, comportamento histórico; 2 = dois slots
  // por semana). Slot 1 = dia/hora da dataInicial; slot 2 = diaSemana2 +
  // horario2, na MESMA semana do slot 1 e pelo menos INTERVALO_MINIMO_DIAS
  // depois (D7). Com 1x, diaSemana2/horario2 são ignorados e gravados nulos.
  const frequenciaSemanal = body.frequenciaSemanal === undefined ? 1 : Number(body.frequenciaSemanal);
  if (frequenciaSemanal !== 1 && frequenciaSemanal !== 2) {
    return NextResponse.json({ erro: "frequenciaSemanal deve ser 1 ou 2" }, { status: 400 });
  }
  let slot2: { offsetDias: number; h: number; m: number } | null = null;
  if (frequenciaSemanal === 2) {
    if (total < 2) {
      return NextResponse.json({ erro: "frequência 2x por semana exige pelo menos 2 sessões" }, { status: 400 });
    }
    if (!body.diaSemana2 || !(body.diaSemana2 in DIA_OFFSET)) {
      return NextResponse.json({ erro: "informe o dia da 2ª sessão da semana" }, { status: 400 });
    }
    if (!body.horario2 || !HORA_REGEX.test(body.horario2)) {
      return NextResponse.json({ erro: "horário da 2ª sessão deve estar no formato HH:MM" }, { status: 400 });
    }
    const offsetSlot1 = (componentesSP(primeira).diaSemana + 6) % 7;
    const offsetSlot2 = DIA_OFFSET[body.diaSemana2];
    if (offsetSlot2 - offsetSlot1 < INTERVALO_MINIMO_DIAS) {
      return NextResponse.json(
        {
          erro: `o 2º dia precisa estar na mesma semana (segunda a domingo) da 1ª sessão e pelo menos ${INTERVALO_MINIMO_DIAS} dias depois dela`,
        },
        { status: 400 }
      );
    }
    const [h2, m2] = body.horario2.split(":").map(Number);
    slot2 = { offsetDias: offsetSlot2 - offsetSlot1, h: h2, m: m2 };
  }

  const leituraForcar = lerForcarCadencia(body, usuario.papel);
  if (!leituraForcar.ok) return NextResponse.json({ erro: leituraForcar.erro }, { status: 400 });
  const forcar = leituraForcar.forcar;

  // Datas das sessões. 1x: primeira + i semanas (inalterado). 2x: alterna
  // slot 1 e slot 2 semana a semana; total ímpar deixa a última semana com
  // só o slot 1.
  const datas: Date[] = [];
  for (let i = 0; i < total; i++) {
    if (!slot2) {
      datas.push(new Date(primeira.getTime() + i * 7 * DIA_MS));
      continue;
    }
    const semana = Math.floor(i / 2);
    const slot1DaSemana = new Date(primeira.getTime() + semana * 7 * DIA_MS);
    if (i % 2 === 0) {
      datas.push(slot1DaSemana);
    } else {
      const c = componentesSP(slot1DaSemana);
      const dia = new Date(Date.UTC(c.ano, c.mes - 1, c.dia) + slot2.offsetDias * DIA_MS);
      datas.push(criarDataSP(dia.getUTCFullYear(), dia.getUTCMonth() + 1, dia.getUTCDate(), slot2.h, slot2.m));
    }
  }

  const clinica = await prisma.clinica.findUnique({ where: { id: usuario.clinicaId } });
  const googleSyncStatus = clinica?.googleConectado ? "PENDENTE" : "NAO_APLICAVEL";

  // Renovação: um pacote novo reativa o paciente, saindo de Finalizado/Cancelado
  const foiRenovacao = paciente.statusGeral !== "ATIVO";

  // Validação de cadência + escrita na mesma transação, sob o lock do
  // paciente (D9): cada data gerada é checada contra as sessões já
  // existentes do paciente (todos os pacotes) e contra as anteriores do
  // próprio lote, com o limite do pacote novo (D1).
  let resultado: { pacote: { id: string }; agendamentoIds: string[]; tarefasConcluidas: number };
  try {
    resultado = await prisma.$transaction(async (tx) => {
      await travarPaciente(tx, pacienteId);
      const existentes = await tx.agendamento.findMany({
        where: { pacienteId },
        select: { id: true, inicio: true, status: true },
      });
      const conflitos = validarCadenciaLote(
        datas.map((d, i) => ({ id: `nova-${i + 1}`, novaData: d, limite: frequenciaSemanal, rotulo: `sessão ${i + 1}` })),
        existentes
      );
      if (conflitos.length > 0 && !forcar) throw new ErroCadencia(conflitos);

      const pacote = await tx.pacote.create({
        data: {
          pacienteId, tipo, totalSessoes: total, dataInicial: primeira,
          frequenciaSemanal,
          diaSemana2: frequenciaSemanal === 2 ? body.diaSemana2 : null,
          horario2: frequenciaSemanal === 2 ? body.horario2 : null,
        },
      });

      let tarefasConcluidas = 0;
      if (foiRenovacao) {
        await tx.paciente.update({
          where: { id: pacienteId },
          data: { statusGeral: "ATIVO", finalizadoEm: null },
        });
        ({ tarefasConcluidas } = await sincronizarTarefaRenovacao(tx, paciente, "ATIVO", usuario.id));
      }

      const criadas = await tx.agendamento.createManyAndReturn({
        data: datas.map((inicio, i) => ({
          clinicaId: usuario.clinicaId,
          pacoteId: pacote.id, pacienteId,
          numeroSessao: i + 1, totalPacote: total,
          inicio, duracaoMin: tipoSessaoDuracaoMin,
          tipoSessaoId,
          googleSyncStatus,
        })),
        select: { id: true, numeroSessao: true },
      });
      const idPorNumero = new Map(criadas.map((c) => [c.numeroSessao, c.id]));

      if (conflitos.length > 0 && forcar) {
        await registrarExcecaoCadencia(tx, {
          clinicaId: usuario.clinicaId,
          usuarioId: usuario.id,
          pacienteId,
          operacao: "a criação de atendimento",
          motivo: forcar.motivo,
          conflitos: conflitos.map((c) => ({ ...c, id: idPorNumero.get(Number(c.id.slice(5))) ?? c.id })),
        });
      }

      return {
        pacote,
        agendamentoIds: datas.map((_, i) => idPorNumero.get(i + 1)!).filter(Boolean),
        tarefasConcluidas,
      };
    }, OPCOES_TRANSACAO_CADENCIA);
  } catch (err) {
    if (err instanceof ErroCadencia) return respostaCadencia(err, usuario.papel, "Não é possível criar o atendimento");
    throw err;
  }
  const { pacote, tarefasConcluidas } = resultado;

  // Clínica com Google conectado: cada sessão criada aqui vira um item
  // CALENDAR_CRIAR no outbox (src/lib/sincronizacao.ts) — o evento em si
  // (com Meet só quando o tipo de atendimento é online, calendário
  // escolhido pelo tipo de sessão) é criado pelo worker, de forma
  // assíncrona. O gate continua sendo a conexão da clínica, não o tipo de
  // sessão (bug histórico corrigido em 2026-07-21). A gravação da sessão em
  // si nunca espera o Google: enfileirar() nunca lança, e o worker relê o
  // agendamento pelo id pra montar título/calendário/Meet na hora de
  // processar (não precisa do estado local nesta requisição). Enfileirado
  // só depois do COMMIT acima, em ordem de numeroSessao, para o worker
  // nunca enxergar um agendamento ainda não commitado.
  if (clinica?.googleConectado) {
    for (const agendamentoId of resultado.agendamentoIds) {
      await enfileirar(clinica.id, "CALENDAR_CRIAR", { agendamentoId });
    }
  }

  const acaoLog = foiRenovacao ? "RENOVAR_ATENDIMENTO" : "CRIAR_ATENDIMENTO";
  const verboLog = foiRenovacao ? "Renovou" : "Criou";
  const sessaoOuSessoes = total === 1 ? "sessão" : "sessões";
  await registrarLog(
    usuario.clinicaId,
    usuario.id,
    acaoLog,
    `${verboLog} atendimento ${tipoPacoteLabel(tipo)} (${total} ${sessaoOuSessoes}${frequenciaSemanal === 2 ? " · 2x/semana" : ""}) para ${paciente.nome} — tipo de atendimento: ${tipoSessaoNome ?? "não definido"}`
  );
  if (tarefasConcluidas > 0) {
    await registrarLog(
      usuario.clinicaId,
      usuario.id,
      "CONCLUIR_TAREFA_RENOVACAO",
      `Tarefa de renovação de ${paciente.nome} concluída automaticamente (novo pacote criado)`
    );
  }

  return NextResponse.json({ pacote, sessoesGeradas: total }, { status: 201 });
}
