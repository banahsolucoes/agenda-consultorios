"use client";

import { useEffect, useState } from "react";
import { useRouter, useParams } from "next/navigation";
import { statusLabel } from "@/lib/labels";
import { TIMEZONE } from "@/lib/timezone";
import { formatarMoedaBR } from "@/lib/mentoria/format";

const NOMES_MES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

function labelMes(mesReferencia: string): string {
  const ano = Number(mesReferencia.slice(0, 4));
  const mes = Number(mesReferencia.slice(4, 6));
  return `${NOMES_MES[mes - 1]} de ${ano}`;
}

function formaRecebimentoLabel(f: string): string {
  return f === "ADIANTADO" ? "Adiantado" : "Por parcela";
}

function formatarMoeda(valor: number): string {
  return formatarMoedaBR(valor);
}

function formatarDataCurta(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: TIMEZONE });
}

interface LinhaAdiantado {
  contratoId: string;
  alunoNome: string;
  valorContrato: number;
  baseComissionavel: number;
  percentual: number;
  valorComissao: number;
  dataReferencia: string;
  status: "PENDENTE" | "PAGO";
}

interface LinhaAReceber {
  contratoId: string;
  alunoNome: string;
  parcelaNumero: number;
  registro: string;
  valorLiquidoParcela: number;
  percentual: number;
  comissaoParcela: number;
  dataPagamentoParcela: string;
}

interface LinhaPrevisto {
  contratoId: string;
  alunoNome: string;
  parcelaNumero: number;
  registro: string;
  valorLiquidoPrevisto: number;
  percentual: number;
  comissaoPrevista: number;
  vencimento: string;
}

interface Extrato {
  comissionado: {
    id: string;
    nome: string;
    percentualComissao: string | null;
    formaRecebimento: string;
  };
  linhasAdiantado: LinhaAdiantado[];
  porParcela: { aReceber: LinhaAReceber[]; previsto: LinhaPrevisto[] };
  totalAReceber: number;
  totalPrevisto: number;
  resumoMensal: { mesReferencia: string; totalDoMes: number }[];
}

