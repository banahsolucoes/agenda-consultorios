import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { resolverOrigemPublica } from "@/lib/google";

// POST /api/assinatura/criar — abre uma assinatura recorrente no Mercado
// Pago para a clínica do usuário logado e retorna o init_point (checkout
// hospedado do MP). clinicaId e e-mail sempre vêm de getUsuarioLogado(),
// nunca do corpo da requisição. Não processamos cartão no nosso código: o MP
// hospeda o checkout inteiro.
export async function POST(req: NextRequest) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });

  const accessToken = process.env.MP_ACCESS_TOKEN;
  const planId = process.env.MP_PREAPPROVAL_PLAN_ID;
  if (!accessToken || !planId) {
    console.error("MP_ACCESS_TOKEN ou MP_PREAPPROVAL_PLAN_ID não configurados.");
    return NextResponse.json({ erro: "assinatura indisponível no momento" }, { status: 500 });
  }

  const origem = resolverOrigemPublica(req);

  const body = {
    preapproval_plan_id: planId,
    payer_email: usuario.email,
    external_reference: usuario.clinicaId,
    back_url: `${origem}/onboarding/retorno`,
    status: "pending",
  };

  let dados: any;
  try {
    const res = await fetch("https://api.mercadopago.com/preapproval", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    dados = await res.json();
    if (!res.ok) {
      console.error("Falha ao criar preapproval no Mercado Pago:", res.status, dados);
      return NextResponse.json({ erro: "não foi possível iniciar a assinatura" }, { status: 502 });
    }
  } catch (err) {
    console.error("Erro de rede ao chamar o Mercado Pago:", err);
    return NextResponse.json({ erro: "não foi possível iniciar a assinatura" }, { status: 502 });
  }

  await prisma.clinica.update({
    where: { id: usuario.clinicaId },
    data: {
      mpPreapprovalId: dados.id,
      mpPayerEmail: usuario.email,
    },
  });

  return NextResponse.json({ initPoint: dados.init_point });
}
