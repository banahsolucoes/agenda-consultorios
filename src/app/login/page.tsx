"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

// Página de login da clínica: autentica via /api/auth/login e redireciona para /painel
export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro("");
    setCarregando(true);

    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, senha }),
      });

      if (!res.ok) {
        setErro("email ou senha inválidos");
        return;
      }

      router.push("/painel");
    } catch {
      // falha de rede ou servidor indisponível
      setErro("email ou senha inválidos");
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="font-serif text-2xl font-semibold text-fg">
            Agenda Consultórios
          </h1>
          <p className="mt-1 text-sm text-muted">
            Acesse sua conta para continuar
          </p>
        </div>

        <form
          onSubmit={handleSubmit}
          className="rounded-xl border border-border bg-surface p-8 shadow-sm"
        >
          <div className="mb-4">
            <label
              htmlFor="email"
              className="mb-1 block text-sm font-medium text-fg"
            >
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

          <div className="mb-6">
            <label
              htmlFor="senha"
              className="mb-1 block text-sm font-medium text-fg"
            >
              Senha
            </label>
            <input
              id="senha"
              type="password"
              autoComplete="current-password"
              required
              value={senha}
              onChange={(e) => setSenha(e.target.value)}
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
              placeholder="••••••••"
            />
            <div className="mt-2 text-right">
              <Link href="/esqueci-senha" className="text-sm text-muted hover:text-gold hover:underline">
                Esqueci minha senha
              </Link>
            </div>
          </div>

          {erro && (
            <p className="mb-4 rounded-lg bg-red/10 px-3 py-2 text-sm text-red">
              {erro}
            </p>
          )}

          <button
            type="submit"
            disabled={carregando}
            className="w-full rounded-lg bg-gold px-4 py-2 font-medium text-bg transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {carregando ? "Entrando..." : "Entrar"}
          </button>
        </form>
      </div>
    </div>
  );
}
