import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";

// GET /api/notificacoes — pendências para o sino do painel: sessões reagendadas
// aguardando novo horário, tarefas pendentes já visíveis (sem aviso futuro),
// se a integração Google da clínica caiu de verdade (token revogado — ver
// google.ts:ehErroTokenRevogado, pro banner persistente do painel), e a
// contagem de EnvioFormulario PENDENTE (F2.5 — badge do link "Anamneses").
export async function GET() {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });

  const agora = new Date();

  const [reagendadas, tarefas, clinica, formulariosPendentes] = await Promise.all([
    prisma.agendamento.findMany({
      where: { status: "REAGENDADA", paciente: { clinicaId: usuario.clinicaId } },
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
      select: { googleConectado: true, googleTokenValido: true },
    }),
    prisma.envioFormulario.count({ where: { clinicaId: usuario.clinicaId, status: "PENDENTE" } }),
  ]);

  const integracaoGoogleFalhou = Boolean(clinica?.googleConectado && !clinica.googleTokenValido);

  return NextResponse.json({ reagendadas, tarefas, integracaoGoogleFalhou, formulariosPendentes });
}
