import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { getProvider } from "@/lib/whatsapp/provider";

// POST /api/integracoes/google/avisar-responsavel — botão "Avisar
// responsável" do popup global de reconexão, pra quem NÃO tem
// gerirIntegracoes (não pode reconectar, só sinalizar). Reaproveita o único
// canal de notificação humana já existente no sistema, independente do
// Google: WhatsApp Cloud API pra WHATSAPP_TELEFONE_NOTIFICACAO_HUMANO —
// mesmo mecanismo/env var de notificarHandoffHumano()
// (src/lib/ia/responderWhatsapp.ts). Não exige gerirIntegracoes — é
// justamente pra quem não tem.
export async function POST() {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });

  const numeroHumano = process.env.WHATSAPP_TELEFONE_NOTIFICACAO_HUMANO;
  if (!numeroHumano) {
    return NextResponse.json(
      { erro: "nenhum canal de notificação configurado — avise o responsável diretamente" },
      { status: 501 }
    );
  }

  const clinica = await prisma.clinica.findUnique({ where: { id: usuario.clinicaId }, select: { nome: true } });

  const texto =
    `⚠️ Conexão Google caiu\n` +
    `Clínica: ${clinica?.nome ?? usuario.clinicaId}\n` +
    `Avisado por: ${usuario.nome}\n` +
    `É preciso reconectar em Configurações → Integrações.`;

  // enviarMensagemLivre só entrega dentro da janela de 24h aberta com esse
  // número (regra da Meta) — mesma limitação que notificarHandoffHumano já
  // aceita hoje; falha aqui vira erro explícito pro operador, não silêncio.
  const resultado = await getProvider().enviarMensagemLivre(numeroHumano, texto);
  if (!resultado.ok) {
    return NextResponse.json({ erro: resultado.erro || "falha ao enviar notificação" }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
