"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

type EstadoConvite = "verificando" | "sem-token" | "invalido" | "valido";

// Página pública de cadastro de clínica nova — só acessível com um link de
// convite válido (?convite={token}, gerado por scripts/gerar-convite.mjs).
// Sem token na URL, nem chama a API de validação — mensagem direta.
//
// useSearchParams exige um boundary de Suspense pra não bloquear o
// pre-render estático da página (Next.js) — CadastroPage só existe pra
// fornecer esse boundary; toda a lógica real fica em CadastroForm.
export default function CadastroPage() {
  return (
    <Suspense fallback={null}>
      <CadastroForm />
    </Suspense>
  );
}

function CadastroForm() {
  const searchParams = useSearchParams();
  const token = searchParams.get("convite")?.trim() ?? "";

  const [estadoConvite, setEstadoConvite] = useState<EstadoConvite>(token ? "verificando" : "sem-token");
  const [emailConvite, setEmailConvite] = useState("");

  const [nome, setNome] = useState("");
  const [clinicaNome, setClinicaNome] = useState("");
  const [senha, setSenha] = useState("");
  const [confirmarSenha, setConfirmarSenha] = useState("");
  const [aceiteTermos, setAceiteTermos] = useState(false);

  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [sucesso, setSucesso] = useState(false);

  useEffect(() => {
    if (!token) return;

    let cancelado = false;
    fetch(`/api/auth/convite/validar?token=${encodeURIComponent(token)}`)
      .then((res) => res.json())
      .then((data: { valido: boolean; email?: string; nomeClinicaSugerido?: string }) => {
        if (cancelado) return;
        if (!data.valido) {
          setEstadoConvite("invalido");
          return;
        }
        setEmailConvite(data.email ?? "");
        setClinicaNome(data.nomeClinicaSugerido ?? "");
        setEstadoConvite("valido");
      })
      .catch(() => {
        if (!cancelado) setEstadoConvite("invalido");
      });

    return () => {
      cancelado = true;
    };
  }, [token]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro("");

    if (!clinicaNome.trim()) {
      setErro("informe o nome da clínica");
      return;
    }
    if (senha.length < 8) {
      setErro("a senha deve ter no mínimo 8 caracteres");
      return;
    }
    if (senha !== confirmarSenha) {
      setErro("as senhas não coincidem");
      return;
    }
    if (!aceiteTermos) {
      setErro("é preciso aceitar os Termos de Uso e a Política de Privacidade");
      return;
    }

    setEnviando(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: emailConvite,
          senha,
          nome,
          clinicaNome: clinicaNome.trim(),
          convite: token,
        }),
      });

      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setErro(data?.erro || "não foi possível concluir o cadastro — tente novamente");
        return;
      }

      setSucesso(true);
    } catch {
      setErro("não foi possível concluir o cadastro — verifique sua conexão e tente novamente");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="font-serif text-2xl font-semibold text-fg">Agenda Consultórios</h1>
          <p className="mt-1 text-sm text-muted">Cadastro da sua clínica</p>
        </div>

        <div className="rounded-xl border border-border bg-surface p-8 shadow-sm">
          {estadoConvite === "sem-token" && (
            <p className="rounded-lg bg-red/10 px-3 py-2 text-center text-sm text-red">
              Link de convite necessário. Solicite o link de cadastro a quem te convidou.
            </p>
          )}

          {estadoConvite === "verificando" && (
            <p className="text-center text-sm text-muted">Verificando convite...</p>
          )}

          {estadoConvite === "invalido" && (
            <div className="space-y-3 text-center">
              <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red">
                Este convite é inválido ou expirou.
              </p>
              <p className="text-sm text-muted">Solicite um novo link a quem te convidou.</p>
            </div>
          )}

          {estadoConvite === "valido" && sucesso && (
            <div className="space-y-4 text-center">
              <p className="rounded-lg bg-green/10 px-3 py-2 text-sm text-green">
                Clínica criada! Confirme seu e-mail (se aplicável) e faça login.
              </p>
              <Link
                href="/login"
                className="inline-block w-full rounded-lg bg-gold px-4 py-2 font-medium text-bg transition-colors hover:brightness-110"
              >
                Ir para o login
              </Link>
            </div>
          )}

          {estadoConvite === "valido" && !sucesso && (
            <form onSubmit={handleSubmit}>
              <div className="mb-4">
                <label htmlFor="nome" className="mb-1 block text-sm font-medium text-fg">
                  Seu nome
                </label>
                <input
                  id="nome"
                  type="text"
                  autoComplete="name"
                  required
                  value={nome}
                  onChange={(e) => setNome(e.target.value)}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                  placeholder="Seu nome completo"
                />
              </div>

              <div className="mb-4">
                <label htmlFor="email" className="mb-1 block text-sm font-medium text-fg">
                  E-mail
                </label>
                <input
                  id="email"
                  type="email"
                  value={emailConvite}
                  disabled
                  className="w-full cursor-not-allowed rounded-lg border border-border bg-bg px-3 py-2 text-muted outline-none"
                />
              </div>

              <div className="mb-4">
                <label htmlFor="clinicaNome" className="mb-1 block text-sm font-medium text-fg">
                  Nome da clínica
                </label>
                <input
                  id="clinicaNome"
                  type="text"
                  required
                  value={clinicaNome}
                  onChange={(e) => setClinicaNome(e.target.value)}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                  placeholder="Nome da sua clínica"
                />
              </div>

              <div className="mb-4">
                <label htmlFor="senha" className="mb-1 block text-sm font-medium text-fg">
                  Senha
                </label>
                <input
                  id="senha"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={senha}
                  onChange={(e) => setSenha(e.target.value)}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                  placeholder="••••••••"
                />
              </div>

              <div className="mb-4">
                <label htmlFor="confirmarSenha" className="mb-1 block text-sm font-medium text-fg">
                  Confirmar senha
                </label>
                <input
                  id="confirmarSenha"
                  type="password"
                  autoComplete="new-password"
                  required
                  minLength={8}
                  value={confirmarSenha}
                  onChange={(e) => setConfirmarSenha(e.target.value)}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                  placeholder="••••••••"
                />
              </div>

              <div className="mb-6">
                <label className="flex items-start gap-2 text-sm text-muted">
                  <input
                    type="checkbox"
                    required
                    checked={aceiteTermos}
                    onChange={(e) => setAceiteTermos(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded border-border text-gold focus:ring-gold/20"
                  />
                  <span>
                    Li e aceito os{" "}
                    <Link href="/termos" target="_blank" className="text-gold hover:underline">
                      Termos de Uso
                    </Link>{" "}
                    e a{" "}
                    <Link href="/privacidade" target="_blank" className="text-gold hover:underline">
                      Política de Privacidade
                    </Link>
                    .
                  </span>
                </label>
              </div>

              {erro && (
                <p className="mb-4 rounded-lg bg-red/10 px-3 py-2 text-sm text-red">{erro}</p>
              )}

              <button
                type="submit"
                disabled={enviando}
                className="w-full rounded-lg bg-gold px-4 py-2 font-medium text-bg transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {enviando ? "Criando clínica..." : "Criar clínica"}
              </button>
            </form>
          )}
        </div>

        <p className="mt-6 text-center text-xs text-muted">
          <Link href="/termos" className="hover:text-gold hover:underline">
            Termos de Uso
          </Link>
          {" · "}
          <Link href="/privacidade" className="hover:text-gold hover:underline">
            Política de Privacidade
          </Link>
        </p>
      </div>
    </div>
  );
}
