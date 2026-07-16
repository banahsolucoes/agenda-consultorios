"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { TIMEZONE } from "@/lib/timezone";
import { tarefaTipoLabel, tarefaRecorrenciaLabel, statusLabel } from "@/lib/labels";
import DatePickerSP from "../painel/DatePickerSP";

interface Tarefa {
  id: string;
  tipo: "RENOVACAO" | "CONTA";
  origem: "SISTEMA" | "MANUAL";
  titulo: string;
  descricao: string | null;
  pacienteId: string | null;
  dataVencimento: string | null;
  dataAviso: string | null;
  recorrencia: "NENHUMA" | "MENSAL";
  status: "PENDENTE" | "CONCLUIDA" | "ARQUIVADA";
}

const FILTROS_STATUS = [
  { valor: "PENDENTE", rotulo: "Pendentes" },
  { valor: "CONCLUIDA", rotulo: "Concluídas" },
  { valor: "TODAS", rotulo: "Todas" },
] as const;
type FiltroStatus = (typeof FILTROS_STATUS)[number]["valor"];

const FILTROS_TIPO = [
  { valor: "TODOS", rotulo: "Todos" },
  { valor: "RENOVACAO", rotulo: "Renovação" },
  { valor: "CONTA", rotulo: "Conta" },
] as const;
type FiltroTipo = (typeof FILTROS_TIPO)[number]["valor"];

function formatarDataCurta(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: TIMEZONE });
}

function corStatus(status: string) {
  switch (status) {
    case "PENDENTE":
      return "bg-blue/10 text-blue";
    case "CONCLUIDA":
      return "bg-green/10 text-green";
    case "ARQUIVADA":
      return "bg-muted/10 text-muted";
    default:
      return "bg-muted/10 text-muted";
  }
}

const FORM_VAZIO = { titulo: "", descricao: "", dataVencimento: "", dataAviso: "", recorrencia: "NENHUMA" as "NENHUMA" | "MENSAL" };

