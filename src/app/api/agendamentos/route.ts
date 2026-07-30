import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });

  const pacienteId = req.nextUrl.searchParams.get("pacienteId");
  if (!pacienteId) {
    return NextResponse.json({ erro: "pacienteId é obrigatório" }, { status: 400 });
  }

  const paciente = await prisma.paciente.findUnique({ where: { id: pacienteId } });
  if (!paciente || paciente.clinicaId !== usuario.clinicaId) {
    return NextResponse.json({ erro: "paciente não encontrado" }, { status: 404 });
  }

  const sessoes = await prisma.agendamento.findMany({
    // Sessão arquivada some do cadastro do paciente — continua no banco
    // para histórico/auditoria, só não é mais exibida.
    where: { pacienteId, arquivada: false },
    include: { tipoSessao: { select: { nome: true, ehAtendimentoUnico: true } } },
    orderBy: { numeroSessao: "asc" },
  });
  return NextResponse.json(sessoes);
}
