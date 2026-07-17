"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { statusLabel, formaPagamentoLabel } from "@/lib/labels";
import { TIMEZONE } from "@/lib/timezone";
import DatePickerSP from "../../../painel/DatePickerSP";

const FORMAS_PAGAMENTO = ["PIX", "CARTAO", "BOLETO", "DINHEIRO", "TRANSFERENCIA"] as const;
const PAPEIS_COMISSAO = ["SELLER", "CLOSER", "PRODUTOR"] as const;

interface Comissionado {
  id: string;
  nome: string;
}

interface Comissao {
  id: string;
  comissionadoId: string;
  comissionado: { id: string; nome: string };
  papel: string;
  percentual: string;
  status: "PENDENTE" | "PAGO" | "ESTORNADO";
  valorComissao: number;
}

interface ComissoesData {
  comissoes: Comissao[];
  baseComissionavel: number;
  somaComissoes: number;
  liquidoPamela: number;
}

interface Parcela {
  id: string;
  numero: number;
  valorBruto: string;
  valorLiquido: string | null;
  vencimento: string;
  dataPagamento: string | null;
  formaPagamento: string | null;
  estornoEm: string | null;
  valorEstornado: string | null;
}

function formatarDataCurta(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: TIMEZONE });
}

interface Contrato {
  id: string;
  pacote: string;
  valorTotal: string;
  taxaImpostoPct: string;
  assinaturaContrato: string;
  totalParcelas: number;
  status: "ATIVO" | "CONCLUIDO" | "CANCELADO";
  canceladoEm: string | null;
  motivoCancelamento: string | null;
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

// Status derivado — nunca persistido. ESTORNADA > PAGA > CANCELADA (contrato
// cancelado) > ABERTA, nessa ordem de prioridade.
function statusParcelaLabel(p: Parcela, statusContrato: string): string {
  if (p.estornoEm !== null) return "Estornada";
  if (p.dataPagamento !== null) return "Paga";
  if (statusContrato === "CANCELADO") return "Cancelada";
  return "Aberta";
}

function corStatusParcela(p: Parcela, statusContrato: string): string {
  if (p.estornoEm !== null) return "bg-muted/10 text-muted";
  if (p.dataPagamento !== null) return "bg-green/10 text-green";
  if (statusContrato === "CANCELADO") return "bg-muted/10 text-muted";
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

  const [parcelaBaixa, setParcelaBaixa] = useState<Parcela | null>(null);
  const [formBaixa, setFormBaixa] = useState({ dataPagamento: "", valorLiquido: "", formaPagamento: "" });
  const [salvandoBaixa, setSalvandoBaixa] = useState(false);
  const [erroBaixa, setErroBaixa] = useState("");

  const [parcelaEstorno, setParcelaEstorno] = useState<Parcela | null>(null);
  const [valorEstornoParcial, setValorEstornoParcial] = useState("");
  const [salvandoEstorno, setSalvandoEstorno] = useState(false);
  const [erroEstorno, setErroEstorno] = useState("");

  const [comissoesData, setComissoesData] = useState<ComissoesData | null>(null);
  const [carregandoComissoes, setCarregandoComissoes] = useState(true);
  const [comissionadosDisponiveis, setComissionadosDisponiveis] = useState<Comissionado[]>([]);

  const [modalComissao, setModalComissao] = useState(false);
  const [formComissao, setFormComissao] = useState({ comissionadoId: "", papel: "", percentual: "" });
  const [salvandoComissao, setSalvandoComissao] = useState(false);
  const [erroComissao, setErroComissao] = useState("");

  const [modalDistrato, setModalDistrato] = useState(false);
  const [formDistrato, setFormDistrato] = useState({ motivoCancelamento: "", estornarParcelasPagas: true });
  const [salvandoDistrato, setSalvandoDistrato] = useState(false);
  const [erroDistrato, setErroDistrato] = useState("");

  async function carregarComissoes() {
    setCarregandoComissoes(true);
    try {
      const res = await fetch(`/api/mentoria/contratos/${contratoId}/comissoes`);
      if (res.ok) setComissoesData(await res.json());
    } finally {
      setCarregandoComissoes(false);
    }
  }

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
    if (contratoId) {
      carregarContrato();
      carregarComissoes();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contratoId]);

  useEffect(() => {
    fetch("/api/mentoria/comissionados")
      .then((r) => (r.ok ? r.json() : []))
      .then((lista: Comissionado[]) => setComissionadosDisponiveis(lista))
      .catch(() => {});
  }, []);

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

