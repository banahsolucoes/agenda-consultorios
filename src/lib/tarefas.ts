import { Prisma } from "@/generated/prisma";

type TransacaoPrisma = Prisma.TransactionClient;

// Mantém a Tarefa RENOVACAO de um paciente sincronizada com o statusGeral.
// Chamada nos 3 pontos que alteram Paciente.statusGeral (finalização
// automática, renovação por novo pacote e edição manual), dentro da mesma
// transação da mudança de status.
export async function sincronizarTarefaRenovacao(
  tx: TransacaoPrisma,
  paciente: { id: string; clinicaId: string; nome: string },
  novoStatus: "ATIVO" | "FINALIZADO" | "CANCELADO",
  usuarioId: string | null
): Promise<{ tarefaCriada: boolean; tarefasConcluidas: number }> {
  if (novoStatus === "FINALIZADO") {
    const existente = await tx.tarefa.findFirst({
      where: { pacienteId: paciente.id, tipo: "RENOVACAO", status: "PENDENTE" },
    });
    if (existente) return { tarefaCriada: false, tarefasConcluidas: 0 };

    await tx.tarefa.create({
      data: {
        clinicaId: paciente.clinicaId,
        tipo: "RENOVACAO",
        origem: "SISTEMA",
        titulo: `Renovação — ${paciente.nome}`,
        pacienteId: paciente.id,
        dataAviso: null,
        criadoPor: null,
      },
    });
    return { tarefaCriada: true, tarefasConcluidas: 0 };
  }

  // ATIVO ou CANCELADO: a pendência de renovação deixa de fazer sentido.
  const resultado = await tx.tarefa.updateMany({
    where: { pacienteId: paciente.id, tipo: "RENOVACAO", status: "PENDENTE" },
    data: { status: "CONCLUIDA", concluidoEm: new Date(), concluidoPor: usuarioId },
  });
  return { tarefaCriada: false, tarefasConcluidas: resultado.count };
}
