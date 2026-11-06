import crypto from "node:crypto";
import { NextRequest, NextResponse, after } from "next/server";
import { prisma } from "@/lib/prisma";
import { responderMensagemWhatsapp } from "@/lib/ia/responderWhatsapp";
import { responderMensagemLead } from "@/lib/ia/responderLead";
import { iaLeadHabilitada, motivoParaNaoResponder } from "@/lib/ia/leadRegras";
import { normalizarTelefoneE164 } from "@/lib/whatsapp/telefone";
import {
  classificarCanal,
  decidirModo,
  parseNumerosTeste,
  type CanalWhatsAppResolvido,
  type ModoAtendimento,
} from "@/lib/whatsapp/canal";

// Janela de conversação do WhatsApp Business: 24h a partir da última
// mensagem do paciente, período em que a clínica pode responder livremente
// (fora dela, só template aprovado).
const JANELA_24H_MS = 24 * 60 * 60 * 1000;

// A IA do modo LEAD roda em after(), na mesma função. Pior caso estimado
// (ARCHITECTURE.md §10.14): "digitando" inicial + rajada 4s + IA até ~41s
// (timeout 20s, 1 retry) + 5 mensagens x 7s + documento 3s, cada envio com
// "digitando" e chamada à Meta ≈ 96s; com todas as chamadas de "digitando"
// esgotando o timeout de 5s ≈ 126s. 150s dá folga. Exige Fluid Compute na
// Vercel (sem ele, o Hobby limita a 60s e o deploy recusa este valor).
export const maxDuration = 150;

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
// atende uma única clínica de verdade em produção (Fono Pâmela Rachid,
// slug "pamela-rachid") e não há campo de mapeamento phone_number_id →
// Clinica no schema; quando existir mais de uma clínica conectada ao
// WhatsApp, trocar isso por um lookup real usando value.metadata.phone_number_id.
//
// Bug corrigido em 2026-07-24: a versão anterior usava findFirst() sem
// orderBy — sem ordem explícita, o Postgres/Prisma não garante qual linha
// volta primeiro, e na prática estava retornando "Clínica Teste" em vez de
// "Fono Pâmela Rachid" (confirmado: as duas ConversaWhatsapp criadas até
// aqui foram gravadas com o clinicaId errado, e por isso nunca apareciam no
// inbox — GET /api/whatsapp/conversas filtra por clinicaId do usuário
// logado, que é sempre "Fono Pâmela Rachid"). Filtrar pelo slug real é
// explícito e determinístico, em vez de depender de ordem incidental de
// linhas no banco.
async function resolverClinicaId(): Promise<string | null> {
  const clinica = await prisma.clinica.findFirst({
    where: { slug: "pamela-rachid" },
    select: { id: true },
  });
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

// Paciente.telefone está salvo em formatos inconsistentes (com/sem DDI, com/
// sem máscara — mesmo achado da auditoria em enviarTemplate.ts), enquanto o
// telefone que a Meta manda (`value.messages[0].from`) é sempre dígitos com
// DDI. Comparar direto (`WHERE telefone = ...`) quase nunca batia. Normaliza
// os dois lados com normalizarTelefoneE164() e compara em memória — sem
// índice único em Paciente.telefone, não dá pra fazer isso via WHERE no
// banco sem mudar o dado na origem (cadastro), fora de escopo aqui. Volume
// por clínica é baixo, então buscar todos e comparar em memória é barato.
async function buscarPacientePorTelefone(clinicaId: string, telefoneMeta: string): Promise<string | null> {
  const alvo = normalizarTelefoneE164(telefoneMeta);
  if (!alvo) return null;

  const pacientes = await prisma.paciente.findMany({
    where: { clinicaId, telefone: { not: null } },
    select: { id: true, telefone: true },
  });

  const match = pacientes.find((p) => normalizarTelefoneE164(p.telefone!) === alvo);
  return match?.id ?? null;
}

// Resolve o canal pelo phone_number_id do payload (value.metadata), ver
// whatsapp/canal.ts. null = número desconhecido ou CanalWhatsApp inativo.
async function resolverCanal(phoneNumberId: string): Promise<CanalWhatsAppResolvido | null> {
  const envPhoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  if (envPhoneNumberId && phoneNumberId === envPhoneNumberId) return { tipo: "AGENDA" };
  const registro = await prisma.canalWhatsApp.findUnique({
    where: { phoneNumberId },
    select: { id: true, clinicaId: true, phoneNumberId: true, accessToken: true, ativo: true },
  });
  return classificarCanal(phoneNumberId, envPhoneNumberId, registro);
}

// Conversa é separada por modo e canal de origem (§10.13): o mesmo telefone
// tem uma conversa AGENDA no número da agenda e outra LEAD por canal.
// canalWhatsAppId null = número da agenda (envs).
interface ChaveConversa {
  modo: ModoAtendimento;
  canalWhatsAppId: string | null;
}

// Grava conversa (busca/cria por clinicaId+telefone+modo+canal, renova a
// janela de 24h) e as mensagens de entrada, pulando wamid duplicado. Devolve
// os textos das mensagens efetivamente gravadas agora. Comum aos dois modos.
async function gravarMensagensEntrada(clinicaId: string, telefone: string, mensagens: any[], chave: ChaveConversa) {
  let conversa = await prisma.conversaWhatsapp.findFirst({
    where: { clinicaId, telefone, modo: chave.modo, canalWhatsAppId: chave.canalWhatsAppId },
  });

  const agora = new Date();
  const janelaAbertaAte = new Date(agora.getTime() + JANELA_24H_MS);

  if (!conversa) {
    const pacienteId = await buscarPacientePorTelefone(clinicaId, telefone);

    conversa = await prisma.conversaWhatsapp.create({
      data: {
        clinicaId,
        telefone,
        pacienteId,
        janelaAbertaAte,
        ultimaMensagemEm: agora,
        modo: chave.modo,
        canalWhatsAppId: chave.canalWhatsAppId,
      },
    });
  } else {
    conversa = await prisma.conversaWhatsapp.update({
      where: { id: conversa.id },
      data: { janelaAbertaAte, ultimaMensagemEm: agora },
    });
  }

  const novas: { id: string; texto: string; wamid: string | null }[] = [];
  for (const mensagem of mensagens) {
    const wamid: string | undefined = mensagem.id;

    if (wamid) {
      const jaExiste = await prisma.mensagemWhatsapp.findUnique({ where: { wamid } });
      if (jaExiste) continue;
    }

    const texto = extrairTextoMensagem(mensagem);

    const criada = await prisma.mensagemWhatsapp.create({
      data: {
        conversaId: conversa.id,
        direcao: "entrada",
        texto,
        tipo: mensagem.type ?? "desconhecido",
        wamid: wamid ?? null,
      },
    });
    novas.push({ id: criada.id, texto, wamid: wamid ?? null });
  }

  return { conversa, janelaAbertaAte, novas };
}

// Modo AGENDA: comportamento de sempre (grava + IA de confirmação/handoff).
async function processarMensagensEntrada(clinicaId: string, telefone: string, mensagens: any[]) {
  const { conversa, janelaAbertaAte, novas } = await gravarMensagensEntrada(clinicaId, telefone, mensagens, {
    modo: "AGENDA",
    canalWhatsAppId: null,
  });

  // Resposta automática por IA só faz sentido pra conversa já ligada a um
  // paciente cadastrado, e só enquanto nenhum humano assumiu a conversa
  // (estado "aguardando_humano" — setado pela própria IA ao detectar pedido
  // de reagendamento — trava qualquer resposta automática até alguém tratar).
  // Kill switch: WHATSAPP_IA_ATIVA="false" desliga a IA sem reverter código —
  // mensagem continua sendo gravada normalmente, só não gera resposta nem
  // custo de IA. Qualquer outro valor (ou ausente) mantém a IA ativa.
  const iaAtiva = process.env.WHATSAPP_IA_ATIVA !== "false";
  const podeResponderPorIa =
    iaAtiva && Boolean(conversa.pacienteId) && conversa.estado !== "aguardando_humano";
  const nomePaciente = podeResponderPorIa
    ? (await prisma.paciente.findUnique({ where: { id: conversa.pacienteId! }, select: { nome: true } }))?.nome
    : null;

  for (const { texto } of novas) {
    if (podeResponderPorIa && nomePaciente && texto.trim()) {
      const conversaId = conversa.id;
      const pacienteId = conversa.pacienteId!;
      after(() =>
        responderMensagemWhatsapp({
          conversaId,
          pacienteId,
          telefone,
          nomePaciente,
          textoRecebido: texto,
          janelaAbertaAte,
        })
      );
    }
  }
}

// Modo LEAD: grava no histórico e agenda a IA do lead (responderLead.ts) só
// para a última mensagem nova do lote; as anteriores entram no histórico.
// Nunca chama responderMensagemWhatsapp, então mensagem de número de teste
// nunca passa pela lógica de confirmação de sessão.
// Canal LEAD → conversa ligada ao CanalWhatsApp; número de teste no canal
// AGENDA → conversa LEAD com canalWhatsAppId null (separada da conversa AGENDA).
async function processarMensagensLead(
  clinicaId: string,
  telefone: string,
  mensagens: any[],
  canal: CanalWhatsAppResolvido,
  nomeContato: string | null
) {
  const { conversa, novas } = await gravarMensagensEntrada(clinicaId, telefone, mensagens, {
    modo: "LEAD",
    canalWhatsAppId: canal.tipo === "LEAD" ? canal.canalId : null,
  });
  const ultima = novas[novas.length - 1];
  if (!ultima) return;
  console.log("[lead] mensagem recebida", { conversaId: conversa.id, novas: novas.length });

  // Checagem antecipada (flag e estado) para não agendar à toa. A regra
  // completa, com a rajada, roda de novo dentro de responderMensagemLead.
  const motivo = motivoParaNaoResponder({
    iaHabilitada: iaLeadHabilitada(process.env),
    estadoConversa: conversa.estado,
    mensagemId: ultima.id,
    ultimaEntradaId: ultima.id,
  });
  if (motivo) {
    console.log("[lead] IA não agendada", { conversaId: conversa.id, motivo });
    return;
  }

  const conversaId = conversa.id;
  after(() =>
    responderMensagemLead({
      conversaId,
      mensagemId: ultima.id,
      wamidEntrada: ultima.wamid,
      telefone,
      nomeContato,
      canal,
    })
  );
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

    // Roteamento por número: sem metadata → canal AGENDA (comportamento antigo).
    const phoneNumberId: string | undefined = value?.metadata?.phone_number_id;
    const canal: CanalWhatsAppResolvido | null = phoneNumberId
      ? await resolverCanal(phoneNumberId)
      : { tipo: "AGENDA" };
    if (!canal) {
      console.log("[whatsapp-webhook] canal desconhecido ou inativo", { phoneNumberId });
      return NextResponse.json({ ok: true }, { status: 200 });
    }

    if (value?.messages) {
      const clinicaId = canal.tipo === "LEAD" ? canal.clinicaId : await resolverClinicaId();
      if (!clinicaId) {
        console.error("[whatsapp webhook] nenhuma clínica encontrada para associar a conversa");
      } else {
        const telefone: string = value.messages[0]?.from ?? value.contacts?.[0]?.wa_id ?? "";
        if (telefone) {
          const modo = decidirModo(canal, telefone, parseNumerosTeste(process.env.WHATSAPP_LEAD_TESTE_NUMEROS));
          if (modo === "LEAD") {
            const nomeContato: string | null = value.contacts?.[0]?.profile?.name?.trim() || null;
            await processarMensagensLead(clinicaId, telefone, value.messages, canal, nomeContato);
          } else {
            await processarMensagensEntrada(clinicaId, telefone, value.messages);
          }
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
