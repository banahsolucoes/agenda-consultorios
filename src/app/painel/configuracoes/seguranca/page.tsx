"use client";

import { useEffect, useState } from "react";
import { papelLabel } from "@/lib/labels";
import type { Papel } from "@/lib/permissoes";
import CampoTexto from "../_components/CampoTexto";

const SENHA_MINIMA = 8;

interface UsuarioEquipe {
  id: string;
  nome: string;
  email: string;
  papel: Papel;
  criadoEm: string;
}

// Segurança: troca da própria senha (todos os papéis) + gestão de equipe
// (só ADMIN). Página autocontida — não depende do estado do
// configuracoes/legado antigo. clinicaId pra criar usuário vem de
// GET /api/clinica (a clínica do próprio usuário logado), nunca digitado;
// a rota /api/auth/signup também revalida isso no servidor contra
// getUsuarioLogado() antes de aceitar.
export default function SegurancaPage() {
  const [papel, setPapel] = useState<Papel | null>(null);
  const [clinicaId, setClinicaId] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/auth/usuario")
      .then((r) => (r.ok ? r.json() : null))
      .then((dados: { papel: Papel } | null) => setPapel(dados?.papel ?? null));
  }, []);

  // Equipe — só busca quando (e só quando) o papel for ADMIN
  const [equipe, setEquipe] = useState<UsuarioEquipe[]>([]);
  const [carregandoEquipe, setCarregandoEquipe] = useState(true);
  const [erroCarregarEquipe, setErroCarregarEquipe] = useState(false);
  const [novoNome, setNovoNome] = useState("");
  const [novoEmail, setNovoEmail] = useState("");
  const [novaSenha, setNovaSenha] = useState("");
  const [novoPapel, setNovoPapel] = useState<Papel>("OPERADOR");
  const [criandoUsuario, setCriandoUsuario] = useState(false);
  const [erroCriarUsuario, setErroCriarUsuario] = useState("");
  const [sucessoCriarUsuario, setSucessoCriarUsuario] = useState(false);

  async function carregarEquipe() {
    setCarregandoEquipe(true);
    setErroCarregarEquipe(false);
    try {
      const res = await fetch("/api/usuarios");
      if (!res.ok) {
        setErroCarregarEquipe(true);
        return;
      }
      setEquipe(await res.json());
    } catch {
      setErroCarregarEquipe(true);
    } finally {
      setCarregandoEquipe(false);
    }
  }

  useEffect(() => {
    if (papel !== "ADMIN") return;
    void (async () => {
      await Promise.all([
        carregarEquipe(),
        (async () => {
          const res = await fetch("/api/clinica");
          if (res.ok) setClinicaId((await res.json()).id);
        })(),
      ]);
    })();
  }, [papel]);

  async function handleCriarUsuario(e: React.FormEvent) {
    e.preventDefault();
    if (!clinicaId) return;
    setErroCriarUsuario("");
    setSucessoCriarUsuario(false);
    setCriandoUsuario(true);
    try {
      const res = await fetch("/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nome: novoNome,
          email: novoEmail,
          senha: novaSenha,
          papel: novoPapel,
          clinicaId,
        }),
      });
      const dados = await res.json().catch(() => null);
      if (!res.ok) {
        setErroCriarUsuario(dados?.erro ?? "não foi possível criar o usuário");
        return;
      }
      setNovoNome("");
      setNovoEmail("");
      setNovaSenha("");
      setNovoPapel("OPERADOR");
      setSucessoCriarUsuario(true);
      await carregarEquipe();
    } catch {
      setErroCriarUsuario("não foi possível criar o usuário");
    } finally {
      setCriandoUsuario(false);
    }
  }

  // Alterar minha senha — qualquer papel
  const [senhaAtual, setSenhaAtual] = useState("");
  const [confirmarSenha, setConfirmarSenha] = useState("");
  const [salvandoSenha, setSalvandoSenha] = useState(false);
  const [erroSenha, setErroSenha] = useState("");
  const [sucessoSenha, setSucessoSenha] = useState(false);

  async function handleAlterarSenha(e: React.FormEvent) {
    e.preventDefault();
    setErroSenha("");
    setSucessoSenha(false);

    if (senhaAtual.length < SENHA_MINIMA) {
      setErroSenha(`a senha deve ter pelo menos ${SENHA_MINIMA} caracteres`);
      return;
    }
    if (senhaAtual !== confirmarSenha) {
      setErroSenha("as senhas não coincidem");
      return;
    }

    setSalvandoSenha(true);
    try {
      const res = await fetch("/api/usuario/senha", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ senha: senhaAtual }),
      });
      const dados = await res.json().catch(() => null);
      if (!res.ok) {
        setErroSenha(dados?.erro ?? "não foi possível alterar a senha");
        return;
      }
      setSenhaAtual("");
      setConfirmarSenha("");
      setSucessoSenha(true);
    } catch {
      setErroSenha("não foi possível alterar a senha");
    } finally {
      setSalvandoSenha(false);
    }
  }

  return (
    <div className="space-y-8">
      <h2 className="font-serif text-lg font-semibold text-fg">Segurança</h2>

      {/* Alterar minha senha — todos os papéis */}
      <section className="rounded-xl border border-border bg-surface p-6">
        <h3 className="mb-1 font-serif text-base font-semibold text-fg">Alterar minha senha</h3>
        <p className="mb-4 text-sm text-muted">Troca a senha da sua própria conta.</p>

        <form onSubmit={handleAlterarSenha} className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-fg">Nova senha</label>
            <input
              type="password"
              name="senhaAtual"
              value={senhaAtual}
              onChange={(e) => {
                setSenhaAtual(e.target.value);
                setSucessoSenha(false);
              }}
              required
              minLength={SENHA_MINIMA}
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-fg">Confirmar nova senha</label>
            <input
              type="password"
              name="confirmarSenha"
              value={confirmarSenha}
              onChange={(e) => {
                setConfirmarSenha(e.target.value);
                setSucessoSenha(false);
              }}
              required
              minLength={SENHA_MINIMA}
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
            />
          </div>

          {erroSenha && (
            <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red sm:col-span-2">{erroSenha}</p>
          )}
          {sucessoSenha && (
            <p className="rounded-lg bg-green/10 px-3 py-2 text-sm text-green sm:col-span-2">
              Senha alterada.
            </p>
          )}

          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={salvandoSenha}
              className="rounded-lg bg-gold px-4 py-2 text-sm font-medium text-bg transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {salvandoSenha ? "Salvando..." : "Salvar"}
            </button>
          </div>
        </form>
      </section>

      {/* Equipe — só ADMIN vê e usa; o servidor também barra não-ADMIN em GET/POST */}
      {papel === "ADMIN" && (
        <section className="rounded-xl border border-border bg-surface p-6">
          <h3 className="mb-1 font-serif text-base font-semibold text-fg">Equipe</h3>
          <p className="mb-4 text-sm text-muted">
            Usuários com acesso a este painel. Só administradores podem ver esta lista e criar novos usuários.
          </p>

          {carregandoEquipe ? (
            <p className="text-sm text-muted">Carregando...</p>
          ) : erroCarregarEquipe ? (
            <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red">Não foi possível carregar a equipe.</p>
          ) : equipe.length === 0 ? (
            <p className="text-sm text-muted">Nenhum usuário encontrado.</p>
          ) : (
            <div className="mb-6 space-y-2">
              {equipe.map((u) => (
                <div
                  key={u.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-bg px-3 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-fg">{u.nome}</p>
                    <p className="truncate text-xs text-muted">{u.email}</p>
                  </div>
                  <span className="shrink-0 rounded-full bg-gold/10 px-2 py-0.5 text-xs font-medium text-gold">
                    {papelLabel(u.papel)}
                  </span>
                </div>
              ))}
            </div>
          )}

          <form onSubmit={handleCriarUsuario} className="space-y-4 border-t border-border pt-4">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-gold">Novo usuário</h4>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <CampoTexto label="Nome" name="novoNome" value={novoNome} onChange={(e) => setNovoNome(e.target.value)} required />
              <div>
                <label className="mb-1 block text-sm font-medium text-fg">E-mail</label>
                <input
                  type="email"
                  value={novoEmail}
                  onChange={(e) => setNovoEmail(e.target.value)}
                  required
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-fg">Senha inicial</label>
                <input
                  type="password"
                  value={novaSenha}
                  onChange={(e) => setNovaSenha(e.target.value)}
                  required
                  minLength={6}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-fg">Papel</label>
                <select
                  value={novoPapel}
                  onChange={(e) => setNovoPapel(e.target.value as Papel)}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                >
                  <option value="OPERADOR">{papelLabel("OPERADOR")}</option>
                  <option value="PROFISSIONAL">{papelLabel("PROFISSIONAL")}</option>
                  <option value="ADMIN">{papelLabel("ADMIN")}</option>
                </select>
              </div>
            </div>

            {erroCriarUsuario && (
              <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red">{erroCriarUsuario}</p>
            )}
            {sucessoCriarUsuario && (
              <p className="rounded-lg bg-green/10 px-3 py-2 text-sm text-green">Usuário criado.</p>
            )}

            <div className="flex justify-end">
              <button
                type="submit"
                disabled={criandoUsuario}
                className="rounded-lg bg-gold px-4 py-2 text-sm font-medium text-bg transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {criandoUsuario ? "Criando..." : "Criar usuário"}
              </button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}
