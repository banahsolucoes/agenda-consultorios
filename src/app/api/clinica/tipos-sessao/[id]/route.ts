import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";

const COR_REGEX = /^#[0-9a-fA-F]{6}$/;

// PATCH /api/clinica/tipos-sessao/:id — atualiza um tipo de sessão da clínica do usuário logado
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });

  const { id } = await ctx.params;
  const tipo = await prisma.tipoSessao.findUnique({ where: { id } });
  if (!tipo || tipo.clinicaId !== usuario.clinicaId) {
    return NextResponse.json({ erro: "tipo de atendimento não encontrado" }, { status: 404 });
  }

  const body = await req.json();
  const data: Record<string, unknown> = {};

  if (body.nome !== undefined) {
    if (!body.nome) return NextResponse.json({ erro: "nome não pode ser vazio" }, { status: 400 });
    data.nome = body.nome;
  }
  if (body.cor !== undefined) {
    if (body.cor && !COR_REGEX.test(body.cor)) {
      return NextResponse.json({ erro: "cor deve estar no formato #rrggbb" }, { status: 400 });
    }
    data.cor = body.cor || null;
  }
  if (body.duracaoPadraoMin !== undefined) {
    const duracaoPadraoMin = Number(body.duracaoPadraoMin);
    if (!Number.isInteger(duracaoPadraoMin) || duracaoPadraoMin < 1) {
      return NextResponse.json({ erro: "duracaoPadraoMin deve ser um inteiro positivo" }, { status: 400 });
    }
    data.duracaoPadraoMin = duracaoPadraoMin;
  }
  if (body.ehOnline !== undefined) {
    data.ehOnline = Boolean(body.ehOnline);
  }
  if (body.ehAtendimentoUnico !== undefined) {
    data.ehAtendimentoUnico = Boolean(body.ehAtendimentoUnico);
  }
  if (body.valor !== undefined) {
    data.valor = body.valor !== null && body.valor !== "" ? String(body.valor) : null;
  }

  const atualizado = await prisma.tipoSessao.update({ where: { id }, data });
  return NextResponse.json(atualizado);
}

// DELETE /api/clinica/tipos-sessao/:id — remove um tipo de sessão, se não estiver em uso
export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });

  const { id } = await ctx.params;
  const tipo = await prisma.tipoSessao.findUnique({ where: { id } });
  if (!tipo || tipo.clinicaId !== usuario.clinicaId) {
    return NextResponse.json({ erro: "tipo de atendimento não encontrado" }, { status: 404 });
  }

  const [pacientesVinculados, agendamentosVinculados] = await Promise.all([
    prisma.paciente.count({ where: { tipoSessaoId: id } }),
    prisma.agendamento.count({ where: { tipoSessaoId: id } }),
  ]);
  if (pacientesVinculados > 0 || agendamentosVinculados > 0) {
    return NextResponse.json(
      { erro: "não é possível remover: há pacientes ou sessões usando este tipo de atendimento" },
      { status: 409 }
    );
  }

  await prisma.tipoSessao.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
