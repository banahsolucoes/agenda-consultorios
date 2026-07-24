import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { componentesSP, criarDataSP, formatarHoraSP } from "@/lib/timezone";
import { renderizarTemplateMensagem, saudacaoAtual } from "@/lib/templatesMensagem";
import { enviarMensagemLivre } from "@/lib/whatsapp/enviarMensagem";
import { normalizarTelefoneE164 } from "@/lib/whatsapp/enviarTemplate";

const JANELA_24H_MS = 24 * 60 * 60 * 1000;
// Identifica no MensagemWhatsapp.tipo as mensagens desta rotina — serve de
// idempotência (não reenviar no mesmo dia) sem precisar de campo novo no
// Agendamento.
const TIPO_MENSAGEM_DIA = "meet_dia";

// GET /api/cron/whatsapp-dia-sessao — envia o link do Meet (texto livre,
// reaproveitando Clinica.templateMeet) pra quem tem sessão hoje com link
// gerado, independente de `confirmada`. Protegida por CRON_SECRET, mesmo
// padrão dos outros crons.
//
// Limitação conhecida: mensagem de texto livre só é aceita pela Meta dentro
// da janela de 24h da conversa (paciente precisa ter escrito recentemente).
// Sem template aprovado pra isso (diferente do lembrete de 48h, que usa o
// template "confirmacao_agenda"), quem está fora da janela aparece em
// `falhas` — a rotina não tenta contornar isso.
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  }

  const agora = new Date();
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
  const falhas: { agendamentoId: string; pacienteId: string; erro: string }[] = [];

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

    const resultado = await enviarMensagemLivre(telefoneBruto, texto);
    if (!resultado.sucesso) {
      falhas.push({
        agendamentoId: agendamento.id,
        pacienteId: agendamento.pacienteId,
        erro: resultado.erro ?? "falha desconhecida",
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
        wamid: resultado.wamid ?? null,
      },
    });
    enviados++;
  }

  return NextResponse.json({
    ok: true,
    avaliados: candidatos.length,
    enviados,
    falharam: falhas.length,
    falhas,
  });
}
