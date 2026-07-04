// Script de LEITURA apenas: consulta a base de pacientes/clientes do Notion
// e imprime os dados no console para conferencia antes de qualquer importacao.
// Nao grava nada no banco nem no Notion.
//
// Uso: node scratchpad/ler-pacientes-notion.mjs

import "dotenv/config";

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DB_CLIENTES = process.env.NOTION_DB_CLIENTES;
const NOTION_VERSION = "2022-06-28";

if (!NOTION_TOKEN || !NOTION_DB_CLIENTES) {
  console.error(
    "Erro: defina NOTION_TOKEN e NOTION_DB_CLIENTES no arquivo .env antes de rodar este script."
  );
  process.exit(1);
}

function getPlainText(richTextArray) {
  if (!Array.isArray(richTextArray) || richTextArray.length === 0) return "";
  return richTextArray.map((t) => t.plain_text ?? "").join("");
}

function extractPropertyValue(property) {
  if (!property) return "";

  switch (property.type) {
    case "title":
      return getPlainText(property.title);
    case "rich_text":
      return getPlainText(property.rich_text);
    case "phone_number":
      return property.phone_number ?? "";
    case "select":
      return property.select?.name ?? "";
    case "status":
      return property.status?.name ?? "";
    case "multi_select":
      return (property.multi_select ?? []).map((o) => o.name).join(", ");
    case "number":
      return property.number ?? "";
    case "email":
      return property.email ?? "";
    case "checkbox":
      return property.checkbox ? "sim" : "nao";
    case "date":
      return property.date?.start ?? "";
    default:
      return "";
  }
}

// Nomes de propriedades tentados em ordem, para lidar com pequenas
// variacoes de nomenclatura na base real do Notion.
const FIELD_CANDIDATES = {
  nome: ["Nome do paciente", "Nome", "Name", "Paciente", "Cliente"],
  telefone: ["Telefone", "Phone", "Celular", "WhatsApp"],
  pacote: ["Pacote", "Package", "Plano"],
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

async function queryDatabase(databaseId, startCursor) {
  const url = `https://api.notion.com/v1/databases/${databaseId}/query`;
  const body = startCursor
    ? { start_cursor: startCursor, page_size: 100 }
    : { page_size: 100 };

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${NOTION_TOKEN}`,
      "Notion-Version": NOTION_VERSION,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Notion API respondeu ${response.status}: ${errorText}`
    );
  }

  return response.json();
}

// Normaliza telefone para comparação: mantém só dígitos, remove DDI 55
// e zero à esquerda, para que "+55 11 95295-7516" e "11952957516" batam.
function normalizePhone(telefone) {
  let digits = telefone.replace(/\D/g, "");
  if (digits.startsWith("55") && digits.length > 11) {
    digits = digits.slice(2);
  }
  digits = digits.replace(/^0+/, "");
  return digits;
}

async function main() {
  console.log("Lendo pacientes do Notion (somente leitura)...\n");

  let allPages = [];
  let hasMore = true;
  let cursor = undefined;

  while (hasMore) {
    const data = await queryDatabase(NOTION_DB_CLIENTES, cursor);
    allPages = allPages.concat(data.results);
    hasMore = data.has_more;
    cursor = data.next_cursor ?? undefined;
  }

  const pacientes = allPages.map((page) => {
    const props = page.properties ?? {};
    return {
      nome: extractField(props, FIELD_CANDIDATES.nome) || "(sem nome)",
      telefone: extractField(props, FIELD_CANDIDATES.telefone) || "-",
      pacote: extractField(props, FIELD_CANDIDATES.pacote) || "-",
      status: extractField(props, FIELD_CANDIDATES.status) || "-",
    };
  });

  pacientes.forEach((p, index) => {
    console.log(
      `${index + 1}. ${p.nome} | telefone: ${p.telefone} | pacote: ${p.pacote} | status: ${p.status}`
    );
  });

  console.log(`\nTotal de pacientes encontrados: ${pacientes.length}`);

  const grupos = new Map();
  pacientes.forEach((p) => {
    const chave = normalizePhone(p.telefone);
    if (!chave) return;
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave).push(p);
  });

  const duplicados = [...grupos.entries()].filter(([, lista]) => lista.length > 1);

  console.log(`\nPossíveis duplicatas por telefone: ${duplicados.length} grupo(s)\n`);
  duplicados.forEach(([telefoneNormalizado, lista], i) => {
    console.log(`Grupo ${i + 1} (telefone normalizado: ${telefoneNormalizado})`);
    lista.forEach((p) => {
      console.log(
        `   - ${p.nome} | telefone original: ${p.telefone} | pacote: ${p.pacote} | status: ${p.status}`
      );
    });
  });
}

main().catch((err) => {
  console.error("Falha ao consultar o Notion:", err.message);
  process.exit(1);
});
