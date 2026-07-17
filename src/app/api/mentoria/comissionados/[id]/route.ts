import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { registrarLog } from "@/lib/auditoria";
import { exigirAcessoMentoria } from "@/lib/mentoria";

const PAPEIS_COMISSAO = ["SELLER", "CLOSER", "PRODUTOR"];
const FORMAS_RECEBIMENTO = ["ADIANTADO", "POR_PARCELA"];

// PATCH /api/mentoria/comissionados/[id] — edita o cadastro do comissionado
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  const erroAcesso = await exigirAcessoMentoria(usuario);
  if (erroAcesso) return erroAcesso;

  const { id } = await ctx.params;
  const comissionado = await prisma.comissionado.findUnique({ where: { id } });
  if (!comissionado || comissionado.clinicaId !== usuario.clinicaId) {
    return NextResponse.json({ erro: "comissionado não encontrado" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ erro: "corpo da requisição inválido" }, { status: 400 });

  if (body.nome !== undefined && (!body.nome || typeof body.nome !== "string")) {
    return NextResponse.json({ erro: "nome não pode ser vazio" }, { status: 400 });
  }
  if (body.papelPadrao !== undefined && body.papelPadrao !== null && !PAPEIS_COMISSAO.includes(body.papelPadrao)) {
    return NextResponse.json({ erro: "papelPadrao inválido" }, { status: 400 });
  }
  if (
    body.percentualComissao !== undefined &&
    (typeof body.percentualComissao !== "number" || !(body.percentualComissao > 0) || body.percentualComissao > 1)
  ) {
    return NextResponse.json(
      { erro: "percentualComissao deve ser um número maior que zero e menor ou igual a 1" },
      { status: 400 }
    );
  }
  if (body.formaRecebimento !== undefined && !FORMAS_RECEBIMENTO.includes(body.formaRecebimento)) {
    return NextResponse.json({ erro: "formaRecebimento inválido" }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (body.nome !== undefined) data.nome = body.nome;
  if (body.email !== undefined) data.email = body.email || null;
  if (body.telefone !== undefined) data.telefone = body.telefone || null;
  if (body.papelPadrao !== undefined) data.papelPadrao = body.papelPadrao;
  if (body.ativo !== undefined) data.ativo = Boolean(body.ativo);
  if (body.percentualComissao !== undefined) data.percentualComissao = body.percentualComissao;
  if (body.formaRecebimento !== undefined) data.formaRecebimento = body.formaRecebimento;

  const camposAlterados = Object.keys(data);
  if (camposAlterados.length === 0) {
    return NextResponse.json({ erro: "nenhum campo para atualizar" }, { status: 400 });
  }

  const atualizado = await prisma.comissionado.update({ where: { id }, data });

  await registrarLog(
    usuario.clinicaId,
    usuario.id,
    "EDITAR_COMISSIONADO_MENTORIA",
    `Editou o comissionado ${atualizado.nome} (campos: ${camposAlterados.join(", ")})`
  );

  return NextResponse.json(atualizado);
}
