// Script para ativar o módulo Mentoria numa clínica existente
// Rode com: node scripts/ativar-mentoria.mjs <slug-da-clinica>

import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const slug = process.argv[2];
if (!slug) {
  console.error("Uso: node scripts/ativar-mentoria.mjs <slug-da-clinica>");
  process.exit(1);
}

async function main() {
  const clinica = await prisma.clinica.findUnique({ where: { slug } });
  if (!clinica) {
    console.error(`❌ Nenhuma clínica encontrada com slug "${slug}".`);
    process.exit(1);
  }

  if (clinica.mentoriaAtivada) {
    console.log(`ℹ️  Módulo Mentoria já estava ativado para "${clinica.nome}" (${clinica.id}).`);
    return;
  }

  const atualizada = await prisma.clinica.update({
    where: { id: clinica.id },
    data: { mentoriaAtivada: true },
  });

  console.log(`✅ Módulo Mentoria ativado para "${atualizada.nome}" (${atualizada.id}, slug: ${atualizada.slug}).`);
}

main()
  .catch((err) => {
    console.error("❌ Erro durante a execução:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
