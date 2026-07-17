import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { registrarLog } from "@/lib/auditoria";
import { exigirAcessoMentoria } from "@/lib/mentoria";

// PATCH /api/mentoria/comissoes/[id] — troca o status entre PENDENTE e PAGO.
// ESTORNADO não é permitido por esta rota (só via distrato, fora desta fase).
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  const erroAcesso = await exigirAcessoMentoria(usuario);
  if (erroAcesso) return erroAcesso;

  const { id } = await ctx.params;
  const comissao = await prisma.mentoriaComissao.findUnique({ where: { id } });
  if (!comissao || comissao.clinicaId !== usuario.clinicaId) {
    return NextResponse.json({ erro: "comissão não encontrada" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  if (!body || (body.status !== "PAGO" && body.status !== "PENDENTE")) {
    return NextResponse.json({ erro: "status deve ser PAGO ou PENDENTE" }, { status: 400 });
  }
  if (comissao.status === "ESTORNADO") {
    return NextResponse.json({ erro: "comissão estornada não pode ter o status alterado por esta rota" }, { status: 409 });
  }

  const atualizada = await prisma.mentoriaComissao.update({
    where: { id },
    data: {
      status: body.status,
      dataPagamento: body.status === "PAGO" ? new Date() : null,
    },
  });

  await registrarLog(
    usuario.clinicaId,
    usuario.id,
    "ALTERAR_STATUS_COMISSAO_MENTORIA",
    `Alterou o status da comissão ${id} para ${body.status}`
  );

  return NextResponse.json(atualizada);
}

// DELETE /api/mentoria/comissoes/[id] — remove o vínculo, só se ainda PENDENTE
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  const erroAcesso = await exigirAcessoMentoria(usuario);
  if (erroAcesso) return erroAcesso;

  const { id } = await ctx.params;
  const comissao = await prisma.mentoriaComissao.findUnique({ where: { id } });
  if (!comissao || comissao.clinicaId !== usuario.clinicaId) {
    return NextResponse.json({ erro: "comissão não encontrada" }, { status: 404 });
  }
  if (comissao.status !== "PENDENTE") {
    return NextResponse.json({ erro: "só é possível remover uma comissão pendente" }, { status: 409 });
  }

  await prisma.mentoriaComissao.delete({ where: { id } });

  await registrarLog(usuario.clinicaId, usuario.id, "REMOVER_COMISSAO_MENTORIA", `Removeu a comissão ${id}`);

  return NextResponse.json({ ok: true });
}
