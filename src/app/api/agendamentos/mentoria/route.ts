import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { enfileirar } from "@/lib/sincronizacao";
import { criarDataSP } from "@/lib/timezone";
import { registrarLog } from "@/lib/auditoria";

const HORA_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATA_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;
const DURACAO_PADRAO_MIN = 45;

function parseDataLocal(dataStr: string): { ano: number; mes: number; dia: number } | null {
  const m = DATA_REGEX.exec(dataStr);
  if (!m) return null;
  const [, ano, mes, dia] = m;
  return { ano: Number(ano), mes: Number(mes), dia: Number(dia) };
}

// POST /api/agendamentos/mentoria — reunião avulsa de mentorado na mesma
// agenda semanal do consultório (sem pacote, sem numeração — mesmo padrão
// dos agendamentos de paciente pra tudo mais: clinicaId sempre de
// getUsuarioLogado(), evento Google Calendar + Meet gerados pela mesma
// engine já usada por POST /api/pacotes, mesma trilha de auditoria).
export async function POST(req: NextRequest) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  if (!pode(usuario.papel, "operarAgenda")) {
    return NextResponse.json({ erro: "sem permissão para esta ação" }, { status: 403 });
  }

  const body = await req.json();
  const { alunoId } = body;
  if (!alunoId) {
    return NextResponse.json({ erro: "alunoId é obrigatório" }, { status: 400 });
  }

  // Tenancy: nunca confia em alunoId do body sem checar que pertence à
  // clínica do usuário logado — mesmo padrão de POST /api/pacotes com
  // pacienteId.
  const aluno = await prisma.mentoriaAluno.findUnique({ where: { id: alunoId } });
  if (!aluno || aluno.clinicaId !== usuario.clinicaId) {
    return NextResponse.json({ erro: "mentorado não encontrado" }, { status: 404 });
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
  const inicio = criarDataSP(dataEscolhida.ano, dataEscolhida.mes, dataEscolhida.dia, h, m);

  let tipoSessaoId: string | null = null;
  if (body.tipoSessaoId !== undefined && body.tipoSessaoId !== null) {
    const tipoSessao = await prisma.tipoSessao.findUnique({ where: { id: body.tipoSessaoId } });
    if (!tipoSessao || tipoSessao.clinicaId !== usuario.clinicaId) {
      return NextResponse.json({ erro: "tipoSessaoId inválido" }, { status: 400 });
    }
    tipoSessaoId = tipoSessao.id;
  }

  const duracaoMin =
    typeof body.duracaoMin === "number" && Number.isInteger(body.duracaoMin) && body.duracaoMin >= 15
      ? body.duracaoMin
      : DURACAO_PADRAO_MIN;

  // Evento Google Calendar/Meet vira um item CALENDAR_CRIAR no outbox
  // (src/lib/sincronizacao.ts) em vez de chamada síncrona — mesma engine
  // (criarEventoGoogleMeet, chamada pelo worker), nenhum caminho de sync
  // paralelo. Título, comMeet:true e o calendário SEMPRE de mentoria (nunca
  // o calendário clínico, ver resolverCalendarIdMentorado) são resolvidos
  // pelo worker ao reler o agendamento pelo id — ele sabe que é reunião de
  // mentorado pelo alunoId presente.
  const clinica = await prisma.clinica.findUnique({ where: { id: usuario.clinicaId } });
  const googleSyncStatus = clinica?.googleConectado ? "PENDENTE" : "NAO_APLICAVEL";

  const agendamento = await prisma.agendamento.create({
    data: {
      clinicaId: usuario.clinicaId,
      alunoId: aluno.id,
      inicio,
      duracaoMin,
      tipoSessaoId,
      googleSyncStatus,
    },
  });

  if (clinica?.googleConectado) {
    await enfileirar(clinica.id, "CALENDAR_CRIAR", { agendamentoId: agendamento.id });
  }

  await registrarLog(
    usuario.clinicaId,
    usuario.id,
    "CRIAR_REUNIAO_MENTORIA",
    `Criou reunião de mentoria com ${aluno.nomeCompleto} em ${body.dataInicial} às ${body.horario}`
  );

  return NextResponse.json({ agendamento }, { status: 201 });
}
