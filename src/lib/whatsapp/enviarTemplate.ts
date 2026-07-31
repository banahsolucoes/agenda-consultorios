import { prisma } from "@/lib/prisma";
import { normalizarTelefoneE164 } from "@/lib/whatsapp/telefone";

const JANELA_24H_MS = 24 * 60 * 60 * 1000;
const META_API_VERSION = "v25.0";

export interface EnviarConfirmacaoAgendaParams {
  clinicaId: string;
  pacienteId: string;
  telefone: string; // Paciente.telefone bruto — a normalização acontece aqui dentro
  nome: string;
  data: string;
  hora: string;
}

export interface EnviarConfirmacaoAgendaResultado {
  sucesso: boolean;
  wamid?: string;
  erro?: string;
}

// Envia o template "confirmacao_agenda" (aprovado pela Meta, {{1}}=nome,
// {{2}}=data, {{3}}=hora, botões Confirmar/Cancelar/Reagendar) e, em caso de
// sucesso, grava a mensagem de saída na conversa. Nunca lança — todo erro
// (telefone inválido, falha da API, falha de banco ao gravar a mensagem)
// volta como { sucesso: false, erro } para o chamador decidir o que fazer,
// sem derrubar o restante de um lote (ex.: o cron de lembretes).
export async function enviarConfirmacaoAgenda(
  params: EnviarConfirmacaoAgendaParams
): Promise<EnviarConfirmacaoAgendaResultado> {
  const { clinicaId, pacienteId, telefone, nome, data, hora } = params;

  const telefoneE164 = normalizarTelefoneE164(telefone);
  if (!telefoneE164) {
    return { sucesso: false, erro: `telefone fora do padrão E.164: "${telefone}"` };
  }

  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  if (!phoneNumberId || !accessToken) {
    return { sucesso: false, erro: "WHATSAPP_PHONE_NUMBER_ID/WHATSAPP_ACCESS_TOKEN não configurados" };
  }

  let wamid: string | undefined;
  try {
    const resp = await fetch(`https://graph.facebook.com/${META_API_VERSION}/${phoneNumberId}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: telefoneE164,
        type: "template",
        template: {
          name: "confirmacao_agenda",
          language: { code: "pt_BR" },
          components: [
            {
              type: "body",
              parameters: [
                { type: "text", text: nome },
                { type: "text", text: data },
                { type: "text", text: hora },
              ],
            },
          ],
        },
      }),
    });

    const corpo = await resp.json();

    if (!resp.ok) {
      const erroMeta = corpo?.error;
      console.error(
        `[whatsapp enviarConfirmacaoAgenda] falha da API Meta (paciente ${pacienteId}, telefone ${telefoneE164}):`,
        `code=${erroMeta?.code} title=${erroMeta?.error_subcode ?? erroMeta?.type} message=${erroMeta?.message}`
      );
      return { sucesso: false, erro: erroMeta?.message ?? `HTTP ${resp.status}` };
    }

    wamid = corpo?.messages?.[0]?.id;
  } catch (erro) {
    console.error(
      `[whatsapp enviarConfirmacaoAgenda] erro de rede ao chamar a API Meta (paciente ${pacienteId}):`,
      erro
    );
    return { sucesso: false, erro: erro instanceof Error ? erro.message : "erro de rede desconhecido" };
  }

  try {
    const agora = new Date();
    let conversa = await prisma.conversaWhatsapp.findFirst({
      where: { clinicaId, telefone: telefoneE164 },
    });

    if (!conversa) {
      conversa = await prisma.conversaWhatsapp.create({
        data: {
          clinicaId,
          pacienteId,
          telefone: telefoneE164,
          janelaAbertaAte: new Date(agora.getTime() + JANELA_24H_MS),
          ultimaMensagemEm: agora,
        },
      });
    } else {
      conversa = await prisma.conversaWhatsapp.update({
        where: { id: conversa.id },
        data: { ultimaMensagemEm: agora },
      });
    }

    await prisma.mensagemWhatsapp.create({
      data: {
        conversaId: conversa.id,
        direcao: "saida",
        texto: `Confirmação de agenda: ${nome}, ${data} às ${hora}`,
        tipo: "template",
        wamid: wamid ?? null,
      },
    });
  } catch (erro) {
    console.error(
      `[whatsapp enviarConfirmacaoAgenda] mensagem enviada (wamid=${wamid}) mas falhou ao gravar no banco (paciente ${pacienteId}):`,
      erro
    );
    return { sucesso: true, wamid, erro: "enviado, mas falhou ao persistir a conversa/mensagem" };
  }

  return { sucesso: true, wamid };
}
