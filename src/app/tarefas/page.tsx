"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { TIMEZONE } from "@/lib/timezone";
import { tarefaTipoLabel, tarefaRecorrenciaLabel, statusLabel } from "@/lib/labels";
import TarefaForm, { type TarefaFormValores } from "@/components/TarefaForm";

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

export default function TarefasPage() {
  const router = useRouter();

  const [tarefas, setTarefas] = useState<Tarefa[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [filtroStatus, setFiltroStatus] = useState<FiltroStatus>("PENDENTE");
  const [filtroTipo, setFiltroTipo] = useState<FiltroTipo>("TODOS");

  const [modalAberto, setModalAberto] = useState(false);
  const [tarefaEditando, setTarefaEditando] = useState<Tarefa | null>(null);
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
    setErroForm("");
    setModalAberto(true);
  }

  function abrirEditarTarefa(t: Tarefa) {
    setTarefaEditando(t);
    setErroForm("");
    setModalAberto(true);
  }

  async function handleSalvar(valores: TarefaFormValores) {
    setErroForm("");
    setSalvando(true);
    try {
      const body: Record<string, unknown> = {
        titulo: valores.titulo.trim(),
        descricao: valores.descricao.trim() || undefined,
        dataVencimento: valores.dataVencimento || undefined,
        dataAviso: valores.dataAviso || undefined,
        recorrencia: valores.recorrencia,
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
        <TarefaForm
          key={tarefaEditando?.id ?? "novo"}
          tituloModal={tarefaEditando ? "Editar tarefa" : "Nova tarefa"}
          valoresIniciais={
            tarefaEditando
              ? {
                  titulo: tarefaEditando.titulo,
                  descricao: tarefaEditando.descricao ?? "",
                  dataVencimento: tarefaEditando.dataVencimento ? tarefaEditando.dataVencimento.slice(0, 10) : "",
                  dataAviso: tarefaEditando.dataAviso ? tarefaEditando.dataAviso.slice(0, 10) : "",
                  recorrencia: tarefaEditando.recorrencia,
                }
              : undefined
          }
          erroExterno={erroForm}
          salvando={salvando}
          textoSalvar={tarefaEditando ? "Salvar" : "Criar"}
          textoSalvando="Salvando..."
          onSalvar={handleSalvar}
          onCancelar={() => setModalAberto(false)}
        />
      )}
    </div>
  );
}
