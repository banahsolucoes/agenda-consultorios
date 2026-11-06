import { readFileSync } from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { MODELO, enviarNotificacaoHumano } from "@/lib/ia/responderWhatsapp";
import {
  ESPERA_RAJADA_MS,
  ESTADO_AGUARDANDO_HUMANO,
  ESTADO_ENCERRADA,
  HISTORICO_MAX_MENSAGENS,
  MAX_RESPOSTAS_IA_POR_CONVERSA,
  RESUMO_LIMITE_IA,
  SAIDA_LEAD_SCHEMA,
  contarRespostasIa,
  iaLeadHabilitada,
  montarContexto,
  montarHistorico,
  motivoParaNaoResponder,
  normalizarSaidaLead,
  planejarEnvios,
  tempoDigitacaoMs,
  type SaidaLead,
} from "@/lib/ia/leadRegras";
import {
  enviarBotoes,
  enviarDigitando,
  enviarDocumento,
  enviarMensagemLivre,
} from "@/lib/whatsapp/enviarMensagem";
import type { CanalWhatsAppResolvido } from "@/lib/whatsapp/canal";

// IA do modo LEAD (ARCHITECTURE.md §10.14). Chamada pelo webhook via after(),
// depois do 200. Nunca lança: qualquer erro é logado (sem token) e a conversa
// fica como está.

// Caminho relativo à raiz do projeto. Na Vercel o arquivo entra no bundle da
// função do webhook por outputFileTracingIncludes (next.config.ts).
export const CAMINHO_PROMPT_LEAD = "src/lib/whatsapp/prompts/lead-consultorio.md";

const NOME_ARQUIVO_MIDIA_KIT = "Midia Kit - Dra. Pamela Rachid.pdf";
const CAMINHO_PUBLICO_MIDIA_KIT = "/midia-kit-pamela-rachid.pdf";
const APP_URL_PADRAO = "https://agenda.banahdigital.com.br";

let promptEmCache: string | null = null;

export function carregarPromptLead(): string | null {
  if (promptEmCache) return promptEmCache;
  try {
    promptEmCache = readFileSync(path.join(process.cwd(), CAMINHO_PROMPT_LEAD), "utf8");
    return promptEmCache;
  } catch (erro) {
    console.error(
      `[lead ia] não foi possível ler ${CAMINHO_PROMPT_LEAD}:`,
      erro instanceof Error ? erro.message : "erro desconhecido"
    );
    return null;
  }
}

export function urlMidiaKit(): string {
  const base = (process.env.APP_URL || APP_URL_PADRAO).replace(/\/+$/, "");
  return `${base}${CAMINHO_PUBLICO_MIDIA_KIT}`;
}

const ANTHROPIC_TIMEOUT_MS = 20_000;

const esperar = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function mensagemDeErro(erro: unknown): string {
  return erro instanceof Error ? erro.message : "erro desconhecido";
}

export interface ResponderLeadParams {
  conversaId: string;
  mensagemId: string; // MensagemWhatsapp de entrada que disparou a chamada
  wamidEntrada: string | null; // wamid dessa mensagem, para o "digitando..."
  telefone: string;
  nomeContato: string | null;
  canal: CanalWhatsAppResolvido;
}

export async function responderMensagemLead(params: ResponderLeadParams): Promise<void> {
  try {
    await responder(params);
  } catch (erro) {
    console.error(`[lead ia] falha inesperada (conversa ${params.conversaId}):`, mensagemDeErro(erro));
  }
}

async function estadoAtual(conversaId: string) {
  return prisma.conversaWhatsapp.findUnique({
    where: { id: conversaId },
    select: { estado: true, janelaAbertaAte: true },
  });
}

