// AUDITORIA READ-ONLY (2026-09-02) — detecção de googleEventId reaproveitado
// entre agendamentos distintos, clínica Fono Pâmela Rachid. Sem filtro de
// data/status: inclui CANCELADA e REALIZADA. NENHUM write no banco, NENHUMA
// chamada de escrita ao Google, NENHUM enfileiramento. Script temporário,
// não commitável.
//
// Uso: npx tsx scripts/tmp/auditoria-eventid.ts
import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { formatarDataHoraSP } from "@/lib/timezone";

async function main() {
  const clinica = await prisma.clinica.findFirst({
    where: { nome: { contains: "Pâmela", mode: "insensitive" } },
  });
  if (!clinica) {
    console.error("Clínica Fono Pâmela Rachid não encontrada.");
    process.exit(1);
  }

  const agendamentos = await prisma.agendamento.findMany({
    where: { clinicaId: clinica.id },
    include: { paciente: true },
    orderBy: { criadoEm: "asc" },
  });

  console.log(`Total de agendamentos (qualquer status) da clínica: ${agendamentos.length}\n`);

  const grupos = new Map<string, typeof agendamentos>();
  for (const a of agendamentos) {
    if (!a.googleEventId) continue;
    if (!grupos.has(a.googleEventId)) grupos.set(a.googleEventId, []);
    grupos.get(a.googleEventId)!.push(a);
  }

  const duplicados = [...grupos.entries()]
    .filter(([, lista]) => lista.length > 1)
    .sort((a, b) => b[1].length - a[1].length);

  console.log(`googleEventId distintos usados: ${grupos.size}`);
  console.log(`googleEventId duplicados (count > 1): ${duplicados.length}`);
  const totalAfetados = duplicados.reduce((soma, [, lista]) => soma + lista.length, 0);
  console.log(`Total de agendamentos afetados: ${totalAfetados}\n`);

  for (const [eventId, lista] of duplicados) {
    lista.sort((a, b) => a.criadoEm.getTime() - b.criadoEm.getTime());
    console.log(`\n=== googleEventId=${eventId} (${lista.length} agendamentos) ===`);
    console.log("id agendamento                       | paciente                     | dataHoraInicio          | status        | googleSyncStatus | createdAt               | updatedAt");
    for (const a of lista) {
      console.log(
        `${a.id} | ${(a.paciente?.nome ?? "(sem paciente)").padEnd(28)} | ${formatarDataHoraSP(a.inicio).padEnd(24)} | ${a.status.padEnd(13)} | ${a.googleSyncStatus.padEnd(17)} | ${formatarDataHoraSP(a.criadoEm).padEnd(24)} | ${formatarDataHoraSP(a.updatedAt)}`
      );
    }
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
