"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

// Página de destino do link de recuperação enviado por e-mail. O Supabase
// detecta a sessão de recovery automaticamente a partir do hash da URL
// (detectSessionInUrl, default do client) e dispara o evento
// PASSWORD_RECOVERY — é isso que confirma que o link é válido.
export default function RedefinirSenhaPage() {
  const router = useRouter();
  const [supabase] = useState(() => createClient());
  const [statusSessao, setStatusSessao] = useState<"verificando" | "valida" | "invalida">("verificando");

  const [novaSenha, setNovaSenha] = useState("");
  const [confirmarSenha, setConfirmarSenha] = useState("");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [sucesso, setSucesso] = useState(false);

  useEffect(() => {
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") setStatusSessao("valida");
    });

    // Fallback: se o evento já tiver disparado antes deste listener ser
    // registrado, a sessão já existe — confirma por getSession().
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setStatusSessao((atual) => (atual === "verificando" ? "valida" : atual));
    });

    // Sem sinal de sessão válida em alguns segundos, trata como link
    // expirado/inválido em vez de deixar a tela carregando para sempre.
    const timer = setTimeout(() => {
      setStatusSessao((atual) => (atual === "verificando" ? "invalida" : atual));
    }, 4000);

    return () => {
      listener.subscription.unsubscribe();
      clearTimeout(timer);
    };
  }, [supabase]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro("");

    if (novaSenha.length < 6) {
      setErro("a senha deve ter no mínimo 6 caracteres");
      return;
    }
    if (novaSenha !== confirmarSenha) {
      setErro("as senhas não coincidem");
      return;
    }

    setSalvando(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: novaSenha });
      if (error) {
        setErro("não foi possível redefinir a senha — tente solicitar um novo link");
        return;
      }
      setSucesso(true);
      setTimeout(() => router.push("/login"), 2000);
    } catch {
      setErro("não foi possível redefinir a senha — tente solicitar um novo link");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="font-serif text-2xl font-semibold text-fg">Redefinir senha</h1>
          <p className="mt-1 text-sm text-muted">Defina sua nova senha de acesso</p>
        </div>

        <div className="rounded-xl border border-border bg-surface p-8 shadow-sm">
          {statusSessao === "verificando" ? (
            <p className="text-center text-sm text-muted">Verificando link de recuperação...</p>
          ) : statusSessao === "invalida" ? (
            <div className="space-y-4 text-center">
              <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red">
                Este link de recuperação é inválido ou expirou.
              </p>
              <Link href="/esqueci-senha" className="inline-block text-sm text-gold hover:underline">
                Solicitar novo link
              </Link>
            </div>
          ) : sucesso ? (
            <p className="rounded-lg bg-green/10 px-3 py-2 text-center text-sm text-green">
              Senha redefinida com sucesso. Redirecionando para o login...
            </p>
          ) : (
            <form onSubmit={handleSubmit}>
              <div className="mb-4">
                <label htmlFor="novaSenha" className="mb-1 block text-sm font-medium text-fg">
                  Nova senha
                </label>
                <input
                  id="novaSenha"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={6}
                  value={novaSenha}
                  onChange={(e) => setNovaSenha(e.target.value)}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                  placeholder="••••••••"
                />
              </div>

              <div className="mb-6">
                <label htmlFor="confirmarSenha" className="mb-1 block text-sm font-medium text-fg">
                  Confirmar nova senha
                </label>
                <input
                  id="confirmarSenha"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={6}
                  value={confirmarSenha}
                  onChange={(e) => setConfirmarSenha(e.target.value)}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                  placeholder="••••••••"
                />
              </div>

              {erro && <p className="mb-4 rounded-lg bg-red/10 px-3 py-2 text-sm text-red">{erro}</p>}

              <button
                type="submit"
                disabled={salvando}
                className="w-full rounded-lg bg-gold px-4 py-2 font-medium text-bg transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {salvando ? "Salvando..." : "Redefinir senha"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
