import { NextRequest, NextResponse } from "next/server";
import { processarPendentes } from "@/lib/sincronizacao";

const LIMITE_POR_EXECUCAO = 25;

// GET /api/cron/sincronizacao — worker do outbox de sincronização Google
// (Calendar/Drive). NÃO está registrada em vercel.json — o plano Hobby
// permite só 2 cron jobs (já ocupados por verificar-google-noturno e
// whatsapp-lembretes) e só schedule diário, incompatível com o intervalo de
// 10min que este worker precisa. Por isso é chamada por um cron EXTERNO
// (fora da Vercel — ex.: cron-job.org, GitHub Actions), protegida por um
// header próprio (x-cron-secret) em vez de "Authorization: Bearer", porque
// "Authorization: Bearer $CRON_SECRET" é o header que a própria Vercel
// injeta automaticamente só em invocações nativas de vercel.json — um
// serviço externo não tem esse comportamento especial, então precisa de um
// jeito próprio de provar que conhece o segredo. Mesma env var
// (CRON_SECRET) dos outros crons — não é um segredo novo, só um header
// diferente pra chegar até ela. Ver ARCHITECTURE.md §9 pra URL/valor exatos
// a configurar no serviço externo. Processa até LIMITE_POR_EXECUCAO itens
// por execução pra caber no timeout da function — sobra fica pra próxima
// execução, ORDER BY proximaTentativaEm já prioriza o que está esperando há
// mais tempo.
export async function GET(req: NextRequest) {
  const segredo = req.headers.get("x-cron-secret");
  if (!process.env.CRON_SECRET || segredo !== process.env.CRON_SECRET) {
    return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  }

  const resultado = await processarPendentes(LIMITE_POR_EXECUCAO);
  return NextResponse.json({ ok: true, ...resultado });
}
