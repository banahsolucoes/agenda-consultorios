import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { registrarLog } from "@/lib/auditoria";
import { exigirAcessoMentoria } from "@/lib/mentoria";

const PAPEIS_COMISSAO = ["SELLER", "CLOSER", "PRODUTOR"];
const FORMAS_RECEBIMENTO = ["ADIANTADO", "POR_PARCELA"];

// GET /api/mentoria/comissionados — lista os comissionados da clínica logada
export async function GET() {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  const erroAcesso = await exigirAcessoMentoria(usuario);
  if (erroAcesso) return erroAcesso;

  const comissionados = await prisma.comissionado.findMany({
    where: { clinicaId: usuario.clinicaId },
    orderBy: { nome: "asc" },
  });

  return NextResponse.json(comissionados);
}

// POST /api/mentoria/comissionados — cadastra comissionado na clínica logada
export async function POST(req: NextRequest) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  const erroAcesso = await exigirAcessoMentoria(usuario);
  if (erroAcesso) return erroAcesso;

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ erro: "corpo da requisição inválido" }, { status: 400 });

  if (!body.nome || typeof body.nome !== "string") {
    return NextResponse.json({ erro: "nome é obrigatório" }, { status: 400 });
  }
  if (body.papelPadrao !== undefined && body.papelPadrao !== null && !PAPEIS_COMISSAO.includes(body.papelPadrao)) {
    return NextResponse.json({ erro: "papelPadrao inválido" }, { status: 400 });
  }
  if (typeof body.percentualComissao !== "number" || !(body.percentualComissao > 0) || body.percentualComissao > 1) {
    return NextResponse.json(
      { erro: "percentualComissao é obrigatório e deve ser um número maior que zero e menor ou igual a 1" },
      { status: 400 }
    );
  }
  if (body.formaRecebimento !== undefined && !FORMAS_RECEBIMENTO.includes(body.formaRecebimento)) {
    return NextResponse.json({ erro: "formaRecebimento inválido" }, { status: 400 });
  }

  const comissionado = await prisma.comissionado.create({
    data: {
      clinicaId: usuario.clinicaId, // vem do login, não do request
      nome: body.nome,
      email: body.email ?? null,
      telefone: body.telefone ?? null,
      papelPadrao: body.papelPadrao ?? null,
      ativo: body.ativo === undefined ? true : Boolean(body.ativo),
      percentualComissao: body.percentualComissao,
      formaRecebimento: body.formaRecebimento ?? "POR_PARCELA",
    },
  });

  await registrarLog(
    usuario.clinicaId,
    usuario.id,
    "CRIAR_COMISSIONADO_MENTORIA",
    `Cadastrou o comissionado ${comissionado.nome}`
  );

  return NextResponse.json(comissionado, { status: 201 });
}
