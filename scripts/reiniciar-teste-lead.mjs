// Reinicia a conversa de teste do modo LEAD (ARCHITECTURE.md §10.14): apaga
// as ConversaWhatsapp com modo = 'LEAD' de um telefone de teste, e as
// MensagemWhatsapp delas, para o próximo "oi" começar o roteiro do zero.
// Nunca toca em conversas modo 'AGENDA'.
//
// Uso:
//   node --env-file=.env scripts/reiniciar-teste-lead.mjs 5511993944786
//
// Só aceita telefones listados em WHATSAPP_LEAD_TESTE_NUMEROS (mesmo formato
// da env do webhook: E.164 sem "+", separados por vírgula). Se a env não
// estiver no .env local, passe na linha de comando, de qualquer um destes
// jeitos:
//   WHATSAPP_LEAD_TESTE_NUMEROS=5511993944786 node --env-file=.env scripts/reiniciar-teste-lead.mjs 5511993944786
//   node --env-file=.env scripts/reiniciar-teste-lead.mjs 5511993944786 WHATSAPP_LEAD_TESTE_NUMEROS=5511993944786
//
// Precisa de Node 22.18+ (importa o .ts do projeto direto, por type stripping).
import pg from "pg";
import { normalizarTelefoneE164 } from "../src/lib/whatsapp/telefone.ts";

const NOME_ENV = "WHATSAPP_LEAD_TESTE_NUMEROS";

function abortar(mensagem) {
  console.error(`ABORTADO: ${mensagem}`);
  console.error("Nada foi alterado.");
  process.exit(1);
}

const args = process.argv.slice(2);
const argEnv = args.find((a) => a.startsWith(`${NOME_ENV}=`));
const argsTelefone = args.filter((a) => a !== argEnv);

if (argsTelefone.length !== 1) {
  abortar("informe exatamente um telefone. Ex.: node --env-file=.env scripts/reiniciar-teste-lead.mjs 5511993944786");
}

const listaBruta = process.env[NOME_ENV] || (argEnv ? argEnv.slice(NOME_ENV.length + 1) : "");
if (!listaBruta.trim()) {
  abortar(`${NOME_ENV} não definida (nem no .env, nem na linha de comando).`);
}

// Mesma regra de parseNumerosTeste (src/lib/whatsapp/canal.ts): cada item
// normalizado, inválidos ignorados.
const numerosTeste = new Set(
  listaBruta
    .split(",")
    .map((item) => (item.trim() ? normalizarTelefoneE164(item) : null))
    .filter(Boolean)
);

const telefone = normalizarTelefoneE164(argsTelefone[0]);
if (!telefone) {
  abortar(`telefone "${argsTelefone[0]}" fora do padrão (esperado 10 a 13 dígitos).`);
}
if (!numerosTeste.has(telefone)) {
  abortar(`${telefone} não está em ${NOME_ENV}. Este script só reinicia números de teste.`);
}

const connectionString = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!connectionString) abortar("DIRECT_URL/DATABASE_URL não definida.");

const client = new pg.Client({ connectionString });
await client.connect();

try {
  // Busca todas as conversas LEAD e compara o telefone normalizado (o webhook
  // grava o "from" da Meta como veio), sem depender do formato salvo.
  const { rows: candidatas } = await client.query(
    `SELECT c.id, c.telefone, c.estado, c."canalWhatsAppId", c."criadoEm",
            (SELECT count(*)::int FROM "MensagemWhatsapp" m WHERE m."conversaId" = c.id) AS mensagens
       FROM "ConversaWhatsapp" c
      WHERE c.modo = 'LEAD'`
  );
  const alvo = candidatas.filter((c) => normalizarTelefoneE164(c.telefone) === telefone);

  console.log(`Telefone: ${telefone}`);
  if (alvo.length === 0) {
    console.log("Nenhuma conversa modo LEAD para este telefone. Nada a apagar.");
  } else {
    const totalMensagens = alvo.reduce((soma, c) => soma + c.mensagens, 0);
    console.log(`Serão removidas: ${alvo.length} conversa(s) LEAD e ${totalMensagens} mensagem(ns):`);
    for (const c of alvo) {
      console.log(
        `  - conversa ${c.id} | canal ${c.canalWhatsAppId ?? "número da agenda"} | estado ${c.estado} | ` +
          `criada ${c.criadoEm.toISOString()} | ${c.mensagens} mensagem(ns)`
      );
    }

    const ids = alvo.map((c) => c.id);
    await client.query("BEGIN");
    // modo = 'LEAD' repetido nos DELETEs como trava extra contra apagar AGENDA.
    const mensagens = await client.query(
      `DELETE FROM "MensagemWhatsapp"
        WHERE "conversaId" IN (SELECT id FROM "ConversaWhatsapp" WHERE id = ANY($1) AND modo = 'LEAD')`,
      [ids]
    );
    const conversas = await client.query(
      `DELETE FROM "ConversaWhatsapp" WHERE id = ANY($1) AND modo = 'LEAD'`,
      [ids]
    );
    await client.query("COMMIT");
    console.log(`Apagadas: ${conversas.rowCount} conversa(s) LEAD e ${mensagens.rowCount} mensagem(ns).`);
  }

  const { rows } = await client.query(
    `SELECT modo, count(*)::int AS n FROM "ConversaWhatsapp" WHERE telefone = $1 GROUP BY modo ORDER BY modo`,
    [telefone]
  );
  const resumo = rows.map((r) => `${r.modo}: ${r.n}`).join(", ") || "nenhuma";
  console.log(`Conversas restantes com telefone ${telefone} (qualquer modo): ${resumo}`);
} catch (erro) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("ERRO, transação desfeita:", erro instanceof Error ? erro.message : erro);
  process.exitCode = 1;
} finally {
  await client.end();
}
