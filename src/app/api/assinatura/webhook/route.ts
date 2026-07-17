import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  consultarPreapprovalMP,
  mapearStatusAssinatura,
  validarAssinaturaWebhookMP,
} from "@/lib/mercadopago";

// POST /api/assinatura/webhook — notificação do Mercado Pago sobre mudanças
// numa assinatura (preapproval). O estado da Clinica é sempre derivado de
// uma consulta à API do MP feita aqui dentro, nunca do payload cru recebido
// — o payload só serve para saber QUAL preapproval consultar.
export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ erro: "corpo inválido" }, { status: 400 });
  }

  const dataId: string | null =
    req.nextUrl.searchParams.get("data.id") ?? body?.data?.id ?? null;

  if (!validarAssinaturaWebhookMP(req, dataId)) {
    console.error("Webhook do Mercado Pago rejeitado: assinatura inválida.");
    return NextResponse.json({ erro: "assinatura inválida" }, { status: 401 });
  }

  const tipo = req.nextUrl.searchParams.get("type") ?? body?.type;
  if (tipo !== "preapproval" && tipo !== "subscription_preapproval") {
    // Notificação de um tipo que não nos interessa (ex.: pagamento avulso).
    return NextResponse.json({ ok: true });
  }

  if (!dataId) {
    return NextResponse.json({ erro: "data.id ausente" }, { status: 400 });
  }

  try {
    const preapproval = await consultarPreapprovalMP(dataId);
    const novoStatus = mapearStatusAssinatura(preapproval.status);
    if (!novoStatus) {
      // Status ainda não mapeado (ex.: "pending") — nada a atualizar.
      return NextResponse.json({ ok: true });
    }

    const clinica = await prisma.clinica.findFirst({
      where: {
        OR: [
          { mpPreapprovalId: dataId },
          { id: preapproval.external_reference ?? "" },
        ],
      },
    });

    if (!clinica) {
      console.error(`Webhook do Mercado Pago: clínica não encontrada para preapproval ${dataId}.`);
      return NextResponse.json({ erro: "clínica não encontrada" }, { status: 404 });
    }

    // Idempotente: reprocessar a mesma notificação escreve o mesmo estado —
    // não há incremento nem efeito colateral duplicável.
    await prisma.clinica.update({
      where: { id: clinica.id },
      data: {
        statusAssinatura: novoStatus,
        mpPreapprovalId: dataId,
        mpPayerEmail: preapproval.payer_email ?? clinica.mpPayerEmail,
        assinaturaAtualizadaEm: new Date(),
      },
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Erro ao processar webhook de assinatura do Mercado Pago:", err);
    return NextResponse.json({ erro: "erro ao processar notificação" }, { status: 500 });
  }
}
