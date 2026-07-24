// Checagem pontual e só-leitura: detalhe dos pacientes com telefone em
// formato inesperado (fora do padrão E.164 BR), pra decisão manual.
import "dotenv/config";
import pg from "pg";

const client = new pg.Client({ connectionString: process.env.DIRECT_URL });
await client.connect();

const ids = ["c8b3a3eb-c3fd-4de1-b08d-ba30012f90d7", "cc647963-24d9-4c1a-ac09-f647f350c085"];

const { rows } = await client.query(
  `SELECT p.id, p.nome, p.telefone, p.email, p."statusGeral", p."criadoEm", c.nome AS clinica
   FROM "Paciente" p
   JOIN "Clinica" c ON c.id = p."clinicaId"
   WHERE p.id = ANY($1::text[])`,
  [ids]
);

for (const r of rows) {
  console.log(`id=${r.id}`);
  console.log(`  nome: ${r.nome}`);
  console.log(`  telefone: "${r.telefone}"`);
  console.log(`  email: ${r.email}`);
  console.log(`  status: ${r.statusGeral}`);
  console.log(`  clinica: ${r.clinica}`);
  console.log(`  criadoEm: ${r.criadoEm.toISOString()}`);
  console.log("");
}

await client.end();
