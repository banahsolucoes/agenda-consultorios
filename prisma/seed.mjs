// Seed de desenvolvimento: recria os dados base da clínica "Fono Pâmela Rachid"
// depois de um reset do banco. Idempotente — rodar de novo não duplica nada.
//
// NÃO cria usuário: o usuário do Supabase Auth é criado pela tela/endpoint de
// signup, que vincula o registro em Usuario à clínica existente.
//
// Uso:
//   npx prisma db seed
//   node prisma/seed.mjs

import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const CLINICA = {
  nome: "Fono Pâmela Rachid",
  slug: "pamela-rachid",
};

const TIPOS_SESSAO = [
  { nome: "Sessão online", ehOnline: true, cor: "#4285f4", duracaoPadraoMin: 45 },
  { nome: "Sessão presencial", ehOnline: false, cor: "#27ae60", duracaoPadraoMin: 45 },
  { nome: "Avaliação online", ehOnline: true, cor: "#c9a96e", duracaoPadraoMin: 45 },
  { nome: "Avaliação presencial", ehOnline: false, cor: "#f2994a", duracaoPadraoMin: 45 },
];

const DIAS_TRABALHO = ["SEGUNDA", "TERCA", "QUARTA", "QUINTA"];
const HORARIO_TRABALHO = { horaInicio: "08:00", horaFim: "19:30" };

async function seedClinica() {
  const clinica = await prisma.clinica.upsert({
    where: { slug: CLINICA.slug },
    update: {},
    create: CLINICA,
  });
  console.log(`✓ Clínica "${clinica.nome}" (${clinica.id})`);
  return clinica;
}

async function seedTiposSessao(clinicaId) {
  for (const tipo of TIPOS_SESSAO) {
    const existente = await prisma.tipoSessao.findFirst({
      where: { clinicaId, nome: tipo.nome },
    });
    if (existente) {
      console.log(`  = tipo de sessão "${tipo.nome}" já existe`);
      continue;
    }
    const criado = await prisma.tipoSessao.create({ data: { clinicaId, ...tipo } });
    console.log(`  ✓ tipo de sessão "${criado.nome}" criado`);
  }
}

async function seedHorarios(clinicaId) {
  for (const diaSemana of DIAS_TRABALHO) {
    const existente = await prisma.horarioTrabalho.findFirst({
      where: { clinicaId, diaSemana },
    });
    if (existente) {
      console.log(`  = horário de ${diaSemana} já existe`);
      continue;
    }
    await prisma.horarioTrabalho.create({
      data: { clinicaId, diaSemana, ...HORARIO_TRABALHO },
    });
    console.log(
      `  ✓ horário de ${diaSemana} (${HORARIO_TRABALHO.horaInicio}-${HORARIO_TRABALHO.horaFim}) criado`
    );
  }
}

async function main() {
  const clinica = await seedClinica();
  await seedTiposSessao(clinica.id);
  await seedHorarios(clinica.id);
  console.log("Seed concluído.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
