"use client";

import { useState } from "react";

// Editor de anamnese reutilizável — textarea livre + botão "Salvar", persiste
// via PATCH /api/pacientes/[id]. Usado dentro do modal de cadastro/edição de
// paciente e do AnamneseModal (abertura rápida a partir da agenda). Paciente
// antigo sem anamnese vem com o campo vazio pra colar manualmente.
export default function AnamneseEditor({
  pacienteId,
  anamneseInicial,
}: {
  pacienteId: string;
  anamneseInicial: string | null;
}) {
  const [valor, setValor] = useState(anamneseInicial ?? "");
  const [salvando, setSalvando] = useState(false);
  const [salvo, setSalvo] = useState(false);
  const [erro, setErro] = useState("");

  async function handleSalvar() {
    setSalvando(true);
    setSalvo(false);
    setErro("");
    try {
      const res = await fetch(`/api/pacientes/${pacienteId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ anamnese: valor }),
      });
      const dados = await res.json().catch(() => null);
      if (!res.ok) throw new Error(dados?.erro || "não foi possível salvar a anamnese");
      setSalvo(true);
    } catch (err) {
      setErro(err instanceof Error ? err.message : "não foi possível salvar a anamnese");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div>
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gold">
        Anamnese
      </h3>
      <textarea
        value={valor}
        onChange={(e) => {
          setValor(e.target.value);
          setSalvo(false);
        }}
        rows={14}
        placeholder="Cole aqui as respostas da anamnese ou escreva livremente..."
        className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
      />

      {erro && <p className="mt-2 text-sm text-red">{erro}</p>}

      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          onClick={handleSalvar}
          disabled={salvando}
          className="rounded-lg bg-gold px-4 py-2 text-sm font-medium text-bg transition-colors hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {salvando ? "Salvando..." : "Salvar"}
        </button>
        {salvo && <span className="text-sm text-green">Salvo!</span>}
      </div>
    </div>
  );
}
