"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatarDataHoraSP } from "@/lib/timezone";

interface EnvioResumo {
  id: string;
  criadoEm: string;
  status: "PENDENTE" | "IGNORADO" | "PROCESSADO";
  observacaoProcessamento: string | null;
  formularioTitulo: string;
  nomeInformado: string | null;
  cpfDigitos: string | null;
  matchPacienteId: string | null;
  matchPacienteNome: string | null;
}

const FILTROS = [
  { valor: "PENDENTE", rotulo: "Pendentes" },
  { valor: "IGNORADO", rotulo: "Ignorados" },
] as const;
type Filtro = (typeof FILTROS)[number]["valor"];

export default function AnamnesesPage() {
  const router = useRouter();
  const [envios, setEnvios] = useState<EnvioResumo[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [filtro, setFiltro] = useState<Filtro>("PENDENTE");
  const [acessoNegado, setAcessoNegado] = useState(false);

  async function carregar() {
    setCarregando(true);
    try {
      const res = await fetch(`/api/anamneses?status=${filtro}`);
      if (res.status === 403) {
        setAcessoNegado(true);
        return;
      }
      if (res.ok) setEnvios(await res.json());
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtro]);

  async function handleSair() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  if (acessoNegado) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg px-4">
        <div className="text-center">
          <p className="text-fg">Você não tem permissão para acessar esta página.</p>
          <button onClick={() => router.push("/painel")} className="mt-4 text-sm text-gold hover:underline">
            Voltar ao painel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <button onClick={() => router.push("/painel")} className="text-sm text-muted hover:text-fg">
              ← Painel
            </button>
            <h1 className="font-serif text-lg font-semibold text-fg">Anamneses</h1>
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
        <div className="mb-4 flex overflow-hidden rounded-lg border border-border w-fit">
          {FILTROS.map((f) => (
            <button
              key={f.valor}
              onClick={() => setFiltro(f.valor)}
              className={`px-3 py-1.5 text-sm font-medium ${
                filtro === f.valor ? "bg-gold text-bg" : "bg-surface text-fg hover:bg-bg"
              }`}
            >
              {f.rotulo}
            </button>
          ))}
        </div>

        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wide text-muted">
                <th className="px-4 py-3">Nome informado</th>
                <th className="px-4 py-3">Formulário</th>
                <th className="px-4 py-3">Enviado em</th>
                <th className="px-4 py-3">{filtro === "PENDENTE" ? "Indicação" : "Motivo"}</th>
              </tr>
            </thead>
            <tbody>
              {carregando ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-muted">
                    Carregando...
                  </td>
                </tr>
              ) : envios.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-center text-muted">
                    {filtro === "PENDENTE" ? "Nenhum envio pendente." : "Nenhum envio ignorado."}
                  </td>
                </tr>
              ) : (
                envios.map((e) => (
                  <tr
                    key={e.id}
                    onClick={() => router.push(`/painel/anamneses/${e.id}`)}
                    className="cursor-pointer border-b border-border last:border-0 hover:bg-bg"
                  >
                    <td className="px-4 py-3 font-medium text-fg">{e.nomeInformado || "(sem nome)"}</td>
                    <td className="px-4 py-3 text-muted">{e.formularioTitulo}</td>
                    <td className="px-4 py-3 text-muted">{formatarDataHoraSP(new Date(e.criadoEm))}</td>
                    <td className="px-4 py-3">
                      {filtro === "PENDENTE" ? (
                        e.matchPacienteId ? (
                          <span className="rounded-full bg-blue/10 px-2 py-0.5 text-xs font-medium text-blue">
                            paciente existente: {e.matchPacienteNome}
                          </span>
                        ) : (
                          <span className="rounded-full bg-muted/10 px-2 py-0.5 text-xs font-medium text-muted">
                            novo
                          </span>
                        )
                      ) : (
                        <span className="text-muted">{e.observacaoProcessamento || "—"}</span>
                      )}
                    </td>
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
