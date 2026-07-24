// Checagem pontual e só-leitura: 5 mensagens mais recentes de MensagemWhatsapp.
import "dotenv/config";
import pg from "pg";

const client = new pg.Client({ connectionString: process.env.DIRECT_URL });
await client.connect();

const { rows } = await client.query(
  `SELECT direcao, texto, "criadoEm"
   FROM "MensagemWhatsapp"
   ORDER BY "criadoEm" DESC
   LIMIT 5`
);

console.log("=== 5 mensagens mais recentes de MensagemWhatsapp ===");
for (const r of rows) {
  console.log(`${r.criadoEm.toISOString()}\t${r.direcao}\t${r.texto}`);
}
if (rows.length === 0) console.log("(nenhuma linha encontrada)");

await client.end();
