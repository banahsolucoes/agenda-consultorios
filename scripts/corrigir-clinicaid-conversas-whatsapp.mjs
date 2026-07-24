// Correção pontual aprovada pelo usuário: as 2 ConversaWhatsapp criadas até
// 2026-07-24 foram gravadas com clinicaId da "Clínica Teste" em vez da
// "Fono Pâmela Rachid" (bug de resolverClinicaId() em route.ts, corrigido no
// mesmo commit). Move as conversas pra clínica certa e tenta reencontrar
// pacienteId agora que a clínica bate.
import "dotenv/config";
import pg from "pg";

const CLINICA_ERRADA = "2f4ddf04-6053-407d-9c25-c8bd68ef815b"; // Clínica Teste
const CLINICA_CERTA = "14cc29f9-7cb6-4b93-88fc-e5d868770895"; // Fono Pâmela Rachid

function normalizarTelefoneE164(bruto) {
  const digitos = bruto.replace(/\D/g, "");
  if (digitos.length === 10 || digitos.length === 11) return `55${digitos}`;
  if (digitos.length === 12 || digitos.length === 13) return digitos;
  return null;
}

const client = new pg.Client({ connectionString: process.env.DIRECT_URL });
await client.connect();

const { rows: conversas } = await client.query(
  `SELECT id, telefone, "pacienteId" FROM "ConversaWhatsapp" WHERE "clinicaId" = $1`,
  [CLINICA_ERRADA]
);
console.log(`${conversas.length} conversa(s) com clinicaId errado.`);

const { rows: pacientes } = await client.query(
  `SELECT id, nome, telefone FROM "Paciente" WHERE "clinicaId" = $1 AND telefone IS NOT NULL`,
  [CLINICA_CERTA]
);

for (const c of conversas) {
  const alvo = normalizarTelefoneE164(c.telefone);
  const match = pacientes.find((p) => normalizarTelefoneE164(p.telefone) === alvo);

  await client.query(
    `UPDATE "ConversaWhatsapp" SET "clinicaId" = $1, "pacienteId" = $2 WHERE id = $3`,
    [CLINICA_CERTA, match?.id ?? c.pacienteId, c.id]
  );

  console.log(
    `${c.id}: clinicaId -> ${CLINICA_CERTA}, pacienteId ${c.pacienteId} -> ${match?.id ?? c.pacienteId} ${match ? `(${match.nome})` : "(sem match)"}`
  );
}

await client.end();
