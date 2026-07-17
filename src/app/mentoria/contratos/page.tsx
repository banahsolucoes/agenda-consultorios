"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { TIMEZONE } from "@/lib/timezone";
import { statusLabel } from "@/lib/labels";

interface ContratoLinha {
  id: string;
  pacote: string;
  status: "ATIVO" | "CONCLUIDO" | "CANCELADO";
  assinaturaContrato: string;
  terminoContrato: string;
  parcelasEmAberto: number;
  aluno: { id: string; nomeCompleto: string };
}

function formatarDataCurta(iso: string): string {
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

type SortKey = "aluno" | "assinaturaContrato" | "terminoContrato";
type SortDir = "asc" | "desc";

// Ícone de seta de ordenação — mesmo padrão de /mentoria/alunos
function IconSeta({ dir, className }: { dir: SortDir; className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" className={className} aria-hidden="true">
      <path
        d={dir === "asc" ? "M10 13V7M6.5 10.5 10 7l3.5 3.5" : "M10 7v6M6.5 9.5 10 13l3.5-3.5"}
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

type FiltroStatus = "ativos" | "todos";

export default function MentoriaContratosPage() {
  const router = useRouter();
  const pathname = usePathname();
  const [contratos, setContratos] = useState<ContratoLinha[]>([]);
  const [carregando, setCarregando] = useState(true);

  const [filtro, setFiltro] = useState<FiltroStatus>("ativos");
  const [sortKey, setSortKey] = useState<SortKey>("terminoContrato");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  useEffect(() => {
    fetch("/api/mentoria/contratos")
      .then((r) => (r.ok ? r.json() : []))
      .then(setContratos)
      .finally(() => setCarregando(false));
  }, []);

  function alternarOrdenacao(chave: SortKey) {
    if (sortKey === chave) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(chave);
      setSortDir("asc");
    }
  }

  async function handleSair() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  const contratosFiltrados = useMemo(
    () => (filtro === "ativos" ? contratos.filter((c) => c.status === "ATIVO") : contratos),
    [contratos, filtro]
  );

  const contratosOrdenados = useMemo(() => {
    const copia = [...contratosFiltrados];
    copia.sort((a, b) => {
      let comparacao = 0;
      if (sortKey === "aluno") {
        comparacao = a.aluno.nomeCompleto.localeCompare(b.aluno.nomeCompleto, "pt-BR");
      } else {
        comparacao = a[sortKey].localeCompare(b[sortKey]);
      }
      return sortDir === "asc" ? comparacao : -comparacao;
    });
    return copia;
  }, [contratosFiltrados, sortKey, sortDir]);

  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <button onClick={() => router.push("/painel")} className="text-sm text-muted hover:text-fg">
              ← Painel
            </button>
            <h1 className="font-serif text-lg font-semibold text-fg">Mentoria — Contratos</h1>
          </div>
          <button
            onClick={handleSair}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-fg hover:bg-bg"
          >
            Sair
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-6 py-8">
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
              onClick={() => router.push("/mentoria/contratos")}
              className={`rounded-lg border px-4 py-2 text-sm font-medium ${
                pathname?.startsWith("/mentoria/contratos") ? "border-gold bg-gold/10 text-gold" : "border-border text-fg hover:bg-bg"
              }`}
            >
              Contratos
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

          <div className="flex shrink-0 gap-2">
            {(["ativos", "todos"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFiltro(f)}
                className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${
                  filtro === f ? "border-gold bg-gold/10 text-gold" : "border-border text-fg hover:bg-bg"
                }`}
              >
                {f === "ativos" ? "Ativos" : "Todos"}
              </button>
            ))}
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-medium tracking-wide text-muted">
                <th className="px-4 py-3">
                  <button onClick={() => alternarOrdenacao("aluno")} className="flex items-center gap-1 hover:text-fg">
                    Aluno
                    {sortKey === "aluno" && <IconSeta dir={sortDir} className="h-3.5 w-3.5" />}
                  </button>
                </th>
                <th className="px-4 py-3">Produto</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">
                  <button
                    onClick={() => alternarOrdenacao("assinaturaContrato")}
                    className="flex items-center gap-1 hover:text-fg"
                  >
                    Assinatura do contrato
                    {sortKey === "assinaturaContrato" && <IconSeta dir={sortDir} className="h-3.5 w-3.5" />}
                  </button>
                </th>
                <th className="px-4 py-3">
                  <button
                    onClick={() => alternarOrdenacao("terminoContrato")}
                    className="flex items-center gap-1 hover:text-fg"
                  >
                    Término
                    {sortKey === "terminoContrato" && <IconSeta dir={sortDir} className="h-3.5 w-3.5" />}
                  </button>
                </th>
                <th className="px-4 py-3">Parcelas em aberto</th>
              </tr>
            </thead>
            <tbody>
              {carregando ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-muted">
                    Carregando...
                  </td>
                </tr>
              ) : contratosOrdenados.length === 0 ? (
                <tr>
                  <td colSpan={6} className="px-4 py-6 text-center text-muted">
                    Nenhum contrato encontrado.
                  </td>
                </tr>
              ) : (
                contratosOrdenados.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => router.push(`/mentoria/contratos/${c.id}`)}
                    className="cursor-pointer border-b border-border last:border-0 hover:bg-bg"
                  >
                    <td className="px-4 py-3 font-medium text-fg">{c.aluno.nomeCompleto}</td>
                    <td className="px-4 py-3 text-fg">{c.pacote}</td>
                    <td className="px-4 py-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${corStatusContrato(c.status)}`}>
                        {statusLabel(c.status)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-fg">{formatarDataCurta(c.assinaturaContrato)}</td>
                    <td className="px-4 py-3 text-fg">{formatarDataCurta(c.terminoContrato)}</td>
                    <td className="px-4 py-3 text-fg">{c.parcelasEmAberto}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
