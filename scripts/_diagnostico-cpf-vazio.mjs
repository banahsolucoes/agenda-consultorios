// Diagnóstico read-only (nenhuma escrita) pedido no Bloco B2, item 6: dos
// pacientes sem CPF na clínica, quantos têm nome que casa (normalizado) com
// algum "Nome Completo" da planilha configurada — serve de insumo pra
// decidir o tratamento de duplicidade na importação (ver ARCHITECTURE.md §9,
// "PENDENTE DE DECISÃO — tratamento de duplicidade/complemento").
import "dotenv/config";
import { google } from "googleapis";
import pg from "pg";

const SLUG_CLINICA = "pamela-rachid";

function normalizarNome(s) {
  return (s || "")
    .normalize("NFD")
    .replace(/\p{Mark}/gu, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function normalizarCabecalho(s) {
  return (s || "")
    .normalize("NFD")
    .replace(/\p{Mark}/gu, "")
    .toLowerCase()
    .trim();
}

// Mesmo padrão de scripts/reprocessar-anamnese.ts: TODA saída derivada de
// campo de paciente deve passar por aqui antes de ir pro console — nenhum
// caminho deste script pode imprimir nome/CPF/telefone/e-mail crus. Hoje o
// script só imprime contagens e os literais [REDIGIDO — MATCH]/[REDIGIDO —
// SEM MATCH] (nunca o nome em si), mas a função fica disponível como padrão
// obrigatório pra qualquer extensão futura que precise ecoar um campo.
const CAMPOS_PII_ROTULOS = new Set(
  [
    "nome completo",
    "seu cpf",
    "seu rg",
    "telefone (whatsapp)",
    "telefone",
    "e-mail",
    "endereço completo",
    "cep",
    "seu instagram",
    "data de nascimento",
  ]
);
const REGEX_CPF_OU_TELEFONE = /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b|\b\d{10,11}\b/g;
const REGEX_EMAIL = /[\w.+-]+@[\w-]+\.[a-zA-Z]{2,}/g;

function redigir(texto) {
  const porRotulo = (texto || "")
    .split("\n")
    .map((linha) => {
      const idx = linha.indexOf(": ");
      if (idx === -1) return linha;
      const rotulo = linha.slice(0, idx).trim().toLowerCase();
      if (CAMPOS_PII_ROTULOS.has(rotulo)) return `${linha.slice(0, idx)}: [REDIGIDO]`;
      return linha;
    })
    .join("\n");
  return porRotulo.replace(REGEX_CPF_OU_TELEFONE, "[REDIGIDO]").replace(REGEX_EMAIL, "[REDIGIDO]");
}

const client = new pg.Client({ connectionString: process.env.DIRECT_URL });
await client.connect();

const { rows: clinicas } = await client.query(
  `SELECT id, "sheetsPlanilhaId", "sheetsAba", "googleConectado", "googleRefreshToken", "googleAccessToken", "googleTokenExpiry"
   FROM "Clinica" WHERE slug = $1`,
  [SLUG_CLINICA]
);
const clinica = clinicas[0];
if (!clinica) {
  console.log(`NAO ENCONTRADO: clínica "${SLUG_CLINICA}"`);
  await client.end();
  process.exit(1);
}
if (!clinica.sheetsPlanilhaId || !clinica.googleConectado || !clinica.googleRefreshToken) {
  console.log("NAO ENCONTRADO: planilha não configurada ou Google não conectado");
  await client.end();
  process.exit(1);
}

const auth = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  process.env.GOOGLE_REDIRECT_URI
);
auth.setCredentials({
  refresh_token: clinica.googleRefreshToken,
  access_token: clinica.googleAccessToken || undefined,
  expiry_date: clinica.googleTokenExpiry ? new Date(clinica.googleTokenExpiry).getTime() : undefined,
});

const sheets = google.sheets({ version: "v4", auth });
const aba = clinica.sheetsAba || "Página1";
const resp = await sheets.spreadsheets.values.get({ spreadsheetId: clinica.sheetsPlanilhaId, range: aba });
const valores = resp.data.values || [];

if (valores.length < 2) {
  console.log("Planilha vazia ou só cabeçalho — nada a comparar.");
  await client.end();
  process.exit(0);
}

const cabecalhoOriginal = valores[0];
const cabecalhoNormalizado = cabecalhoOriginal.map(normalizarCabecalho);
const idxNomeCompleto = cabecalhoNormalizado.indexOf("nome completo");
if (idxNomeCompleto === -1) {
  console.log('NAO ENCONTRADO: coluna "Nome Completo" não existe na planilha');
  await client.end();
  process.exit(1);
}

const nomesPlanilha = new Set(
  valores
    .slice(1)
    .map((linha) => normalizarNome(linha[idxNomeCompleto] || ""))
    .filter(Boolean)
);

const { rows: pacientesSemCpf } = await client.query(
  `SELECT id, nome FROM "Paciente" WHERE "clinicaId" = $1 AND (cpf IS NULL OR trim(cpf) = '')`,
  [clinica.id]
);

let comMatch = 0;
const exemplos = [];
for (const p of pacientesSemCpf) {
  const bateu = nomesPlanilha.has(normalizarNome(p.nome));
  if (bateu) comMatch++;
  if (exemplos.length < 3) {
    exemplos.push(bateu ? "[REDIGIDO — MATCH]" : "[REDIGIDO — SEM MATCH]");
  }
}

console.log(`Pacientes sem CPF na clínica: ${pacientesSemCpf.length}`);
console.log(`Com nome (normalizado) batendo em "Nome Completo" da planilha: ${comMatch}`);
console.log("Exemplos (3 primeiros, nome redigido):");
exemplos.forEach((e) => console.log(`  - ${e}`));

await client.end();
