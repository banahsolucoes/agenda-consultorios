// scripts/create-mp-plan.mjs
// Cria o plano de assinatura recorrente no Mercado Pago (preapproval_plan).
// Roda uma única vez. O id retornado vira MP_PREAPPROVAL_PLAN_ID no .env/Vercel.
//
// Uso: node scripts/create-mp-plan.mjs
// Requer MP_ACCESS_TOKEN no ambiente (.env) e a origem pública do app.

import "dotenv/config";

// Preencher antes de rodar:
const VALOR_MENSAL = 0; // valor da assinatura em reais (ex.: 97.9)
const DIAS_TRIAL = 0; // duração do trial gratuito em dias (ex.: 7)
const ORIGEM_PUBLICA = ""; // ex.: "https://app.suaclinica.com.br"

async function main() {
  const accessToken = process.env.MP_ACCESS_TOKEN;
  if (!accessToken) {
    console.error("MP_ACCESS_TOKEN não definido no ambiente.");
    process.exit(1);
  }
  if (!VALOR_MENSAL || !DIAS_TRIAL || !ORIGEM_PUBLICA) {
    console.error(
      "Preencha VALOR_MENSAL, DIAS_TRIAL e ORIGEM_PUBLICA no topo do script antes de rodar."
    );
    process.exit(1);
  }

  const body = {
    reason: "Agenda para Consultórios - Mensal",
    auto_recurring: {
      frequency: 1,
      frequency_type: "months",
      transaction_amount: VALOR_MENSAL,
      currency_id: "BRL",
      free_trial: {
        frequency: DIAS_TRIAL,
        frequency_type: "days",
      },
    },
    back_url: `${ORIGEM_PUBLICA}/onboarding/retorno`,
    payment_methods_allowed: {
      payment_types: [{ id: "credit_card" }],
    },
  };

  const res = await fetch("https://api.mercadopago.com/preapproval_plan", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const dados = await res.json();

  if (!res.ok) {
    console.error("Falha ao criar o plano:", res.status, dados);
    process.exit(1);
  }

  console.log("Plano criado com sucesso.");
  console.log("MP_PREAPPROVAL_PLAN_ID =", dados.id);
}

main();
