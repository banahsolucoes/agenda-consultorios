"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { TIMEZONE } from "@/lib/timezone";
import { statusLabel } from "@/lib/labels";
import DatePickerSP from "../../../painel/DatePickerSP";

interface Contrato {
  id: string;
  pacote: string;
  valorTotal: string;
  status: "ATIVO" | "CONCLUIDO" | "CANCELADO";
  totalParcelas: number;
  assinaturaContrato: string;
}

interface Aluno {
  id: string;
  nomeCompleto: string;
  cpf: string | null;
  email: string | null;
  telefone: string | null;
  observacoes: string | null;
  rg: string | null;
  estadoCivil: string | null;
  profissao: string | null;
  nacionalidade: string | null;
  enderecoCompleto: string | null;
  cep: string | null;
  cidadeUf: string | null;
  dataNascimento: string | null;
  contratos: Contrato[];
}

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

function formatarMoeda(valor: string) {
  const n = Number(valor);
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatarDataCurta(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: TIMEZONE });
}

function corStatusContrato(status: string) {
  switch (status) {
    case "ATIVO":
      return "bg-green/10 text-green";
    case "CONCLUIDO":
      return "bg-blue/10 text-blue";
    case "CANCELADO":
      return "bg-muted/10 text-muted";
    default:
      return "bg-muted/10 text-muted";
  }
}

export default function DetalheAlunoMentoriaPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const alunoId = params.id;

  const [aluno, setAluno] = useState<Aluno | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erroCarregar, setErroCarregar] = useState("");

  const [modalEdicao, setModalEdicao] = useState(false);
  const [form, setForm] = useState(FORM_VAZIO);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [erroCpf, setErroCpf] = useState("");

  async function carregarAluno() {
    setCarregando(true);
    try {
      const res = await fetch(`/api/mentoria/alunos/${alunoId}`);
      if (!res.ok) {
        setErroCarregar(res.status === 404 ? "aluno não encontrado" : "não foi possível carregar o aluno");
        return;
      }
      setAluno(await res.json());
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    if (alunoId) carregarAluno();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alunoId]);

  function abrirEdicao() {
    if (!aluno) return;
    setForm({
      nomeCompleto: aluno.nomeCompleto,
      rg: aluno.rg ?? "",
      cpf: aluno.cpf ?? "",
      dataNascimento: aluno.dataNascimento ? aluno.dataNascimento.slice(0, 10) : "",
      estadoCivil: aluno.estadoCivil ?? "",
      profissao: aluno.profissao ?? "",
      nacionalidade: aluno.nacionalidade ?? "",
      telefone: aluno.telefone ?? "",
      email: aluno.email ?? "",
      enderecoCompleto: aluno.enderecoCompleto ?? "",
      cep: aluno.cep ?? "",
      cidadeUf: aluno.cidadeUf ?? "",
      observacoes: aluno.observacoes ?? "",
    });
    setErro("");
    setErroCpf("");
    setModalEdicao(true);
  }

  async function handleSalvarEdicao(e: React.FormEvent) {
    e.preventDefault();
    if (!form.nomeCompleto.trim()) {
      setErro("informe o nome completo");
      return;
    }
    setErro("");
    setErroCpf("");
    setSalvando(true);

    try {
      const res = await fetch(`/api/mentoria/alunos/${alunoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nomeCompleto: form.nomeCompleto.trim(),
          rg: form.rg || null,
          cpf: form.cpf || null,
          dataNascimento: form.dataNascimento || null,
          estadoCivil: form.estadoCivil || null,
          profissao: form.profissao || null,
          nacionalidade: form.nacionalidade || null,
          telefone: form.telefone || null,
          email: form.email || null,
          enderecoCompleto: form.enderecoCompleto || null,
          cep: form.cep || null,
          cidadeUf: form.cidadeUf || null,
          observacoes: form.observacoes || null,
        }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        if (res.status === 409) {
          setErroCpf(data?.erro ?? "CPF já cadastrado nesta clínica");
        } else {
          setErro(data?.erro ?? "não foi possível salvar as alterações");
        }
        return;
      }

      setModalEdicao(false);
      await carregarAluno();
    } catch {
      setErro("não foi possível salvar as alterações");
    } finally {
      setSalvando(false);
    }
  }

  if (carregando) {
    return <div className="flex min-h-screen items-center justify-center bg-bg text-sm text-muted">Carregando...</div>;
  }

  if (erroCarregar || !aluno) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-bg text-sm text-muted">
        <p>{erroCarregar || "aluno não encontrado"}</p>
        <button onClick={() => router.push("/mentoria/alunos")} className="text-gold hover:underline">
          ← Voltar para Alunos
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-3xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <button onClick={() => router.push("/mentoria/alunos")} className="text-sm text-muted hover:text-fg">
              ← Alunos
            </button>
            <h1 className="font-serif text-lg font-semibold text-fg">{aluno.nomeCompleto}</h1>
          </div>
          <button
            onClick={abrirEdicao}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-fg hover:bg-bg"
          >
            Editar
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-3xl space-y-6 px-6 py-8">
        <div className="rounded-xl border border-border bg-surface p-6">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Dados pessoais</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted">RG</p>
              <p className="text-fg">{aluno.rg || "—"}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted">CPF</p>
              <p className="text-fg">{aluno.cpf || "—"}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted">Data de nascimento</p>
              <p className="text-fg">{aluno.dataNascimento ? formatarDataCurta(aluno.dataNascimento) : "—"}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted">Estado civil</p>
              <p className="text-fg">{aluno.estadoCivil || "—"}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted">Profissão</p>
              <p className="text-fg">{aluno.profissao || "—"}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted">Nacionalidade</p>
              <p className="text-fg">{aluno.nacionalidade || "—"}</p>
            </div>
          </div>

          <h2 className="mb-3 mt-6 text-xs font-semibold uppercase tracking-wide text-muted">Contato</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted">Telefone</p>
              <p className="text-fg">{aluno.telefone || "—"}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted">E-mail</p>
              <p className="text-fg">{aluno.email || "—"}</p>
            </div>
          </div>

          <h2 className="mb-3 mt-6 text-xs font-semibold uppercase tracking-wide text-muted">Endereço</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">Endereço completo</p>
              <p className="text-fg">{aluno.enderecoCompleto || "—"}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted">CEP</p>
              <p className="text-fg">{aluno.cep || "—"}</p>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-muted">Cidade/UF</p>
              <p className="text-fg">{aluno.cidadeUf || "—"}</p>
            </div>
          </div>

          {aluno.observacoes && (
            <div className="mt-6">
              <p className="text-xs font-medium uppercase tracking-wide text-muted">Observações</p>
              <p className="whitespace-pre-wrap text-fg">{aluno.observacoes}</p>
            </div>
          )}
        </div>

        <div>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-serif text-base font-semibold text-fg">Contratos</h2>
            <button
              onClick={() => router.push(`/mentoria/contratos/novo?aluno=${aluno.id}`)}
              className="rounded-lg bg-gold px-4 py-2 text-sm font-medium text-bg hover:brightness-110"
            >
              Novo contrato
            </button>
          </div>

          <div className="overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wide text-muted">
                  <th className="px-4 py-3">Pacote</th>
                  <th className="px-4 py-3">Valor total</th>
                  <th className="px-4 py-3">Parcelas</th>
                  <th className="px-4 py-3">Assinatura</th>
                  <th className="px-4 py-3">Status</th>
                </tr>
              </thead>
              <tbody>
                {aluno.contratos.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-6 text-center text-muted">
                      Nenhum contrato cadastrado.
                    </td>
                  </tr>
                ) : (
                  aluno.contratos.map((c) => (
                    <tr
                      key={c.id}
                      onClick={() => router.push(`/mentoria/contratos/${c.id}`)}
                      className="cursor-pointer border-b border-border last:border-0 hover:bg-bg"
                    >
                      <td className="px-4 py-3 font-medium text-fg">{c.pacote}</td>
                      <td className="px-4 py-3 text-fg">{formatarMoeda(c.valorTotal)}</td>
                      <td className="px-4 py-3 text-fg">{c.totalParcelas}</td>
                      <td className="px-4 py-3 text-fg">{formatarDataCurta(c.assinaturaContrato)}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${corStatusContrato(c.status)}`}>
                          {statusLabel(c.status)}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {modalEdicao && (
        <div className="fixed inset-x-0 bottom-0 top-16 z-50 flex items-center justify-center overflow-y-auto bg-black/60 px-4 py-8">
          <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-lg">
            <h2 className="mb-4 font-serif text-lg font-semibold text-fg">Editar aluno</h2>
            <form onSubmit={handleSalvarEdicao} className="space-y-6">
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
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Dados pessoais</h3>
                <div className="space-y-4">
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
                    <DatePickerSP
                      value={form.dataNascimento}
                      onChange={(v) => setForm((f) => ({ ...f, dataNascimento: v }))}
                    />
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
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Contato</h3>
                <div className="space-y-4">
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
                <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">Endereço</h3>
                <div className="space-y-4">
                  <div>
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
                  onClick={() => setModalEdicao(false)}
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
