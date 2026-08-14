import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";

// Janela de "recente" pro banner reagir a uma falha do outbox de
// sincronização (googleUltimoErro/googleUltimoErroEm) mesmo quando o token
// em si continua válido (erro transitório, quota, escopo insuficiente etc.
// — não só invalid_grant). 2h cobre várias tentativas de backoff (o outbox
// tenta de novo em 1min/5min/30min/2h/6h) sem deixar o banner aceso por
// muito tempo depois que o problema já foi resolvido — e marcarConcluido()
// no worker limpa o campo assim que qualquer sincronização daquela clínica
// funciona de novo, então na prática o banner some antes disso na maioria
// dos casos.
const JANELA_ERRO_RECENTE_MS = 2 * 60 * 60 * 1000;

// GET /api/notificacoes — pendências para o sino do painel: sessões reagendadas
// aguardando novo horário, tarefas pendentes já visíveis (sem aviso futuro),
// se a integração Google da clínica caiu de verdade (token revogado — ver
// google.ts:ehErroTokenRevogado — ou uma falha recente do outbox de
// sincronização, ver JANELA_ERRO_RECENTE_MS, pro banner persistente do
// painel), e a contagem de EnvioFormulario PENDENTE (F2.5 — badge do link
// "Anamneses").
export async function GET() {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });

  const agora = new Date();

  const [reagendadas, tarefas, clinica, formulariosPendentes] = await Promise.all([
    prisma.agendamento.findMany({
      where: { status: "REAGENDADA", clinicaId: usuario.clinicaId },
      include: {
        paciente: { select: { id: true, nome: true } },
        tipoSessao: { select: { nome: true, ehAtendimentoUnico: true } },
      },
      orderBy: { inicio: "asc" },
    }),
    prisma.tarefa.findMany({
      where: {
        clinicaId: usuario.clinicaId,
        status: "PENDENTE",
        OR: [{ dataAviso: null }, { dataAviso: { lte: agora } }],
      },
      orderBy: { dataVencimento: { sort: "asc", nulls: "last" } },
    }),
    prisma.clinica.findUnique({
      where: { id: usuario.clinicaId },
      select: { googleConectado: true, googleTokenValido: true, googleUltimoErroEm: true },
    }),
    prisma.envioFormulario.count({ where: { clinicaId: usuario.clinicaId, status: "PENDENTE" } }),
  ]);

  const erroRecente =
    clinica?.googleUltimoErroEm !== null &&
    clinica?.googleUltimoErroEm !== undefined &&
    agora.getTime() - clinica.googleUltimoErroEm.getTime() < JANELA_ERRO_RECENTE_MS;
  const integracaoGoogleFalhou = Boolean(clinica?.googleConectado && (!clinica.googleTokenValido || erroRecente));

  return NextResponse.json({ reagendadas, tarefas, integracaoGoogleFalhou, formulariosPendentes });
}
