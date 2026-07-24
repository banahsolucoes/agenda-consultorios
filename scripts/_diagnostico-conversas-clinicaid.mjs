import "dotenv/config";
import pg from "pg";

const client = new pg.Client({ connectionString: process.env.DIRECT_URL });
await client.connect();

console.log("=== Clinicas ===");
const { rows: clinicas } = await client.query(`SELECT id, nome, slug FROM "Clinica" ORDER BY "criadoEm" ASC`);
for (const c of clinicas) console.log(`${c.id}\t${c.nome}\t${c.slug}`);

console.log("\n=== Usuarios (id, email, papel, clinicaId) ===");
const { rows: usuarios } = await client.query(`SELECT id, email, papel, "clinicaId" FROM "Usuario" ORDER BY "criadoEm" ASC`);
for (const u of usuarios) console.log(`${u.id}\t${u.email}\t${u.papel}\t${u.clinicaId}`);

console.log("\n=== Últimas 10 ConversaWhatsapp ===");
const { rows: conversas } = await client.query(
  `SELECT id, "clinicaId", "pacienteId", telefone, estado, "criadoEm"
   FROM "ConversaWhatsapp"
   ORDER BY "criadoEm" DESC
   LIMIT 10`
);
for (const c of conversas) {
  console.log(`${c.id}\tclinicaId=${c.clinicaId}\tpacienteId=${c.pacienteId}\ttelefone=${c.telefone}\testado=${c.estado}\tcriadoEm=${c.criadoEm.toISOString()}`);
}

await client.end();
