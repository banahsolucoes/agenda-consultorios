import { normalizarTelefoneE164 } from "@/lib/whatsapp/telefone";
import { credenciaisEnvio, type CanalWhatsAppResolvido } from "@/lib/whatsapp/canal";

const META_API_VERSION = "v25.0";

export interface EnviarMensagemLivreResultado {
  sucesso: boolean;
  wamid?: string;
  erro?: string;
}

// POST /{phone_number_id}/messages comum aos envios fora de template. Resolve
// telefone e credenciais (sem canal ou canal AGENDA → envs; canal LEAD →
// CanalWhatsApp) e nunca lança. Logs só levam telefone e erro da Meta, nunca
// o token.
async function postarMensagem(
  rotulo: string,
  telefoneBruto: string,
  conteudo: Record<string, unknown>,
  canal?: CanalWhatsAppResolvido
): Promise<EnviarMensagemLivreResultado> {
  const telefoneE164 = normalizarTelefoneE164(telefoneBruto);
  if (!telefoneE164) {
    return { sucesso: false, erro: `telefone fora do padrão E.164: "${telefoneBruto}"` };
  }

  const credenciais = credenciaisEnvio(canal);
  if (!credenciais) {
    return { sucesso: false, erro: "WHATSAPP_PHONE_NUMBER_ID/WHATSAPP_ACCESS_TOKEN não configurados" };
  }
  const { phoneNumberId, accessToken } = credenciais;

  try {
    const resp = await fetch(`https://graph.facebook.com/${META_API_VERSION}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ messaging_product: "whatsapp", to: telefoneE164, ...conteudo }),
    });

    const corpo = await resp.json();

    if (!resp.ok) {
      const erroMeta = corpo?.error;
      console.error(
        `[whatsapp ${rotulo}] falha da API Meta (telefone ${telefoneE164}):`,
        `code=${erroMeta?.code} message=${erroMeta?.message}`
      );
      return { sucesso: false, erro: erroMeta?.message ?? `HTTP ${resp.status}` };
    }

    return { sucesso: true, wamid: corpo?.messages?.[0]?.id };
  } catch (erro) {
    console.error(
      `[whatsapp ${rotulo}] erro de rede (telefone ${telefoneE164}):`,
      erro instanceof Error ? erro.message : "erro desconhecido"
    );
    return { sucesso: false, erro: erro instanceof Error ? erro.message : "erro de rede desconhecido" };
  }
}

// Envia uma mensagem de texto livre (fora do fluxo de template) — só funciona
// dentro da janela de 24h da conversa (regra da Meta), quem chama já deve ter
// checado isso. Não persiste nada — quem chama grava a MensagemWhatsapp.
export async function enviarMensagemLivre(
  telefoneBruto: string,
  texto: string,
  canal?: CanalWhatsAppResolvido
): Promise<EnviarMensagemLivreResultado> {
  return postarMensagem("enviarMensagemLivre", telefoneBruto, { type: "text", text: { body: texto } }, canal);
}

// Mensagem com até 3 botões de resposta rápida (interactive "button"). Limites
// da Meta: corpo até 1024 caracteres, título do botão até 20, ids únicos.
// Quem chama já deve mandar os botões normalizados (ver ia/leadRegras.ts).
// Mesma regra de janela de 24h do texto livre. Não persiste nada.
export async function enviarBotoes(
  telefoneBruto: string,
  texto: string,
  botoes: string[],
  canal?: CanalWhatsAppResolvido
): Promise<EnviarMensagemLivreResultado> {
  return postarMensagem(
    "enviarBotoes",
    telefoneBruto,
    {
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: texto },
        action: {
          buttons: botoes.map((titulo, i) => ({
            type: "reply",
            reply: { id: `btn_${i + 1}`, title: titulo },
          })),
        },
      },
    },
    canal
  );
}

// Marca a mensagem de entrada como lida e mostra "digitando..." para o
// contato (some sozinho ao enviar a próxima mensagem ou em ~25s). Usa as
// credenciais do canal (sem canal = envs). Só loga em caso de falha; quem
// chama não depende do resultado. Timeout de 5s para uma Meta lenta não
// atrasar a resposta.
const DIGITANDO_TIMEOUT_MS = 5000;

export async function enviarDigitando(
  canal: CanalWhatsAppResolvido | undefined,
  messageIdEntrada: string
): Promise<void> {
  const credenciais = credenciaisEnvio(canal);
  if (!credenciais) {
    console.error("[whatsapp enviarDigitando] WHATSAPP_PHONE_NUMBER_ID/WHATSAPP_ACCESS_TOKEN não configurados");
    return;
  }
  try {
    const resp = await fetch(
      `https://graph.facebook.com/${META_API_VERSION}/${credenciais.phoneNumberId}/messages`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${credenciais.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          status: "read",
          message_id: messageIdEntrada,
          typing_indicator: { type: "text" },
        }),
        signal: AbortSignal.timeout(DIGITANDO_TIMEOUT_MS),
      }
    );
    if (!resp.ok) {
      const erroMeta = (await resp.json().catch(() => null))?.error;
      console.error(
        "[whatsapp enviarDigitando] falha da API Meta:",
        `status=${resp.status} code=${erroMeta?.code} message=${erroMeta?.message}`
      );
    }
  } catch (erro) {
    console.error(
      "[whatsapp enviarDigitando] erro de rede:",
      erro instanceof Error ? erro.message : "erro desconhecido"
    );
  }
}

// Documento por link público (a Meta baixa o arquivo da URL). Mesma regra de
// janela de 24h. Não persiste nada.
export async function enviarDocumento(
  telefoneBruto: string,
  link: string,
  filename: string,
  canal?: CanalWhatsAppResolvido
): Promise<EnviarMensagemLivreResultado> {
  return postarMensagem("enviarDocumento", telefoneBruto, { type: "document", document: { link, filename } }, canal);
}
