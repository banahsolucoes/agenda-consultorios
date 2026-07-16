import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { registrarLog } from "@/lib/auditoria";
import { dataEhFutura } from "@/lib/validacaoSessao";

// POST /api/pacientes/[id]/reverter-futuras — corrige sessões futuras que
// foram marcadas incorretamente como Realizada/Não realizada, revertendo
// para Agendada. Mesma gravação de status usada em src/app/api/sessoes/[id]/route.ts
// (branch de status individual): não sincroniza nada no Google Calendar,
// porque nenhuma transição de status sincroniza — comportamento simétrico ao
// que já existe hoje.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });

  const { id: pacienteId } = await ctx.params;
  const paciente = await prisma.paciente.findUnique({ where: { id: pacienteId } });
  if (!paciente || paciente.clinicaId !== usuario.clinicaId) {
    return NextResponse.json({ erro: "paciente não encontrado" }, { status: 404 });
  }

  const candidatas = await prisma.agendamento.findMany({
    where: { pacienteId, status: { in: ["REALIZADA", "NAO_REALIZADA"] } },
    orderBy: { numeroSessao: "asc" },
  });
  const aReverter = candidatas.filter((s) => dataEhFutura(s.inicio));

  if (aReverter.length === 0) {
    return NextResponse.json({ revertidas: 0, sessoes: [] });
  }

  await prisma.$transaction(
    aReverter.map((s) => prisma.agendamento.update({ where: { id: s.id }, data: { status: "AGENDADA" } }))
  );

  const numeros = aReverter.map((s) => s.numeroSessao).join(", ");
  await registrarLog(
    usuario.clinicaId,
    usuario.id,
    "REVERTER_SESSOES_FUTURAS",
    `Reverteu ${aReverter.length} sessão(ões) futura(s) de ${paciente.nome} para Agendada (sessões: ${numeros})`
  );

  return NextResponse.json({
    revertidas: aReverter.length,
    sessoes: aReverter.map((s) => ({ id: s.id, numeroSessao: s.numeroSessao })),
  });
}
