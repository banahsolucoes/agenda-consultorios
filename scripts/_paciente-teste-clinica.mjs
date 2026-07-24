import "dotenv/config";
import pg from "pg";

const client = new pg.Client({ connectionString: process.env.DIRECT_URL });
await client.connect();

const { rows } = await client.query(
  `SELECT id, nome, telefone, "clinicaId" FROM "Paciente" WHERE telefone LIKE '%19395401%' OR telefone LIKE '%50329645%'`
);
console.log(JSON.stringify(rows, null, 2));

await client.end();
