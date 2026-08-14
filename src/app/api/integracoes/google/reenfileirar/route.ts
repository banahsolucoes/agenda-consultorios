import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { pode } from "@/lib/permissoes";

// POST /api/integracoes/google/reenfileirar — reenfileira (volta a PENDENTE,
// zera tentativas/ultimoErro) todo item FALHA do outbox de sincronização
// Google da clínica do usuário logado. Ação manual do operador depois de
// resolver o problema de origem (ex.: reconectar o Google) — o cron
// (GET /api/cron/sincronizacao) processa a partir daí.
export async function POST() {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  if (!pode(usuario.papel, "gerirIntegracoes")) {
    return NextResponse.json({ erro: "sem permissão para esta ação" }, { status: 403 });
  }

  const resultado = await prisma.sincronizacaoPendente.updateMany({
    where: { clinicaId: usuario.clinicaId, status: "FALHA" },
    data: { status: "PENDENTE", tentativas: 0, ultimoErro: null, proximaTentativaEm: new Date() },
  });

  return NextResponse.json({ reenfileirados: resultado.count });
}
