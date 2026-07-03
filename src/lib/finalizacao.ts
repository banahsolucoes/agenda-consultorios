import { prisma } from "@/lib/prisma";

const CONSUMIDOS = ["REALIZADA", "NAO_REALIZADA"];

// Verifica se o pacote acabou; se sim, finaliza pacote + paciente.
// Retorna true se finalizou (para o front acender o lembrete de renovação).
export async function verificarFinalizacao(pacoteId: string): Promise<boolean> {
  const sessoes = await prisma.agendamento.findMany({
    where: { pacoteId, status: { not: "CANCELADA" } },
  });

  if (sessoes.length === 0) return false;

  const todasConsumidas = sessoes.every((s) => CONSUMIDOS.includes(s.status));
  if (!todasConsumidas) return false;

  const pacote = await prisma.pacote.update({
    where: { id: pacoteId },
    data: { status: "FINALIZADO" },
  });

  await prisma.paciente.update({
    where: { id: pacote.pacienteId },
    data: { statusGeral: "FINALIZADO" },
  });

  return true;
}
