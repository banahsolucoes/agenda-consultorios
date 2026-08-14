import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { componentesSP } from "@/lib/timezone";
import { registrarLog } from "@/lib/auditoria";
import { enfileirar } from "@/lib/sincronizacao";

const DIA_MS = 24 * 60 * 60 * 1000;

// Marcador (meia-noite UTC do dia de calendário) da segunda-feira da semana
// que contém `data`, calculado no calendário de São Paulo — usado só para
// comparação de igualdade entre semanas, nunca exposto como instante real.
function inicioDaSemana(data: Date): Date {
  const c = componentesSP(data);
  const distSeg = c.diaSemana === 0 ? 6 : c.diaSemana - 1;
  return new Date(Date.UTC(c.ano, c.mes - 1, c.dia) - distSeg * DIA_MS);
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  if (!pode(usuario.papel, "operarAgenda")) {
    return NextResponse.json({ erro: "sem permissão para esta ação" }, { status: 403 });
  }

  const { id: pacienteId } = await ctx.params;
  const paciente = await prisma.paciente.findUnique({ where: { id: pacienteId } });
  if (!paciente || paciente.clinicaId !== usuario.clinicaId) {
    return NextResponse.json({ erro: "paciente não encontrado" }, { status: 404 });
  }

  const body = await req.json();
  const { sessaoCorteId } = body;
  if (!sessaoCorteId) {
    return NextResponse.json({ erro: "sessaoCorteId é obrigatório" }, { status: 400 });
  }

  const sessoes = await prisma.agendamento.findMany({
    where: { pacienteId, status: { notIn: ["CANCELADA"] } },
    orderBy: { numeroSessao: "asc" },
    include: { tipoSessao: true },
  });

  const corte = sessoes.find((s) => s.id === sessaoCorteId);
  if (!corte) {
    return NextResponse.json({ erro: "sessão de corte não encontrada" }, { status: 404 });
  }

  // pacienteId sempre não-nulo nesta query — toda sessão aqui é numerada
  // (vem de um pacote), nunca uma reunião avulsa de mentorado.
  const anteriores = sessoes.filter((s) => (s.numeroSessao ?? 0) < (corte.numeroSessao ?? 0));
  const aMover = sessoes.filter((s) => (s.numeroSessao ?? 0) >= (corte.numeroSessao ?? 0));

  // Regra de conflito: a sessão de corte recuada 7 dias não pode cair na mesma
  // semana (segunda a domingo) de uma sessão anterior que não será movida.
  // Se colidir, bloqueia a operação inteira — nada é movido.
  const novaSemanaCorte = inicioDaSemana(new Date(corte.inicio.getTime() - 7 * DIA_MS)).getTime();
  const colide = anteriores.some((s) => inicioDaSemana(s.inicio).getTime() === novaSemanaCorte);
  if (colide) {
    return NextResponse.json(
      { erro: "Não é possível trazer: já existe uma sessão nesta semana." },
      { status: 400 }
    );
  }

  const movimentos = aMover.map((s) => ({ sessao: s, novaData: new Date(s.inicio.getTime() - 7 * DIA_MS) }));

  await prisma.$transaction(
    movimentos.map((mov) =>
      prisma.agendamento.update({
        where: { id: mov.sessao.id },
        data: { inicio: mov.novaData, status: "AGENDADA" },
      })
    )
  );

  // Reflete a nova data/hora no Google Calendar de cada sessão movida — via
  // outbox: um item CALENDAR_ATUALIZAR se a sessão já tinha evento, ou
  // CALENDAR_CRIAR se nunca teve (mesmo gate de POST /api/pacotes: clínica
  // conectada, Meet só quando o tipo de atendimento é online — resolvido
  // pelo worker ao reler a sessão). enfileirar() é chamado sequencialmente
  // dentro do for (nunca em paralelo) pra preservar a ordem relativa do
  // loop na fila; cada item aponta pra uma sessão diferente, então não há
  // dependência real entre eles além dessa ordem de criação. Falha na
  // integração nunca desfaz o que já foi movido no banco; googleSyncStatus
  // vira PENDENTE (era SINCRONIZADO/FALHOU síncrono antes) pra distinguir
  // "aguardando" de "nunca tentou" — mesmo espírito do achado da auditoria
  // de 2026-07-23 (sessões do paciente Jadir ficaram com a data desatualizada
  // no Google porque a falha síncrona de então era só logada).
  const clinica = await prisma.clinica.findUnique({
    where: { id: usuario.clinicaId },
    select: { googleConectado: true },
  });
  if (clinica?.googleConectado) {
    for (const mov of movimentos) {
      await prisma.agendamento.update({
        where: { id: mov.sessao.id },
        data: { googleSyncStatus: "PENDENTE" },
      });
      await enfileirar(usuario.clinicaId, mov.sessao.googleEventId ? "CALENDAR_ATUALIZAR" : "CALENDAR_CRIAR", {
        agendamentoId: mov.sessao.id,
      });
    }
  }

  const sessaoOuSessoes = aMover.length === 1 ? "sessão" : "sessões";
  await registrarLog(
    usuario.clinicaId,
    usuario.id,
    "ADIAR",
    `Trouxe ${aMover.length} ${sessaoOuSessoes} de ${paciente.nome} a partir da sessão ${corte.numeroSessao}`
  );

  return NextResponse.json({ adiadas: aMover.length, aPartirDe: corte.numeroSessao });
}
