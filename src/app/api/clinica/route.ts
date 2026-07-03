import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";

// Campos que podem ser alterados pela tela de Configurações
const CAMPOS_EDITAVEIS = [
  "nome",
  "logo",
  "corPrimaria",
  "corSecundaria",
  "duracaoPadraoMin",
  "nomeAssistente",
  "horarioLimiteConfirmacao",
] as const;

// GET /api/clinica — dados gerais da clínica do usuário logado
export async function GET() {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });

  const clinica = await prisma.clinica.findUnique({ where: { id: usuario.clinicaId } });
  if (!clinica) return NextResponse.json({ erro: "clínica não encontrada" }, { status: 404 });

  return NextResponse.json(clinica);
}

// PATCH /api/clinica — atualiza dados gerais/white-label da clínica do usuário logado
export async function PATCH(req: NextRequest) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });

  const body = await req.json();
  const data: Record<string, unknown> = {};
  for (const campo of CAMPOS_EDITAVEIS) {
    if (body[campo] !== undefined) data[campo] = body[campo];
  }

  if (data.duracaoPadraoMin !== undefined) {
    data.duracaoPadraoMin = Number(data.duracaoPadraoMin);
  }

  const clinica = await prisma.clinica.update({
    where: { id: usuario.clinicaId },
    data,
  });

  return NextResponse.json(clinica);
}
