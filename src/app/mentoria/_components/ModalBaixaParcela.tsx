"use client";

import { useEffect, useState } from "react";
import { formaPagamentoLabel } from "@/lib/labels";
import DatePickerSP from "../../painel/DatePickerSP";
import InputMoedaBR from "./InputMoedaBR";

const FORMAS_PAGAMENTO = ["PIX", "CARTAO", "BOLETO", "DINHEIRO", "TRANSFERENCIA"] as const;

interface ParcelaBaixavel {
  id: string;
  numero: number;
  valorLiquido: string | number | null;
}

// Modal de "Dar baixa" reutilizável — mesmo comportamento usado na tela de
// contrato (fluxo original) e no dashboard (baixa direto na lista "Parcelas
// do mês", sem navegar). POST /api/mentoria/parcelas/[id]/baixa; backend
// inalterado.
export default function ModalBaixaParcela({
  parcela,
  onClose,
  onSucesso,
}: {
  parcela: ParcelaBaixavel | null;
  onClose: () => void;
  onSucesso: () => void | Promise<void>;
}) {
  const [dataPagamento, setDataPagamento] = useState("");
  const [valorLiquido, setValorLiquido] = useState("");
  const [formaPagamento, setFormaPagamento] = useState("");
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);

  useEffect(() => {
    if (!parcela) return;
    setDataPagamento(new Date().toISOString().slice(0, 10));
    setValorLiquido(parcela.valorLiquido !== null ? String(parcela.valorLiquido) : "");
    setFormaPagamento("");
    setErro("");
  }, [parcela]);

  if (!parcela) return null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!dataPagamento) {
      setErro("informe a data de pagamento");
      return;
    }
    if (!valorLiquido || Number(valorLiquido) <= 0) {
      setErro("valorLiquido deve ser maior que zero");
      return;
    }
    if (!formaPagamento) {
      setErro("selecione a forma de pagamento");
      return;
    }

    setErro("");
    setSalvando(true);
    try {
      const res = await fetch(`/api/mentoria/parcelas/${parcela!.id}/baixa`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dataPagamento,
          valorLiquido: Number(valorLiquido),
          formaPagamento,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setErro(data?.erro ?? "não foi possível registrar o pagamento");
        return;
      }
      await onSucesso();
      onClose();
    } catch {
      setErro("não foi possível registrar o pagamento");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <div className="fixed inset-x-0 bottom-0 top-16 z-50 flex items-center justify-center bg-black/60 px-4">
      <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-lg">
        <h2 className="mb-4 font-serif text-lg font-semibold text-fg">Dar baixa — parcela {parcela.numero}</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-fg">Data de pagamento</label>
            <DatePickerSP value={dataPagamento} onChange={setDataPagamento} />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-fg">Valor líquido</label>
            <InputMoedaBR
              value={Number(valorLiquido) || 0}
              onChange={(v) => setValorLiquido(String(v))}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-fg">Forma de pagamento</label>
            <select
              value={formaPagamento}
              onChange={(e) => setFormaPagamento(e.target.value)}
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
            >
              <option value="">Selecione...</option>
              {FORMAS_PAGAMENTO.map((f) => (
                <option key={f} value={f}>
                  {formaPagamentoLabel(f)}
                </option>
              ))}
            </select>
          </div>

          {erro && <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red">{erro}</p>}

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={salvando}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-fg hover:bg-bg disabled:cursor-not-allowed disabled:opacity-60"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={salvando}
              className="rounded-lg bg-gold px-4 py-2 text-sm font-medium text-bg hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {salvando ? "Salvando..." : "Confirmar baixa"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
