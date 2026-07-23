import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { obterCalendarDaClinica, criarEventoGoogleMeet } from "@/lib/google";
import { primeiroUltimoNome } from "@/lib/nomes";
import { criarDataSP } from "@/lib/timezone";
import { registrarLog } from "@/lib/auditoria";
import { tipoPacoteLabel } from "@/lib/labels";
import { sincronizarTarefaRenovacao } from "@/lib/tarefas";

const TOTAL_POR_TIPO: Record<string, number> = {
  AVULSA: 1, MENSAL: 4, BIMESTRAL: 8, TRIMESTRAL: 12,
};
const HORA_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATA_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;
const DIA_MS = 24 * 60 * 60 * 1000;

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
  let tipoSessaoEhOnline = paciente.tipoSessao?.ehOnline ?? false;
  let tipoSessaoEhAtendimentoUnico = paciente.tipoSessao?.ehAtendimentoUnico ?? false;
  let tipoSessaoNome = paciente.tipoSessao?.nome ?? null;
  let tipoSessaoDuracaoMin = paciente.tipoSessao?.duracaoPadraoMin ?? 45;
  let tipoSessaoGoogleCalendarId = paciente.tipoSessao?.googleCalendarId ?? null;
  if (body.tipoSessaoId !== undefined) {
    const tipoSessao = await prisma.tipoSessao.findUnique({ where: { id: body.tipoSessaoId } });
    if (!tipoSessao || tipoSessao.clinicaId !== usuario.clinicaId) {
      return NextResponse.json({ erro: "tipoSessaoId inválido" }, { status: 400 });
    }
    tipoSessaoId = tipoSessao.id;
    tipoSessaoEhOnline = tipoSessao.ehOnline;
    tipoSessaoEhAtendimentoUnico = tipoSessao.ehAtendimentoUnico;
    tipoSessaoNome = tipoSessao.nome;
    tipoSessaoDuracaoMin = tipoSessao.duracaoPadraoMin;
    tipoSessaoGoogleCalendarId = tipoSessao.googleCalendarId;
  }

  // Tipo de sessão de atendimento único (ex.: avaliação) só pode ser usado
  // num pacote Avulsa — nunca em pacotes recorrentes.
  if (tipoSessaoEhAtendimentoUnico && tipo !== "AVULSA") {
    return NextResponse.json(
      { erro: "este tipo de atendimento é de atendimento único — só permite recorrência Avulsa" },
      { status: 400 }
    );
  }

  const pacote = await prisma.pacote.create({
    data: { pacienteId, tipo, totalSessoes: total, dataInicial: primeira },
  });

  // Renovação: um pacote novo reativa o paciente, saindo de Finalizado/Cancelado
  const foiRenovacao = paciente.statusGeral !== "ATIVO";
  let tarefasConcluidas = 0;
  if (foiRenovacao) {
    tarefasConcluidas = await prisma.$transaction(async (tx) => {
      await tx.paciente.update({
        where: { id: pacienteId },
        data: { statusGeral: "ATIVO", finalizadoEm: null },
      });
      const { tarefasConcluidas } = await sincronizarTarefaRenovacao(tx, paciente, "ATIVO", usuario.id);
      return tarefasConcluidas;
    });
  }

  const sessoes = [];
  for (let i = 0; i < total; i++) {
    const inicio = new Date(primeira.getTime() + i * 7 * DIA_MS);
    sessoes.push({
      pacoteId: pacote.id, pacienteId,
      numeroSessao: i + 1, totalPacote: total,
      inicio, duracaoMin: tipoSessaoDuracaoMin,
      tipoSessaoId,
    });
  }

  // Clínica com Google conectado: cria um evento por sessão — com Meet só
  // quando o tipo de atendimento é online — e grava link/id + status de
  // sincronização junto do agendamento. O gate é a conexão da clínica, não o
  // tipo de sessão: antes, sessão presencial pulava a integração inteira
  // mesmo com a clínica conectada (bug real — ver auditoria de 2026-07-21).
  // Falha na chamada ao Google nunca pode travar a criação da sessão em si —
  // só grava FALHOU pra não confundir com "nunca tentou". O calendário é
  // escolhido pelo tipo de sessão (TipoSessao.googleCalendarId) quando
  // configurado — sem isso, todo evento caía no googleCalendarId único da
  // Clinica, misturando presencial e online no mesmo calendário (bug
  // histórico corrigido em 2026-07-23).
  const clinica = await prisma.clinica.findUnique({ where: { id: usuario.clinicaId } });
  const calendar = clinica ? await obterCalendarDaClinica(clinica).catch(() => null) : null;

  if (calendar && clinica) {
    for (const sessao of sessoes) {
      const dadosGoogle = await criarEventoGoogleMeet(
        calendar,
        tipoSessaoGoogleCalendarId ?? clinica.googleCalendarId ?? "primary",
        {
          titulo: `${primeiroUltimoNome(paciente.nome)} (${sessao.numeroSessao}/${sessao.totalPacote})`,
          inicio: sessao.inicio,
          duracaoMin: sessao.duracaoMin,
        },
        tipoSessaoEhOnline,
        clinica.id
      );
      const googleSyncStatus = dadosGoogle.googleEventId ? "SINCRONIZADO" : "FALHOU";
      await prisma.agendamento.create({ data: { ...sessao, ...dadosGoogle, googleSyncStatus } });
    }
  } else {
    await prisma.agendamento.createMany({ data: sessoes });
  }

  const acaoLog = foiRenovacao ? "RENOVAR_ATENDIMENTO" : "CRIAR_ATENDIMENTO";
  const verboLog = foiRenovacao ? "Renovou" : "Criou";
  const sessaoOuSessoes = total === 1 ? "sessão" : "sessões";
  await registrarLog(
    usuario.clinicaId,
    usuario.id,
    acaoLog,
    `${verboLog} atendimento ${tipoPacoteLabel(tipo)} (${total} ${sessaoOuSessoes}) para ${paciente.nome} — tipo de atendimento: ${tipoSessaoNome ?? "não definido"}`
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