  function abrirBaixa(p: Parcela) {
    const hoje = new Date().toISOString().slice(0, 10);
    setFormBaixa({
      dataPagamento: hoje,
      valorLiquido: p.valorLiquido ?? "",
      formaPagamento: "",
    });
    setErroBaixa("");
    setParcelaBaixa(p);
  }

  async function handleConfirmarBaixa(e: React.FormEvent) {
    e.preventDefault();
    if (!parcelaBaixa) return;
    if (!formBaixa.dataPagamento) {
      setErroBaixa("informe a data de pagamento");
      return;
    }
    if (!formBaixa.valorLiquido || Number(formBaixa.valorLiquido) <= 0) {
      setErroBaixa("valorLiquido deve ser maior que zero");
      return;
    }
    if (!formBaixa.formaPagamento) {
      setErroBaixa("selecione a forma de pagamento");
      return;
    }

    setErroBaixa("");
    setSalvandoBaixa(true);
    try {
      const res = await fetch(`/api/mentoria/parcelas/${parcelaBaixa.id}/baixa`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dataPagamento: formBaixa.dataPagamento,
          valorLiquido: Number(formBaixa.valorLiquido),
          formaPagamento: formBaixa.formaPagamento,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setErroBaixa(data?.erro ?? "não foi possível registrar o pagamento");
        return;
      }
      setParcelaBaixa(null);
      await carregarContrato();
    } catch {
      setErroBaixa("não foi possível registrar o pagamento");
    } finally {
      setSalvandoBaixa(false);
    }
  }

  function abrirEstorno(p: Parcela) {
    setValorEstornoParcial("");
    setErroEstorno("");
    setParcelaEstorno(p);
  }

  async function handleConfirmarEstorno() {
    if (!parcelaEstorno) return;
    if (valorEstornoParcial && Number(valorEstornoParcial) <= 0) {
      setErroEstorno("valor do estorno deve ser maior que zero");
      return;
    }

    setErroEstorno("");
    setSalvandoEstorno(true);
    try {
      const res = await fetch(`/api/mentoria/parcelas/${parcelaEstorno.id}/estorno`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(valorEstornoParcial ? { valorEstornado: Number(valorEstornoParcial) } : {}),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setErroEstorno(data?.erro ?? "não foi possível estornar a parcela");
        return;
      }
      setParcelaEstorno(null);
      await carregarContrato();
    } catch {
      setErroEstorno("não foi possível estornar a parcela");
    } finally {
      setSalvandoEstorno(false);
    }
  }

  function abrirModalComissao() {
    setFormComissao({ comissionadoId: "", papel: "", percentual: "" });
    setErroComissao("");
    setModalComissao(true);
  }

