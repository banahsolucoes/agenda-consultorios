import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";

// GET /api/notificacoes — pendências para o sino do painel: sessões reagendadas
// aguardando novo horário e pacientes finalizados aguardando renovação de pacote.
export async function GET() {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });

  const ha30Dias = new Date();
  ha30Dias.setDate(ha30Dias.getDate() - 30);

  const [reagendadas, finalizados] = await Promise.all([
    prisma.agendamento.findMany({
      where: { status: "REAGENDADA", paciente: { clinicaId: usuario.clinicaId } },
      include: { paciente: { select: { id: true, nome: true } } },
      orderBy: { inicio: "asc" },
    }),
    prisma.paciente.findMany({
      where: {
        clinicaId: usuario.clinicaId,
        statusGeral: "FINALIZADO",
        finalizadoEm: { gte: ha30Dias },
      },
      select: { id: true, nome: true, finalizadoEm: true },
      orderBy: { finalizadoEm: "desc" },
    }),
  ]);

  return NextResponse.json({ reagendadas, finalizados });
}
