import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { enviarConfirmacaoAgenda } from "@/lib/whatsapp/enviarTemplate";
import { formatarDataCurtaSP, formatarHoraSP } from "@/lib/timezone";

const HORA_MS = 60 * 60 * 1000;
// Alvo é 48h corridas antes da sessão, mas o plano Vercel (Hobby) só permite
// cron 1x/dia — não dá pra rodar de hora em hora como uma janela estreita de
// 48h exigiria. Em vez disso, a janela é larga (24h-72h de antecedência,
// centrada em 48h) e roda 1x/dia: toda sessão futura acaba caindo na janela
// em pelo menos uma execução diária (a largura de 48h da janela cobre a
// distância de 24h entre execuções, sem buraco), e `lembreteWhatsappEnviadoEm`
// evita reenvio nas execuções seguintes em que ela ainda aparecer na janela.
const JANELA_INICIO_H = 24;
const JANELA_FIM_H = 72;

// GET /api/cron/whatsapp-lembretes — envia o template "confirmacao_agenda"
// (Meta) para agendamentos ainda não confirmados que caem na janela de ~48h.
// Protegida por CRON_SECRET, mesmo padrão de /api/cron/verificar-google-noturno.
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  }

  const agora = new Date();
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
  const falhas: { agendamentoId: string; pacienteId: string; erro: string }[] = [];

  for (const agendamento of candidatos) {
    const telefone = agendamento.paciente.telefone?.trim();
    if (!telefone) {
      falhas.push({ agendamentoId: agendamento.id, pacienteId: agendamento.pacienteId, erro: "sem telefone" });
      continue;
    }

    try {
      const resultado = await enviarConfirmacaoAgenda({
        clinicaId: agendamento.paciente.clinicaId,
        pacienteId: agendamento.pacienteId,
        telefone,
        nome: agendamento.paciente.nome,
        data: formatarDataCurtaSP(agendamento.inicio),
        hora: formatarHoraSP(agendamento.inicio),
      });

      if (resultado.sucesso) {
        await prisma.agendamento.update({
          where: { id: agendamento.id },
          data: { lembreteWhatsappEnviadoEm: agora },
        });
        enviados++;
      } else {
        falhas.push({ agendamentoId: agendamento.id, pacienteId: agendamento.pacienteId, erro: resultado.erro ?? "falha desconhecida" });
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

  return NextResponse.json({
    ok: true,
    avaliados: candidatos.length,
    enviados,
    falharam: falhas.length,
    falhas,
  });
}
