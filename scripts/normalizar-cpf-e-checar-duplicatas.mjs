// Normaliza os CPFs existentes de Paciente para só dígitos e checa se sobra
// algum par (clinicaId, cpf) duplicado — pré-requisito para adicionar
// @@unique([clinicaId, cpf]) no schema. Execução única, não faz parte do
// fluxo normal da aplicação.
//
// Conecta via DIRECT_URL (porta 5432), nunca o pooler — mesma regra das
// migrations.
//
// Uso: node scripts/normalizar-cpf-e-checar-duplicatas.mjs

import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";

if (!process.env.DIRECT_URL) {
  console.error("DIRECT_URL não definida no ambiente.");
  process.exit(1);
}

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL });
const prisma = new PrismaClient({ adapter });

function soDigitos(s) {
  return (s || "").replace(/\D/g, "");
}

// Normaliza cada CPF não-nulo para só dígitos. Se depois de tirar tudo que
// não é número não sobrar nada (ex.: CPF gravado como só espaços/traços),
// vira null — CPF nulo permanece nulo.
async function normalizarCpfs() {
  const pacientes = await prisma.paciente.findMany({
    where: { cpf: { not: null } },
    select: { id: true, cpf: true },
  });

  let atualizados = 0;
  for (const p of pacientes) {
    const normalizado = soDigitos(p.cpf) || null;
    if (normalizado !== p.cpf) {
      await prisma.paciente.update({ where: { id: p.id }, data: { cpf: normalizado } });
      atualizados++;
    }
  }

  console.log(`✓ CPFs normalizados: ${atualizados} de ${pacientes.length} pacientes com CPF preenchido`);
}

// Agrupa por (clinicaId, cpf) só entre os que têm CPF (null nunca conflita)
// e reporta qualquer grupo com mais de um paciente.
async function checarDuplicatas() {
  const pacientes = await prisma.paciente.findMany({
    where: { cpf: { not: null } },
    select: { id: true, nome: true, clinicaId: true, cpf: true },
    orderBy: { nome: "asc" },
  });

  const grupos = new Map();
  for (const p of pacientes) {
    const chave = `${p.clinicaId}::${p.cpf}`;
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave).push(p);
  }

  const duplicatas = [...grupos.values()].filter((grupo) => grupo.length > 1);

  if (duplicatas.length > 0) {
    console.log(`\n${duplicatas.length} par(es) (clinicaId, cpf) duplicado(s):\n`);
    for (const grupo of duplicatas) {
      console.log(`clinicaId: ${grupo[0].clinicaId}  cpf: ${grupo[0].cpf}`);
      for (const p of grupo) {
        console.log(`  - id: ${p.id}  nome: ${p.nome}`);
      }
      console.log("");
    }
    console.log("DUPLICATAS ENCONTRADAS — parar");
    return false;
  }

  console.log("SEM DUPLICATAS — ok para constraint");
  return true;
}

async function main() {
  await normalizarCpfs();
  const semDuplicatas = await checarDuplicatas();
  process.exitCode = semDuplicatas ? 0 : 1;
}

main()
  .catch((err) => {
    console.error("Falha no script:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
