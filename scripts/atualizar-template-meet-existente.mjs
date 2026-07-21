// Atualiza templateMeet das clínicas que ainda estão no texto-padrão antigo
// (sem {hora}) para o novo default com horário. Clínicas que já
// personalizaram a mensagem (valor diferente do default antigo) são
// puladas — não sobrescrevemos customização do usuário. Execução única, não
// faz parte do fluxo normal da aplicação.
//
// Conecta via DIRECT_URL (porta 5432), nunca o pooler — mesma regra das
// migrations.
//
// Uso: node scripts/atualizar-template-meet-existente.mjs

import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";

if (!process.env.DIRECT_URL) {
  console.error("DIRECT_URL não definida no ambiente.");
  process.exit(1);
}

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL });
const prisma = new PrismaClient({ adapter });

const TEMPLATE_MEET_ANTIGO =
  "{saudacao} {paciente}, tudo bem? ☀️\n" +
  "\n" +
  "Segue o link da sua sessão de hoje.\n" +
  "🔗 {linkMeet} 🔗\n" +
  "\n" +
  "Qualquer coisa, estou por aqui.\n" +
  "\n" +
  "{assistente} 🥰";

const TEMPLATE_MEET_NOVO =
  "{saudacao} {paciente}, tudo bem? ☀️\n" +
  "\n" +
  "Segue o link da sua sessão de hoje às {hora}h.\n" +
  "🔗 {linkMeet} 🔗\n" +
  "\n" +
  "Qualquer coisa, estou por aqui.\n" +
  "\n" +
  "{assistente} 🥰";

async function main() {
  const clinicas = await prisma.clinica.findMany({
    select: { id: true, nome: true, templateMeet: true },
    orderBy: { nome: "asc" },
  });

  const paraAtualizar = clinicas.filter((c) => c.templateMeet === TEMPLATE_MEET_ANTIGO);
  const puladas = clinicas.filter((c) => c.templateMeet !== TEMPLATE_MEET_ANTIGO);

  for (const c of paraAtualizar) {
    await prisma.clinica.update({ where: { id: c.id }, data: { templateMeet: TEMPLATE_MEET_NOVO } });
  }

  console.log(`✓ Atualizadas: ${paraAtualizar.length}`);
  for (const c of paraAtualizar) console.log(`  - id: ${c.id}  nome: ${c.nome}`);

  console.log(`\nPuladas (templateMeet já customizado): ${puladas.length}`);
  for (const c of puladas) console.log(`  - id: ${c.id}  nome: ${c.nome}`);
}

main()
  .catch((err) => {
    console.error("Falha no script:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
