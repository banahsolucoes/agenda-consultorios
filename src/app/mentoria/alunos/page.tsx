"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";

interface Aluno {
  id: string;
  nomeCompleto: string;
  email: string | null;
  telefone: string | null;
  _count: { contratos: number };
}

function soDigitos(s: string): string {
  return (s || "").replace(/\D/g, "");
}

// Ícone de lixeira (excluir aluno) — mesmo traçado usado na Agenda (painel/page.tsx)
function IconLixeira({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
      <path
        d="M4 6h12M8 6V4.5A1.5 1.5 0 0 1 9.5 3h1A1.5 1.5 0 0 1 12 4.5V6M6 6l.6 9.4A1.5 1.5 0 0 0 8.1 17h3.8a1.5 1.5 0 0 0 1.5-1.6L14 6"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export default function MentoriaAlunosPage() {
  const router = useRouter();
  const pathname = usePathname();
  const [alunos, setAlunos] = useState<Aluno[]>([]);
  const [carregando, setCarregando] = useState(true);

  // Modal: pré-visualização e confirmação da importação de clientes
  // (planilha fixa da Mentoria) — mesma UX da importação de pacientes da
  // Agenda (src/app/painel/page.tsx).
  const [carregandoPreviewImportacao, setCarregandoPreviewImportacao] = useState(false);
  const [erroPreviewImportacao, setErroPreviewImportacao] = useState("");
  const [previewImportacaoAberto, setPreviewImportacaoAberto] = useState(false);
  const [previewImportacao, setPreviewImportacao] = useState<{
    total: number;
    novos: number;
    existentes: number;
    registros: Array<{ nomeCompleto?: string; cpf?: string; status: string }>;
  } | null>(null);
  const [cpfsSelecionadosImportacao, setCpfsSelecionadosImportacao] = useState<Set<string>>(new Set());
  const [confirmandoImportacao, setConfirmandoImportacao] = useState(false);
  const [erroExecutarImportacao, setErroExecutarImportacao] = useState("");
  const [resultadoImportacao, setResultadoImportacao] = useState<{
    criados: number;
    pulados: number;
    erros: number;
  } | null>(null);

  // Modal: excluir aluno — trava exige digitar o nome do aluno, mesmo padrão
  // da exclusão de paciente na Agenda (src/app/painel/page.tsx).
  const [alunoExcluindo, setAlunoExcluindo] = useState<Aluno | null>(null);
  const [confirmacaoExclusao, setConfirmacaoExclusao] = useState("");
  const [salvandoExclusao, setSalvandoExclusao] = useState(false);
  const [erroExclusao, setErroExclusao] = useState("");

  function carregarAlunos() {
    setCarregando(true);
    return fetch("/api/mentoria/alunos")
      .then((r) => (r.ok ? r.json() : []))
      .then(setAlunos)
      .finally(() => setCarregando(false));
  }

  useEffect(() => {
    carregarAlunos();
  }, []);

  async function handleSair() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  async function handleAbrirPreviewImportacao() {
    setCarregandoPreviewImportacao(true);
    setErroPreviewImportacao("");
    setResultadoImportacao(null);

    try {
      const res = await fetch("/api/mentoria/importacao/preview");
      const dados = await res.json().catch(() => null);

      if (!res.ok) {
        setErroPreviewImportacao(dados?.erro ?? "não foi possível pré-visualizar a importação");
        return;
      }

      setPreviewImportacao(dados);
      const registrosNovos = (dados?.registros ?? []) as Array<{ cpf?: string; status: string }>;
      setCpfsSelecionadosImportacao(
        new Set(
          registrosNovos
            .filter((r) => r.status === "novo")
            .map((r) => soDigitos(r.cpf || ""))
            .filter(Boolean)
        )
      );
      setPreviewImportacaoAberto(true);
    } catch {
      setErroPreviewImportacao("não foi possível pré-visualizar a importação");
    } finally {
      setCarregandoPreviewImportacao(false);
    }
  }

  function alternarSelecaoTodosImportacao(novosRegistros: Array<{ cpf?: string }>) {
    const todasAsChaves = novosRegistros.map((r) => soDigitos(r.cpf || "")).filter(Boolean);
    setCpfsSelecionadosImportacao((atual) =>
      atual.size === todasAsChaves.length ? new Set() : new Set(todasAsChaves)
    );
  }

  function alternarSelecaoImportacao(cpf: string) {
    const chave = soDigitos(cpf || "");
    if (!chave) return;
    setCpfsSelecionadosImportacao((atual) => {
      const novo = new Set(atual);
      if (novo.has(chave)) novo.delete(chave);
      else novo.add(chave);
      return novo;
    });
  }

  async function handleConfirmarImportacao() {
    setConfirmandoImportacao(true);
    setErroExecutarImportacao("");

    try {
      const res = await fetch("/api/mentoria/importacao/executar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cpfs: Array.from(cpfsSelecionadosImportacao) }),
      });
      const dados = await res.json().catch(() => null);

      if (!res.ok) {
        setErroExecutarImportacao(dados?.erro ?? "não foi possível concluir a importação");
        return;
      }

      setResultadoImportacao(dados);
      await carregarAlunos();
    } catch {
      setErroExecutarImportacao("não foi possível concluir a importação");
    } finally {
      setConfirmandoImportacao(false);
    }
  }

  function fecharPreviewImportacao() {
    setPreviewImportacaoAberto(false);
    setPreviewImportacao(null);
    setResultadoImportacao(null);
    setErroExecutarImportacao("");
    setCpfsSelecionadosImportacao(new Set());
  }

  function abrirModalExcluir(a: Aluno) {
    setAlunoExcluindo(a);
    setConfirmacaoExclusao("");
    setErroExclusao("");
  }

  async function handleConfirmarExclusao(e: React.FormEvent) {
    e.preventDefault();
    if (!alunoExcluindo) return;
    setErroExclusao("");
    setSalvandoExclusao(true);

    try {
      const res = await fetch(`/api/mentoria/alunos/${alunoExcluindo.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setErroExclusao(data?.erro ?? "não foi possível excluir o cliente");
        return;
      }

      setAlunoExcluindo(null);
      await carregarAlunos();
    } catch {
      setErroExclusao("não foi possível excluir o cliente");
    } finally {
      setSalvandoExclusao(false);
    }
  }

  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <button onClick={() => router.push("/painel")} className="text-sm text-muted hover:text-fg">
              ← Painel
            </button>
            <h1 className="font-serif text-lg font-semibold text-fg">Mentoria — Alunos</h1>
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
          <div className="flex shrink-0 items-center gap-3">
            <button
              onClick={handleAbrirPreviewImportacao}
              disabled={carregandoPreviewImportacao}
              className="rounded-lg border border-gold px-4 py-2 text-sm font-medium text-gold transition-colors hover:bg-gold/10 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {carregandoPreviewImportacao ? "Carregando..." : "Importar alunos"}
            </button>
            <button
              onClick={() => router.push("/mentoria/alunos/novo")}
              className="rounded-lg bg-gold px-4 py-2 text-sm font-medium text-bg hover:brightness-110"
            >
              Novo aluno
            </button>
          </div>
        </div>
        {erroPreviewImportacao && (
          <p className="mb-4 rounded-lg bg-red/10 px-3 py-2 text-sm text-red">{erroPreviewImportacao}</p>
        )}

        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-medium tracking-wide text-muted">
                <th className="px-4 py-3">Nome</th>
                <th className="px-4 py-3">Contatos</th>
                <th className="px-4 py-3">Contratos</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {carregando ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-muted">
                    Carregando...
                  </td>
                </tr>
              ) : alunos.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-muted">
                    Nenhum aluno cadastrado.
                  </td>
                </tr>
              ) : (
                alunos.map((a) => (
                  <tr
                    key={a.id}
                    onClick={() => router.push(`/mentoria/alunos/${a.id}`)}
                    className="cursor-pointer border-b border-border last:border-0 hover:bg-bg"
                  >
                    <td className="px-4 py-3 font-medium text-fg">{a.nomeCompleto}</td>
                    <td className="px-4 py-3 text-fg">
                      {[a.email, a.telefone].filter(Boolean).join(" · ") || "—"}
                    </td>
                    <td className="px-4 py-3 text-fg">{a._count.contratos}</td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          abrirModalExcluir(a);
                        }}
                        className="rounded-lg p-1.5 text-muted hover:bg-red/10 hover:text-red"
                        aria-label="Excluir cliente"
                        title="Excluir cliente"
                      >
                        <IconLixeira className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal: pré-visualização e confirmação da importação de clientes */}
      {previewImportacaoAberto && previewImportacao && (
        <div className="fixed inset-x-0 bottom-0 top-16 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-lg">
            <h2 className="mb-4 font-serif text-lg font-semibold text-fg">
              Importar alunos da planilha
            </h2>

            {resultadoImportacao ? (
              <>
                <p className="mb-4 rounded-lg bg-green/10 px-3 py-2 text-sm text-green">
                  {resultadoImportacao.criados} cliente(s) criado(s), {resultadoImportacao.pulados} pulado(s)
                  {resultadoImportacao.erros > 0 ? `, ${resultadoImportacao.erros} com erro` : ""}.
                </p>
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={fecharPreviewImportacao}
                    className="rounded-lg bg-gold px-4 py-2 text-sm font-medium text-bg hover:brightness-110"
                  >
                    Fechar
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="mb-3 text-sm text-fg">
                  <strong>{previewImportacao.novos}</strong> novo(s), <strong>{previewImportacao.existentes}</strong> já
                  existem na clínica.
                </p>

                {previewImportacao.novos > 0 ? (
                  <>
                    <div className="mb-2 flex items-center justify-between gap-2 text-xs text-muted">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={
                            cpfsSelecionadosImportacao.size > 0 &&
                            cpfsSelecionadosImportacao.size ===
                              previewImportacao.registros
                                .filter((r) => r.status === "novo")
                                .map((r) => soDigitos(r.cpf || ""))
                                .filter(Boolean).length
                          }
                          onChange={() =>
                            alternarSelecaoTodosImportacao(
                              previewImportacao.registros.filter((r) => r.status === "novo")
                            )
                          }
                          className="h-4 w-4 rounded border-border"
                        />
                        Selecionar todos
                      </label>
                      <span>
                        {cpfsSelecionadosImportacao.size} de {previewImportacao.novos} selecionados
                      </span>
                    </div>
                    <div className="mb-4 max-h-64 space-y-1 overflow-y-auto rounded-lg border border-border bg-bg p-2">
                      {previewImportacao.registros
                        .filter((r) => r.status === "novo")
                        .map((r, i) => {
                          const chave = soDigitos(r.cpf || "");
                          return (
                            <label
                              key={i}
                              className="flex items-center justify-between gap-2 rounded-md px-2 py-1 text-sm hover:bg-surface"
                            >
                              <span className="flex min-w-0 items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={chave ? cpfsSelecionadosImportacao.has(chave) : false}
                                  disabled={!chave}
                                  onChange={() => alternarSelecaoImportacao(r.cpf || "")}
                                  className="h-4 w-4 shrink-0 rounded border-border disabled:cursor-not-allowed"
                                />
                                <span className="truncate text-fg">{r.nomeCompleto || "(sem nome)"}</span>
                              </span>
                              <span className="shrink-0 font-mono text-xs text-muted">{r.cpf || "sem CPF"}</span>
                            </label>
                          );
                        })}
                    </div>
                  </>
                ) : (
                  <p className="mb-4 text-sm text-muted">Nenhum cliente novo para importar.</p>
                )}

                {erroExecutarImportacao && (
                  <p className="mb-4 rounded-lg bg-red/10 px-3 py-2 text-sm text-red">{erroExecutarImportacao}</p>
                )}

                <div className="flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={fecharPreviewImportacao}
                    disabled={confirmandoImportacao}
                    className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-fg hover:bg-bg disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={handleConfirmarImportacao}
                    disabled={confirmandoImportacao || cpfsSelecionadosImportacao.size === 0}
                    className="rounded-lg bg-gold px-4 py-2 text-sm font-medium text-bg hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {confirmandoImportacao ? "Importando..." : "Confirmar importação"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Modal: excluir cliente — trava exige digitar o nome do cliente */}
      {alunoExcluindo && (
        <div className="fixed inset-x-0 bottom-0 top-16 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-lg">
            <h2 className="mb-4 font-serif text-lg font-semibold text-fg">
              Excluir {alunoExcluindo.nomeCompleto}
            </h2>
            <p className="mb-4 rounded-lg bg-red/10 px-3 py-2 text-sm text-red">
              Esta ação é irreversível. O cadastro deste cliente será apagado permanentemente.
            </p>
            <form onSubmit={handleConfirmarExclusao} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-fg">
                  Para confirmar, digite o nome completo do cliente
                </label>
                <input
                  type="text"
                  autoComplete="off"
                  value={confirmacaoExclusao}
                  onChange={(e) => setConfirmacaoExclusao(e.target.value)}
                  placeholder={alunoExcluindo.nomeCompleto}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-red focus:ring-2 focus:ring-red/20"
                />
              </div>

              {erroExclusao && (
                <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red">
                  {erroExclusao}
                </p>
              )}

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setAlunoExcluindo(null)}
                  disabled={salvandoExclusao}
                  className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-fg hover:bg-bg disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Voltar
                </button>
                <button
                  type="submit"
                  disabled={
                    salvandoExclusao ||
                    confirmacaoExclusao.trim().toLowerCase() !== alunoExcluindo.nomeCompleto.trim().toLowerCase()
                  }
                  className="rounded-lg bg-red px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {salvandoExclusao ? "Excluindo..." : "Excluir definitivamente"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