  async function handleAdicionarComissao(e: React.FormEvent) {
    e.preventDefault();
    if (!formComissao.comissionadoId) {
      setErroComissao("selecione o comissionado");
      return;
    }
    if (!formComissao.papel) {
      setErroComissao("selecione o papel");
      return;
    }
    const percentualFracao = Number(formComissao.percentual) / 100;
    if (!formComissao.percentual || !(percentualFracao > 0) || percentualFracao > 1) {
      setErroComissao("percentual deve ser maior que 0% e no máximo 100%");
      return;
    }

    setErroComissao("");
    setSalvandoComissao(true);
    try {
      const res = await fetch(`/api/mentoria/contratos/${contratoId}/comissoes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          comissionadoId: formComissao.comissionadoId,
          papel: formComissao.papel,
          percentual: percentualFracao,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setErroComissao(data?.erro ?? "não foi possível adicionar a comissão");
        return;
      }
      setModalComissao(false);
      await carregarComissoes();
    } catch {
      setErroComissao("não foi possível adicionar a comissão");
    } finally {
      setSalvandoComissao(false);
    }
  }

  async function handleAlterarStatusComissao(id: string, novoStatus: "PAGO" | "PENDENTE") {
    const res = await fetch(`/api/mentoria/comissoes/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: novoStatus }),
    });
    if (res.ok) await carregarComissoes();
  }

  async function handleRemoverComissao(id: string) {
    const res = await fetch(`/api/mentoria/comissoes/${id}`, { method: "DELETE" });
    if (res.ok) await carregarComissoes();
  }

  function abrirModalDistrato() {
    setFormDistrato({ motivoCancelamento: "", estornarParcelasPagas: true });
    setErroDistrato("");
    setModalDistrato(true);
  }

  async function handleConfirmarDistrato(e: React.FormEvent) {
    e.preventDefault();
    if (!formDistrato.motivoCancelamento.trim()) {
      setErroDistrato("informe o motivo do cancelamento");
      return;
    }

    setErroDistrato("");
    setSalvandoDistrato(true);
    try {
      const res = await fetch(`/api/mentoria/contratos/${contratoId}/distrato`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          motivoCancelamento: formDistrato.motivoCancelamento.trim(),
          estornarParcelasPagas: formDistrato.estornarParcelasPagas,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setErroDistrato(data?.erro ?? "não foi possível distratar o contrato");
        return;
      }
      setModalDistrato(false);
      await carregarContrato();
      await carregarComissoes();
    } catch {
      setErroDistrato("não foi possível distratar o contrato");
    } finally {
      setSalvandoDistrato(false);
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
          <div className="flex items-center gap-2">
            {editavel && (
              <button
                onClick={abrirModalDistrato}
                className="rounded-lg bg-red px-4 py-2 text-sm font-medium text-white hover:brightness-110"
              >
                Distratar contrato
              </button>
            )}
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
        </div>
      </header>

      <div className="mx-auto max-w-3xl space-y-6 px-6 py-8">
        {!editavel && (
          <p className="rounded-lg bg-bg px-3 py-2 text-sm text-muted">
            Este contrato não está ativo — cabeçalho e parcelas não podem ser editados.
          </p>
        )}

        {contrato.status === "CANCELADO" && (
          <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red">
            Contrato distratado{contrato.canceladoEm && ` em ${formatarDataCurta(contrato.canceladoEm)}`}
            {contrato.motivoCancelamento && ` — motivo: ${contrato.motivoCancelamento}`}
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
                  <th className="px-3 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {parcelas.map((p, i) => {
                  const original = p.id ? parcelasOriginais.get(p.id) : undefined;
                  const podeEditarLinha = editavel && p.aberta;
                  const podeDarBaixa = original && estaAberta(original) && contrato.status === "ATIVO";
                  const podeEstornar = original && original.dataPagamento !== null && original.estornoEm === null;
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
                          <div>
                            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${corStatusParcela(original, contrato.status)}`}>
                              {statusParcelaLabel(original, contrato.status)}
                            </span>
                            {original.dataPagamento && (
                              <p className="mt-1 text-xs text-muted">
                                {original.estornoEm ? "Pago" : "via"} {formaPagamentoLabel(original.formaPagamento ?? "")} em{" "}
                                {formatarDataCurta(original.dataPagamento)}
                              </p>
                            )}
                            {original.estornoEm && (
                              <p className="text-xs text-muted">
                                Estornado em {formatarDataCurta(original.estornoEm)}
                                {original.valorEstornado &&
                                  ` — ${Number(original.valorEstornado).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`}
                              </p>
                            )}
                          </div>
                        ) : (
                          <span className="rounded-full bg-blue/10 px-2 py-0.5 text-xs font-medium text-blue">Nova</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-2">
                          {editavel && p.aberta && (
                            <button type="button" onClick={() => removerParcela(i)} className="text-xs text-red hover:underline">
                              Remover
                            </button>
                          )}
                          {podeDarBaixa && (
                            <button
                              type="button"
                              onClick={() => abrirBaixa(original!)}
                              className="text-xs font-medium text-gold hover:underline"
                            >
                              Dar baixa
                            </button>
                          )}
                          {podeEstornar && (
                            <button
                              type="button"
                              onClick={() => abrirEstorno(original!)}
                              className="text-xs font-medium text-red hover:underline"
                            >
                              Estornar
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td className="px-3 py-2 text-xs font-medium text-muted">Soma líquido</td>
                  <td colSpan={5} className="px-3 py-2">
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

        <div className="space-y-3 rounded-xl border border-border bg-surface p-6">
          <div className="flex items-center justify-between">
            <h2 className="font-serif text-base font-semibold text-fg">Comissões</h2>
            {editavel && (
              <button type="button" onClick={abrirModalComissao} className="text-sm font-medium text-gold hover:underline">
                + Adicionar comissão
              </button>
            )}
          </div>

          {carregandoComissoes ? (
            <p className="text-sm text-muted">Carregando...</p>
          ) : !comissoesData ? (
            <p className="text-sm text-muted">Não foi possível carregar as comissões.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wide text-muted">
                    <th className="px-3 py-2">Comissionado</th>
                    <th className="px-3 py-2">Papel</th>
                    <th className="px-3 py-2">Percentual</th>
                    <th className="px-3 py-2">Valor (R$)</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {comissoesData.comissoes.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-4 text-center text-muted">
                        Nenhuma comissão vinculada.
                      </td>
                    </tr>
                  ) : (
                    comissoesData.comissoes.map((c) => (
                      <tr key={c.id} className="border-b border-border last:border-0">
                        <td className="px-3 py-2 font-medium text-fg">{c.comissionado.nome}</td>
                        <td className="px-3 py-2 text-fg">{c.papel}</td>
                        <td className="px-3 py-2 text-fg">{(Number(c.percentual) * 100).toLocaleString("pt-BR")}%</td>
                        <td className="px-3 py-2 text-fg">
                          {c.valorComissao.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                        </td>
                        <td className="px-3 py-2">
                          <span
                            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                              c.status === "PAGO"
                                ? "bg-green/10 text-green"
                                : c.status === "ESTORNADO"
                                  ? "bg-muted/10 text-muted"
                                  : "bg-blue/10 text-blue"
                            }`}
                          >
                            {statusLabel(c.status)}
                          </span>
                        </td>
                        <td className="px-3 py-2">
                          <div className="flex flex-wrap gap-2">
                            {c.status === "PENDENTE" && (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleAlterarStatusComissao(c.id, "PAGO")}
                                  className="text-xs font-medium text-gold hover:underline"
                                >
                                  Marcar pago
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handleRemoverComissao(c.id)}
                                  className="text-xs text-red hover:underline"
                                >
                                  Remover
                                </button>
                              </>
                            )}
                            {c.status === "PAGO" && (
                              <button
                                type="button"
                                onClick={() => handleAlterarStatusComissao(c.id, "PENDENTE")}
                                className="text-xs font-medium text-fg hover:underline"
                              >
                                Voltar a pendente
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={3} className="px-3 py-2 text-xs font-medium text-muted">
                      Base comissionável
                    </td>
                    <td colSpan={3} className="px-3 py-2 text-sm font-medium text-fg">
                      {comissoesData.baseComissionavel.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={3} className="px-3 py-2 text-xs font-medium text-muted">
                      Total de comissões
                    </td>
                    <td colSpan={3} className="px-3 py-2 text-sm font-medium text-fg">
                      {comissoesData.somaComissoes.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                    </td>
                  </tr>
                  <tr>
                    <td colSpan={3} className="px-3 py-2 text-xs font-medium text-muted">
                      Líquido Pâmela
                    </td>
                    <td colSpan={3} className="px-3 py-2">
                      <span className={`text-sm font-medium ${comissoesData.liquidoPamela < 0 ? "text-red" : "text-fg"}`}>
                        {comissoesData.liquidoPamela.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                        {comissoesData.liquidoPamela < 0 && " — comissões excedem a base comissionável"}
                      </span>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
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

      {parcelaBaixa && (
        <div className="fixed inset-x-0 bottom-0 top-16 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-lg">
            <h2 className="mb-4 font-serif text-lg font-semibold text-fg">Dar baixa — parcela {parcelaBaixa.numero}</h2>
            <form onSubmit={handleConfirmarBaixa} className="space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-fg">Data de pagamento</label>
                <DatePickerSP
                  value={formBaixa.dataPagamento}
                  onChange={(v) => setFormBaixa((f) => ({ ...f, dataPagamento: v }))}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-fg">Valor líquido (R$)</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={formBaixa.valorLiquido}
                  onChange={(e) => setFormBaixa((f) => ({ ...f, valorLiquido: e.target.value }))}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-fg">Forma de pagamento</label>
                <select
                  value={formBaixa.formaPagamento}
                  onChange={(e) => setFormBaixa((f) => ({ ...f, formaPagamento: e.target.value }))}
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

              {erroBaixa && <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red">{erroBaixa}</p>}

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setParcelaBaixa(null)}
                  disabled={salvandoBaixa}
                  className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-fg hover:bg-bg disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={salvandoBaixa}
                  className="rounded-lg bg-gold px-4 py-2 text-sm font-medium text-bg hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {salvandoBaixa ? "Salvando..." : "Confirmar baixa"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {parcelaEstorno && (
        <div className="fixed inset-x-0 bottom-0 top-16 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-lg">
            <h2 className="mb-4 font-serif text-lg font-semibold text-fg">Estornar — parcela {parcelaEstorno.numero}</h2>
            <p className="text-sm text-fg">
              Valor pago:{" "}
              {Number(parcelaEstorno.valorLiquido ?? 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
            </p>
            <div className="mt-4">
              <label className="mb-1 block text-sm font-medium text-fg">
                Valor a estornar (R$, opcional — em branco estorna o valor total)
              </label>
              <input
                type="number"
                min={0}
                step="0.01"
                placeholder={parcelaEstorno.valorLiquido ?? ""}
                value={valorEstornoParcial}
                onChange={(e) => setValorEstornoParcial(e.target.value)}
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
              />
            </div>

            {erroEstorno && <p className="mt-3 rounded-lg bg-red/10 px-3 py-2 text-sm text-red">{erroEstorno}</p>}

            <div className="mt-4 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setParcelaEstorno(null)}
                disabled={salvandoEstorno}
                className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-fg hover:bg-bg disabled:cursor-not-allowed disabled:opacity-60"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleConfirmarEstorno}
                disabled={salvandoEstorno}
                className="rounded-lg bg-red px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {salvandoEstorno ? "Estornando..." : "Confirmar estorno"}
              </button>
            </div>
          </div>
        </div>
      )}

      {modalComissao && (
        <div className="fixed inset-x-0 bottom-0 top-16 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-lg">
            <h2 className="mb-4 font-serif text-lg font-semibold text-fg">Adicionar comissão</h2>
            {comissionadosDisponiveis.length === 0 ? (
              <p className="text-sm text-muted">
                Nenhum comissionado cadastrado ainda.{" "}
                <button
                  type="button"
                  onClick={() => router.push("/mentoria/comissionados")}
                  className="text-gold hover:underline"
                >
                  Cadastrar um comissionado
                </button>
                .
              </p>
            ) : (
              <form onSubmit={handleAdicionarComissao} className="space-y-4">
                <div>
                  <label className="mb-1 block text-sm font-medium text-fg">Comissionado</label>
                  <select
                    value={formComissao.comissionadoId}
                    onChange={(e) => setFormComissao((f) => ({ ...f, comissionadoId: e.target.value }))}
                    className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                  >
                    <option value="">Selecione...</option>
                    {comissionadosDisponiveis.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nome}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-fg">Papel</label>
                  <select
                    value={formComissao.papel}
                    onChange={(e) => setFormComissao((f) => ({ ...f, papel: e.target.value }))}
                    className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                  >
                    <option value="">Selecione...</option>
                    {PAPEIS_COMISSAO.map((p) => (
                      <option key={p} value={p}>
                        {p}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-fg">Percentual (%)</label>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    step="0.01"
                    value={formComissao.percentual}
                    onChange={(e) => setFormComissao((f) => ({ ...f, percentual: e.target.value }))}
                    className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                  />
                </div>

                {erroComissao && <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red">{erroComissao}</p>}

                <div className="flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => setModalComissao(false)}
                    disabled={salvandoComissao}
                    className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-fg hover:bg-bg disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={salvandoComissao}
                    className="rounded-lg bg-gold px-4 py-2 text-sm font-medium text-bg hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {salvandoComissao ? "Salvando..." : "Adicionar"}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {modalDistrato && (
        <div className="fixed inset-x-0 bottom-0 top-16 z-50 flex items-center justify-center bg-black/60 px-4">
          <div className="w-full max-w-sm rounded-xl border border-border bg-surface p-6 shadow-lg">
            <h2 className="mb-4 font-serif text-lg font-semibold text-fg">Distratar contrato</h2>
            <p className="text-sm text-fg">
              Esta ação cancela o contrato e <strong>estorna automaticamente TODAS as comissões</strong> vinculadas a ele,
              inclusive as já pagas. Não pode ser desfeita.
            </p>
            <form onSubmit={handleConfirmarDistrato} className="mt-4 space-y-4">
              <div>
                <label className="mb-1 block text-sm font-medium text-fg">Motivo do cancelamento</label>
                <textarea
                  required
                  value={formDistrato.motivoCancelamento}
                  onChange={(e) => setFormDistrato((f) => ({ ...f, motivoCancelamento: e.target.value }))}
                  rows={3}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                />
              </div>
              <label className="flex items-center gap-2 text-sm text-fg">
                <input
                  type="checkbox"
                  checked={formDistrato.estornarParcelasPagas}
                  onChange={(e) => setFormDistrato((f) => ({ ...f, estornarParcelasPagas: e.target.checked }))}
                />
                Estornar parcelas já pagas
              </label>

              {erroDistrato && <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red">{erroDistrato}</p>}

              <div className="flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setModalDistrato(false)}
                  disabled={salvandoDistrato}
                  className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-fg hover:bg-bg disabled:cursor-not-allowed disabled:opacity-60"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={salvandoDistrato || !formDistrato.motivoCancelamento.trim()}
                  className="rounded-lg bg-red px-4 py-2 text-sm font-medium text-white hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {salvandoDistrato ? "Distratando..." : "Confirmar distrato"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
