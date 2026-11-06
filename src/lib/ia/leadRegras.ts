// Regras puras da IA do modo LEAD (ARCHITECTURE.md §10.14): validação da
// saída do modelo, decisão de chamar ou não a IA, contagem de respostas e
// montagem do histórico. Sem Prisma nem rede, para testar sem dependências.

export const MAX_MENSAGENS_POR_RESPOSTA = 5;
export const MAX_BOTOES_POR_MENSAGEM = 3;
export const MAX_CARACTERES_BOTAO = 20;
export const MAX_CARACTERES_CORPO_BOTOES = 1024; // limite da Meta p/ body de interactive
export const MAX_CARACTERES_TEXTO = 4096; // limite da Meta p/ text.body
export const MAX_RESPOSTAS_IA_POR_CONVERSA = 40;
export const HISTORICO_MAX_MENSAGENS = 30;
export const ESPERA_RAJADA_MS = 4000;
export const RESUMO_LIMITE_IA = "limite de mensagens da IA";

// "digitando..." antes de cada envio: tempo proporcional ao texto.
export const DIGITACAO_MS_POR_CARACTERE = 45;
export const DIGITACAO_MIN_MS = 2000;
export const DIGITACAO_MAX_MS = 7000;
export const DIGITACAO_DOCUMENTO_MS = 3000;

// Estados em que a IA do modo LEAD não responde mais.
export const ESTADO_AGUARDANDO_HUMANO = "aguardando_humano";
export const ESTADO_ENCERRADA = "fechada"; // estado já existente no inbox ("Fechada")

export interface MensagemLead {
  texto: string;
  botoes: string[];
}

export interface SaidaLead {
  mensagens: MensagemLead[];
  // Quantas mensagens saem antes do PDF do mídia kit (0..mensagens.length);
  // null = sem mídia kit nesta resposta.
  posicaoMidiaKit: number | null;
  passarParaHumano: { resumo: string } | null;
  encerrar: boolean;
}

// Schema enviado ao modelo (output_config json_schema). A validação de
// verdade é normalizarSaidaLead: o schema não garante limites de tamanho.
export const SAIDA_LEAD_SCHEMA = {
  type: "object",
  properties: {
    mensagens: {
      type: "array",
      description: "De 0 a 5 mensagens, enviadas nesta ordem. Cada uma curta (até 3 ou 4 linhas).",
      items: {
        type: "object",
        properties: {
          texto: { type: "string" },
          botoes: {
            type: "array",
            description: "Até 3 botões de resposta rápida, cada um com no máximo 20 caracteres. Vazio se não houver.",
            items: { type: "string" },
          },
          enviarMidiaKitDepois: {
            type: "boolean",
            description:
              "true só na mensagem logo antes do PDF do mídia kit (ação ENVIAR_MIDIA_KIT). O PDF é enviado logo depois desta mensagem. No máximo uma mensagem por resposta.",
          },
        },
        required: ["texto", "botoes"],
        additionalProperties: false,
      },
    },
    passarParaHumano: {
      anyOf: [
        {
          type: "object",
          properties: { resumo: { type: "string" } },
          required: ["resumo"],
          additionalProperties: false,
        },
        { type: "null" },
      ],
    },
    encerrar: { type: "boolean" },
  },
  required: ["mensagens", "passarParaHumano", "encerrar"],
  additionalProperties: false,
} as const;

// Corta por caractere visível (code point), sem partir emoji ao meio.
export function truncar(texto: string, max: number): string {
  const chars = Array.from(texto);
  return chars.length <= max ? texto : chars.slice(0, max).join("");
}

