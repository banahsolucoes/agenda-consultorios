import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";

// GET /api/sessoes/[id]/irmas-futuras — quantas sessões seguintes do mesmo
// pacote ainda são elegíveis para o escopo ESTA_E_FUTURAS do move (mesmos
// critérios do branch ESTA_E_FUTURAS em sessoes/[id]/route.ts: mesmo
// pacoteId, numeroSessao maior, status AGENDADA, não arquivada). Só leitura
// — usado pelo front pra decidir se pergunta o escopo antes de mover.
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });

  const { id } = await ctx.params;
  const sessao = await prisma.agendamento.findUnique({
    where: { id },
    include: { paciente: true },
  });
  if (!sessao || sessao.paciente.clinicaId !== usuario.clinicaId) {
    return NextResponse.json({ erro: "sessão não encontrada" }, { status: 404 });
  }

  const quantidade = await prisma.agendamento.count({
    where: {
      pacoteId: sessao.pacoteId,
      numeroSessao: { gt: sessao.numeroSessao },
      status: "AGENDADA",
      arquivada: false,
    },
  });

  return NextResponse.json({ temFuturas: quantidade > 0, quantidade });
}
