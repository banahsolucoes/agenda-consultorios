import { prisma } from "@/lib/prisma";
import { registrarLog } from "@/lib/auditoria";
import { sincronizarTarefaRenovacao } from "@/lib/tarefas";

const CONSUMIDOS = ["REALIZADA", "NAO_REALIZADA"];

// Verifica se o pacote acabou; se sim, finaliza pacote + paciente.
// Retorna true se finalizou (para o front acender o lembrete de renovação).
// usuarioId é quem disparou a ação que levou à finalização (ex.: marcou a
// última sessão como Realizada) — usado só para o log de auditoria.
export async function verificarFinalizacao(pacoteId: string, usuarioId?: string | null): Promise<boolean> {
  const sessoes = await prisma.agendamento.findMany({
    where: { pacoteId, status: { not: "CANCELADA" } },
  });

  if (sessoes.length === 0) return false;

  const todasConsumidas = sessoes.every((s) => CONSUMIDOS.includes(s.status));
  if (!todasConsumidas) return false;

  const { paciente, tarefa } = await prisma.$transaction(async (tx) => {
    const pacote = await tx.pacote.update({
      where: { id: pacoteId },
      data: { status: "FINALIZADO" },
    });

    const paciente = await tx.paciente.update({
      where: { id: pacote.pacienteId },
      data: { statusGeral: "FINALIZADO", finalizadoEm: new Date() },
    });

    const tarefa = await sincronizarTarefaRenovacao(tx, paciente, "FINALIZADO", usuarioId ?? null);
    return { paciente, tarefa };
  });

  await registrarLog(
    paciente.clinicaId,
    usuarioId ?? null,
    "FINALIZAR_ATENDIMENTO",
    `Atendimento de ${paciente.nome} finalizado automaticamente (todas as sessões concluídas)`
  );
  if (tarefa.tarefaCriada) {
    await registrarLog(
      paciente.clinicaId,
      usuarioId ?? null,
      "CRIAR_TAREFA_RENOVACAO",
      `Tarefa de renovação criada para ${paciente.nome}`
    );
  }

  return true;
}