export default function ExtratoComissionadoPage() {
  const router = useRouter();
  const params = useParams();
  const comissionadoId = params.id as string;

  const [extrato, setExtrato] = useState<Extrato | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");

  useEffect(() => {
    setCarregando(true);
    setErro("");
    fetch(`/api/mentoria/comissionados/${comissionadoId}/extrato`)
      .then(async (r) => {
        if (!r.ok) {
          const data = await r.json().catch(() => null);
          throw new Error(data?.erro ?? "não foi possível carregar o extrato");
        }
        return r.json();
      })
      .then(setExtrato)
      .catch((e) => setErro(e.message))
      .finally(() => setCarregando(false));
  }, [comissionadoId]);

  async function handleSair() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <button onClick={() => router.push("/mentoria/comissionados")} className="text-sm text-muted hover:text-fg">
              ← Comissionados
            </button>
            <h1 className="font-serif text-lg font-semibold text-fg">Extrato do comissionado</h1>
          </div>
          <button
            onClick={handleSair}
            className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-fg hover:bg-bg"
          >
            Sair
          </button>
        </div>
      </header>

      <div className="mx-auto max-w-5xl space-y-6 px-6 py-8">
        {carregando ? (
          <p className="text-sm text-muted">Carregando...</p>
        ) : erro ? (
          <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red">{erro}</p>
        ) : !extrato ? (
          <p className="text-sm text-muted">Não foi possível carregar o extrato.</p>
        ) : (
          <>
            {/* Cabeçalho */}
            <div className="rounded-xl border border-border bg-surface p-6">
              <h2 className="font-serif text-lg font-semibold text-fg">{extrato.comissionado.nome}</h2>
              <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted">Percentual fixo</p>
                  <p className="mt-1 text-lg font-semibold text-fg">
                    {extrato.comissionado.percentualComissao !== null
                      ? `${(Number(extrato.comissionado.percentualComissao) * 100).toLocaleString("pt-BR")}%`
                      : "não definido"}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted">Forma de recebimento</p>
                  <p className="mt-1 text-lg font-semibold text-fg">
                    {formaRecebimentoLabel(extrato.comissionado.formaRecebimento)}
                  </p>
                </div>
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-muted">Total a receber (devido)</p>
                  <p className="mt-1 text-lg font-semibold text-fg">{formatarMoeda(extrato.totalAReceber)}</p>
                </div>
              </div>
            </div>

            {/* Resumo por mês */}
            <div className="space-y-3 rounded-xl border border-border bg-surface p-6">
              <h2 className="font-serif text-base font-semibold text-fg">Resumo por mês</h2>
              {extrato.resumoMensal.length === 0 ? (
                <p className="text-sm text-muted">Nenhum valor devido em nenhum mês.</p>
              ) : (
                <div className="flex flex-wrap gap-3">
                  {extrato.resumoMensal.map((m) => (
                    <div key={m.mesReferencia} className="rounded-lg border border-border bg-bg px-4 py-2">
                      <p className="text-xs text-muted">{labelMes(m.mesReferencia)}</p>
                      <p className="text-sm font-semibold text-fg">{formatarMoeda(m.totalDoMes)}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ADIANTADO */}
            {extrato.comissionado.formaRecebimento === "ADIANTADO" && (
              <div className="space-y-3 rounded-xl border border-border bg-surface p-6">
                <h2 className="font-serif text-base font-semibold text-fg">Comissões por contrato</h2>
                {extrato.linhasAdiantado.length === 0 ? (
                  <p className="text-sm text-muted">Nenhuma comissão vinculada.</p>
                ) : (
                  <div className="overflow-x-auto rounded-lg border border-border">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wide text-muted">
                          <th className="px-3 py-2">Aluno</th>
                          <th className="px-3 py-2">Valor do contrato</th>
                          <th className="px-3 py-2">%</th>
                          <th className="px-3 py-2">Valor comissão</th>
                          <th className="px-3 py-2">Data referência</th>
                          <th className="px-3 py-2">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {extrato.linhasAdiantado.map((l, i) => (
                          <tr
                            key={i}
                            onClick={() => router.push(`/mentoria/contratos/${l.contratoId}`)}
                            className="cursor-pointer border-b border-border last:border-0 hover:bg-bg"
                          >
                            <td className="px-3 py-2 font-medium text-fg">{l.alunoNome}</td>
                            <td className="px-3 py-2 text-fg">{formatarMoeda(l.valorContrato)}</td>
                            <td className="px-3 py-2 text-fg">{(l.percentual * 100).toLocaleString("pt-BR")}%</td>
                            <td className="px-3 py-2 text-fg">{formatarMoeda(l.valorComissao)}</td>
                            <td className="px-3 py-2 text-fg">{formatarDataCurta(l.dataReferencia)}</td>
                            <td className="px-3 py-2">
                              <span
                                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                                  l.status === "PAGO" ? "bg-green/10 text-green" : "bg-blue/10 text-blue"
                                }`}
                              >
                                {statusLabel(l.status)}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}

            {/* POR_PARCELA */}
            {extrato.comissionado.formaRecebimento === "POR_PARCELA" && (
              <>
                <div className="space-y-3 rounded-xl border border-border bg-surface p-6">
                  <h2 className="font-serif text-base font-semibold text-fg">A receber (parcelas pagas)</h2>
                  {extrato.porParcela.aReceber.length === 0 ? (
                    <p className="text-sm text-muted">Nenhuma parcela paga ainda.</p>
                  ) : (
                    <div className="overflow-x-auto rounded-lg border border-border">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wide text-muted">
                            <th className="px-3 py-2">Aluno</th>
                            <th className="px-3 py-2">Parcela</th>
                            <th className="px-3 py-2">Valor líquido</th>
                            <th className="px-3 py-2">%</th>
                            <th className="px-3 py-2">Comissão</th>
                            <th className="px-3 py-2">Data pagamento</th>
                          </tr>
                        </thead>
                        <tbody>
                          {extrato.porParcela.aReceber.map((l, i) => (
                            <tr
                              key={i}
                              onClick={() => router.push(`/mentoria/contratos/${l.contratoId}`)}
                              className="cursor-pointer border-b border-border last:border-0 hover:bg-bg"
                            >
                              <td className="px-3 py-2 font-medium text-fg">{l.alunoNome}</td>
                              <td className="px-3 py-2 text-fg">{l.registro}</td>
                              <td className="px-3 py-2 text-fg">{formatarMoeda(l.valorLiquidoParcela)}</td>
                              <td className="px-3 py-2 text-fg">{(l.percentual * 100).toLocaleString("pt-BR")}%</td>
                              <td className="px-3 py-2 text-fg">{formatarMoeda(l.comissaoParcela)}</td>
                              <td className="px-3 py-2 text-fg">{formatarDataCurta(l.dataPagamentoParcela)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <div className="space-y-3 rounded-xl border border-dashed border-border bg-surface p-6 opacity-70">
                  <div className="flex items-center justify-between">
                    <h2 className="font-serif text-base font-semibold text-fg">Previsto (parcelas futuras)</h2>
                    <span className="rounded-full bg-muted/10 px-2 py-0.5 text-xs font-medium text-muted">
                      não entra no total devido
                    </span>
                  </div>
                  {extrato.porParcela.previsto.length === 0 ? (
                    <p className="text-sm text-muted">Nenhuma parcela em aberto.</p>
                  ) : (
                    <div className="overflow-x-auto rounded-lg border border-border">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wide text-muted">
                            <th className="px-3 py-2">Aluno</th>
                            <th className="px-3 py-2">Parcela</th>
                            <th className="px-3 py-2">Valor líquido previsto</th>
                            <th className="px-3 py-2">%</th>
                            <th className="px-3 py-2">Comissão prevista</th>
                            <th className="px-3 py-2">Vencimento</th>
                          </tr>
                        </thead>
                        <tbody>
                          {extrato.porParcela.previsto.map((l, i) => (
                            <tr
                              key={i}
                              onClick={() => router.push(`/mentoria/contratos/${l.contratoId}`)}
                              className="cursor-pointer border-b border-border text-muted last:border-0 hover:bg-bg"
                            >
                              <td className="px-3 py-2 font-medium">{l.alunoNome}</td>
                              <td className="px-3 py-2">{l.registro}</td>
                              <td className="px-3 py-2">{formatarMoeda(l.valorLiquidoPrevisto)}</td>
                              <td className="px-3 py-2">{(l.percentual * 100).toLocaleString("pt-BR")}%</td>
                              <td className="px-3 py-2">{formatarMoeda(l.comissaoPrevista)}</td>
                              <td className="px-3 py-2">{formatarDataCurta(l.vencimento)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <p className="text-xs text-muted">Total previsto (fora do total devido): {formatarMoeda(extrato.totalPrevisto)}</p>
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
