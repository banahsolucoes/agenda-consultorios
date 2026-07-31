import type { EnviarConfirmacaoAgendaParams } from "@/lib/whatsapp/enviarTemplate";

export type ResultadoEnvio = { ok: true; externalId: string } | { ok: false; erro: string };

// Ponto de indireção entre os call sites e a implementação concreta de envio
// (hoje só a Cloud API da Meta) — assinaturas de parâmetros idênticas às que
// enviarTemplate.ts/enviarMensagem.ts já expõem, só o formato do resultado é
// normalizado (ok/externalId/erro) para não vazar o shape específico de cada
// provider.
export interface WhatsAppProvider {
  readonly suportaTemplate: boolean;
  readonly suportaJanela24h: boolean;
  enviarTemplate(params: EnviarConfirmacaoAgendaParams): Promise<ResultadoEnvio>;
  enviarMensagemLivre(telefoneBruto: string, texto: string): Promise<ResultadoEnvio>;
}
