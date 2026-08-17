// Drena a fila SincronizacaoPendente processando lotes até zerar PENDENTE.
// Usa o mesmo processarPendentes() do worker de produção (src/lib/sincronizacao.ts).
import "dotenv/config";

const { processarPendentes } = await import("../src/lib/sincronizacao.ts");
const { prisma } = await import("../src/lib/prisma.ts");

const LOTE = 25;

async function main() {
  let totalProcessados = 0;
  let totalConcluidos = 0;
  let totalFalhas = 0;
  let rodada = 0;

  while (true) {
    rodada++;
    const r = await processarPendentes(LOTE);
    totalProcessados += r.processados;
    totalConcluidos += r.concluidos;
    totalFalhas += r.falhas;
    console.log(`Rodada ${rodada}: recuperados=${r.recuperados} processados=${r.processados} concluidos=${r.concluidos} falhas=${r.falhas}`);
    if (r.processados === 0) break;
  }

  const restante = await prisma.sincronizacaoPendente.count({ where: { status: "PENDENTE" } });
  const falha = await prisma.sincronizacaoPendente.count({ where: { status: "FALHA" } });

  console.log("\n=== RESUMO ===");
  console.log({ totalProcessados, totalConcluidos, totalFalhas, restantePendente: restante, totalFalhaDefinitiva: falha });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
