import "dotenv/config";
import pg from "pg";

const conversaId = process.argv[2];
const client = new pg.Client({ connectionString: process.env.DIRECT_URL });
await client.connect();

const { rows } = await client.query(
  `SELECT direcao, texto, "respondidaPorIa", "criadoEm"
   FROM "MensagemWhatsapp"
   WHERE "conversaId" = $1
   ORDER BY "criadoEm" DESC
   LIMIT 5`,
  [conversaId]
);
for (const m of rows) {
  console.log(`${m.criadoEm.toISOString()}\t${m.direcao}\trespondidaPorIa=${m.respondidaPorIa}\t${m.texto}`);
}
if (rows.length === 0) console.log("(nenhuma mensagem)");

await client.end();
