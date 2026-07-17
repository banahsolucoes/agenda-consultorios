"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

// Tela de bloqueio exibida quando a assinatura da clínica está INADIMPLENTE
// ou CANCELADA (ver gate em src/app/painel/layout.tsx). Deixa o usuário
// reabrir o checkout hospedado do Mercado Pago para regularizar.
export default function RegularizarAssinaturaPage() {
  const router = useRouter();
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");

  async function handleRegularizar() {
    setErro("");
    setCarregando(true);
    try {
      const res = await fetch("/api/assinatura/criar", { method: "POST" });
      const dados = await res.json().catch(() => null);
      if (!res.ok || !dados?.initPoint) {
        setErro(dados?.erro ?? "não foi possível abrir o checkout");
        return;
      }
      window.location.href = dados.initPoint;
    } catch {
      setErro("não foi possível abrir o checkout");
    } finally {
      setCarregando(false);
    }
  }

  async function handleSair() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-6">
      <div className="w-full max-w-md rounded-2xl border border-border bg-surface p-8 text-center shadow-sm">
        <h1 className="font-serif text-xl font-semibold text-fg">
          Assinatura pendente
        </h1>
        <p className="mt-3 text-sm text-muted">
          O acesso ao painel está temporariamente bloqueado porque a
          assinatura da clínica não está ativa. Regularize o pagamento para
          voltar a usar o sistema.
        </p>

        {erro && (
          <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {erro}
          </p>
        )}

        <button
          onClick={handleRegularizar}
          disabled={carregando}
          className="mt-6 w-full rounded-lg bg-gold px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
        >
          {carregando ? "Abrindo checkout..." : "Regularizar assinatura"}
        </button>

        <button
          onClick={handleSair}
          className="mt-3 w-full rounded-lg border border-border px-4 py-2 text-sm font-medium text-fg hover:bg-bg"
        >
          Sair
        </button>
      </div>
    </div>
  );
}
