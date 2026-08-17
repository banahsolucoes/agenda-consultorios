// AUDITORIA READ-ONLY (2026-08-13) — apenas SELECT, nenhuma escrita.
// Reporta presença/tamanho dos tokens Google da clínica, NUNCA o valor.
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";

if (!process.env.DIRECT_URL && !process.env.DATABASE_URL) {
  console.error("DIRECT_URL/DATABASE_URL não definida no ambiente.");
  process.exit(1);
}

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const clinicas = await prisma.clinica.findMany({
    select: {
      id: true,
      nome: true,
      googleConectado: true,
      googleTokenValido: true,
      googleUltimaFalhaEm: true,
      googleRefreshToken: true,
      googleAccessToken: true,
      googleTokenExpiry: true,
      googleEscopos: true,
    },
  });

  for (const c of clinicas) {
    console.log(`\n--- Clínica ${c.nome} (${c.id}) ---`);
    console.log("googleConectado:", c.googleConectado);
    console.log("googleTokenValido:", c.googleTokenValido);
    console.log("googleUltimaFalhaEm:", c.googleUltimaFalhaEm?.toISOString() ?? null);
    console.log("refreshToken presente:", c.googleRefreshToken ? "SIM" : "NÃO");
    console.log("refreshToken length:", c.googleRefreshToken?.length ?? 0);
    console.log("accessToken presente:", c.googleAccessToken ? "SIM" : "NÃO");
    console.log("accessToken length:", c.googleAccessToken?.length ?? 0);
    console.log("googleTokenExpiry:", c.googleTokenExpiry?.toISOString() ?? null);
    console.log("googleEscopos:", c.googleEscopos ?? null);
    console.log("(modelo Clinica não tem coluna updatedAt — sem timestamp de última alteração do registro)");
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("Erro na auditoria:", err);
  await prisma.$disconnect();
  process.exit(1);
});