// Valida e normaliza a saída bruta do modelo (string JSON ou objeto). Devolve
// null se a estrutura for inválida: quem chama loga e não envia nada.
// Normalizações: no máximo 5 mensagens e 3 botões por mensagem; botões
// aparados, sem vazios, sem repetidos e cortados em 20 caracteres; textos
// vazios descartados; texto cortado no limite da Meta.
// Mídia kit: o PDF sai logo depois da primeira mensagem (mantida) marcada com
// enviarMidiaKitDepois. Sem marca válida, mas com o enviarMidiaKit antigo de
// topo (ou com a marca numa mensagem descartada), sai antes da última.
export function normalizarSaidaLead(bruto: unknown): SaidaLead | null {
  let dado: unknown = bruto;
  if (typeof bruto === "string") {
    try {
      dado = JSON.parse(bruto);
    } catch {
      return null;
    }
  }
  if (!dado || typeof dado !== "object" || Array.isArray(dado)) return null;
  const obj = dado as Record<string, unknown>;

  if (!Array.isArray(obj.mensagens)) return null;
  if (obj.enviarMidiaKit !== undefined && typeof obj.enviarMidiaKit !== "boolean") return null;
  if (typeof obj.encerrar !== "boolean") return null;

  let passarParaHumano: SaidaLead["passarParaHumano"] = null;
  if (obj.passarParaHumano !== null && obj.passarParaHumano !== undefined) {
    const p = obj.passarParaHumano as Record<string, unknown>;
    if (typeof p !== "object" || typeof p.resumo !== "string") return null;
    passarParaHumano = { resumo: p.resumo.trim() };
  }

  const mensagens: MensagemLead[] = [];
  let posicaoMidiaKit: number | null = null;
  // Olha todas as mensagens (inclusive as que serão cortadas) para não perder
  // o pedido de mídia kit feito numa mensagem descartada.
  const midiaKitPedido =
    obj.enviarMidiaKit === true ||
    obj.mensagens.some(
      (item) => Boolean(item) && typeof item === "object" && (item as Record<string, unknown>).enviarMidiaKitDepois === true
    );
  for (const item of obj.mensagens) {
    if (!item || typeof item !== "object") return null;
    const m = item as Record<string, unknown>;
    if (typeof m.texto !== "string") return null;
    if (m.botoes !== undefined && m.botoes !== null && !Array.isArray(m.botoes)) return null;
    if (m.enviarMidiaKitDepois !== undefined && typeof m.enviarMidiaKitDepois !== "boolean") return null;

    const botoes: string[] = [];
    for (const b of (m.botoes as unknown[] | undefined) ?? []) {
      if (typeof b !== "string") return null;
      const titulo = truncar(b.trim(), MAX_CARACTERES_BOTAO).trim();
      if (titulo && !botoes.includes(titulo)) botoes.push(titulo);
      if (botoes.length === MAX_BOTOES_POR_MENSAGEM) break;
    }

    const texto = m.texto.trim();
    if (!texto) continue;
    const limite = botoes.length > 0 ? MAX_CARACTERES_CORPO_BOTOES : MAX_CARACTERES_TEXTO;
    mensagens.push({ texto: truncar(texto, limite), botoes });
    if (m.enviarMidiaKitDepois === true && posicaoMidiaKit === null) posicaoMidiaKit = mensagens.length;
    if (mensagens.length === MAX_MENSAGENS_POR_RESPOSTA) break;
  }

  if (midiaKitPedido && posicaoMidiaKit === null) {
    posicaoMidiaKit = Math.max(mensagens.length - 1, 0); // antes da última
  }

  return { mensagens, posicaoMidiaKit, passarParaHumano, encerrar: obj.encerrar };
}

export type Envio =
  | { tipo: "livre"; texto: string }
  | { tipo: "botoes"; texto: string; botoes: string[] }
  | { tipo: "documento" };

// Ordem final dos envios de uma resposta, com o mídia kit na posição certa.
export function planejarEnvios(saida: SaidaLead): Envio[] {
  const envios: Envio[] = saida.mensagens.map((m) =>
    m.botoes.length > 0 ? { tipo: "botoes", texto: m.texto, botoes: m.botoes } : { tipo: "livre", texto: m.texto }
  );
  if (saida.posicaoMidiaKit !== null) {
    envios.splice(Math.min(saida.posicaoMidiaKit, envios.length), 0, { tipo: "documento" });
  }
  return envios;
}

// Tempo de "digitando..." antes de um envio: 45 ms por caractere, entre 2 s e
// 7 s; documento, 3 s fixos.
export function tempoDigitacaoMs(envio: Envio): number {
  if (envio.tipo === "documento") return DIGITACAO_DOCUMENTO_MS;
  const ms = Array.from(envio.texto).length * DIGITACAO_MS_POR_CARACTERE;
  return Math.min(DIGITACAO_MAX_MS, Math.max(DIGITACAO_MIN_MS, ms));
}

// Flags: WHATSAPP_IA_LEAD_ATIVA precisa ser "true" (ausente = desligada) e o
// kill switch geral WHATSAPP_IA_ATIVA não pode ser "false".
export function iaLeadHabilitada(env: Record<string, string | undefined>): boolean {
  return env.WHATSAPP_IA_ATIVA !== "false" && env.WHATSAPP_IA_LEAD_ATIVA === "true";
}

export type MotivoNaoResponder = "ia_desligada" | "estado" | "rajada" | null;

