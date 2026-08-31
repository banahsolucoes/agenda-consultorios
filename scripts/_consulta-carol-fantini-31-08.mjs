// Somente leitura. Localiza o agendamento de Carol Fantini Gobbi em 31/08 11:30
// "Sessão 4/4", para obter o id antes de uma correção posterior.
// Nenhum UPDATE/INSERT/DELETE é executado por este script.
//
// Uso: node scripts/_consulta-carol-fantini-31-08.mjs

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
  const candidatos = await prisma.agendamento.findMany({
    where: {
      paciente: { nome: { contains: "Carol Fantini Gobbi" } },
    },
    include: { paciente: { select: { id: true, nome: true } } },
    orderBy: { inicio: "asc" },
  });

  console.log(`Total de agendamentos encontrados para o paciente: ${candidatos.length}\n`);

  for (const a of candidatos) {
    console.log(
      JSON.stringify(
        {
          id: a.id,
          pacienteId: a.pacienteId,
          paciente: a.paciente.nome,
          inicio: a.inicio.toISOString(),
          status: a.status,
          numeroSessao: a.numeroSessao,
          totalPacote: a.totalPacote,
          arquivada: a.arquivada,
        },
        null,
        2
      )
    );
  }
}

main()
  .catch((err) => {
    console.error("Falha no script:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
