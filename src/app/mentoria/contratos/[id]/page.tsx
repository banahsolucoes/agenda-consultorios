"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { statusLabel } from "@/lib/labels";
import DatePickerSP from "../../../painel/DatePickerSP";

interface Parcela {
  id: string;
  numero: number;
  valorBruto: string;
  valorLiquido: string | null;
  vencimento: string;
  dataPagamento: string | null;
  estornoEm: string | null;
}

interface Contrato {
  id: string;
  pacote: string;
  valorTotal: string;
  taxaImpostoPct: string;
  assinaturaContrato: string;
  totalParcelas: number;
  status: "ATIVO" | "CONCLUIDO" | "CANCELADO";
  aluno: { id: string; nomeCompleto: string };
  parcelas: Parcela[];
}

interface ParcelaForm {
  id?: string;
  valorBruto: string;
  valorLiquido: string;
  vencimento: string;
  aberta: boolean;
  numeroOriginal?: number;
}

function estaAberta(p: Parcela): boolean {
  return p.dataPagamento === null && p.estornoEm === null;
}

function statusParcelaLabel(p: Parcela): string {
  if (p.estornoEm !== null) return "Estornada";
  if (p.dataPagamento !== null) return "Paga";
  return "Aberta";
}

function corStatusParcela(p: Parcela): string {
  if (p.estornoEm !== null) return "bg-muted/10 text-muted";
  if (p.dataPagamento !== null) return "bg-green/10 text-green";
  return "bg-blue/10 text-blue";
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

export default function DetalheContratoMentoriaPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const contratoId = params.id;

  const [contrato, setContrato] = useState<Contrato | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erroCarregar, setErroCarregar] = useState("");

  const [pacote, setPacote] = useState("");
  const [valorTotal, setValorTotal] = useState("");
  const [taxaImpostoPctPercent, setTaxaImpostoPctPercent] = useState("");
  const [assinaturaContrato, setAssinaturaContrato] = useState("");
  const [parcelas, setParcelas] = useState<ParcelaForm[]>([]);
  const [parcelasOriginais, setParcelasOriginais] = useState<Map<string, Parcela>>(new Map());

  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  const [modalExcluir, setModalExcluir] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const [erroExcluir, setErroExcluir] = useState("");

  async function carregarContrato() {
    setCarregando(true);
    try {
      const res = await fetch(`/api/mentoria/contratos/${contratoId}`);
      if (!res.ok) {
        setErroCarregar(res.status === 404 ? "contrato não encontrado" : "não foi possível carregar o contrato");
        return;
      }
      const dados: Contrato = await res.json();
      setContrato(dados);
      setPacote(dados.pacote);
      setValorTotal(dados.valorTotal);
      setTaxaImpostoPctPercent(String(Number(dados.taxaImpostoPct) * 100));
      setAssinaturaContrato(dados.assinaturaContrato.slice(0, 10));
      setParcelas(
        dados.parcelas.map((p) => ({
          id: p.id,
          valorBruto: p.valorBruto,
          valorLiquido: p.valorLiquido ?? "",
          vencimento: p.vencimento.slice(0, 10),
          aberta: estaAberta(p),
          numeroOriginal: p.numero,
        }))
      );
      setParcelasOriginais(new Map(dados.parcelas.map((p) => [p.id, p])));
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    if (contratoId) carregarContrato();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contratoId]);

  function alterarParcela(index: number, campo: "valorBruto" | "valorLiquido" | "vencimento", valor: string) {
    setParcelas((atual) => atual.map((p, i) => (i === index ? { ...p, [campo]: valor } : p)));
  }

  function removerParcela(index: number) {
    setParcelas((atual) => atual.filter((_, i) => i !== index));
  }

  function adicionarParcela() {
    setParcelas((atual) => [...atual, { valorBruto: "", valorLiquido: "", vencimento: "", aberta: true }]);
  }

  const somaLiquido = parcelas.reduce((soma, p) => soma + (Number(p.valorLiquido) || 0), 0);
  const diferenca = Math.round((somaLiquido - (Number(valorTotal) || 0)) * 100) / 100;
  const somaBate = Math.abs(diferenca) <= 0.01;

  const editavel = contrato?.status === "ATIVO";

  async function handleSalvar() {
    setErro("");

    if (!pacote.trim()) {
      setErro("informe o pacote");
      return;
    }
    if (!valorTotal || Number(valorTotal) <= 0) {
      setErro("valorTotal deve ser maior que zero");
      return;
    }
    if (!assinaturaContrato) {
      setErro("informe a data de assinatura");
      return;
    }
    if (parcelas.length === 0) {
      setErro("é necessário ao menos uma parcela");
      return;
    }
    for (const p of parcelas) {
      if (!p.valorBruto || Number(p.valorBruto) <= 0 || !p.valorLiquido || Number(p.valorLiquido) <= 0 || !p.vencimento) {
        setErro("toda parcela precisa de valorBruto, valorLiquido (maiores que zero) e vencimento preenchidos");
        return;
      }
    }
    if (!somaBate) {
      setErro(`a soma dos valores líquidos (${somaLiquido.toFixed(2)}) não bate com o valor total (${Number(valorTotal).toFixed(2)})`);
      return;
    }

    setSalvando(true);
    try {
      const resHeader = await fetch(`/api/mentoria/contratos/${contratoId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pacote: pacote.trim(),
          valorTotal: Number(valorTotal),
          taxaImpostoPct: Number(taxaImpostoPctPercent) / 100,
          assinaturaContrato,
        }),
      });
      const dataHeader = await resHeader.json().catch(() => null);
      if (!resHeader.ok) {
        setErro(dataHeader?.erro ?? "não foi possível salvar o cabeçalho do contrato");
        return;
      }

      const resParcelas = await fetch(`/api/mentoria/contratos/${contratoId}/parcelas`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parcelas: parcelas.map((p, i) => ({
            id: p.id,
            numero: i + 1,
            valorBruto: Number(p.valorBruto),
            valorLiquido: Number(p.valorLiquido),
            vencimento: p.vencimento,
          })),
        }),
      });
      const dataParcelas = await resParcelas.json().catch(() => null);
      if (!resParcelas.ok) {
        setErro(dataParcelas?.erro ?? "não foi possível salvar as parcelas");
        return;
      }

      await carregarContrato();
    } catch {
      setErro("não foi possível salvar as alterações");
    } finally {
      setSalvando(false);
    }
  }

  async function handleExcluir() {
    setErroExcluir("");
    setExcluindo(true);
    try {
      const res = await fetch(`/api/mentoria/contratos/${contratoId}`, { method: "DELETE" });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setErroExcluir(data?.erro ?? "não foi possível excluir o contrato");
        return;
      }
      router.push(`/mentoria/alunos/${contrato?.aluno.id}`);
    } catch {
      setErroExcluir("não foi possível excluir o contrato");
    } finally {
      setExcluindo(false);
    }
  }

  if (carregando) {
    return <div className="flex min-h-screen items-center justify-center bg-bg text-sm text-muted">Carregando...</div>;
  }

  if (erroCarregar || !contrato) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-bg text-sm text-muted">
        <p>{erroCarregar || "contrato não encontrado"}</p>
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
            <button
              onClick={() => router.push(`/mentoria/alunos/${contrato.aluno.id}`)}
              className="text-sm text-muted hover:text-fg"
            >
              ← {contrato.aluno.nomeCompleto}
            </button>
            <h1 className="font-serif text-lg font-semibold text-fg">{contrato.pacote}</h1>
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${corStatusContrato(contrato.status)}`}>
              {statusLabel(contrato.status)}
            </span>
          </div>
          <button
            onClick={() => {
              setErroExcluir("");
              setModalExcluir(true);
            }}
            className="rounded-lg border border-red px-4 py-2 text-sm font-medium text-red hover:bg-red/10"
          >
            Excluir contrato
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-3xl space-y-6 px-6 py-8">
        {!editavel && (
          <p className="rounded-lg bg-bg px-3 py-2 text-sm text-muted">
            Este contrato não está ativo — cabeçalho e parcelas não podem ser editados.
          </p>
        )}

        <div className="space-y-4 rounded-xl border border-border bg-surface p-6">
          <h2 className="font-serif text-base font-semibold text-fg">Dados do contrato</h2>

          <div>
            <label className="mb-1 block text-sm font-medium text-fg">Pacote</label>
            <input
              type="text"
              value={pacote}
              disabled={!editavel}
              onChange={(e) => setPacote(e.target.value)}
              className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20 disabled:cursor-not-allowed disabled:opacity-60"
            />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-fg">Valor total (R$)</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={valorTotal}
                disabled={!editavel}
                onChange={(e) => setValorTotal(e.target.value)}
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20 disabled:cursor-not-allowed disabled:opacity-60"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-fg">Taxa de imposto (%)</label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={taxaImpostoPctPercent}
                disabled={!editavel}
                onChange={(e) => setTaxaImpostoPctPercent(e.target.value)}
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20 disabled:cursor-not-allowed disabled:opacity-60"
              />
            </div>
            <div>
              <label className="mb-1 block whitespace-nowrap text-sm font-medium text-fg">Assinatura do contrato</label>
              {editavel ? (
                <DatePickerSP value={assinaturaContrato} onChange={setAssinaturaContrato} />
              ) : (
                <input
                  type="text"
                  disabled
                  value={assinaturaContrato}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg opacity-60"
                />
              )}
            </div>
          </div>
        </div>

        <div className="space-y-3 rounded-xl border border-border bg-surface p-6">
          <div className="flex items-center justify-between">
            <h2 className="font-serif text-base font-semibold text-fg">Parcelas</h2>
            {editavel && (
              <button type="button" onClick={adicionarParcela} className="text-sm font-medium text-gold hover:underline">
                + Adicionar parcela
              </button>
            )}
          </div>

          <div className="overflow-x-auto rounded-lg border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wide text-muted">
                  <th className="px-3 py-2">Nº</th>
                  <th className="px-3 py-2">Valor bruto (R$)</th>
                  <th className="px-3 py-2">Valor líquido (R$)</th>
                  <th className="px-3 py-2">Vencimento</th>
                  <th className="px-3 py-2">Status</th>
                  {editavel && <th className="px-3 py-2"></th>}
                </tr>
              </thead>
              <tbody>
                {parcelas.map((p, i) => {
                  const original = p.id ? parcelasOriginais.get(p.id) : undefined;
                  const podeEditarLinha = editavel && p.aberta;
                  return (
                    <tr key={p.id ?? `nova-${i}`} className="border-b border-border last:border-0">
                      <td className="px-3 py-2 text-fg">{i + 1}</td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={p.valorBruto}
                          disabled={!podeEditarLinha}
                          onChange={(e) => alterarParcela(i, "valorBruto", e.target.value)}
                          className="w-28 rounded-lg border border-border bg-bg px-2 py-1 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20 disabled:cursor-not-allowed disabled:opacity-60"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          min={0}
                          step="0.01"
                          value={p.valorLiquido}
                          disabled={!podeEditarLinha}
                          onChange={(e) => alterarParcela(i, "valorLiquido", e.target.value)}
                          className="w-28 rounded-lg border border-border bg-bg px-2 py-1 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20 disabled:cursor-not-allowed disabled:opacity-60"
                        />
                      </td>
                      <td className="px-3 py-2">
                        {podeEditarLinha ? (
                          <DatePickerSP value={p.vencimento} onChange={(v) => alterarParcela(i, "vencimento", v)} />
                        ) : (
                          <span className="text-fg">{p.vencimento}</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {original ? (
                          <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${corStatusParcela(original)}`}>
                            {statusParcelaLabel(original)}
                          </span>
                        ) : (
                          <span className="rounded-full bg-blue/10 px-2 py-0.5 text-xs font-medium text-blue">Nova</span>
                        )}
                      </td>
                      {editavel && (
                        <td className="px-3 py-2">
                          {p.aberta && (
                            <button type="button" onClick={() => removerParcela(i)} className="text-xs text-red hover:underline">
                              Remover
                            </button>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td className="px-3 py-2 text-xs font-medium text-muted">Soma líquido</td>
                  <td colSpan={editavel ? 5 : 4} className="px-3 py-2">
                    <span className={`text-sm font-medium ${somaBate ? "text-green" : "text-red"}`}>
                      {somaLiquido.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                      {!somaBate &&
                        ` — diferença de ${diferenca.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} em relação ao valor total`}
                    </span>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {erro && <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red">{erro}</p>}

        {editavel && (
          <div className="flex justify-end">
            <button
              onClick={handleSalvar}
              disabled={salvando || !somaBate}
              className="rounded-lg bg-gold px-4 py-2 text-sm font-medium text-bg hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {salvando ? "Salvando..." : "Salvar alterações"}
            </button>
          </div>
        )}
      </div>

      {modalExcluir && (
        <div className="fixed inset-x-0 bottom-0 top-16 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-lg">
            <h2 className="mb-4 font-serif text-lg font-semibold text-fg">Excluir contrato</h2>
            <p className="text-sm text-fg">
              Tem certeza que deseja excluir o contrato &quot;{contrato.pacote}&quot; e todas as suas parcelas? Esta ação não pode
              ser desfeita.
            </p>

            {erroExcluir && <p className="mt-3 rounded-lg bg-red/10 px-3 py-2 text-sm text-red">{erroExcluir}</p>}

            <div className="mt-4 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setModalExcluir(false)}
                disabled={excluindo}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-fg hover:bg-bg disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleExcluir}
                disabled={excluindo}
                className="rounded-lg bg-red px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {excluindo ? "Excluindo..." : "Excluir"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
