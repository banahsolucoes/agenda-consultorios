// Checagem pontual e só-leitura: quais colunas a tabela Paciente realmente
// tem no banco agora, e o estado da tabela _prisma_migrations.
import "dotenv/config";
import pg from "pg";

const client = new pg.Client({ connectionString: process.env.DIRECT_URL });
await client.connect();

const colunas = await client.query(
  `SELECT column_name, data_type, is_nullable
   FROM information_schema.columns
   WHERE table_name = 'Paciente'
   ORDER BY ordinal_position`
);
console.log("=== Colunas de Paciente no banco ===");
for (const c of colunas.rows) {
  console.log(`${c.column_name}\t${c.data_type}\tnullable=${c.is_nullable}`);
}

const migracoes = await client.query(
  `SELECT migration_name, finished_at, rolled_back_at, logs
   FROM _prisma_migrations
   ORDER BY started_at DESC
   LIMIT 5`
);
console.log("\n=== Últimas 5 linhas de _prisma_migrations ===");
for (const m of migracoes.rows) {
  console.log(`${m.migration_name}\tfinished_at=${m.finished_at}\trolled_back_at=${m.rolled_back_at}`);
  if (m.logs) console.log(`  logs: ${m.logs}`);
}

await client.end();
