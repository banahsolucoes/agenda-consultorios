// Preenche o googleSyncStatus (campo novo, default NAO_APLICAVEL) dos
// Agendamentos criados antes dele existir, com base no estado que já dá pra
// inferir do banco:
//   - googleEventId preenchido            -> SINCRONIZADO
//   - googleEventId nulo + clínica conectada ao Google agora -> FALHOU
//     (a integração devia ter rodado e não gerou evento — provável vítima do
//     bug do gate por tipoSessaoEhOnline, corrigido em 2026-07-21)
//   - googleEventId nulo + clínica não conectada -> NAO_APLICAVEL
//     (nunca houve integração pra tentar)
// "Conectada" usa os mesmos campos que obterClienteGoogleDaClinica() checa
// (googleConectado + googleRefreshToken) — não chama a API do Google, só lê
// o estado já persistido, então não tem custo/side-effect de rede.
//
// Execução única, não faz parte do fluxo normal da aplicação. Não mexe em
// PENDENTE (não há hoje nenhum fluxo assíncrono que deixaria uma sessão
// nesse estado).
//
// Conecta via DIRECT_URL (porta 5432), nunca o pooler — mesma regra das
// migrations.
//
// Uso: node scripts/backfill-google-sync-status.mjs

import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";

if (!process.env.DIRECT_URL) {
  console.error("DIRECT_URL não definida no ambiente.");
  process.exit(1);
}

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const clinicas = await prisma.clinica.findMany({
    select: { id: true, googleConectado: true, googleRefreshToken: true },
  });
  const clinicaConectada = new Map(
    clinicas.map((c) => [c.id, Boolean(c.googleConectado && c.googleRefreshToken)])
  );

  const agendamentos = await prisma.agendamento.findMany({
    select: { id: true, googleEventId: true, pacienteId: true, googleSyncStatus: true },
  });
  const pacienteIds = [...new Set(agendamentos.map((a) => a.pacienteId))];
  const pacientes = await prisma.paciente.findMany({
    where: { id: { in: pacienteIds } },
    select: { id: true, clinicaId: true },
  });
  const clinicaDoPaciente = new Map(pacientes.map((p) => [p.id, p.clinicaId]));

  const contagem = { SINCRONIZADO: 0, FALHOU: 0, NAO_APLICAVEL: 0 };

  for (const a of agendamentos) {
    let status;
    if (a.googleEventId) {
      status = "SINCRONIZADO";
    } else {
      const clinicaId = clinicaDoPaciente.get(a.pacienteId);
      status = clinicaConectada.get(clinicaId) ? "FALHOU" : "NAO_APLICAVEL";
    }

    if (a.googleSyncStatus !== status) {
      await prisma.agendamento.update({ where: { id: a.id }, data: { googleSyncStatus: status } });
    }
    contagem[status]++;
  }

  console.log(`Total de agendamentos processados: ${agendamentos.length}`);
  console.log(`  SINCRONIZADO: ${contagem.SINCRONIZADO}`);
  console.log(`  FALHOU:       ${contagem.FALHOU}`);
  console.log(`  NAO_APLICAVEL: ${contagem.NAO_APLICAVEL}`);
}

main()
  .catch((err) => {
    console.error("Falha no script:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
