// Fallback de rate limiting em memória, por instância/isolate. Protege as
// rotas mesmo sem uma regra configurada no Vercel Firewall (ou em ambiente
// local/dev). Janela fixa simples — não é distribuído entre instâncias ou
// regiões, então não substitui uma regra real no Vercel Firewall em produção
// com múltiplas instâncias; serve de rede de segurança enquanto isso não
// está configurado (ver checkRateLimit em @vercel/firewall).

const LIMITE_ENTRADAS = 10_000;

const contadores = new Map<string, { contagem: number; resetaEm: number }>();

export function checkRateLimiteLocal(chave: string, limite: number, janelaMs: number): boolean {
  const agora = Date.now();

  if (contadores.size > LIMITE_ENTRADAS) {
    for (const [k, v] of contadores) {
      if (agora >= v.resetaEm) contadores.delete(k);
    }
  }

  const atual = contadores.get(chave);
  if (!atual || agora >= atual.resetaEm) {
    contadores.set(chave, { contagem: 1, resetaEm: agora + janelaMs });
    return true;
  }

  if (atual.contagem >= limite) return false;

  atual.contagem += 1;
  return true;
}
