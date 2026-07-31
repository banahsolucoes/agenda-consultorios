import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { normalizarTelefoneE164 } from "@/lib/whatsapp/telefone";
import { getProvider } from "@/lib/whatsapp/provider";
import { componentesSP, criarDataSP, formatarDataCurtaSP, formatarHoraSP } from "@/lib/timezone";
import { renderizarTemplateMensagem, saudacaoAtual } from "@/lib/templatesMensagem";

const HORA_MS = 60 * 60 * 1000;
const JANELA_24H_MS = 24 * HORA_MS;
// Identifica no MensagemWhatsapp.tipo as mensagens do dia — serve de
// idempotência (não reenviar no mesmo dia) sem precisar de campo novo no
// Agendamento.
const TIPO_MENSAGEM_DIA = "meet_dia";

// Alvo é 48h corridas antes da sessão, mas o plano Vercel (Hobby) só permite
// cron 1x/dia — não dá pra rodar de hora em hora como uma janela estreita de
// 48h exigiria. Em vez disso, a janela é larga (24h-72h de antecedência,
// centrada em 48h): a largura de 48h cobre a distância de 24h entre
// execuções diárias sem deixar buraco, e `lembreteWhatsappEnviadoEm` evita
// reenvio nas execuções seguintes em que ela ainda aparecer na janela.
const JANELA_INICIO_H = 24;
const JANELA_FIM_H = 72;

type Falha = { agendamentoId: string; pacienteId: string; erro: string };

async function enviarLembretes48h(agora: Date) {
  const inicioJanela = new Date(agora.getTime() + JANELA_INICIO_H * HORA_MS);
  const fimJanela = new Date(agora.getTime() + JANELA_FIM_H * HORA_MS);

  const candidatos = await prisma.agendamento.findMany({
    where: {
      inicio: { gte: inicioJanela, lt: fimJanela },
      status: { not: "CANCELADA" },
      confirmada: false,
      lembreteWhatsappEnviadoEm: null,
      paciente: { telefone: { not: null } },
    },
    include: { paciente: true },
    orderBy: { inicio: "asc" },
  });

  let enviados = 0;
  const falhas: Falha[] = [];

  for (const agendamento of candidatos) {
    const telefone = agendamento.paciente.telefone?.trim();
    if (!telefone) {
      falhas.push({ agendamentoId: agendamento.id, pacienteId: agendamento.pacienteId, erro: "sem telefone" });
      continue;
    }

    try {
      const resultado = await getProvider().enviarTemplate({
        clinicaId: agendamento.paciente.clinicaId,
        pacienteId: agendamento.pacienteId,
        telefone,
        nome: agendamento.paciente.nome,
        data: formatarDataCurtaSP(agendamento.inicio),
        hora: formatarHoraSP(agendamento.inicio),
      });

      if (resultado.ok) {
        await prisma.agendamento.update({
          where: { id: agendamento.id },
          data: { lembreteWhatsappEnviadoEm: agora },
        });
        enviados++;
      } else {
        falhas.push({ agendamentoId: agendamento.id, pacienteId: agendamento.pacienteId, erro: resultado.erro });
      }
    } catch (erro) {
      console.error(`[cron-whatsapp-lembretes] erro inesperado no agendamento ${agendamento.id}:`, erro);
      falhas.push({
        agendamentoId: agendamento.id,
        pacienteId: agendamento.pacienteId,
        erro: erro instanceof Error ? erro.message : "erro inesperado",
      });
    }
  }

  return { avaliados: candidatos.length, enviados, falharam: falhas.length, falhas };
}

