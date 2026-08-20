"use client";

import { useEffect, useState } from "react";
import { diaSemanaLabel } from "@/lib/labels";

// Mesma ordem dos enums do Prisma (DiaSemana) — duplicado aqui como em
// AgendaCalendario.tsx (mascararHorarioAgenda) porque são helpers de UI
// pequenos e sem lógica de negócio, não vale a pena um lib compartilhado só
// pra isso.
const DIAS_SEMANA = [
  "SEGUNDA",
  "TERCA",
  "QUARTA",
  "QUINTA",
  "SEXTA",
  "SABADO",
  "DOMINGO",
] as const;

// Aplica máscara HH:MM ao horário conforme o usuário digita
function mascararHorario(valor: string) {
  const digitos = valor.replace(/\D/g, "").slice(0, 4);
  return digitos.length > 2 ? `${digitos.slice(0, 2)}:${digitos.slice(2)}` : digitos;
}

interface EmpurrarModalProps {
  pacienteId: string;
  aberto: boolean;
  onFechar: () => void;
  // Chamado após empurrar com sucesso — quem usa decide o que recarregar
  // (a tela do paciente recarrega a lista de sessões do paciente; o card da
  // agenda recarrega a grade do calendário). O componente nunca chama
  // nenhuma "carregarSessoes" diretamente — evita depender de uma função
  // homônima com significado diferente em cada tela.
  onSucesso: () => void;
}

// Modal de empurrar sessões futuras em N semanas (+ opcionalmente trocar dia
// da semana/horário) — extraído de painel/page.tsx (JSX inline + 7 useState
// locais até 2026-08-20), pra ser reutilizado também pelo botão "Empurrar"
// no card da agenda (AgendaCalendario.tsx). Move TODAS as sessões futuras
// não-canceladas do paciente — não tem conceito de "sessão de corte" (só
// POST /api/pacientes/[id]/adiar, "Trazer", tem). Nenhuma regra de negócio
// aqui: validação de semanas/conflito de semana/sync Google continuam
// inteiramente na rota.
export default function EmpurrarModal({ pacienteId, aberto, onFechar, onSucesso }: EmpurrarModalProps) {
  const [semanas, setSemanas] = useState("1");
  const [mudarDiaHorario, setMudarDiaHorario] = useState(false);
  const [novoDia, setNovoDia] = useState<string>(DIAS_SEMANA[0]);
  const [novoHorario, setNovoHorario] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  // Reseta pro estado padrão toda vez que o modal abre — mesmo
  // comportamento do antigo abrirModalEmpurrar() em page.tsx, que zerava os
  // campos antes de setModalEmpurrar(true).
  useEffect(() => {
    if (!aberto) return;
    setSemanas("1");
    setMudarDiaHorario(false);
    setNovoDia(DIAS_SEMANA[0]);
    setNovoHorario("");
    setErro("");
  }, [aberto]);

  if (!aberto) return null;

  async function handleSalvar(e: React.FormEvent) {
    e.preventDefault();
    setErro("");
    setSalvando(true);

    try {
      const body: Record<string, unknown> = { semanas: Number(semanas) };
      if (mudarDiaHorario) {
        body.novoDia = novoDia;
        body.novoHorario = novoHorario;
      }

      const res = await fetch(`/api/pacientes/${pacienteId}/empurrar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setErro(data?.erro ?? "não foi possível empurrar as sessões");
        return;
      }

      onSucesso();
      onFechar();
    } catch {
      setErro("não foi possível empurrar as sessões");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="fixed inset-x-0 bottom-0 top-16 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-lg">
        <h2 className="mb-4 font-serif text-lg font-semibold text-fg">
          Empurrar sessões
        </h2>
        <form onSubmit={handleSalvar} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-fg">
              Número de semanas (0-10)
            </label>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setSemanas((s) => String(Math.max(0, Number(s) - 1)))}
                disabled={Number(semanas) <= 0}
                aria-label="Diminuir"
                className="h-9 w-9 rounded-lg border border-border text-lg text-fg hover:bg-bg disabled:cursor-not-allowed disabled:opacity-40"
              >
                −
              </button>
              <span className="w-8 text-center text-lg font-medium text-fg">
                {semanas}
              </span>
              <button
                type="button"
                onClick={() => setSemanas((s) => String(Math.min(10, Number(s) + 1)))}
                disabled={Number(semanas) >= 10}
                aria-label="Aumentar"
                className="h-9 w-9 rounded-lg border border-border text-lg text-fg hover:bg-bg disabled:cursor-not-allowed disabled:opacity-40"
              >
                +
              </button>
            </div>
          </div>

          {/* Toggle: também trocar o dia da semana e o horário */}
          <div>
            <label className="mb-1 block text-sm font-medium text-fg">
              Deseja mudar o dia da semana e horário?
            </label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setMudarDiaHorario(false)}
                className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${
                  !mudarDiaHorario
                    ? "border-gold bg-gold/10 text-gold"
                    : "border-border text-fg hover:bg-bg"
                }`}
              >
                Não
              </button>
              <button
                type="button"
                onClick={() => setMudarDiaHorario(true)}
                className={`rounded-lg border px-3 py-1.5 text-sm font-medium ${
                  mudarDiaHorario
                    ? "border-gold bg-gold/10 text-gold"
                    : "border-border text-fg hover:bg-bg"
                }`}
              >
                Sim
              </button>
            </div>
          </div>

          {mudarDiaHorario && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-fg">
                  Novo dia
                </label>
                <select
                  value={novoDia}
                  onChange={(e) => setNovoDia(e.target.value)}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                >
                  {DIAS_SEMANA.map((dia) => (
                    <option key={dia} value={dia}>
                      {diaSemanaLabel(dia)}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-fg">
                  Novo horário (HH:MM)
                </label>
                <input
                  type="text"
                  required
                  placeholder="14:00"
                  pattern="^([01]\d|2[0-3]):[0-5]\d$"
                  value={novoHorario}
                  onChange={(e) => setNovoHorario(mascararHorario(e.target.value))}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                />
              </div>
            </div>
          )}

          {erro && (
            <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red">
              {erro}
            </p>
          )}

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onFechar}
              disabled={salvando}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-fg hover:bg-bg disabled:cursor-not-allowed disabled:opacity-60"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={salvando}
              className="rounded-lg bg-green px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {salvando ? "Confirmando..." : "Confirmar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
