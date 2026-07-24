import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { pode } from "@/lib/permissoes";
import { enviarMensagemLivre } from "@/lib/whatsapp/enviarMensagem";

// POST /api/whatsapp/conversas/[id]/enviar — envio manual (inbox) de uma
// mensagem de texto livre. Só funciona dentro da janela de 24h da Meta
// (mesma regra do envio automático) — fora dela, erro claro em vez de
// tentar e falhar sem explicação.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  if (!pode(usuario.papel, "atenderWhatsapp")) {
    return NextResponse.json({ erro: "sem permissão" }, { status: 403 });
  }

  const { id } = await ctx.params;
  const body = await req.json().catch(() => null);
  const texto = typeof body?.texto === "string" ? body.texto.trim() : "";
  if (!texto) return NextResponse.json({ erro: "texto obrigatório" }, { status: 400 });

  const conversa = await prisma.conversaWhatsapp.findUnique({ where: { id } });
  if (!conversa || conversa.clinicaId !== usuario.clinicaId) {
    return NextResponse.json({ erro: "conversa não encontrada" }, { status: 404 });
  }

  if (!conversa.janelaAbertaAte || conversa.janelaAbertaAte.getTime() < Date.now()) {
    return NextResponse.json(
      { erro: "Janela de 24h fechada — o paciente precisa mandar uma mensagem antes de você poder responder." },
      { status: 409 }
    );
  }

  const resultado = await enviarMensagemLivre(conversa.telefone, texto);
  if (!resultado.sucesso) {
    return NextResponse.json({ erro: resultado.erro ?? "falha ao enviar mensagem" }, { status: 502 });
  }

  const agora = new Date();
  await prisma.conversaWhatsapp.update({
    where: { id },
    data: {
      ultimaMensagemEm: agora,
      // Envio manual de um humano é, por definição, atendimento acontecendo
      // — reseta o estado de "aguardando_humano" pra "aberta" (Daiane já
      // respondeu, não está mais esperando ninguém pegar a conversa).
      estado: conversa.estado === "aguardando_humano" ? "aberta" : conversa.estado,
    },
  });

  const mensagem = await prisma.mensagemWhatsapp.create({
    data: {
      conversaId: id,
      direcao: "saida",
      texto,
      tipo: "livre",
      respondidaPorIa: false,
      wamid: resultado.wamid ?? null,
    },
  });

  return NextResponse.json(mensagem, { status: 201 });
}
