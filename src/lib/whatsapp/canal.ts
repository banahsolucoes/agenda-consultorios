import { normalizarTelefoneE164 } from "@/lib/whatsapp/telefone";

// Roteamento do WhatsApp por número (2026-11-06) — ver ARCHITECTURE.md §10.13.
//
// "Canal" = por qual número/credencial a mensagem entrou (e por qual sai):
//   - AGENDA: número global das envs WHATSAPP_PHONE_NUMBER_ID/WHATSAPP_ACCESS_TOKEN.
//   - LEAD: número conectado pela clínica via Embedded Signup (CanalWhatsApp, ativo=true).
// "Modo" = qual fluxo trata a mensagem (AGENDA = confirmação/IA/handoff; LEAD =
// atendimento de lead). Canal LEAD sempre roda modo LEAD; canal AGENDA roda modo
// AGENDA, exceto para remetentes listados em WHATSAPP_LEAD_TESTE_NUMEROS.
//
// Arquivo sem Prisma de propósito: só regras puras, testáveis sem banco.

export type CanalWhatsAppResolvido =
  | { tipo: "AGENDA" }
  | {
      tipo: "LEAD";
      canalId: string;
      clinicaId: string;
      phoneNumberId: string;
      accessToken: string; // nunca logar
    };

export type ModoAtendimento = "AGENDA" | "LEAD";

export interface RegistroCanalWhatsApp {
  id: string;
  clinicaId: string;
  phoneNumberId: string;
  accessToken: string;
  ativo: boolean;
}

// Decide o canal a partir do phone_number_id do payload (value.metadata). O
// registro é o CanalWhatsApp com esse phoneNumberId (ou null se não existir).
// Retorna null para número desconhecido ou canal inativo, e quem chama não
// processa a mensagem. O número da env tem prioridade sobre a tabela.
export function classificarCanal(
  phoneNumberId: string,
  envPhoneNumberId: string | undefined,
  registro: RegistroCanalWhatsApp | null
): CanalWhatsAppResolvido | null {
  if (envPhoneNumberId && phoneNumberId === envPhoneNumberId) return { tipo: "AGENDA" };
  if (registro && registro.phoneNumberId === phoneNumberId && registro.ativo) {
    return {
      tipo: "LEAD",
      canalId: registro.id,
      clinicaId: registro.clinicaId,
      phoneNumberId: registro.phoneNumberId,
      accessToken: registro.accessToken,
    };
  }
  return null;
}

// WHATSAPP_LEAD_TESTE_NUMEROS: lista separada por vírgula, E.164 sem "+".
// Cada item passa por normalizarTelefoneE164 (o mesmo do remetente); itens
// inválidos são ignorados.
export function parseNumerosTeste(valorEnv: string | undefined): Set<string> {
  const numeros = new Set<string>();
  for (const item of (valorEnv ?? "").split(",")) {
    const normalizado = item.trim() ? normalizarTelefoneE164(item) : null;
    if (normalizado) numeros.add(normalizado);
  }
  return numeros;
}

export function ehNumeroTesteLead(telefone: string, numerosTeste: Set<string>): boolean {
  const normalizado = normalizarTelefoneE164(telefone);
  return normalizado !== null && numerosTeste.has(normalizado);
}

export function decidirModo(
  canal: CanalWhatsAppResolvido,
  telefoneRemetente: string,
  numerosTeste: Set<string>
): ModoAtendimento {
  if (canal.tipo === "LEAD") return "LEAD";
  return ehNumeroTesteLead(telefoneRemetente, numerosTeste) ? "LEAD" : "AGENDA";
}

// Credenciais de envio: sem canal ou canal AGENDA → envs atuais; canal LEAD →
// phoneNumberId/accessToken do próprio CanalWhatsApp.
export function credenciaisEnvio(
  canal?: CanalWhatsAppResolvido
): { phoneNumberId: string; accessToken: string } | null {
  if (canal?.tipo === "LEAD") {
    return { phoneNumberId: canal.phoneNumberId, accessToken: canal.accessToken };
  }
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneNumberId || !accessToken) return null;
  return { phoneNumberId, accessToken };
}
