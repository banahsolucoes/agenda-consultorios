import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { verificarFinalizacao } from "@/lib/finalizacao";
import { obterClinicaECalendar } from "@/lib/google";
import { registrarLog } from "@/lib/auditoria";
import {
  filtrarSessoesElegiveis,
  montarDetalheLote,
  resolverNomePaciente,
  statusLoteValido,
} from "@/lib/loteSessoes";
import { validarStatusSessao } from "@/lib/validacaoSessao";

export async function POST(req: NextRequest) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });

  const body = await req.json();
  const ids: unknown = body.ids;
  const statusBruto: unknown = body.status;

  if (!Array.isArray(ids) || ids.length === 0 || ids.some((id) => typeof id !== "string")) {
    return NextResponse.json({ erro: "ids é obrigatório" }, { status: 400 });
  }
  if (!statusLoteValido(statusBruto)) {
    return NextResponse.json({ erro: "status inválido" }, { status: 400 });
  }
  const status = statusBruto;

  let motivo = "";
  let arquivar = false;
  if (status === "CANCELADA") {
    motivo = typeof body.motivoCancelamento === "string" ? body.motivoCancelamento.trim() : "";
    if (!motivo) {
      return NextResponse.json({ erro: "motivo do cancelamento é obrigatório" }, { status: 400 });
    }
    arquivar = body.arquivar === true;
  }

  const sessoes = await prisma.agendamento.findMany({
    where: { id: { in: ids } },
    include: { paciente: true },
  });

  // Toda sessão fora da clínica do usuário logado é tratada como "não
  // encontrada" (mesmo critério 404 da rota individual) — nunca revela a
  // existência do recurso de outra clínica.
  const elegiveis = filtrarSessoesElegiveis(sessoes, usuario.clinicaId);

  // Mesma trava da rota individual (validarStatusSessao): sessão futura não
  // pode ir para Realizada/Não realizada. Consistente com o resto do lote —
  // nunca rejeita a operação inteira, só pula a sessão inválida (mesmo
  // critério "puladas" já usado para sessão de outra clínica/já consumida).
  const validas = elegiveis.filter((s) => validarStatusSessao(status, s.inicio).valido);
  const puladas = ids.length - validas.length;

  if (validas.length === 0) {
    return NextResponse.json({ aplicadas: 0, puladas: ids.length });
  }

  // Remoção dos eventos do Google Calendar é melhor esforço: busca o cliente
  // uma única vez para todo o lote e nunca deixa uma falha de integração
  // impedir o cancelamento local de nenhuma sessão.
  if (status === "CANCELADA") {
    const google = await obterClinicaECalendar(usuario.clinicaId);
    if (google) {
      for (const s of validas) {
        if (!s.googleEventId) continue;
        await google.calendar.events
          .delete({
            calendarId: s.googleCalendarId ?? google.clinica.googleCalendarId ?? "primary",
            eventId: s.googleEventId,
          })
          .catch((err) => console.error("Falha ao remover evento do Google Calendar:", err));
      }
    }
  }

  await prisma.$transaction(
    validas.map((s) =>
      prisma.agendamento.update({
        where: { id: s.id },
        data:
          status === "CANCELADA"
            ? { status, motivoCancelamento: motivo, ...(arquivar ? { arquivada: true } : {}) }
            : { status },
      })
    )
  );

  // Sessões selecionadas podem pertencer a pacotes diferentes do mesmo
  // paciente (ex.: atendimento renovado) — verifica a finalização de cada um.
  const pacoteIds = Array.from(new Set(validas.map((s) => s.pacoteId)));
  let pacoteFinalizado = false;
  for (const pacoteId of pacoteIds) {
    const finalizou = await verificarFinalizacao(pacoteId, usuario.id);
    if (finalizou) pacoteFinalizado = true;
  }

  const nomePaciente = resolverNomePaciente(validas.map((s) => s.paciente.nome));
  const acao = status === "CANCELADA" ? "LOTE_CANCELAR" : "LOTE_STATUS";
  const detalhe = montarDetalheLote(status, validas.length, nomePaciente, motivo, arquivar);

  await registrarLog(usuario.clinicaId, usuario.id, acao, detalhe);

  return NextResponse.json({ aplicadas: validas.length, puladas, pacoteFinalizado });
}
