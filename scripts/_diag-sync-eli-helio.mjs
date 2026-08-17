// DIAGNÓSTICO READ-ONLY (2026-08-17) — apenas SELECT, nenhuma escrita.
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const agora = new Date();

  const pacientes = await prisma.paciente.findMany({
    where: {
      OR: [
        { nome: { contains: "Eli Lima", mode: "insensitive" } },
        { nome: { contains: "Helio", mode: "insensitive" } },
        { nome: { contains: "Hélio", mode: "insensitive" } },
      ],
    },
  });
  console.log("=== Pacientes encontrados ===");
  console.log(pacientes.map(p => ({ id: p.id, nome: p.nome, clinicaId: p.clinicaId })));

  const pacienteIds = pacientes.map(p => p.id);

  const agendamentos = await prisma.agendamento.findMany({
    where: {
      pacienteId: { in: pacienteIds },
      inicio: { gte: new Date(agora.getTime() - 24 * 3600 * 1000) },
    },
    orderBy: { inicio: "asc" },
    include: { paciente: { select: { nome: true } } },
  });

  console.log("\n=== Agendamentos (futuros, DB) ===");
  for (const a of agendamentos) {
    console.log({
      id: a.id,
      paciente: a.paciente?.nome,
      inicio: a.inicio,
      duracaoMin: a.duracaoMin,
      status: a.status,
      googleEventId: a.googleEventId,
      googleCalendarId: a.googleCalendarId,
      googleSyncStatus: a.googleSyncStatus,
      criadoEm: a.criadoEm,
    });
  }

  const agendamentoIds = agendamentos.map(a => a.id);

  console.log("\n=== SincronizacaoPendente relevante (payload contém agendamentoId/pacienteId) ===");
  const pendentes = await prisma.sincronizacaoPendente.findMany({
    orderBy: { createdAt: "desc" },
    take: 1000,
  });
  const relevantes = pendentes.filter(p => {
    try {
      const s = JSON.stringify(p.payload);
      return agendamentoIds.some(id => s.includes(id)) || pacienteIds.some(id => s.includes(id));
    } catch {
      return false;
    }
  });
  for (const p of relevantes) {
    console.log({
      id: p.id,
      tipo: p.tipo,
      status: p.status,
      tentativas: p.tentativas,
      ultimoErro: p.ultimoErro,
      proximaTentativaEm: p.proximaTentativaEm,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
      payload: p.payload,
    });
  }

  console.log("\n=== Fila geral: contagem por status ===");
  const grupos = await prisma.sincronizacaoPendente.groupBy({
    by: ["status"],
    _count: { _all: true },
  });
  console.log(grupos);

  const maisAntigoPendente = await prisma.sincronizacaoPendente.findFirst({
    where: { status: "PENDENTE" },
    orderBy: { createdAt: "asc" },
  });
  console.log("\nItem PENDENTE mais antigo:", maisAntigoPendente ? {
    id: maisAntigoPendente.id,
    createdAt: maisAntigoPendente.createdAt,
    tipo: maisAntigoPendente.tipo,
    tentativas: maisAntigoPendente.tentativas,
  } : null);

  console.log("\n=== Clínica(s) envolvidas — estado Google ===");
  const clinicaIds = [...new Set(pacientes.map(p => p.clinicaId))];
  const clinicas = await prisma.clinica.findMany({
    where: { id: { in: clinicaIds } },
    select: {
      id: true,
      nome: true,
      googleConectado: true,
      googleTokenValido: true,
      googleUltimaFalhaEm: true,
      googleUltimoErro: true,
      googleUltimoErroEm: true,
      googleCalendarId: true,
    },
  });
  console.log(clinicas);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
