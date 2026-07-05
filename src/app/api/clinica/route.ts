import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { extrairIdPastaDrive } from "@/lib/validacao";

// Campos que podem ser alterados pela tela de Configurações
const CAMPOS_EDITAVEIS = [
  "nome",
  "logo",
  "corPrimaria",
  "corSecundaria",
  "duracaoPadraoMin",
  "nomeAssistente",
  "horarioLimiteConfirmacao",
  "pastaRaizDriveId",
  "emailBoasVindasAssunto",
  "emailBoasVindasCorpo",
] as const;

const SELECT_CLINICA = {
  id: true,
  nome: true,
  slug: true,
  logo: true,
  corPrimaria: true,
  corSecundaria: true,
  duracaoPadraoMin: true,
  nomeAssistente: true,
  horarioLimiteConfirmacao: true,
  criadoEm: true,
  googleConectado: true,
  googleCalendarId: true,
  pastaRaizDriveId: true,
  emailBoasVindasAssunto: true,
  emailBoasVindasCorpo: true,
} as const;

// GET /api/clinica — dados gerais da clínica do usuário logado
// (tokens do Google ficam de fora da resposta — não devem sair do servidor)
export async function GET() {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });

  const clinica = await prisma.clinica.findUnique({
    where: { id: usuario.clinicaId },
    select: SELECT_CLINICA,
  });
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

  if (data.emailBoasVindasAssunto !== undefined && !data.emailBoasVindasAssunto) {
    return NextResponse.json({ erro: "emailBoasVindasAssunto não pode ser vazio" }, { status: 400 });
  }
  if (data.emailBoasVindasCorpo !== undefined && !data.emailBoasVindasCorpo) {
    return NextResponse.json({ erro: "emailBoasVindasCorpo não pode ser vazio" }, { status: 400 });
  }

  // Aceita o operador colar tanto um link do Drive quanto já o próprio ID da
  // pasta-mãe — sempre normaliza e guarda só o ID.
  if (typeof data.pastaRaizDriveId === "string") {
    data.pastaRaizDriveId = data.pastaRaizDriveId ? extrairIdPastaDrive(data.pastaRaizDriveId) : null;
  }

  const clinica = await prisma.clinica.update({
    where: { id: usuario.clinicaId },
    data,
    select: SELECT_CLINICA,
  });

  return NextResponse.json(clinica);
}
