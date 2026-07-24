import crypto from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Janela de conversação do WhatsApp Business: 24h a partir da última
// mensagem do paciente, período em que a clínica pode responder livremente
// (fora dela, só template aprovado).
const JANELA_24H_MS = 24 * 60 * 60 * 1000;

export async function GET(req: NextRequest) {
  const modo = req.nextUrl.searchParams.get("hub.mode");
  const token = req.nextUrl.searchParams.get("hub.verify_token");
  const challenge = req.nextUrl.searchParams.get("hub.challenge");

  if (modo === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new NextResponse(challenge ?? "", { status: 200 });
  }
  return new NextResponse("forbidden", { status: 403 });
}

function assinaturaValida(corpoBruto: string, assinaturaHeader: string | null): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret || !assinaturaHeader) return false;

  const [, assinaturaRecebida] = assinaturaHeader.split("sha256=");
  if (!assinaturaRecebida) return false;

  const assinaturaEsperada = crypto.createHmac("sha256", secret).update(corpoBruto).digest("hex");

  const bufRecebido = Buffer.from(assinaturaRecebida, "hex");
  const bufEsperado = Buffer.from(assinaturaEsperada, "hex");
  if (bufRecebido.length !== bufEsperado.length) return false;

  return crypto.timingSafeEqual(bufRecebido, bufEsperado);
}

// Resolve a clínica dona do número que recebeu a mensagem. Hoje o produto
// atende uma única clínica (Pâmela) e não há campo de mapeamento
// phone_number_id → Clinica no schema; quando existir mais de uma clínica
// conectada ao WhatsApp, trocar este findFirst por um lookup real usando
// value.metadata.phone_number_id.
async function resolverClinicaId(): Promise<string | null> {
  const clinica = await prisma.clinica.findFirst({ select: { id: true } });
  return clinica?.id ?? null;
}

function extrairTextoMensagem(mensagem: any): string {
  switch (mensagem.type) {
    case "text":
      return mensagem.text?.body ?? "";
    case "button":
      return mensagem.button?.text ?? "";
    case "interactive":
      return (
        mensagem.interactive?.button_reply?.title ??
        mensagem.interactive?.list_reply?.title ??
        ""
      );
    default:
      return "";
  }
}

async function processarMensagensEntrada(clinicaId: string, telefone: string, mensagens: any[]) {
  let conversa = await prisma.conversaWhatsapp.findFirst({
    where: { clinicaId, telefone },
  });

  const agora = new Date();
  const janelaAbertaAte = new Date(agora.getTime() + JANELA_24H_MS);

  if (!conversa) {
    let pacienteId: string | null = null;
    const paciente = await prisma.paciente.findFirst({
      where: { clinicaId, telefone },
      select: { id: true },
    });
    if (paciente) pacienteId = paciente.id;

    conversa = await prisma.conversaWhatsapp.create({
      data: { clinicaId, telefone, pacienteId, janelaAbertaAte, ultimaMensagemEm: agora },
    });
  } else {
    conversa = await prisma.conversaWhatsapp.update({
      where: { id: conversa.id },
      data: { janelaAbertaAte, ultimaMensagemEm: agora },
    });
  }

  for (const mensagem of mensagens) {
    const wamid: string | undefined = mensagem.id;

    if (wamid) {
      const jaExiste = await prisma.mensagemWhatsapp.findUnique({ where: { wamid } });
      if (jaExiste) continue;
    }

    await prisma.mensagemWhatsapp.create({
      data: {
        conversaId: conversa.id,
        direcao: "entrada",
        texto: extrairTextoMensagem(mensagem),
        tipo: mensagem.type ?? "desconhecido",
        wamid: wamid ?? null,
      },
    });
  }
}

export async function POST(req: NextRequest) {
  const corpoBruto = await req.text();

  if (!assinaturaValida(corpoBruto, req.headers.get("x-hub-signature-256"))) {
    console.error("[whatsapp webhook] assinatura inválida");
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  try {
    const payload = JSON.parse(corpoBruto);
    const value = payload?.entry?.[0]?.changes?.[0]?.value;

    if (value?.messages) {
      const clinicaId = await resolverClinicaId();
      if (!clinicaId) {
        console.error("[whatsapp webhook] nenhuma clínica encontrada para associar a conversa");
      } else {
        const telefone: string = value.messages[0]?.from ?? value.contacts?.[0]?.wa_id ?? "";
        if (telefone) {
          await processarMensagensEntrada(clinicaId, telefone, value.messages);
        }
      }
    }

    if (value?.statuses) {
      console.log("[whatsapp webhook] status de entrega recebido", JSON.stringify(value.statuses));
    }
  } catch (erro) {
    console.error("[whatsapp webhook] falha ao processar payload", erro);
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
