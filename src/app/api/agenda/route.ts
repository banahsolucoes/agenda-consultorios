import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";

// GET /api/agenda?inicio=ISO&fim=ISO — sessões de TODOS os pacientes da
// clínica logada dentro do intervalo, para a visão de calendário (Tarefa 16).
export async function GET(req: NextRequest) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });

  const inicioStr = req.nextUrl.searchParams.get("inicio");
  const fimStr = req.nextUrl.searchParams.get("fim");
  if (!inicioStr || !fimStr) {
    return NextResponse.json({ erro: "inicio e fim são obrigatórios" }, { status: 400 });
  }

  const inicio = new Date(inicioStr);
  const fim = new Date(fimStr);
  if (isNaN(inicio.getTime()) || isNaN(fim.getTime())) {
    return NextResponse.json({ erro: "inicio e fim devem ser datas ISO válidas" }, { status: 400 });
  }

  const sessoes = await prisma.agendamento.findMany({
    where: {
      paciente: { clinicaId: usuario.clinicaId },
      inicio: { gte: inicio, lte: fim },
      // Sessão cancelada some do calendário visual (a profissional acompanha
      // pelo Google Agenda no celular, que só deve refletir sessões ativas);
      // o histórico continua no banco e visível no painel do paciente.
      status: { not: "CANCELADA" },
    },
    include: {
      paciente: { select: { id: true, nome: true } },
      tipoSessao: { select: { id: true, nome: true, cor: true } },
    },
    orderBy: { inicio: "asc" },
  });

  return NextResponse.json(sessoes);
}
