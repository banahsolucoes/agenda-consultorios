// Importação real (única execução) dos pacientes do Notion para o Postgres,
// na clínica "pamela-rachid". Consolida as 7 duplicatas já confirmadas com a
// Pâmela (ver scratchpad/duplicatas-pamela.md) usando as regras:
//   - e-mail presente vence ausente
//   - telefone com o dígito 9 vence telefone sem o 9
//   - nome mais completo (mais longo) vence
//   - status geral: usa o valor não-vazio do grupo (só um registro do par tem)
//
// Idempotente: antes de criar, verifica se já existe paciente na clínica com o
// mesmo telefone normalizado OU o mesmo nome (case/acento-insensitive) e pula.
//
// Uso: node scratchpad/importar-pacientes-notion.mjs

import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DB_CLIENTES = process.env.NOTION_DB_CLIENTES;
const NOTION_VERSION = "2022-06-28";
const CLINICA_SLUG = "pamela-rachid";
const TIPO_SESSAO_PADRAO = "Sessão online";

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL ?? process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function queryDatabase(databaseId, startCursor) {
  const url = `https://api.notion.com/v1/databases/${databaseId}/query`;
  const body = startCursor ? { start_cursor: startCursor, page_size: 100 } : { page_size: 100 };
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Notion API respondeu ${response.status}: ${await response.text()}`);
  return response.json();
}

function getPlainText(arr) {
  return Array.isArray(arr) ? arr.map((t) => t.plain_text ?? "").join("") : "";
}

function extractPropertyValue(property) {
  if (!property) return "";
  switch (property.type) {
    case "title": return getPlainText(property.title);
    case "rich_text": return getPlainText(property.rich_text);
    case "phone_number": return property.phone_number ?? "";
    case "select": return property.select?.name ?? "";
    case "status": return property.status?.name ?? "";
    case "email": return property.email ?? "";
    default: return "";
  }
}

const FIELD_CANDIDATES = {
  nome: ["Nome do paciente", "Nome", "Name", "Paciente", "Cliente"],
  telefone: ["Telefone", "Phone", "Celular", "WhatsApp"],
  email: ["E-mail", "Email"],
  status: ["Status geral", "Status", "Situacao", "Situação"],
};

function extractField(properties, candidates) {
  for (const key of candidates) {
    if (properties[key]) {
      const value = extractPropertyValue(properties[key]);
      if (value !== "") return value;
    }
  }
  return "";
}

// Chave canônica de telefone: DDD + últimos 8 dígitos, ignorando o "9" de
// celular quando presente — unifica "61 9843-4293" e "61998434293".
function chavePhone(telefone) {
  let digits = (telefone ?? "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.startsWith("55") && digits.length > 11) digits = digits.slice(2);
  digits = digits.replace(/^0+/, "");
  if (digits.length === 11) return digits.slice(0, 2) + digits.slice(3);
  return digits;
}

function formatPhone(raw) {
  let digits = (raw ?? "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("55") && digits.length > 11) digits = digits.slice(2);
  digits = digits.replace(/^0+/, "");
  if (digits.length === 11) {
    return `+55 (${digits.slice(0, 2)}) ${digits.slice(2, 7)}-${digits.slice(7)}`;
  }
  if (digits.length === 10) {
    return `+55 (${digits.slice(0, 2)}) ${digits.slice(2, 6)}-${digits.slice(6)}`;
  }
  return raw.trim();
}

function normalizarNome(nome) {
  return nome
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

const STATUS_MAP = {
  ativo: "ATIVO",
  finalizado: "FINALIZADO",
  cancelado: "CANCELADO",
};

function mapStatus(status) {
  const chave = normalizarNome(status || "");
  return STATUS_MAP[chave] ?? "ATIVO";
}

async function buscarPacientesNotion() {
  let allPages = [];
  let hasMore = true;
  let cursor;
  while (hasMore) {
    const data = await queryDatabase(NOTION_DB_CLIENTES, cursor);
    allPages = allPages.concat(data.results);
    hasMore = data.has_more;
    cursor = data.next_cursor ?? undefined;
  }

  return allPages.map((page) => {
    const props = page.properties ?? {};
    return {
      id: page.id,
      criadoEm: page.created_time,
      nome: (extractField(props, FIELD_CANDIDATES.nome) || "(sem nome)").trim(),
      telefone: extractField(props, FIELD_CANDIDATES.telefone),
      email: extractField(props, FIELD_CANDIDATES.email),
      status: extractField(props, FIELD_CANDIDATES.status),
    };
  });
}

function consolidarDuplicatas(pacientes) {
  const grupos = new Map();
  pacientes.forEach((p) => {
    const chave = chavePhone(p.telefone) || `__sem-telefone-${p.id}`;
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave).push(p);
  });

  const consolidados = [];
  for (const lista of grupos.values()) {
    if (lista.length === 1) {
      const p = lista[0];
      consolidados.push({
        nome: p.nome,
        telefoneRaw: p.telefone,
        email: p.email || null,
        status: mapStatus(p.status),
        origens: [p.id],
      });
      continue;
    }

    // nome mais completo (mais longo) vence
    const nome = [...lista].sort((a, b) => b.nome.length - a.nome.length)[0].nome;
    // telefone com mais dígitos (proxy para "tem o 9") vence
    const telefoneRaw = [...lista].sort(
      (a, b) => (b.telefone ?? "").replace(/\D/g, "").length - (a.telefone ?? "").replace(/\D/g, "").length
    )[0].telefone;
    // email presente vence ausente
    const email = lista.find((p) => p.email)?.email || null;
    // status: usa o valor não-vazio do grupo (default ATIVO se nenhum tiver)
    const status = mapStatus(lista.find((p) => p.status)?.status || "");

    consolidados.push({ nome, telefoneRaw, email, status, origens: lista.map((p) => p.id) });
  }

  return consolidados;
}

async function main() {
  console.log("Lendo pacientes do Notion...");
  const brutos = await buscarPacientesNotion();
  console.log(`Total bruto no Notion: ${brutos.length}`);

  const consolidados = consolidarDuplicatas(brutos);
  console.log(`Total após consolidar duplicatas: ${consolidados.length}\n`);

  const clinica = await prisma.clinica.findUnique({ where: { slug: CLINICA_SLUG } });
  if (!clinica) throw new Error(`Clínica de slug "${CLINICA_SLUG}" não encontrada.`);

  const tipoSessao = await prisma.tipoSessao.findFirst({
    where: { clinicaId: clinica.id, nome: TIPO_SESSAO_PADRAO },
  });
  if (!tipoSessao) throw new Error(`Tipo de sessão "${TIPO_SESSAO_PADRAO}" não encontrado na clínica.`);

  const existentes = await prisma.paciente.findMany({
    where: { clinicaId: clinica.id },
    select: { nome: true, telefone: true },
  });
  const telefonesExistentes = new Set(existentes.map((p) => chavePhone(p.telefone)).filter(Boolean));
  const nomesExistentes = new Set(existentes.map((p) => normalizarNome(p.nome)));

  const importados = [];
  const pulados = [];

  for (const p of consolidados) {
    const chave = chavePhone(p.telefoneRaw);
    const nomeNorm = normalizarNome(p.nome);
    const jaExiste = (chave && telefonesExistentes.has(chave)) || nomesExistentes.has(nomeNorm);

    if (jaExiste) {
      pulados.push({ nome: p.nome, motivo: "já existe na clínica (telefone ou nome coincide)" });
      continue;
    }

    await prisma.paciente.create({
      data: {
        clinicaId: clinica.id,
        nome: p.nome,
        telefone: formatPhone(p.telefoneRaw),
        email: p.email,
        statusGeral: p.status,
        diaPreferido: "SEGUNDA",
        horarioFixo: "08:00",
        tipoSessaoId: tipoSessao.id,
        origemCadastro: "FORMS",
      },
    });

    importados.push(p.nome);
    // evita reimportar duplicata dentro do próprio lote (ex.: nomes repetidos no Notion)
    if (chave) telefonesExistentes.add(chave);
    nomesExistentes.add(nomeNorm);
  }

  console.log(`Importados: ${importados.length}`);
  console.log(`Pulados: ${pulados.length}`);
  console.log("\n--- Importados ---");
  importados.forEach((n, i) => console.log(`${i + 1}. ${n}`));
  console.log("\n--- Pulados ---");
  pulados.forEach((p) => console.log(`- ${p.nome} (${p.motivo})`));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
