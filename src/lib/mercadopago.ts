// src/lib/mercadopago.ts
// Helpers da integração de assinatura recorrente com o Mercado Pago
// (preapproval). O estado da assinatura é sempre derivado do webhook +
// consulta à API do MP — nunca do payload cru do webhook nem do redirect do
// usuário (ver src/app/api/assinatura/webhook/route.ts).

import crypto from "crypto";
import type { NextRequest } from "next/server";
import type { StatusAssinatura } from "@/generated/prisma";

// Valida a assinatura HMAC do header x-signature enviado pelo Mercado Pago,
// conforme o algoritmo documentado (manifest "id:...;request-id:...;ts:...;"
// assinado com MP_WEBHOOK_SECRET). Retorna false se o segredo não estiver
// configurado, se os headers faltarem ou se a assinatura não bater.
export function validarAssinaturaWebhookMP(req: NextRequest, dataId: string | null): boolean {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret) return false;

  const xSignature = req.headers.get("x-signature");
  const xRequestId = req.headers.get("x-request-id");
  if (!xSignature || !xRequestId || !dataId) return false;

  const partes = Object.fromEntries(
    xSignature.split(",").map((par) => {
      const [chave, valor] = par.split("=");
      return [chave?.trim(), valor?.trim()];
    })
  );
  const ts = partes["ts"];
  const v1 = partes["v1"];
  if (!ts || !v1) return false;

  const idNormalizado = /^[a-zA-Z0-9]+$/.test(dataId) ? dataId.toLowerCase() : dataId;
  const manifest = `id:${idNormalizado};request-id:${xRequestId};ts:${ts};`;
  const digestEsperado = crypto.createHmac("sha256", secret).update(manifest).digest("hex");

  const bufferEsperado = Buffer.from(digestEsperado, "hex");
  const bufferRecebido = Buffer.from(v1, "hex");
  if (bufferEsperado.length !== bufferRecebido.length) return false;
  return crypto.timingSafeEqual(bufferEsperado, bufferRecebido);
}

// Consulta o estado real da assinatura direto na API do MP — nunca confiamos
// no payload cru do webhook como fonte de verdade.
export async function consultarPreapprovalMP(id: string): Promise<any> {
  const accessToken = process.env.MP_ACCESS_TOKEN;
  const res = await fetch(`https://api.mercadopago.com/preapproval/${id}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Falha ao consultar preapproval ${id} no Mercado Pago: ${res.status}`);
  }
  return res.json();
}

// Mapeia o status de preapproval do MP para o enum StatusAssinatura interno.
// Pagamento recusado (status "paused" por falha de cobrança) também vira
// INADIMPLENTE. Retorna null para status ainda não mapeados (ex.: "pending",
// antes da 1ª autorização) — nesse caso o chamador não deve alterar o estado
// atual da clínica.
export function mapearStatusAssinatura(statusMP: string): StatusAssinatura | null {
  switch (statusMP) {
    case "authorized":
      return "ATIVA";
    case "paused":
      return "INADIMPLENTE";
    case "cancelled":
      return "CANCELADA";
    default:
      return null;
  }
}
