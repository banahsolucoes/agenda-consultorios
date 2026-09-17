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

  const clinica = await prisma.clinica.findUnique({
    where: { id: usuario.clinicaId },
    select: { nome: true, conversasWhatsapp: { take: 1, select: { id: true } } },
  });

  // Clínica sem WhatsApp configurado (2026-09-17, ver
  // docs/auditorias/auditoria-onboarding.md item 6 — mesmo critério do
  // cron/whatsapp-lembretes: nenhuma ConversaWhatsapp gravada ainda):
  // WHATSAPP_TELEFONE_NOTIFICACAO_HUMANO é global, mas o número que de fato
  // envia é o mesmo canal single-tenant — não faz sentido notificar por lá
  // em nome de uma clínica que nunca usou WhatsApp nenhum. Sucesso
  // silencioso (não é erro do usuário, só não há o que fazer).
  if (!clinica || clinica.conversasWhatsapp.length === 0) {
    console.log(
      `[avisar-responsavel] clínica ${usuario.clinicaId} sem WhatsApp configurado — notificação não enviada`
    );
    return NextResponse.json({ ok: true });
  }

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
