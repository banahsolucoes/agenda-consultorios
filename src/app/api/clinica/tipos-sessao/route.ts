import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";

const COR_REGEX = /^#[0-9a-fA-F]{6}$/;

// GET /api/clinica/tipos-sessao — lista os tipos de sessão da clínica do usuário logado
export async function GET() {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });

  const tipos = await prisma.tipoSessao.findMany({
    where: { clinicaId: usuario.clinicaId },
    orderBy: { criadoEm: "asc" },
  });

  return NextResponse.json(tipos);
}

// POST /api/clinica/tipos-sessao — cria um tipo de sessão para a clínica do usuário logado
export async function POST(req: NextRequest) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });

  const body = await req.json();

  if (!body.nome || typeof body.nome !== "string") {
    return NextResponse.json({ erro: "nome é obrigatório" }, { status: 400 });
  }
  if (body.cor && !COR_REGEX.test(body.cor)) {
    return NextResponse.json({ erro: "cor deve estar no formato #rrggbb" }, { status: 400 });
  }
  const duracaoPadraoMin = body.duracaoPadraoMin !== undefined ? Number(body.duracaoPadraoMin) : 45;
  if (!Number.isInteger(duracaoPadraoMin) || duracaoPadraoMin < 1) {
    return NextResponse.json({ erro: "duracaoPadraoMin deve ser um inteiro positivo" }, { status: 400 });
  }

  const tipo = await prisma.tipoSessao.create({
    data: {
      clinicaId: usuario.clinicaId,
      nome: body.nome,
      cor: body.cor ?? null,
      duracaoPadraoMin,
      ehOnline: Boolean(body.ehOnline),
      ehAtendimentoUnico: Boolean(body.ehAtendimentoUnico),
      valor: body.valor !== undefined && body.valor !== null && body.valor !== "" ? String(body.valor) : null,
    },
  });

  return NextResponse.json(tipo, { status: 201 });
}
