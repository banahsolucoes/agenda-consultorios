import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { pode } from "@/lib/permissoes";

// GET /api/whatsapp/conversas/[id]/mensagens — histórico completo da
// conversa, ordem cronológica (mais antiga primeiro, como um chat).
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  if (!pode(usuario.papel, "atenderWhatsapp")) {
    return NextResponse.json({ erro: "sem permissão" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const conversa = await prisma.conversaWhatsapp.findUnique({
    where: { id },
    select: { clinicaId: true },
  });
  if (!conversa || conversa.clinicaId !== usuario.clinicaId) {
    return NextResponse.json({ erro: "conversa não encontrada" }, { status: 404 });
  }

  const mensagens = await prisma.mensagemWhatsapp.findMany({
    where: { conversaId: id },
    orderBy: { criadoEm: "asc" },
    select: { id: true, direcao: true, texto: true, tipo: true, respondidaPorIa: true, criadoEm: true },
  });

  return NextResponse.json(mensagens);
}
