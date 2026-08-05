// One-off: corrige baixa de pagamento incorreta na parcela 4 do contrato de
// Luciana Souza dos Anjos (Mentoria FonoElite 6 Meses). A baixa era pra ter
// sido lançada na parcela 3 (julho, já correta) e foi lançada por engano na
// parcela 4 (vencimento 2026-08-10). O usuário estornou depois, mas o estado
// correto não é "Estornada" — é "Aberta" limpa, sem rastro de pagamento,
// porque o pagamento nunca existiu de fato nessa parcela.
//
// Fase 1 (dry-run): SELECT mostrando o estado atual completo da parcela.
// Fase 2 (update): roda só depois de confirmação explícita, descomentando
// a chamada a aplicarUpdate() no final do main().
//
// Executado em 2026-08-05: UPDATE aplicado limpando dataPagamento,
// formaPagamento, estornoEm, valorLiquido e valorEstornado (os 5 campos —
// confirmado com o usuário incluir valorEstornado, não previsto no pedido
// original, pra não deixar o registro com valor estornado sem data de
// estorno). valorBruto, vencimento e numero mantidos intocados.
//
// Conecta via DIRECT_URL (porta 5432), nunca o pooler — mesma regra das
// migrations.
//
// Uso: node scripts/_corrigir-parcela4-luciana-souza-anjos.mjs

import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";

if (!process.env.DIRECT_URL) {
  console.error("DIRECT_URL não definida no ambiente.");
  process.exit(1);
}

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const candidatas = await prisma.mentoriaParcela.findMany({
    where: {
      numero: 4,
      contrato: {
        pacote: { contains: "FonoElite 6 Meses", mode: "insensitive" },
        aluno: { nomeCompleto: { contains: "Luciana Souza dos Anjos", mode: "insensitive" } },
      },
    },
    include: {
      contrato: { include: { aluno: true } },
    },
  });

  if (candidatas.length === 0) {
    console.error("Nenhuma parcela candidata encontrada — abortando.");
    process.exit(1);
  }
  if (candidatas.length > 1) {
    console.error(`Encontradas ${candidatas.length} parcelas candidatas — abortando (ambíguo).`);
    console.error(JSON.stringify(candidatas, null, 2));
    process.exit(1);
  }

  const p = candidatas[0];
  console.log("=== Estado atual (dry-run) ===");
  console.log({
    id: p.id,
    contratoId: p.contratoId,
    aluno: p.contrato.aluno.nomeCompleto,
    pacote: p.contrato.pacote,
    numero: p.numero,
    valorBruto: p.valorBruto.toString(),
    valorLiquido: p.valorLiquido?.toString() ?? null,
    vencimento: p.vencimento.toISOString(),
    dataPagamento: p.dataPagamento?.toISOString() ?? null,
    formaPagamento: p.formaPagamento,
    estornoEm: p.estornoEm?.toISOString() ?? null,
    valorEstornado: p.valorEstornado?.toString() ?? null,
  });

  // Fase 2 — confirmada explicitamente pelo usuário (opção 1: limpar
  // também valorEstornado). Já executada em 2026-08-05; deixado comentado
  // pra não reaplicar sem querer numa reexecução futura deste script.
  // await aplicarUpdate(p.id);
}

async function aplicarUpdate(id) {
  const atualizado = await prisma.mentoriaParcela.update({
    where: { id },
    data: {
      dataPagamento: null,
      formaPagamento: null,
      estornoEm: null,
      valorLiquido: null,
      valorEstornado: null,
    },
    include: { contrato: { include: { aluno: true } } },
  });
  console.log("=== Estado após UPDATE ===");
  console.log({
    id: atualizado.id,
    aluno: atualizado.contrato.aluno.nomeCompleto,
    numero: atualizado.numero,
    valorBruto: atualizado.valorBruto.toString(),
    valorLiquido: atualizado.valorLiquido?.toString() ?? null,
    vencimento: atualizado.vencimento.toISOString(),
    dataPagamento: atualizado.dataPagamento?.toISOString() ?? null,
    formaPagamento: atualizado.formaPagamento,
    estornoEm: atualizado.estornoEm?.toISOString() ?? null,
    valorEstornado: atualizado.valorEstornado?.toString() ?? null,
  });
}

main()
  .catch((err) => {
    console.error("Falha no script:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
