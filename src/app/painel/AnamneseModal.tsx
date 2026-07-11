"use client";

import { useEffect, useState } from "react";
import AnamneseEditor from "./AnamneseEditor";

// Modal leve de anamnese: busca só o paciente (nome + anamnese) da clínica
// logada ao abrir e mostra o AnamneseEditor — sem campos cadastrais, sem
// anexos. Header fixo (título + "X") e corpo rolável, mesmo padrão dos
// outros modais do painel.
export default function AnamneseModal({
  pacienteId,
  onFechar,
}: {
  pacienteId: string;
  onFechar: () => void;
}) {
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [paciente, setPaciente] = useState<{ nome: string; anamnese: string | null } | null>(null);

  useEffect(() => {
    let cancelado = false;
    async function carregar() {
      setCarregando(true);
      setErro("");
      try {
        const res = await fetch(`/api/pacientes/${pacienteId}`);
        const dados = await res.json().catch(() => null);
        if (!res.ok) throw new Error(dados?.erro || "não foi possível carregar a anamnese");
        if (!cancelado) setPaciente({ nome: dados.nome, anamnese: dados.anamnese ?? null });
      } catch (err) {
        if (!cancelado) setErro(err instanceof Error ? err.message : "não foi possível carregar a anamnese");
      } finally {
        if (!cancelado) setCarregando(false);
      }
    }
    carregar();
    return () => {
      cancelado = true;
    };
  }, [pacienteId]);

  return (
    <div className="fixed inset-x-0 bottom-0 top-16 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl border border-border bg-surface shadow-lg">
        <div className="flex shrink-0 items-center justify-between border-b border-border p-6 pb-4">
          <h2 className="font-serif text-lg font-semibold text-fg">
            Anamnese{paciente ? ` – ${paciente.nome}` : ""}
          </h2>
          <button onClick={onFechar} className="text-muted hover:text-fg" aria-label="Fechar">
            ✕
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {carregando ? (
            <p className="text-sm text-muted">Carregando...</p>
          ) : erro ? (
            <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red">{erro}</p>
          ) : (
            <AnamneseEditor pacienteId={pacienteId} anamneseInicial={paciente?.anamnese ?? null} />
          )}
        </div>
      </div>
    </div>
  );
}
