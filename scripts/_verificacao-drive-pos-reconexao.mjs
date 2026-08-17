// AUDITORIA READ-ONLY (2026-08-13) — verificação de acesso Drive pós-reconexão.
// Só chama drive.files.get / drive.files.list. Nenhuma escrita no Drive nem no banco.
import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";
import { google } from "googleapis";

if (!process.env.DIRECT_URL && !process.env.DATABASE_URL) {
  console.error("DIRECT_URL/DATABASE_URL não definida no ambiente.");
  process.exit(1);
}

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

function extrairIdPastaDrive(valor) {
  const texto = valor.trim();
  if (!texto) return "";
  try {
    const url = new URL(texto);
    const idQuery = url.searchParams.get("id");
    if (idQuery) return idQuery;
    const partes = url.pathname.split("/").filter(Boolean);
    return partes[partes.length - 1] ?? "";
  } catch {
    return texto;
  }
}

function criarOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

async function obterClienteGoogleDaClinica(clinica) {
  if (!clinica.googleConectado || !clinica.googleRefreshToken) return null;
  const client = criarOAuthClient();
  client.setCredentials({
    refresh_token: clinica.googleRefreshToken,
    access_token: clinica.googleAccessToken ?? undefined,
    expiry_date: clinica.googleTokenExpiry?.getTime(),
  });
  return client;
}

async function main() {
  const clinica = await prisma.clinica.findFirst({ where: { googleConectado: true } });
  if (!clinica) {
    console.error("Nenhuma clínica conectada ao Google.");
    await prisma.$disconnect();
    return;
  }

  const auth = await obterClienteGoogleDaClinica(clinica);
  if (!auth) {
    console.error("Não foi possível montar o cliente Google da clínica.");
    await prisma.$disconnect();
    return;
  }
  const drive = google.drive({ version: "v3", auth });

  const candidatos = await prisma.paciente.findMany({
    where: { clinicaId: clinica.id, pastaDriveUrl: { not: "" } },
    select: { id: true, nome: true, pastaDriveUrl: true, criadoEm: true },
    orderBy: { criadoEm: "asc" },
    take: 3,
  });

  console.log(`\n=== Clínica: ${clinica.nome} ===`);
  console.log("\n| Paciente | Criado em | fileId | Resultado |");
  console.log("|---|---|---|---|");

  for (const p of candidatos) {
    const fileId = extrairIdPastaDrive(p.pastaDriveUrl ?? "");
    try {
      const { data } = await drive.files.get({ fileId, fields: "id, name, mimeType, trashed" });
      console.log(`| ${p.nome} | ${p.criadoEm.toISOString().slice(0, 10)} | ${fileId} | SUCESSO (mimeType=${data.mimeType}, trashed=${data.trashed}) |`);
    } catch (err) {
      const status = err?.code ?? err?.response?.status ?? "??";
      const msg = err?.response?.data?.error?.message ?? err?.message ?? "erro desconhecido";
      console.log(`| ${p.nome} | ${p.criadoEm.toISOString().slice(0, 10)} | ${fileId} | FALHA (HTTP ${status}: ${msg}) |`);
    }
  }

  console.log("\n=== drive.files.list() — enumeração total ===");
  let total = 0;
  let pageToken;
  try {
    do {
      const { data } = await drive.files.list({
        pageSize: 1000,
        fields: "nextPageToken, files(id)",
        pageToken,
      });
      total += data.files?.length ?? 0;
      pageToken = data.nextPageToken ?? undefined;
    } while (pageToken);
    console.log(`Total de arquivos/pastas enumerados: ${total}`);
  } catch (err) {
    const status = err?.code ?? err?.response?.status ?? "??";
    const msg = err?.response?.data?.error?.message ?? err?.message ?? "erro desconhecido";
    console.log(`FALHA no list() — HTTP ${status}: ${msg}`);
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("Erro na verificação:", err);
  await prisma.$disconnect();
  process.exit(1);
});
