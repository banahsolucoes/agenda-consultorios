// Gera um ConviteClinica de uso único para o cadastro público de clínica
// nova (POST /api/auth/signup exige um convite válido — ver
// src/app/api/auth/signup/route.ts). Token aleatório e longo (32 bytes,
// hex), validade de 14 dias.
//
// Conecta via DIRECT_URL (porta 5432), nunca o pooler — mesma regra das
// migrations e dos demais scripts one-off.
//
// Uso:
//   node scripts/gerar-convite.mjs --email=fulana@exemplo.com [--clinica="Nome da Clínica"]
//   node scripts/gerar-convite.mjs --email=fulana@exemplo.com --dry-run   (não grava nada)
//
// URL base do app: usa APP_URL do ambiente se definida; senão deriva de
// GOOGLE_REDIRECT_URI (removendo o sufixo do callback OAuth). Se nenhuma
// das duas estiver disponível, o script pede para definir APP_URL.

import "dotenv/config";
import crypto from "node:crypto";
import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";

const VALIDADE_DIAS = 14;

function parseArgs(argv) {
  const args = { dryRun: false };
  for (const arg of argv) {
    if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg.startsWith("--email=")) {
      args.email = arg.slice("--email=".length);
    } else if (arg.startsWith("--clinica=")) {
      args.clinica = arg.slice("--clinica=".length);
    } else if (arg.startsWith("--url=")) {
      args.url = arg.slice("--url=".length);
    }
  }
  return args;
}

function resolverUrlBase(args) {
  if (args.url) return args.url.replace(/\/$/, "");
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/$/, "");

  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  const sufixo = "/api/integracoes/google/callback";
  if (redirectUri && redirectUri.endsWith(sufixo)) {
    return redirectUri.slice(0, -sufixo.length);
  }

  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!args.email) {
    console.error("Uso: node scripts/gerar-convite.mjs --email=fulana@exemplo.com [--clinica=\"Nome\"] [--dry-run] [--url=https://app.exemplo.com]");
    process.exit(1);
  }

  const email = args.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error(`E-mail inválido: "${args.email}"`);
    process.exit(1);
  }

  const urlBase = resolverUrlBase(args);
  if (!urlBase) {
    console.error(
      "Não foi possível determinar a URL do app. Defina APP_URL no ambiente ou passe --url=https://app.exemplo.com"
    );
    process.exit(1);
  }

  const token = crypto.randomBytes(32).toString("hex");
  const expiraEm = new Date(Date.now() + VALIDADE_DIAS * 24 * 60 * 60 * 1000);
  const nomeClinicaSugerido = args.clinica?.trim() || null;

  const link = `${urlBase}/cadastro?convite=${token}`;

  if (args.dryRun) {
    console.log("[dry-run] Nada foi gravado no banco. Convite que seria criado:");
    console.log(`  email:               ${email}`);
    console.log(`  nomeClinicaSugerido: ${nomeClinicaSugerido ?? "(não informado)"}`);
    console.log(`  expiraEm:            ${expiraEm.toISOString()} (${VALIDADE_DIAS} dias)`);
    console.log(`  link:                ${link}`);
    return;
  }

  if (!process.env.DIRECT_URL) {
    console.error("DIRECT_URL não definida no ambiente.");
    process.exit(1);
  }

  const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL });
  const prisma = new PrismaClient({ adapter });

  try {
    const convite = await prisma.conviteClinica.create({
      data: { token, email, nomeClinicaSugerido, expiraEm },
    });
    console.log(`✓ Convite criado (id ${convite.id}), válido até ${expiraEm.toISOString()}.`);
    console.log("");
    console.log(link);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error("Falha ao gerar convite:", err);
  process.exit(1);
});
