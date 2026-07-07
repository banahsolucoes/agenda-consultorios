import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { componentesSP } from "@/lib/timezone";
import { registrarLog } from "@/lib/auditoria";
import { obterClinicaECalendar, sincronizarEventoGoogle } from "@/lib/google";

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
  });

  const corte = sessoes.find((s) => s.id === sessaoCorteId);
  if (!corte) {
    return NextResponse.json({ erro: "sessão de corte não encontrada" }, { status: 404 });
  }

  const anteriores = sessoes.filter((s) => s.numeroSessao < corte.numeroSessao);
  const aMover = sessoes.filter((s) => s.numeroSessao >= corte.numeroSessao);

  // Regra de conflito: a sessão de corte recuada 7 dias não pode cair na mesma
  // semana (segunda a domingo) de uma sessão anterior que não será movida.
  // Se colidir, bloqueia a operação inteira — nada é movido.
  const novaSemanaCorte = inicioDaSemana(new Date(corte.inicio.getTime() - 7 * DIA_MS)).getTime();
  const colide = anteriores.some((s) => inicioDaSemana(s.inicio).getTime() === novaSemanaCorte);
  if (colide) {
    return NextResponse.json(
      { erro: "Não é possível adiar: já existe uma sessão nesta semana." },
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

  // Reflete a nova data/hora no Google Calendar de cada sessão movida que
  // tenha evento vinculado. Melhor esforço — busca o client uma única vez
  // para o lote todo, e falha na integração nunca desfaz o que já foi movido.
  const movimentosComEvento = movimentos.filter((mov) => mov.sessao.googleEventId);
  if (movimentosComEvento.length > 0) {
    const google = await obterClinicaECalendar(usuario.clinicaId);
    if (google) {
      for (const mov of movimentosComEvento) {
        await sincronizarEventoGoogle(
          google.calendar,
          mov.sessao.googleCalendarId ?? google.clinica.googleCalendarId ?? "primary",
          mov.sessao.googleEventId!,
          { inicio: mov.novaData, duracaoMin: mov.sessao.duracaoMin }
        );
      }
    }
  }

  const sessaoOuSessoes = aMover.length === 1 ? "sessão" : "sessões";
  await registrarLog(
    usuario.clinicaId,
    usuario.id,
    "ADIAR",
    `Adiou ${aMover.length} ${sessaoOuSessoes} de ${paciente.nome} a partir da sessão ${corte.numeroSessao}`
  );

  return NextResponse.json({ adiadas: aMover.length, aPartirDe: corte.numeroSessao });
}
