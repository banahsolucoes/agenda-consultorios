// Correção pontual aprovada pelo usuário: telefone do paciente Aarão (Filho
// Ary) estava com um dígito a mais / DDI errado ("+55 21 9646860303"). Valor
// correto confirmado: +1 (305) 513-1252.
import "dotenv/config";
import pg from "pg";

const client = new pg.Client({ connectionString: process.env.DIRECT_URL });
await client.connect();

const id = "cc647963-24d9-4c1a-ac09-f647f350c085";
const antes = await client.query(`SELECT telefone FROM "Paciente" WHERE id = $1`, [id]);
console.log("antes:", antes.rows[0]?.telefone);

await client.query(`UPDATE "Paciente" SET telefone = $1 WHERE id = $2`, ["13055131252", id]);

const depois = await client.query(`SELECT telefone FROM "Paciente" WHERE id = $1`, [id]);
console.log("depois:", depois.rows[0]?.telefone);

await client.end();