export default function TarefasPage() {
  const router = useRouter();

  const [tarefas, setTarefas] = useState<Tarefa[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [filtroStatus, setFiltroStatus] = useState<FiltroStatus>("PENDENTE");
  const [filtroTipo, setFiltroTipo] = useState<FiltroTipo>("TODOS");

  const [modalAberto, setModalAberto] = useState(false);
  const [tarefaEditando, setTarefaEditando] = useState<Tarefa | null>(null);
  const [form, setForm] = useState(FORM_VAZIO);
  const [salvando, setSalvando] = useState(false);
  const [erroForm, setErroForm] = useState("");

  const [acaoId, setAcaoId] = useState<string | null>(null);
  const [confirmExcluirId, setConfirmExcluirId] = useState<string | null>(null);

  async function carregarTarefas() {
    setCarregando(true);
    try {
      const params = new URLSearchParams();
      if (filtroStatus !== "TODAS") params.set("status", filtroStatus);
      if (filtroTipo !== "TODOS") params.set("tipo", filtroTipo);
      const res = await fetch(`/api/tarefas?${params.toString()}`);
      if (res.ok) setTarefas(await res.json());
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    carregarTarefas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtroStatus, filtroTipo]);

  function abrirNovaTarefa() {
    setTarefaEditando(null);
    setForm(FORM_VAZIO);
    setErroForm("");
    setModalAberto(true);
  }

  function abrirEditarTarefa(t: Tarefa) {
    setTarefaEditando(t);
    setForm({
      titulo: t.titulo,
      descricao: t.descricao ?? "",
      dataVencimento: t.dataVencimento ? t.dataVencimento.slice(0, 10) : "",
      dataAviso: t.dataAviso ? t.dataAviso.slice(0, 10) : "",
      recorrencia: t.recorrencia,
    });
    setErroForm("");
    setModalAberto(true);
  }

  async function handleSalvar(e: React.FormEvent) {
    e.preventDefault();
    if (!form.titulo.trim()) {
      setErroForm("informe o título");
      return;
    }
    setErroForm("");
    setSalvando(true);
    try {
      const body: Record<string, unknown> = {
        titulo: form.titulo.trim(),
        descricao: form.descricao.trim() || undefined,
        dataVencimento: form.dataVencimento || undefined,
        dataAviso: form.dataAviso || undefined,
        recorrencia: form.recorrencia,
      };

      const res = tarefaEditando
        ? await fetch(`/api/tarefas/${tarefaEditando.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        : await fetch("/api/tarefas", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...body, tipo: "CONTA" }),
          });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setErroForm(data?.erro ?? "não foi possível salvar a tarefa");
        return;
      }

      setModalAberto(false);
      await carregarTarefas();
    } catch {
      setErroForm("não foi possível salvar a tarefa");
    } finally {
      setSalvando(false);
    }
  }

  async function concluirTarefa(id: string) {
    setAcaoId(id);
    try {
      const res = await fetch(`/api/tarefas/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "CONCLUIDA" }),
      });
      if (res.ok) await carregarTarefas();
    } finally {
      setAcaoId(null);
    }
  }

  async function excluirTarefa(id: string) {
    setAcaoId(id);
    try {
      const res = await fetch(`/api/tarefas/${id}`, { method: "DELETE" });
      if (res.ok) await carregarTarefas();
    } finally {
      setAcaoId(null);
      setConfirmExcluirId(null);
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
            <h1 className="font-serif text-lg font-semibold text-fg">Tarefas</h1>
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
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap gap-2">
            <div className="flex overflow-hidden rounded-lg border border-border">
              {FILTROS_STATUS.map((f) => (
                <button
                  key={f.valor}
                  onClick={() => setFiltroStatus(f.valor)}
                  className={`px-3 py-1.5 text-sm font-medium ${
                    filtroStatus === f.valor ? "bg-gold text-bg" : "bg-surface text-fg hover:bg-bg"
                  }`}
                >
                  {f.rotulo}
                </button>
              ))}
            </div>
            <div className="flex overflow-hidden rounded-lg border border-border">
              {FILTROS_TIPO.map((f) => (
                <button
                  key={f.valor}
                  onClick={() => setFiltroTipo(f.valor)}
                  className={`px-3 py-1.5 text-sm font-medium ${
                    filtroTipo === f.valor ? "bg-gold text-bg" : "bg-surface text-fg hover:bg-bg"
                  }`}
                >
                  {f.rotulo}
                </button>
              ))}
            </div>
          </div>
          <button
            onClick={abrirNovaTarefa}
            className="rounded-lg bg-gold px-4 py-2 text-sm font-medium text-bg hover:brightness-110"
          >
            Nova tarefa
          </button>
        </div>

        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wide text-muted">
                <th className="px-4 py-3">Título</th>
                <th className="px-4 py-3">Tipo</th>
                <th className="px-4 py-3">Vencimento</th>
                <th className="px-4 py-3">Recorrência</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Ações</th>
              </tr>
            </thead>
            <tbody>
              {carregando ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-muted">
                    Carregando...
                  </td>
                </tr>
              ) : tarefas.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-muted">
                    Nenhuma tarefa encontrada.
                  </td>
                </tr>
              ) : (
                tarefas.map((t) => (
                  <tr key={t.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3">
                      <span className="font-medium text-fg">{t.titulo}</span>
                      {t.tipo === "RENOVACAO" && (
                        <span className="ml-2 rounded-full bg-muted/10 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted">
                          Gerada pelo sistema
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-fg">{tarefaTipoLabel(t.tipo)}</td>
                    <td className="px-4 py-3 text-fg">{t.dataVencimento ? formatarDataCurta(t.dataVencimento) : "—"}</td>
                    <td className="px-4 py-3 text-fg">{tarefaRecorrenciaLabel(t.recorrencia)}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${corStatus(t.status)}`}>
                        {statusLabel(t.status)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-2">
                        {t.tipo === "CONTA" ? (
                          <>
                            {t.status === "PENDENTE" && (
                              <>
                                <button
                                  onClick={() => abrirEditarTarefa(t)}
                                  className="rounded-lg border border-border px-2 py-1 text-xs font-medium text-fg hover:bg-bg"
                                >
                                  Editar
                                </button>
                                <button
                                  onClick={() => concluirTarefa(t.id)}
                                  disabled={acaoId === t.id}
                                  className="rounded-lg border border-border px-2 py-1 text-xs font-medium text-fg hover:bg-bg disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  {acaoId === t.id ? "..." : "Concluir"}
                                </button>
                              </>
                            )}
                            {t.status !== "ARQUIVADA" &&
                              (confirmExcluirId === t.id ? (
                                <>
                                  <span className="text-xs text-muted">Excluir?</span>
                                  <button
                                    onClick={() => excluirTarefa(t.id)}
                                    disabled={acaoId === t.id}
                                    className="rounded-lg bg-red px-2 py-1 text-xs font-medium text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                                  >
                                    Confirmar
                                  </button>
                                  <button
                                    onClick={() => setConfirmExcluirId(null)}
                                    className="rounded-lg border border-border px-2 py-1 text-xs font-medium text-fg hover:bg-bg"
                                  >
                                    Cancelar
                                  </button>
                                </>
                              ) : (
                                <button
                                  onClick={() => setConfirmExcluirId(t.id)}
                                  className="rounded-lg border border-border px-2 py-1 text-xs font-medium text-red hover:bg-red/10"
                                >
                                  Excluir
                                </button>
                              ))}
                          </>
                        ) : (
                          t.status === "PENDENTE" && (
                            <button
                              onClick={() => concluirTarefa(t.id)}
                              disabled={acaoId === t.id}
                              className="rounded-lg border border-border px-2 py-1 text-xs font-medium text-fg hover:bg-bg disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              {acaoId === t.id ? "..." : "Dispensar"}
                            </button>
                          )
                        )}
                      </div>
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
              {tarefaEditando ? "Editar tarefa" : "Nova tarefa"}
            </h2>
            <form onSubmit={handleSalvar} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-fg">Título</label>
                <input
                  type="text"
                  required
                  value={form.titulo}
                  onChange={(e) => setForm((f) => ({ ...f, titulo: e.target.value }))}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-fg">Descrição (opcional)</label>
                <textarea
                  value={form.descricao}
                  onChange={(e) => setForm((f) => ({ ...f, descricao: e.target.value }))}
                  rows={2}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                />
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block whitespace-nowrap text-sm font-medium text-fg">
                    Data de vencimento
                  </label>
                  <DatePickerSP
                    value={form.dataVencimento}
                    onChange={(v) => setForm((f) => ({ ...f, dataVencimento: v }))}
                  />
                </div>
                <div>
                  <label className="mb-1 block whitespace-nowrap text-sm font-medium text-fg">Data de aviso</label>
                  <DatePickerSP value={form.dataAviso} onChange={(v) => setForm((f) => ({ ...f, dataAviso: v }))} />
                </div>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-fg">Recorrência</label>
                <select
                  value={form.recorrencia}
                  onChange={(e) => setForm((f) => ({ ...f, recorrencia: e.target.value as "NENHUMA" | "MENSAL" }))}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                >
                  <option value="NENHUMA">Nenhuma</option>
                  <option value="MENSAL">Mensal</option>
                </select>
              </div>

              {erroForm && <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red">{erroForm}</p>}

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
                  disabled={salvando || !form.titulo.trim()}
                  className="rounded-lg bg-gold px-4 py-2 text-sm font-medium text-bg hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {salvando ? "Salvando..." : tarefaEditando ? "Salvar" : "Criar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
