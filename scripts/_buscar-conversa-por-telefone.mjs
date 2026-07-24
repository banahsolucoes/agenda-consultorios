import "dotenv/config";
import pg from "pg";

const client = new pg.Client({ connectionString: process.env.DIRECT_URL });
await client.connect();

const { rows } = await client.query(
  `SELECT id, "clinicaId", "pacienteId", telefone, estado, "janelaAbertaAte", "criadoEm"
   FROM "ConversaWhatsapp"
   WHERE telefone LIKE '%19395401%'
   ORDER BY "criadoEm" DESC`
);
console.log(JSON.stringify(rows, null, 2));

await client.end();
