"use client";

import { useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

// Solicita o link de recuperação de senha via Supabase Auth. A mensagem de
// sucesso é sempre a mesma, com ou sem erro do Supabase — não revela se o
// e-mail está cadastrado (evita enumeração de contas).
export default function EsqueciSenhaPage() {
  const [email, setEmail] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [enviado, setEnviado] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setCarregando(true);

    try {
      const supabase = createClient();
      await supabase.auth.resetPasswordForEmail(email, {
        redirectTo: `${window.location.origin}/redefinir-senha`,
      });
    } catch {
      // falha de rede — ainda assim mostramos a mensagem neutra abaixo
    } finally {
      setCarregando(false);
      setEnviado(true);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="font-serif text-2xl font-semibold text-fg">Esqueci minha senha</h1>
          <p className="mt-1 text-sm text-muted">Informe seu e-mail para receber o link de recuperação</p>
        </div>

        <div className="rounded-xl border border-border bg-surface p-8 shadow-sm">
          {enviado ? (
            <div className="space-y-4 text-center">
              <p className="rounded-lg bg-green/10 px-3 py-2 text-sm text-green">
                Se este e-mail estiver cadastrado, enviamos um link de recuperação.
              </p>
              <Link href="/login" className="inline-block text-sm text-gold hover:underline">
                Voltar ao login
              </Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <div className="mb-6">
                <label htmlFor="email" className="mb-1 block text-sm font-medium text-fg">
                  E-mail
                </label>
                <input
                  id="email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                  placeholder="voce@clinica.com"
                />
              </div>

              <button
                type="submit"
                disabled={carregando}
                className="w-full rounded-lg bg-gold px-4 py-2 font-medium text-bg transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {carregando ? "Enviando..." : "Enviar link de recuperação"}
              </button>

              <div className="mt-4 text-center">
                <Link href="/login" className="text-sm text-muted hover:text-gold hover:underline">
                  Voltar ao login
                </Link>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
