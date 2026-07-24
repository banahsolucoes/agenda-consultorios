import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { pode } from "@/lib/permissoes";

// GET /api/whatsapp/conversas — lista as conversas da clínica logada, mais
// recentes primeiro, com nome do paciente (quando vinculado) e a última
// mensagem pra preview na lista do inbox.
export async function GET() {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  if (!pode(usuario.papel, "atenderWhatsapp")) {
    return NextResponse.json({ erro: "sem permissão" }, { status: 403 });
  }

  const conversas = await prisma.conversaWhatsapp.findMany({
    where: { clinicaId: usuario.clinicaId },
    include: {
      paciente: { select: { nome: true } },
      mensagens: { orderBy: { criadoEm: "desc" }, take: 1 },
    },
    orderBy: { ultimaMensagemEm: "desc" },
  });

  return NextResponse.json(
    conversas.map((c) => ({
      id: c.id,
      telefone: c.telefone,
      estado: c.estado,
      janelaAbertaAte: c.janelaAbertaAte,
      pacienteNome: c.paciente?.nome ?? null,
      ultimaMensagemEm: c.ultimaMensagemEm,
      ultimaMensagem: c.mensagens[0]
        ? { texto: c.mensagens[0].texto, direcao: c.mensagens[0].direcao }
        : null,
    }))
  );
}
