import { enviarConfirmacaoAgenda } from "@/lib/whatsapp/enviarTemplate";
import { enviarMensagemLivre } from "@/lib/whatsapp/enviarMensagem";
import type { ResultadoEnvio, WhatsAppProvider } from "./types";

// Apenas delega para as funções concretas existentes (enviarTemplate.ts /
// enviarMensagem.ts) — nenhuma lógica de envio é reescrita aqui, só a
// tradução do resultado { sucesso, wamid, erro } para { ok, externalId, erro }.
function paraResultadoEnvio(resultado: { sucesso: boolean; wamid?: string; erro?: string }): ResultadoEnvio {
  if (resultado.sucesso) {
    return { ok: true, externalId: resultado.wamid ?? "" };
  }
  return { ok: false, erro: resultado.erro ?? "falha desconhecida" };
}

export const cloudApiProvider: WhatsAppProvider = {
  suportaTemplate: true,
  suportaJanela24h: true,

  async enviarTemplate(params) {
    const resultado = await enviarConfirmacaoAgenda(params);
    return paraResultadoEnvio(resultado);
  },

  async enviarMensagemLivre(telefoneBruto, texto) {
    const resultado = await enviarMensagemLivre(telefoneBruto, texto);
    return paraResultadoEnvio(resultado);
  },
};
