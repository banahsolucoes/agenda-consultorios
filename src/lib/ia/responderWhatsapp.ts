import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/prisma";
import { formatarDataCurtaSP, formatarHoraSP } from "@/lib/timezone";
import { enviarMensagemLivre } from "@/lib/whatsapp/enviarMensagem";

const MODELO = "claude-haiku-4-5";
const MAX_TENTATIVAS_TOOL_USE = 3;

const SYSTEM_PROMPT = `Você é a assistente virtual de uma clínica, respondendo mensagens de WhatsApp de pacientes que já têm sessão marcada. Classifique a intenção da mensagem do paciente em uma destas três categorias:

- CONFIRMAR: o paciente está confirmando a sessão (qualquer variação de "sim", "confirmado", "pode ser", "👍" etc.)
- REAGENDAR: o paciente quer desmarcar, cancelar, trocar de data/horário, ou remarcar de qualquer forma
- OUTRO: qualquer outra mensagem (dúvida de logística: endereço, horário, forma de pagamento, etc.)

Regras:
- Nunca invente data, hora ou status de agendamento. Se precisar de algum desses dados para responder, use a ferramenta consultar_status_agendamento antes de responder.
- Para CONFIRMAR e REAGENDAR, o campo "resposta" deve ser null — a ação do sistema (confirmar a sessão / acionar atendimento humano) já cobre o necessário, não precisa responder nada.
- Para OUTRO, escreva uma resposta curta no tom da Daiane (assistente da clínica): direta, acolhedora, emoji pontual, chama a pessoa pelo nome, sem formalidade excessiva — no estilo de "Boa tarde {nome}, tudo bem?! ...". Baseie qualquer data/hora/status citado em dados reais, obtidos pela ferramenta.`;

const TOOL_CONSULTAR_STATUS = {
  name: "consultar_status_agendamento",
  description:
    "Consulta o próximo agendamento futuro (não cancelado) do paciente desta conversa — data, hora e status real. Use antes de mencionar qualquer data/hora/status ao paciente.",
  input_schema: { type: "object" as const, properties: {}, additionalProperties: false },
};

const DECISAO_SCHEMA = {
  type: "object",
  properties: {
    intencao: { type: "string", enum: ["CONFIRMAR", "REAGENDAR", "OUTRO"] },
    resposta: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description: 'Texto a enviar ao paciente quando intencao="OUTRO"; null nos demais casos',
    },
  },
  required: ["intencao", "resposta"],
  additionalProperties: false,
};

interface Decisao {
  intencao: "CONFIRMAR" | "REAGENDAR" | "OUTRO";
  resposta: string | null;
}

async function buscarProximoAgendamento(pacienteId: string) {
  const agora = new Date();
  const agendamento = await prisma.agendamento.findFirst({
    where: { pacienteId, status: { in: ["AGENDADA", "REAGENDADA"] }, inicio: { gte: agora } },
    orderBy: { inicio: "asc" },
  });
  if (!agendamento) return { encontrado: false };
  return {
    encontrado: true,
    data: formatarDataCurtaSP(agendamento.inicio),
    hora: formatarHoraSP(agendamento.inicio),
    status: agendamento.status,
    confirmada: agendamento.confirmada,
  };
}

async function classificarIntencao(
  pacienteId: string,
  nomePaciente: string,
  textoRecebido: string
): Promise<Decisao> {
  const client = new Anthropic();
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: `Paciente: ${nomePaciente}\nMensagem recebida: "${textoRecebido}"` },
  ];

  for (let tentativa = 0; tentativa < MAX_TENTATIVAS_TOOL_USE; tentativa++) {
    const response = await client.messages.create({
      model: MODELO,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      tools: [TOOL_CONSULTAR_STATUS],
      output_config: { format: { type: "json_schema", schema: DECISAO_SCHEMA } },
      messages,
    });

    if (response.stop_reason === "tool_use") {
      const toolUse = response.content.find(
        (b): b is Anthropic.ToolUseBlock => b.type === "tool_use"
      );
      if (!toolUse) throw new Error("stop_reason tool_use sem bloco tool_use");

      messages.push({ role: "assistant", content: response.content });
      const resultado = await buscarProximoAgendamento(pacienteId);
      messages.push({
        role: "user",
        content: [{ type: "tool_result", tool_use_id: toolUse.id, content: JSON.stringify(resultado) }],
      });
      continue;
    }

    const textBlock = response.content.find((b): b is Anthropic.TextBlock => b.type === "text");
    if (!textBlock) throw new Error(`resposta sem bloco de texto (stop_reason=${response.stop_reason})`);
    return JSON.parse(textBlock.text) as Decisao;
  }

  throw new Error("excedeu tentativas de tool_use sem chegar a uma decisão");
}

export interface ResponderMensagemWhatsappParams {
  conversaId: string;
  pacienteId: string;
  telefone: string;
  nomePaciente: string;
  textoRecebido: string;
  janelaAbertaAte: Date | null;
}

// Interpreta a resposta do paciente a um lembrete/mensagem e age de acordo:
// confirma a sessão, escala pra humano, ou responde dúvidas de logística.
// Nunca lança — erro de classificação/envio é logado, não derruba o webhook.
export async function responderMensagemWhatsapp(params: ResponderMensagemWhatsappParams): Promise<void> {
  const { conversaId, pacienteId, telefone, nomePaciente, textoRecebido, janelaAbertaAte } = params;

  let decisao: Decisao;
  try {
    decisao = await classificarIntencao(pacienteId, nomePaciente, textoRecebido);
  } catch (erro) {
    console.error(`[whatsapp ia] falha ao classificar mensagem (conversa ${conversaId}):`, erro);
    return;
  }

  if (decisao.intencao === "CONFIRMAR") {
    const proximo = await prisma.agendamento.findFirst({
      where: { pacienteId, status: { in: ["AGENDADA", "REAGENDADA"] }, inicio: { gte: new Date() } },
      orderBy: { inicio: "asc" },
    });
    if (proximo) {
      await prisma.agendamento.update({ where: { id: proximo.id }, data: { confirmada: true } });
    }
    return;
  }

  if (decisao.intencao === "REAGENDAR") {
    await prisma.conversaWhatsapp.update({
      where: { id: conversaId },
      data: { estado: "aguardando_humano" },
    });
    return;
  }

  // OUTRO
  if (!decisao.resposta) return;

  if (!janelaAbertaAte || janelaAbertaAte.getTime() < Date.now()) {
    console.error(
      `[whatsapp ia] janela de 24h fechada, não é possível enviar resposta livre (conversa ${conversaId})`
    );
    return;
  }

  const resultado = await enviarMensagemLivre(telefone, decisao.resposta);
  if (!resultado.sucesso) {
    console.error(`[whatsapp ia] falha ao enviar resposta (conversa ${conversaId}):`, resultado.erro);
    return;
  }

  await prisma.mensagemWhatsapp.create({
    data: {
      conversaId,
      direcao: "saida",
      texto: decisao.resposta,
      tipo: "livre",
      respondidaPorIa: true,
      wamid: resultado.wamid ?? null,
    },
  });
}
