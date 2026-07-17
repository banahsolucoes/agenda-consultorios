"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import DatePickerSP from "../../../painel/DatePickerSP";

const FORM_VAZIO = {
  nomeCompleto: "",
  rg: "",
  cpf: "",
  dataNascimento: "",
  estadoCivil: "",
  profissao: "",
  nacionalidade: "",
  telefone: "",
  email: "",
  enderecoCompleto: "",
  cep: "",
  cidadeUf: "",
  observacoes: "",
};

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
          rg: form.rg || undefined,
          cpf: form.cpf || undefined,
          dataNascimento: form.dataNascimento || undefined,
          estadoCivil: form.estadoCivil || undefined,
          profissao: form.profissao || undefined,
          nacionalidade: form.nacionalidade || undefined,
          telefone: form.telefone || undefined,
          email: form.email || undefined,
          enderecoCompleto: form.enderecoCompleto || undefined,
          cep: form.cep || undefined,
          cidadeUf: form.cidadeUf || undefined,
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
        <form onSubmit={handleSubmit} className="space-y-6 rounded-xl border border-border bg-surface p-6">
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

          <div>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Dados pessoais</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-fg">RG</label>
                <input
                  type="text"
                  value={form.rg}
                  onChange={(e) => setForm((f) => ({ ...f, rg: e.target.value }))}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-fg">CPF</label>
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
                <label className="mb-1 block text-sm font-medium text-fg">Data de nascimento</label>
                <DatePickerSP value={form.dataNascimento} onChange={(v) => setForm((f) => ({ ...f, dataNascimento: v }))} />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-fg">Estado civil</label>
                <input
                  type="text"
                  value={form.estadoCivil}
                  onChange={(e) => setForm((f) => ({ ...f, estadoCivil: e.target.value }))}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-fg">Profissão</label>
                <input
                  type="text"
                  value={form.profissao}
                  onChange={(e) => setForm((f) => ({ ...f, profissao: e.target.value }))}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-fg">Nacionalidade</label>
                <input
                  type="text"
                  value={form.nacionalidade}
                  onChange={(e) => setForm((f) => ({ ...f, nacionalidade: e.target.value }))}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                />
              </div>
            </div>
          </div>

          <div>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Contato</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
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
                <label className="mb-1 block text-sm font-medium text-fg">E-mail</label>
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                />
              </div>
            </div>
          </div>

          <div>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Endereço</h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="mb-1 block text-sm font-medium text-fg">Endereço completo</label>
                <input
                  type="text"
                  value={form.enderecoCompleto}
                  onChange={(e) => setForm((f) => ({ ...f, enderecoCompleto: e.target.value }))}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-fg">CEP</label>
                <input
                  type="text"
                  value={form.cep}
                  onChange={(e) => setForm((f) => ({ ...f, cep: e.target.value }))}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-fg">Cidade/UF</label>
                <input
                  type="text"
                  value={form.cidadeUf}
                  onChange={(e) => setForm((f) => ({ ...f, cidadeUf: e.target.value }))}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-fg">Observações</label>
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
