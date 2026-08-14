import { NextRequest, NextResponse } from "next/server";
import { processarPendentes } from "@/lib/sincronizacao";

const LIMITE_POR_EXECUCAO = 25;

// GET /api/cron/sincronizacao — worker do outbox de sincronização Google
// (Calendar/Drive), protegido por CRON_SECRET (chamada só pelo Vercel Cron,
// nunca por usuário logado) — mesmo mecanismo de auth de
// verificar-google-noturno. Roda a cada 10min (vercel.json); processa até
// LIMITE_POR_EXECUCAO itens por execução pra caber no timeout da function —
// sobra fica pra próxima execução, ORDER BY proximaTentativaEm já prioriza
// o que está esperando há mais tempo.
export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ erro: "não autorizado" }, { status: 401 });
  }

  const resultado = await processarPendentes(LIMITE_POR_EXECUCAO);
  return NextResponse.json({ ok: true, ...resultado });
}
