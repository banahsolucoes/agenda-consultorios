"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const FORM_VAZIO = { nomeCompleto: "", cpf: "", email: "", telefone: "", observacoes: "" };

export default function NovoAlunoMentoriaPage() {
  const router = useRouter();
  const [form, setForm] = useState(FORM_VAZIO);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [erroCpf, setErroCpf] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.nomeCompleto.trim()) {
      setErro("informe o nome completo");
      return;
    }
    setErro("");
    setErroCpf("");
    setSalvando(true);

    try {
      const res = await fetch("/api/mentoria/alunos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nomeCompleto: form.nomeCompleto.trim(),
          cpf: form.cpf || undefined,
          email: form.email || undefined,
          telefone: form.telefone || undefined,
          observacoes: form.observacoes || undefined,
        }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        if (res.status === 409) {
          setErroCpf(data?.erro ?? "CPF já cadastrado nesta clínica");
        } else {
          setErro(data?.erro ?? "não foi possível cadastrar o aluno");
        }
        return;
      }

      router.push(`/mentoria/alunos/${data.id}`);
    } catch {
      setErro("não foi possível cadastrar o aluno");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <button onClick={() => router.push("/mentoria/alunos")} className="text-sm text-muted hover:text-fg">
              ← Alunos
            </button>
            <h1 className="font-serif text-lg font-semibold text-fg">Novo aluno</h1>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-2xl px-6 py-8">
        <form onSubmit={handleSubmit} className="space-y-4 rounded-xl border border-border bg-surface p-6">
          <div>
            <label className="mb-1 block text-sm font-medium text-fg">Nome completo</label>
            <input
              type="text"
              required
              value={form.nomeCompleto}
              onChange={(e) => setForm((f) => ({ ...f, nomeCompleto: e.target.value }))}
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-fg">CPF (opcional)</label>
              <input
                type="text"
                value={form.cpf}
                onChange={(e) => {
                  setForm((f) => ({ ...f, cpf: e.target.value }));
                  setErroCpf("");
                }}
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
              />
              {erroCpf && <p className="mt-1 text-xs text-red">{erroCpf}</p>}
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-fg">Telefone (opcional)</label>
              <input
                type="text"
                value={form.telefone}
                onChange={(e) => setForm((f) => ({ ...f, telefone: e.target.value }))}
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
              />
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-fg">E-mail (opcional)</label>
            <input
              type="email"
              value={form.email}
              onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-fg">Observações (opcional)</label>
            <textarea
              value={form.observacoes}
              onChange={(e) => setForm((f) => ({ ...f, observacoes: e.target.value }))}
              rows={3}
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
            />
          </div>

          {erro && <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red">{erro}</p>}

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => router.push("/mentoria/alunos")}
              disabled={salvando}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-fg hover:bg-bg disabled:cursor-not-allowed disabled:opacity-60"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={salvando || !form.nomeCompleto.trim()}
              className="rounded-lg bg-gold px-4 py-2 text-sm font-medium text-bg hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {salvando ? "Salvando..." : "Cadastrar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
