"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";

const PAPEIS_COMISSAO = ["SELLER", "CLOSER", "PRODUTOR"] as const;
const FORMAS_RECEBIMENTO = ["ADIANTADO", "POR_PARCELA"] as const;

function formaRecebimentoLabel(f: string): string {
  return f === "ADIANTADO" ? "Adiantado" : "Por parcela";
}

interface Comissionado {
  id: string;
  nome: string;
  email: string | null;
  telefone: string | null;
  papelPadrao: string | null;
  ativo: boolean;
  percentualComissao: string | null;
  formaRecebimento: string;
}

const FORM_VAZIO = {
  nome: "",
  email: "",
  telefone: "",
  papelPadrao: "",
  ativo: true,
  percentualComissao: "",
  formaRecebimento: "POR_PARCELA",
};

export default function ComissionadosPage() {
  const router = useRouter();
  const pathname = usePathname();

  const [comissionados, setComissionados] = useState<Comissionado[]>([]);
  const [carregando, setCarregando] = useState(true);

  const [modalAberto, setModalAberto] = useState(false);
  const [editando, setEditando] = useState<Comissionado | null>(null);
  const [form, setForm] = useState(FORM_VAZIO);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  async function carregarComissionados() {
    setCarregando(true);
    try {
      const res = await fetch("/api/mentoria/comissionados");
      if (res.ok) setComissionados(await res.json());
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    carregarComissionados();
  }, []);

  function abrirNovo() {
    setEditando(null);
    setForm(FORM_VAZIO);
    setErro("");
    setModalAberto(true);
  }

  function abrirEditar(c: Comissionado) {
    setEditando(c);
    setForm({
      nome: c.nome,
      email: c.email ?? "",
      telefone: c.telefone ?? "",
      papelPadrao: c.papelPadrao ?? "",
      ativo: c.ativo,
      percentualComissao: c.percentualComissao !== null ? String(Number(c.percentualComissao) * 100) : "",
      formaRecebimento: c.formaRecebimento,
    });
    setErro("");
    setModalAberto(true);
  }

  async function handleSalvar(e: React.FormEvent) {
    e.preventDefault();
    if (!form.nome.trim()) {
      setErro("informe o nome");
      return;
    }
    const percentualFracao = Number(form.percentualComissao) / 100;
    if (!form.percentualComissao || !(percentualFracao > 0) || percentualFracao > 1) {
      setErro("percentual de comissão deve ser maior que 0% e no máximo 100%");
      return;
    }
    setErro("");
    setSalvando(true);

    try {
      const body = {
        nome: form.nome.trim(),
        email: form.email || null,
        telefone: form.telefone || null,
        papelPadrao: form.papelPadrao || null,
        ativo: form.ativo,
        percentualComissao: percentualFracao,
        formaRecebimento: form.formaRecebimento,
      };
      const res = editando
        ? await fetch(`/api/mentoria/comissionados/${editando.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        : await fetch("/api/mentoria/comissionados", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setErro(data?.erro ?? "não foi possível salvar o comissionado");
        return;
      }

      setModalAberto(false);
      await carregarComissionados();
    } catch {
      setErro("não foi possível salvar o comissionado");
    } finally {
      setSalvando(false);
    }
  }

  async function handleSair() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <button onClick={() => router.push("/painel")} className="text-sm text-muted hover:text-fg">
              ← Painel
            </button>
            <h1 className="font-serif text-lg font-semibold text-fg">Mentoria — Comissionados</h1>
          </div>
          <button
            onClick={handleSair}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-fg hover:bg-bg"
          >
            Sair
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-5xl px-6 py-8">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex gap-2">
            <button
              onClick={() => router.push("/mentoria/dashboard")}
              className={`rounded-lg border px-4 py-2 text-sm font-medium ${
                pathname?.startsWith("/mentoria/dashboard") ? "border-gold bg-gold/10 text-gold" : "border-border text-fg hover:bg-bg"
              }`}
            >
              Dashboard
            </button>
            <button
              onClick={() => router.push("/mentoria/alunos")}
              className={`rounded-lg border px-4 py-2 text-sm font-medium ${
                pathname?.startsWith("/mentoria/alunos") ? "border-gold bg-gold/10 text-gold" : "border-border text-fg hover:bg-bg"
              }`}
            >
              Alunos
            </button>
            <button
              onClick={() => router.push("/mentoria/comissionados")}
              className={`rounded-lg border px-4 py-2 text-sm font-medium ${
                pathname?.startsWith("/mentoria/comissionados") ? "border-gold bg-gold/10 text-gold" : "border-border text-fg hover:bg-bg"
              }`}
            >
              Comissionados
            </button>
          </div>
          <button
            onClick={abrirNovo}
            className="rounded-lg bg-gold px-4 py-2 text-sm font-medium text-bg hover:brightness-110"
          >
            Novo comissionado
          </button>
        </div>

        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wide text-muted">
                <th className="px-4 py-3">Nome</th>
                <th className="px-4 py-3">Contatos</th>
                <th className="px-4 py-3">Papel padrão</th>
                <th className="px-4 py-3">% Comissão</th>
                <th className="px-4 py-3">Recebimento</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {carregando ? (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-muted">
                    Carregando...
                  </td>
                </tr>
              ) : comissionados.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-6 text-center text-muted">
                    Nenhum comissionado cadastrado.
                  </td>
                </tr>
              ) : (
                comissionados.map((c) => (
                  <tr key={c.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 font-medium text-fg">{c.nome}</td>
                    <td className="px-4 py-3 text-fg">{[c.email, c.telefone].filter(Boolean).join(" · ") || "—"}</td>
                    <td className="px-4 py-3 text-fg">{c.papelPadrao ?? "—"}</td>
                    <td className="px-4 py-3 text-fg">
                      {c.percentualComissao !== null ? `${(Number(c.percentualComissao) * 100).toLocaleString("pt-BR")}%` : "—"}
                    </td>
                    <td className="px-4 py-3 text-fg">{formaRecebimentoLabel(c.formaRecebimento)}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                          c.ativo ? "bg-green/10 text-green" : "bg-muted/10 text-muted"
                        }`}
                      >
                        {c.ativo ? "Ativo" : "Inativo"}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button onClick={() => abrirEditar(c)} className="text-xs font-medium text-gold hover:underline">
                        Editar
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modalAberto && (
        <div className="fixed inset-x-0 bottom-0 top-16 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-lg">
            <h2 className="mb-4 font-serif text-lg font-semibold text-fg">
              {editando ? "Editar comissionado" : "Novo comissionado"}
            </h2>
            <form onSubmit={handleSalvar} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-fg">Nome</label>
                <input
                  type="text"
                  required
                  value={form.nome}
                  onChange={(e) => setForm((f) => ({ ...f, nome: e.target.value }))}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-fg">E-mail</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-fg">Telefone</label>
                <input
                  type="text"
                  value={form.telefone}
                  onChange={(e) => setForm((f) => ({ ...f, telefone: e.target.value }))}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-fg">Papel padrão (opcional)</label>
                <select
                  value={form.papelPadrao}
                  onChange={(e) => setForm((f) => ({ ...f, papelPadrao: e.target.value }))}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                >
                  <option value="">Nenhum</option>
                  {PAPEIS_COMISSAO.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-fg">Percentual de comissão (%)</label>
                <input
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  required
                  value={form.percentualComissao}
                  onChange={(e) => setForm((f) => ({ ...f, percentualComissao: e.target.value }))}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                />
                <p className="mt-1 text-xs text-muted">
                  Fixo — vale para todos os contratos deste comissionado, copiado no momento de cada vínculo.
                </p>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-fg">Forma de recebimento</label>
                <select
                  value={form.formaRecebimento}
                  onChange={(e) => setForm((f) => ({ ...f, formaRecebimento: e.target.value }))}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                >
                  {FORMAS_RECEBIMENTO.map((f) => (
                    <option key={f} value={f}>
                      {formaRecebimentoLabel(f)}
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-2 text-sm text-fg">
                <input
                  type="checkbox"
                  checked={form.ativo}
                  onChange={(e) => setForm((f) => ({ ...f, ativo: e.target.checked }))}
                />
                Ativo
              </label>

              {erro && <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red">{erro}</p>}

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setModalAberto(false)}
                  disabled={salvando}
                  className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-fg hover:bg-bg disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={salvando || !form.nome.trim()}
                  className="rounded-lg bg-gold px-4 py-2 text-sm font-medium text-bg hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {salvando ? "Salvando..." : "Salvar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
