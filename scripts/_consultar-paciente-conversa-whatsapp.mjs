// Checagem pontual e só-leitura: paciente por nome (like, case-insensitive),
// sua ConversaWhatsapp e as 5 últimas MensagemWhatsapp dessa conversa.
import "dotenv/config";
import pg from "pg";

const nomeBusca = process.argv[2] ?? "Teste Israel";

const client = new pg.Client({ connectionString: process.env.DIRECT_URL });
await client.connect();

const { rows: pacientes } = await client.query(
  `SELECT id, nome, telefone, "statusGeral", "clinicaId"
   FROM "Paciente"
   WHERE nome ILIKE $1
   ORDER BY "criadoEm" DESC`,
  [`%${nomeBusca}%`]
);

if (pacientes.length === 0) {
  console.log(`Nenhum paciente encontrado com nome contendo "${nomeBusca}".`);
  await client.end();
  process.exit(0);
}

for (const p of pacientes) {
  console.log("=== Paciente ===");
  console.log(`id: ${p.id}`);
  console.log(`nome: ${p.nome}`);
  console.log(`telefone: ${p.telefone}`);
  console.log(`statusGeral: ${p.statusGeral}`);

  const { rows: conversas } = await client.query(
    `SELECT id, telefone, estado, "janelaAbertaAte", "ultimaMensagemEm"
     FROM "ConversaWhatsapp"
     WHERE "pacienteId" = $1
     ORDER BY "criadoEm" DESC`,
    [p.id]
  );

  if (conversas.length === 0) {
    console.log("(nenhuma ConversaWhatsapp vinculada a este paciente)\n");
    continue;
  }

  for (const c of conversas) {
    console.log("\n  === ConversaWhatsapp ===");
    console.log(`  id: ${c.id}`);
    console.log(`  telefone: ${c.telefone}`);
    console.log(`  estado: ${c.estado}`);
    console.log(`  janelaAbertaAte: ${c.janelaAbertaAte ? c.janelaAbertaAte.toISOString() : null}`);

    const { rows: mensagens } = await client.query(
      `SELECT direcao, texto, "respondidaPorIa", "criadoEm"
       FROM "MensagemWhatsapp"
       WHERE "conversaId" = $1
       ORDER BY "criadoEm" DESC
       LIMIT 5`,
      [c.id]
    );

    console.log(`\n  --- Últimas ${mensagens.length} mensagens ---`);
    if (mensagens.length === 0) console.log("  (nenhuma mensagem)");
    for (const m of mensagens) {
      console.log(
        `  ${m.criadoEm.toISOString()}\t${m.direcao}\trespondidaPorIa=${m.respondidaPorIa}\t${m.texto}`
      );
    }
  }
  console.log("");
}

await client.end();
