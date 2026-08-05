// One-off: backfill de Agendamento.clinicaId a partir de paciente.clinicaId,
// parte da Fase 1 do bloco "reuniões de mentorado na agenda" (clinicaId
// próprio no Agendamento, hoje sempre derivado via paciente.clinicaId).
//
// Executado em 2026-08-05: 634/634 agendamentos atualizados, 0 restantes
// com clinicaId NULL — confirmado antes da migração seguinte que tornou o
// campo NOT NULL (20260805202809_agendamento_clinicaid_obrigatorio).
//
// Modo dry-run por padrão (não escreve nada). Passar --apply para executar
// de fato o UPDATE.
//
// Conecta via DIRECT_URL (porta 5432), nunca o pooler — mesma regra das
// migrations.
//
// Uso:
//   node scripts/_backfill-agendamento-clinicaid.mjs            (dry-run)
//   node scripts/_backfill-agendamento-clinicaid.mjs --apply    (executa)

import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";

if (!process.env.DIRECT_URL) {
  console.error("DIRECT_URL não definida no ambiente.");
  process.exit(1);
}

const APLICAR = process.argv.includes("--apply");

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const totalAgendamentos = await prisma.agendamento.count();
  const jaComClinicaId = await prisma.agendamento.count({ where: { clinicaId: { not: null } } });
  const semClinicaId = await prisma.agendamento.count({ where: { clinicaId: null } });

  console.log(`Total de agendamentos: ${totalAgendamentos}`);
  console.log(`Já com clinicaId preenchido: ${jaComClinicaId}`);
  console.log(`Sem clinicaId (candidatos ao backfill): ${semClinicaId}`);

  // Candidatos: agendamentos sem clinicaId, com pacienteId presente.
  const candidatosComPaciente = await prisma.agendamento.findMany({
    where: { clinicaId: null, pacienteId: { not: null } },
    select: { id: true, pacienteId: true, paciente: { select: { clinicaId: true } } },
  });

  // Órfãos: sem clinicaId E sem pacienteId (não têm de onde derivar) — não deveria existir hoje.
  const orfaosSemPaciente = await prisma.agendamento.findMany({
    where: { clinicaId: null, pacienteId: null },
    select: { id: true, pacienteId: true, pacoteId: true, alunoId: true, inicio: true },
  });

  console.log(`\nSerão preenchidos (têm pacienteId → paciente.clinicaId): ${candidatosComPaciente.length}`);
  console.log(`Ficariam SEM clinicaId (sem pacienteId, nada a derivar): ${orfaosSemPaciente.length}`);

  if (orfaosSemPaciente.length > 0) {
    console.log("\n⚠️  Agendamentos órfãos (sem pacienteId) encontrados:");
    console.log(JSON.stringify(orfaosSemPaciente, null, 2));
  }

  const amostra = candidatosComPaciente.slice(0, 5).map((a) => ({
    id: a.id,
    pacienteId: a.pacienteId,
    clinicaIdQueSeriaSetado: a.paciente?.clinicaId ?? null,
  }));
  console.log("\nAmostra (5 primeiros):");
  console.log(JSON.stringify(amostra, null, 2));

  if (!APLICAR) {
    console.log("\n[DRY-RUN] Nenhuma escrita realizada. Rode com --apply para executar o backfill de fato.");
    return;
  }

  console.log("\n[APLICANDO] Executando backfill...");
  let atualizados = 0;
  for (const a of candidatosComPaciente) {
    if (!a.paciente?.clinicaId) continue; // não deveria acontecer — paciente sempre tem clinicaId
    await prisma.agendamento.update({
      where: { id: a.id },
      data: { clinicaId: a.paciente.clinicaId },
    });
    atualizados++;
  }
  console.log(`Backfill concluído: ${atualizados} agendamentos atualizados.`);

  const semClinicaIdDepois = await prisma.agendamento.count({ where: { clinicaId: null } });
  console.log(`Agendamentos ainda sem clinicaId após o backfill: ${semClinicaIdDepois}`);
}

main()
  .catch((err) => {
    console.error("Falha no script:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
