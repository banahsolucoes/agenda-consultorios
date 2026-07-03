// Seed único da Tarefa 7: cria os 4 tipos de sessão padrão para a clínica da Pâmela
// e vincula os pacientes existentes (via tipoSessaoLegado) ao tipo correspondente.
//
// Rodar DEPOIS de aplicar a migration que adiciona a tabela TipoSessao e a coluna
// Paciente.tipoSessaoId — mas ANTES de qualquer migration futura que remova a coluna
// legado "tipoSessao" (Paciente.tipoSessaoLegado), pois é dela que este script lê os
// valores antigos.
//
// Uso:
//   node prisma/seed-tipos-sessao.mjs                 → detecta a clínica pelo nome "Pâmela"
//   node prisma/seed-tipos-sessao.mjs --clinica=<id>  → aplica direto numa clínica específica

import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

function normalizar(texto) {
  return texto.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

const TIPOS_PADRAO = [
  { nome: "Sessão online", ehOnline: true },
  { nome: "Sessão presencial", ehOnline: false },
  { nome: "Avaliação online", ehOnline: true },
  { nome: "Avaliação presencial", ehOnline: false },
];

// Mapeia o valor antigo do enum (TipoSessaoLegado) para o nome do tipo padrão criado acima
const MAPA_LEGADO = {
  ONLINE: "Sessão online",
  PRESENCIAL: "Sessão presencial",
  AVAL_ONLINE: "Avaliação online",
  AVAL_PRESENCIAL: "Avaliação presencial",
};

async function resolverClinicaId() {
  const argClinica = process.argv.find((a) => a.startsWith("--clinica="));
  if (argClinica) {
    const id = argClinica.split("=")[1];
    const clinica = await prisma.clinica.findUnique({ where: { id } });
    if (!clinica) throw new Error(`Clínica ${id} não encontrada.`);
    return clinica.id;
  }

  const usuarios = await prisma.usuario.findMany({ include: { clinica: true } });
  const candidatos = usuarios.filter(
    (u) => normalizar(u.nome).includes("pamela") || normalizar(u.clinica.nome).includes("pamela")
  );

  const clinicaIds = [...new Set(candidatos.map((u) => u.clinicaId))];

  if (clinicaIds.length === 1) return clinicaIds[0];

  console.error(
    clinicaIds.length === 0
      ? "Nenhum usuário/clínica com 'Pâmela' no nome foi encontrado."
      : "Mais de uma clínica corresponde a 'Pâmela' — rode de novo com --clinica=<id>."
  );
  console.error("Clínicas disponíveis:");
  for (const u of usuarios) {
    console.error(`  - usuário "${u.nome}" <${u.email}> → clínica "${u.clinica.nome}" (${u.clinicaId})`);
  }
  process.exit(1);
}

async function main() {
  const clinicaId = await resolverClinicaId();
  console.log(`Semeando tipos de sessão para a clínica ${clinicaId}...`);

  const tiposPorNome = {};
  for (const t of TIPOS_PADRAO) {
    const existente = await prisma.tipoSessao.findFirst({ where: { clinicaId, nome: t.nome } });
    tiposPorNome[t.nome] =
      existente ??
      (await prisma.tipoSessao.create({
        data: { clinicaId, nome: t.nome, ehOnline: t.ehOnline, duracaoPadraoMin: 45 },
      }));
    console.log(`  ✓ ${t.nome} → ${tiposPorNome[t.nome].id}`);
  }

  const pacientes = await prisma.paciente.findMany({
    where: { clinicaId, tipoSessaoId: null, tipoSessaoLegado: { not: null } },
  });

  let vinculados = 0;
  for (const p of pacientes) {
    const nomeTipo = MAPA_LEGADO[p.tipoSessaoLegado];
    const tipo = nomeTipo ? tiposPorNome[nomeTipo] : null;
    if (!tipo) {
      console.warn(`  ! paciente ${p.id} (${p.nome}) tem tipoSessaoLegado="${p.tipoSessaoLegado}" sem mapeamento — pulado`);
      continue;
    }
    await prisma.paciente.update({ where: { id: p.id }, data: { tipoSessaoId: tipo.id } });
    vinculados++;
  }

  console.log(`Concluído: ${vinculados}/${pacientes.length} paciente(s) vinculado(s) ao novo tipo de sessão.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