// Mensagem do link do Meet pras sessões de hoje que já têm link, independente
// de `confirmada`. Reaproveita Clinica.templateMeet (mesmo texto do botão de
// copiar-colar já existente) e Agendamento.linkMeet (já populado por
// criarEventoGoogleMeet). Limitação real: mensagem de texto livre só é
// aceita pela Meta dentro da janela de 24h da conversa — sem template
// aprovado equivalente ao "confirmacao_agenda" pro link do Meet, quem está
// fora da janela aparece em `falhas`, sem tentar contornar.
async function enviarMensagensDoDia(agora: Date) {
  const c = componentesSP(agora);
  const inicioHoje = criarDataSP(c.ano, c.mes, c.dia, 0, 0, 0);
  const fimHoje = criarDataSP(c.ano, c.mes, c.dia, 23, 59, 59);

  const candidatos = await prisma.agendamento.findMany({
    where: {
      inicio: { gte: inicioHoje, lte: fimHoje },
      status: { not: "CANCELADA" },
      linkMeet: { not: null },
      paciente: { telefone: { not: null } },
    },
    include: { paciente: { include: { clinica: true } } },
    orderBy: { inicio: "asc" },
  });

  let enviados = 0;
  const falhas: Falha[] = [];

  for (const agendamento of candidatos) {
    const telefoneBruto = agendamento.paciente.telefone?.trim();
    if (!telefoneBruto) {
      falhas.push({ agendamentoId: agendamento.id, pacienteId: agendamento.pacienteId, erro: "sem telefone" });
      continue;
    }
    const telefoneE164 = normalizarTelefoneE164(telefoneBruto);
    if (!telefoneE164) {
      falhas.push({
        agendamentoId: agendamento.id,
        pacienteId: agendamento.pacienteId,
        erro: `telefone fora do padrão E.164: "${telefoneBruto}"`,
      });
      continue;
    }

    const clinica = agendamento.paciente.clinica;
    const clinicaId = agendamento.paciente.clinicaId;

    let conversa = await prisma.conversaWhatsapp.findFirst({ where: { clinicaId, telefone: telefoneE164 } });
    if (!conversa) {
      conversa = await prisma.conversaWhatsapp.create({
        data: {
          clinicaId,
          pacienteId: agendamento.pacienteId,
          telefone: telefoneE164,
          janelaAbertaAte: null,
          ultimaMensagemEm: agora,
        },
      });
    }

    if (!conversa.janelaAbertaAte || conversa.janelaAbertaAte.getTime() < agora.getTime()) {
      falhas.push({
        agendamentoId: agendamento.id,
        pacienteId: agendamento.pacienteId,
        erro: "janela de 24h fechada — paciente não escreveu recentemente",
      });
      continue;
    }

    const jaEnviadaHoje = await prisma.mensagemWhatsapp.findFirst({
      where: { conversaId: conversa.id, tipo: TIPO_MENSAGEM_DIA, criadoEm: { gte: inicioHoje } },
    });
    if (jaEnviadaHoje) continue;

    const texto = renderizarTemplateMensagem(clinica.templateMeet, {
      saudacao: saudacaoAtual(agora),
      paciente: agendamento.paciente.nome.split(" ")[0],
      hora: formatarHoraSP(agendamento.inicio),
      linkMeet: agendamento.linkMeet ?? "",
      assistente: clinica.nomeAssistente,
    });

    const resultado = await getProvider().enviarMensagemLivre(telefoneBruto, texto);
    if (!resultado.ok) {
      falhas.push({
        agendamentoId: agendamento.id,
        pacienteId: agendamento.pacienteId,
        erro: resultado.erro,
      });
      continue;
    }

    await prisma.conversaWhatsapp.update({
      where: { id: conversa.id },
      data: { ultimaMensagemEm: agora, janelaAbertaAte: new Date(agora.getTime() + JANELA_24H_MS) },
    });
    await prisma.mensagemWhatsapp.create({
      data: {
        conversaId: conversa.id,
        direcao: "saida",
        texto,
        tipo: TIPO_MENSAGEM_DIA,
        wamid: resultado.externalId || null,
      },
    });
    enviados++;
  }

  return { avaliados: candidatos.length, enviados, falharam: falhas.length, falhas };
}

// GET /api/cron/whatsapp-lembretes — uma única execução diária cobrindo os
// dois critérios de envio de saída via WhatsApp: (1) lembrete de confirmação
// ~48h antes da sessão (template "confirmacao_agenda") e (2) link do Meet
// pra sessão de hoje. Fundidos numa rota só (2026-07-24) porque o plano
// Vercel (Hobby) limita o projeto a 2 cron jobs — um terceiro cron dedicado
// não coube. Protegida por CRON_SECRET, mesmo padrão dos outros crons.
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  }

  const agora = new Date();
  const [lembretes48h, mensagensDoDia] = await Promise.all([
    enviarLembretes48h(agora),
    enviarMensagensDoDia(agora),
  ]);

  return NextResponse.json({ ok: true, lembretes48h, mensagensDoDia });
}
