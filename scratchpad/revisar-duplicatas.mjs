import "dotenv/config";

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_DB_CLIENTES = process.env.NOTION_DB_CLIENTES;
const NOTION_VERSION = "2022-06-28";

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
  if (!Array.isArray(arr)) return "";
  return arr.map((t) => t.plain_text ?? "").join("");
}

function summarizeProperty(prop) {
  switch (prop.type) {
    case "title": return getPlainText(prop.title);
    case "rich_text": return getPlainText(prop.rich_text);
    case "phone_number": return prop.phone_number ?? "";
    case "select": return prop.select?.name ?? "";
    case "status": return prop.status?.name ?? "";
    case "multi_select": return (prop.multi_select ?? []).map((o) => o.name).join(", ");
    case "number": return prop.number ?? "";
    case "email": return prop.email ?? "";
    case "checkbox": return prop.checkbox ? "sim" : "nao";
    case "date": return prop.date?.start ?? "";
    case "created_time": return prop.created_time ?? "";
    case "last_edited_time": return prop.last_edited_time ?? "";
    case "url": return prop.url ?? "";
    case "people": return (prop.people ?? []).map((p) => p.name).join(", ");
    case "relation": return (prop.relation ?? []).map((r) => r.id).join(", ");
    case "formula": return JSON.stringify(prop.formula);
    default: return `(tipo ${prop.type} não tratado)`;
  }
}

const NOMES_ALVO = [
  "Guilherme Messias",
  "Felipe Pezzoni",
  "Felipe Reis Santos",
];

async function main() {
  let allPages = [];
  let hasMore = true;
  let cursor;
  while (hasMore) {
    const data = await queryDatabase(NOTION_DB_CLIENTES, cursor);
    allPages = allPages.concat(data.results);
    hasMore = data.has_more;
    cursor = data.next_cursor ?? undefined;
  }

  for (const page of allPages) {
    const props = page.properties ?? {};
    const nomeProp = props["Nome do paciente"];
    const nome = nomeProp ? getPlainText(nomeProp.title) : "";
    if (!NOMES_ALVO.some((alvo) => nome.trim().toLowerCase().includes(alvo.toLowerCase().split(" ")[0]))) continue;
    if (!NOMES_ALVO.some((alvo) => nome.trim() === alvo || nome.trim().startsWith(alvo.split(" ")[0]))) continue;

    console.log(`\n=== Página: ${nome} (id: ${page.id}) ===`);
    console.log(`criado em: ${page.created_time} | editado em: ${page.last_edited_time}`);
    for (const [key, prop] of Object.entries(props)) {
      console.log(`   ${key}: ${summarizeProperty(prop)}`);
    }
  }
}

main().catch((err) => {
  console.error("Falha:", err.message);
  process.exit(1);
});
