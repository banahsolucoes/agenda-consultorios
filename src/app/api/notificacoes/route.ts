import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";

// GET /api/notificacoes — pendências para o sino do painel: sessões reagendadas
// aguardando novo horário e tarefas pendentes já visíveis (sem aviso futuro).
export async function GET() {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });

  const agora = new Date();

  const [reagendadas, tarefas] = await Promise.all([
    prisma.agendamento.findMany({
      where: { status: "REAGENDADA", paciente: { clinicaId: usuario.clinicaId } },
      include: { paciente: { select: { id: true, nome: true } } },
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
  ]);

  return NextResponse.json({ reagendadas, tarefas });
}