async function responder(params: ResponderLeadParams): Promise<void> {
  const { conversaId, mensagemId, wamidEntrada, telefone, nomeContato, canal } = params;

  // "digitando..." já na chegada, antes da espera da rajada e da IA.
  if (wamidEntrada) await enviarDigitando(canal, wamidEntrada);

  // Rajada: espera e só segue se esta ainda for a última mensagem de entrada.
  await esperar(ESPERA_RAJADA_MS);

  const conversa = await estadoAtual(conversaId);
  if (!conversa) return;
  const ultimaEntrada = await prisma.mensagemWhatsapp.findFirst({
    where: { conversaId, direcao: "entrada" },
    orderBy: [{ criadoEm: "desc" }, { id: "desc" }],
    select: { id: true },
  });
  const motivo = motivoParaNaoResponder({
    iaHabilitada: iaLeadHabilitada(process.env),
    estadoConversa: conversa.estado,
    mensagemId,
    ultimaEntradaId: ultimaEntrada?.id ?? null,
  });
  if (motivo) {
    console.log("[lead ia] sem resposta", { conversaId, motivo });
    return;
  }

  const historico = await prisma.mensagemWhatsapp.findMany({
    where: { conversaId },
    orderBy: [{ criadoEm: "asc" }, { id: "asc" }],
    select: { direcao: true, texto: true, tipo: true, respondidaPorIa: true },
  });

  if (contarRespostasIa(historico) >= MAX_RESPOSTAS_IA_POR_CONVERSA) {
    console.log("[lead ia] limite de respostas atingido", { conversaId });
    await passarParaHumano({ conversaId, telefone, nomeContato, resumo: RESUMO_LIMITE_IA });
    return;
  }

  if (!conversa.janelaAbertaAte || conversa.janelaAbertaAte.getTime() < Date.now()) {
    console.error(`[lead ia] janela de 24h fechada (conversa ${conversaId})`);
    return;
  }

  const turnos = montarHistorico(historico, HISTORICO_MAX_MENSAGENS);
  // Se a última fala já é da clínica (ex.: humano respondeu pelo inbox durante
  // a espera), não há o que responder.
  if (turnos.length === 0 || turnos[turnos.length - 1].role !== "user") {
    console.log("[lead ia] última fala não é do lead, sem resposta", { conversaId });
    return;
  }

  const prompt = carregarPromptLead();
  if (!prompt) return;

  const contexto = montarContexto({
    agora: new Date(),
    nomeContato,
    palavraCta: null, // virá da planilha no próximo bloco
    origem: "pessoa_escreveu",
  });

  let saida: SaidaLead | null;
  try {
    // Timeout e 1 retry limitam o pior caso da chamada a ~40s, para caber no
    // maxDuration do webhook junto com a rajada e os envios (ver §10.14).
    const client = new Anthropic({ timeout: ANTHROPIC_TIMEOUT_MS, maxRetries: 1 });
    const response = await client.messages.create({
      model: MODELO,
      max_tokens: 2048,
      system: `${prompt}\n\n${contexto}`,
      output_config: { format: { type: "json_schema", schema: SAIDA_LEAD_SCHEMA } },
      messages: turnos,
    });
    const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
    saida = normalizarSaidaLead(textBlock?.text ?? null);
    if (!saida) {
      console.error("[lead ia] saída inválida do modelo, nada enviado", {
        conversaId,
        stopReason: response.stop_reason,
      });
      return;
    }
  } catch (erro) {
    console.error(`[lead ia] falha na API da Anthropic (conversa ${conversaId}):`, mensagemDeErro(erro));
    return;
  }

  // Um humano pode ter assumido durante a chamada da IA.
  const depois = await estadoAtual(conversaId);
  if (!depois || depois.estado === ESTADO_AGUARDANDO_HUMANO || depois.estado === ESTADO_ENCERRADA) {
    console.log("[lead ia] conversa mudou de estado durante a chamada, nada enviado", { conversaId });
    return;
  }

  await enviarSaida(conversaId, telefone, canal, wamidEntrada, saida);

  if (saida.passarParaHumano) {
    await passarParaHumano({ conversaId, telefone, nomeContato, resumo: saida.passarParaHumano.resumo });
  } else if (saida.encerrar) {
    await prisma.conversaWhatsapp.updateMany({
      where: { id: conversaId, estado: { notIn: [ESTADO_AGUARDANDO_HUMANO, ESTADO_ENCERRADA] } },
      data: { estado: ESTADO_ENCERRADA },
    });
  }
}

// Envia na ordem (mídia kit na posição pedida, ver planejarEnvios), sempre pelo
// canal da conversa. Antes de cada envio mostra "digitando..." e espera um
// tempo proporcional ao texto (tempoDigitacaoMs). Para no primeiro erro (o
// resto ficaria fora de ordem). Grava cada mensagem enviada como saída da IA.
async function enviarSaida(
  conversaId: string,
  telefone: string,
  canal: CanalWhatsAppResolvido,
  wamidEntrada: string | null,
  saida: SaidaLead
): Promise<void> {
  for (const envio of planejarEnvios(saida)) {
    if (wamidEntrada) await enviarDigitando(canal, wamidEntrada);
    await esperar(tempoDigitacaoMs(envio));

    let resultado;
    let textoGravado: string;
    if (envio.tipo === "livre") {
      resultado = await enviarMensagemLivre(telefone, envio.texto, canal);
      textoGravado = envio.texto;
    } else if (envio.tipo === "botoes") {
      resultado = await enviarBotoes(telefone, envio.texto, envio.botoes, canal);
      textoGravado = `${envio.texto}\n[Botões: ${envio.botoes.join(" | ")}]`;
    } else {
      resultado = await enviarDocumento(telefone, urlMidiaKit(), NOME_ARQUIVO_MIDIA_KIT, canal);
      textoGravado = `[Mídia kit enviado: ${NOME_ARQUIVO_MIDIA_KIT}]`;
    }

    if (!resultado.sucesso) {
      console.error(`[lead ia] falha ao enviar ${envio.tipo} (conversa ${conversaId}):`, resultado.erro);
      return;
    }

    await prisma.mensagemWhatsapp.create({
      data: {
        conversaId,
        direcao: "saida",
        texto: textoGravado,
        tipo: envio.tipo,
        respondidaPorIa: true,
        wamid: resultado.wamid ?? null,
      },
    });
    await prisma.conversaWhatsapp.update({ where: { id: conversaId }, data: { ultimaMensagemEm: new Date() } });
  }
}

// Transição para "aguardando_humano" + aviso para a equipe, só quando esta
// chamada foi quem mudou o estado (mesmo padrão do modo AGENDA).
async function passarParaHumano(params: {
  conversaId: string;
  telefone: string;
  nomeContato: string | null;
  resumo: string;
}): Promise<void> {
  const transicao = await prisma.conversaWhatsapp.updateMany({
    where: { id: params.conversaId, estado: { notIn: [ESTADO_AGUARDANDO_HUMANO, ESTADO_ENCERRADA] } },
    data: { estado: ESTADO_AGUARDANDO_HUMANO },
  });
  if (transicao.count === 0) return;

  await enviarNotificacaoHumano(
    `⚠️ Lead para atendimento humano\n` +
      `Nome: ${params.nomeContato ?? "não informado"}\n` +
      `Telefone: ${params.telefone}\n` +
      `Resumo: ${params.resumo || "(sem resumo)"}`
  );
}
