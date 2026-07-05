import { prisma } from "@/lib/prisma";

// Registra uma linha de log de auditoria. Tolerante a falha de propósito —
// logar é "melhor esforço": se a gravação do log falhar, a operação
// principal (que já foi concluída) nunca deve ser desfeita ou barrada por
// causa disso.
export async function registrarLog(
  clinicaId: string,
  usuarioId: string | null,
  acao: string,
  detalhe: string
): Promise<void> {
  try {
    await prisma.logAuditoria.create({
      data: { clinicaId, usuarioId, acao, detalhe },
    });
  } catch (err) {
    console.error("Falha ao registrar log de auditoria:", err);
  }
}
