import { normalizarTelefoneE164 } from "@/lib/whatsapp/telefone";

const META_API_VERSION = "v25.0";

export interface EnviarMensagemLivreResultado {
  sucesso: boolean;
  wamid?: string;
  erro?: string;
}

// Envia uma mensagem de texto livre (fora do fluxo de template) — só funciona
// dentro da janela de 24h da conversa (regra da Meta), quem chama já deve ter
// checado isso. Não persiste nada — quem chama grava a MensagemWhatsapp.
export async function enviarMensagemLivre(
  telefoneBruto: string,
  texto: string
): Promise<EnviarMensagemLivreResultado> {
  const telefoneE164 = normalizarTelefoneE164(telefoneBruto);
  if (!telefoneE164) {
    return { sucesso: false, erro: `telefone fora do padrão E.164: "${telefoneBruto}"` };
  }

  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneNumberId || !accessToken) {
    return { sucesso: false, erro: "WHATSAPP_PHONE_NUMBER_ID/WHATSAPP_ACCESS_TOKEN não configurados" };
  }

  try {
    const resp = await fetch(`https://graph.facebook.com/${META_API_VERSION}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: telefoneE164,
        type: "text",
        text: { body: texto },
      }),
    });

    const corpo = await resp.json();

    if (!resp.ok) {
      const erroMeta = corpo?.error;
      console.error(
        `[whatsapp enviarMensagemLivre] falha da API Meta (telefone ${telefoneE164}):`,
        `code=${erroMeta?.code} message=${erroMeta?.message}`
      );
      return { sucesso: false, erro: erroMeta?.message ?? `HTTP ${resp.status}` };
    }

    return { sucesso: true, wamid: corpo?.messages?.[0]?.id };
  } catch (erro) {
    console.error(`[whatsapp enviarMensagemLivre] erro de rede (telefone ${telefoneE164}):`, erro);
    return { sucesso: false, erro: erro instanceof Error ? erro.message : "erro de rede desconhecido" };
  }
}