// Decide, depois da espera da rajada, se a IA responde. Só responde se a IA
// estiver ligada, a conversa não estiver com humano/encerrada e a mensagem que
// disparou ainda for a última de entrada da conversa.
export function motivoParaNaoResponder(params: {
  iaHabilitada: boolean;
  estadoConversa: string;
  mensagemId: string;
  ultimaEntradaId: string | null;
}): MotivoNaoResponder {
  if (!params.iaHabilitada) return "ia_desligada";
  if (params.estadoConversa === ESTADO_AGUARDANDO_HUMANO || params.estadoConversa === ESTADO_ENCERRADA) {
    return "estado";
  }
  if (params.ultimaEntradaId !== params.mensagemId) return "rajada";
  return null;
}

interface MensagemHistorico {
  direcao: string; // entrada | saida
  texto: string;
  tipo?: string;
  respondidaPorIa?: boolean;
}

// Uma "resposta da IA" = um bloco de mensagens de saída da IA seguidas (até 3
// textos + mídia kit). Conta blocos, não mensagens, sem coluna nova no banco.
export function contarRespostasIa(mensagens: MensagemHistorico[]): number {
  let total = 0;
  let anteriorEraIa = false;
  for (const m of mensagens) {
    const ehIa = m.direcao === "saida" && Boolean(m.respondidaPorIa);
    if (ehIa && !anteriorEraIa) total++;
    anteriorEraIa = ehIa;
  }
  return total;
}

export interface TurnoHistorico {
  role: "user" | "assistant";
  content: string;
}

// Histórico para o modelo: últimas N mensagens (já em ordem cronológica),
// entrada → user, saída → assistant, juntando mensagens seguidas do mesmo lado
// e começando sempre por user (exigência da API). Mensagem sem texto (áudio,
// imagem...) vira um marcador, para a IA saber que a pessoa mandou algo.
export function montarHistorico(
  mensagens: MensagemHistorico[],
  max = HISTORICO_MAX_MENSAGENS
): TurnoHistorico[] {
  const turnos: TurnoHistorico[] = [];
  for (const m of mensagens.slice(-max)) {
    const texto = m.texto.trim() || (m.direcao === "entrada" ? `[mensagem do tipo ${m.tipo ?? "desconhecido"}, sem texto]` : "");
    if (!texto) continue;
    const role = m.direcao === "entrada" ? "user" : "assistant";
    const ultimo = turnos[turnos.length - 1];
    if (ultimo && ultimo.role === role) ultimo.content += `\n${texto}`;
    else turnos.push({ role, content: texto });
  }
  if (turnos[0]?.role === "assistant") {
    turnos.unshift({ role: "user", content: "(conversa iniciada pela clínica)" });
  }
  return turnos;
}

export interface ContextoLead {
  agora: Date;
  nomeContato: string | null;
  palavraCta: string | null;
  origem: "pessoa_escreveu" | "modelo_planilha";
}

// Bloco de contexto anexado ao system prompt a cada chamada.
export function montarContexto(ctx: ContextoLead): string {
  const fuso = "America/Sao_Paulo";
  const data = new Intl.DateTimeFormat("pt-BR", {
    timeZone: fuso,
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(ctx.agora);
  const hora = new Intl.DateTimeFormat("pt-BR", { timeZone: fuso, hour: "2-digit", minute: "2-digit" }).format(
    ctx.agora
  );
  return [
    "## Contexto desta conversa (enviado pela plataforma)",
    `- Data de hoje (São Paulo): ${data}`,
    `- Horário atual (São Paulo): ${hora}`,
    `- Nome da pessoa: ${ctx.nomeContato ?? "desconhecido"}`,
    `- Palavra do CTA: ${ctx.palavraCta ?? "nenhuma"}`,
    `- Origem da conversa: ${ctx.origem === "pessoa_escreveu" ? "a própria pessoa escreveu primeiro" : "modelo enviado pela planilha"}`,
    "",
    "## Formato da resposta",
    "Responda só no formato estruturado pedido:",
    "- `mensagens`: até 5, enviadas nesta ordem. Cada uma tem `texto` e `botoes` (até 3 botões de no máximo 20 caracteres; lista vazia se não houver).",
    "- Ação ENVIAR_MIDIA_KIT: marque `enviarMidiaKitDepois: true` na mensagem que deve vir logo antes do PDF (a frase \"Esse é o material de apresentação da Dra. Pâmela Rachid.\"). O PDF é enviado logo depois dela e antes das mensagens seguintes. Marque no máximo uma mensagem.",
    "- `passarParaHumano`: { resumo } ou null (ação PASSAR_PARA_HUMANO).",
    "- `encerrar`: true para a ação ENCERRAR.",
  ].join("\n");
}
