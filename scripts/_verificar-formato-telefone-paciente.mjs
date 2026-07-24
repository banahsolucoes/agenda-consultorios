// Checagem pontual e só-leitura: formato do campo Paciente.telefone no banco,
// pra avaliar compatibilidade com E.164 (exigido pela API da Meta).
import "dotenv/config";
import pg from "pg";

const client = new pg.Client({ connectionString: process.env.DIRECT_URL });
await client.connect();

const { rows } = await client.query(
  `SELECT id, telefone FROM "Paciente" WHERE "statusGeral" != 'CANCELADO'`
);

let nulo = 0;
let vazio = 0;
let e164ComDDI = 0; // 55 + DDD(2) + 9 dígitos = 13 dígitos, começa com 55
let onzeDigitosSemDDI = 0; // formato BR comum sem código do país
let outros = 0;
const amostrasOutros = [];

for (const r of rows) {
  const t = r.telefone;
  if (t === null) { nulo++; continue; }
  const digitos = t.replace(/\D/g, "");
  if (digitos === "") { vazio++; continue; }
  if (/^55\d{10,11}$/.test(digitos)) { e164ComDDI++; }
  else if (/^\d{10,11}$/.test(digitos)) { onzeDigitosSemDDI++; }
  else {
    outros++;
    if (amostrasOutros.length < 5) amostrasOutros.push({ id: r.id, telefone: t, digitos });
  }
}

console.log(`Total pacientes (não cancelados): ${rows.length}`);
console.log(`  telefone NULL: ${nulo}`);
console.log(`  telefone vazio/sem dígitos: ${vazio}`);
console.log(`  já com DDI 55 (${"55DDNNNNNNNNN"}): ${e164ComDDI}`);
console.log(`  10-11 dígitos sem DDI (precisa prefixar 55): ${onzeDigitosSemDDI}`);
console.log(`  formato inesperado: ${outros}`);
if (amostrasOutros.length) {
  console.log("  amostras de formato inesperado:");
  for (const a of amostrasOutros) console.log(`    ${a.id}: "${a.telefone}" -> dígitos="${a.digitos}"`);
}

await client.end();
