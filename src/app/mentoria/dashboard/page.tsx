"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { TIMEZONE } from "@/lib/timezone";
import { formatarMoedaBR } from "@/lib/mentoria/format";
import ModalBaixaParcela from "../_components/ModalBaixaParcela";
import ContextoSwitcher from "../../_components/ContextoSwitcher";

const NOMES_MES = [
  "Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho",
  "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro",
];

interface Resumo {
  recebidoLiquidoNoMes: number;
  aReceberNoMes: number;
  inadimplenteNoMes: number;
  totalComissoesAPagar: number;
  impostoNoMes: number;
  liquidoPamelaNoMes: number;
  comissaoLiberadaNoMes: number;
  comissaoPendenteNoMes: number;
  inadimplenciaAtual: number;
}

interface ComissaoDaParcela {
  comissionadoId: string;
  comissionadoNome: string;
  percentual: number;
  valor: number;
  devida: boolean;
}

interface ParcelaDoMes {
  parcelaId: string;
  numero: number;
  alunoNome: string;
  contratoId: string;
  registro: string;
  vencimento: string;
  valorBruto: number;
  valorLiquido: number | null;
  statusDerivado: "ESTORNADA" | "PAGA" | "CANCELADA" | "ABERTA";
  comissoesDaParcela: ComissaoDaParcela[];
  totalComissaoParcela: number;
}

interface Mensal {
  parcelasDoMes: ParcelaDoMes[];
}

interface AlunoLinha {
  alunoNome: string;
  contratoId: string;
  pacote: string;
  parcelaAtual: number;
  totalParcelas: number;
  recebidoAcumulado: number;
  saldoAReceber: number;
}

interface ComissaoLinha {
  id: string;
  nome: string;
  totalAPagar: number;
  qtdContratos: number;
}

interface Comissoes {
  comissionados: ComissaoLinha[];
  totalGeralAPagar: number;
}

interface Geral {
  contratosAtivos: number;
  totalAReceberGeral: number;
  fechadosNoMesQtd: number;
  fechadosNoMesValor: number;
}

function formatarMesParam(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function labelMes(mesParam: string): string {
  const ano = Number(mesParam.slice(0, 4));
  const mes = Number(mesParam.slice(4, 6));
  return `${NOMES_MES[mes - 1]} de ${ano}`;
}

function deslocarMes(mesParam: string, deslocamento: number): string {
  const ano = Number(mesParam.slice(0, 4));
  const mes = Number(mesParam.slice(4, 6));
  const data = new Date(Date.UTC(ano, mes - 1 + deslocamento, 1));
  return `${data.getUTCFullYear()}${String(data.getUTCMonth() + 1).padStart(2, "0")}`;
}

function formatarMoeda(valor: number): string {
  return formatarMoedaBR(valor);
}

function formatarDataCurta(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: TIMEZONE });
}

function statusParcelaLabel(status: string): string {
  switch (status) {
    case "ESTORNADA":
      return "Estornada";
    case "PAGA":
      return "Paga";
    case "CANCELADA":
      return "Cancelada";
    default:
      return "Aberta";
  }
}

function corStatusParcela(status: string): string {
  switch (status) {
    case "ESTORNADA":
      return "bg-muted/10 text-muted";
    case "PAGA":
      return "bg-green/10 text-green";
    case "CANCELADA":
      return "bg-muted/10 text-muted";
    default:
      return "bg-blue/10 text-blue";
  }
}

export default function DashboardMentoriaPage() {
  const router = useRouter();
  const pathname = usePathname();

  const [mes, setMes] = useState(() => formatarMesParam(new Date()));

  const [resumo, setResumo] = useState<Resumo | null>(null);
  const [carregandoResumo, setCarregandoResumo] = useState(true);

  const [mensal, setMensal] = useState<Mensal | null>(null);
  const [carregandoMensal, setCarregandoMensal] = useState(true);

  const [alunosData, setAlunosData] = useState<AlunoLinha[] | null>(null);
  const [carregandoAlunos, setCarregandoAlunos] = useState(true);

  const [comissoesData, setComissoesData] = useState<Comissoes | null>(null);
  const [carregandoComissoes, setCarregandoComissoes] = useState(true);

  const [geral, setGeral] = useState<Geral | null>(null);
  const [carregandoGeral, setCarregandoGeral] = useState(true);

  const [parcelaBaixa, setParcelaBaixa] = useState<{ id: string; numero: number; valorLiquido: number | null } | null>(
    null
  );

  async function carregarResumo() {
    setCarregandoResumo(true);
    try {
      const r = await fetch(`/api/mentoria/dashboard/resumo?mes=${mes}`);
      setResumo(r.ok ? await r.json() : null);
    } finally {
      setCarregandoResumo(false);
    }
  }

  async function carregarMensal() {
    setCarregandoMensal(true);
    try {
      const r = await fetch(`/api/mentoria/dashboard/mensal?mes=${mes}`);
      setMensal(r.ok ? await r.json() : null);
    } finally {
      setCarregandoMensal(false);
    }
  }

  async function carregarGeral() {
    setCarregandoGeral(true);
    try {
      const r = await fetch(`/api/mentoria/dashboard/geral?mes=${mes}`);
      setGeral(r.ok ? await r.json() : null);
    } finally {
      setCarregandoGeral(false);
    }
  }

  useEffect(() => {
    carregarResumo();
    carregarMensal();
    // "Fechados no mês" acompanha o mês selecionado — refaz junto.
    carregarGeral();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mes]);

  useEffect(() => {
    fetch("/api/mentoria/dashboard/alunos")
      .then((r) => (r.ok ? r.json() : []))
      .then(setAlunosData)
      .finally(() => setCarregandoAlunos(false));

    fetch("/api/mentoria/dashboard/comissoes")
      .then((r) => (r.ok ? r.json() : null))
      .then(setComissoesData)
      .finally(() => setCarregandoComissoes(false));
  }, []);

  // Baixa direto na lista "Parcelas do mês" — sem navegar para o contrato.
  // Após sucesso, revalida só o que pode ter mudado: a própria lista, os
  // cards do mês e o card global "Total a Receber".
  async function recarregarAposBaixa() {
    await Promise.all([carregarMensal(), carregarResumo(), carregarGeral()]);
  }

  async function handleSair() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <button onClick={() => router.push("/painel")} className="text-sm text-muted hover:text-fg">
              ← Painel
            </button>
            <h1 className="font-serif text-lg font-semibold text-fg">Mentoria — Dashboard</h1>
          </div>
          <div className="flex items-center gap-3">
            <ContextoSwitcher />
            <button
              onClick={handleSair}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-fg hover:bg-bg"
            >
              Sair
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-5xl space-y-6 px-6 py-8">
        <div className="flex items-center justify-between">
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

          <div className="flex items-center gap-2">
            <button
              onClick={() => setMes((m) => deslocarMes(m, -1))}
              className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-fg hover:bg-bg"
              aria-label="Mês anterior"
            >
              ←
            </button>
            <span className="min-w-[160px] text-center text-sm font-medium text-fg">{labelMes(mes)}</span>
            <button
              onClick={() => setMes((m) => deslocarMes(m, 1))}
              className="rounded-lg border border-border px-3 py-2 text-sm font-medium text-fg hover:bg-bg"
              aria-label="Próximo mês"
            >
              →
            </button>
          </div>
        </div>

        {/* Indicadores globais — Contratos ativos e Total a receber independem do mês; Fechados no mês acompanha o seletor */}
        {carregandoGeral ? (
          <p className="text-sm text-muted">Carregando indicadores gerais...</p>
        ) : !geral ? (
          <p className="text-sm text-muted">Não foi possível carregar os indicadores gerais.</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-border bg-surface p-4">
              <p className="text-xs font-medium tracking-wide text-muted">Contratos ativos</p>
              <p className="mt-1 text-lg font-semibold text-fg">{geral.contratosAtivos}</p>
            </div>
            <div className="rounded-xl border border-border bg-surface p-4">
              <p className="text-xs font-medium tracking-wide text-muted">Total a receber</p>
              <p className="mt-1 text-lg font-semibold text-fg">{formatarMoeda(geral.totalAReceberGeral)}</p>
            </div>
            <div className="rounded-xl border border-border bg-surface p-4">
              <p className="text-xs font-medium tracking-wide text-muted">Fechados no mês</p>
              <p className="mt-1 text-lg font-semibold text-fg">
                {geral.fechadosNoMesQtd} {geral.fechadosNoMesQtd === 1 ? "contrato" : "contratos"} ·{" "}
                {formatarMoeda(geral.fechadosNoMesValor)}
              </p>
            </div>
          </div>
        )}

        {/* Faixa de resumo — só estes cards mudam com o mês selecionado acima */}
        {carregandoResumo ? (
          <p className="text-sm text-muted">Carregando resumo...</p>
        ) : !resumo ? (
          <p className="text-sm text-muted">Não foi possível carregar o resumo do mês.</p>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-border bg-surface p-4">
              <p className="text-xs font-medium tracking-wide text-muted">A receber no mês</p>
              <p className="mt-1 text-lg font-semibold text-fg">{formatarMoeda(resumo.aReceberNoMes)}</p>
            </div>
            <div className="rounded-xl border border-border bg-surface p-4">
              <p className="text-xs font-medium tracking-wide text-muted">Recebido no mês</p>
              <p className="mt-1 text-lg font-semibold text-fg">{formatarMoeda(resumo.recebidoLiquidoNoMes)}</p>
            </div>
            <div className="rounded-xl border border-border bg-surface p-4">
              <p className="text-xs font-medium tracking-wide text-muted">Comissões a pagar no mês</p>
              <p className="mt-1 text-lg font-semibold text-fg">
                {formatarMoeda(resumo.comissaoLiberadaNoMes + resumo.comissaoPendenteNoMes)}
              </p>
              <div className="mt-1 flex gap-3 text-xs">
                <span className="text-green">Liberada: {formatarMoeda(resumo.comissaoLiberadaNoMes)}</span>
                <span className="text-red">Pendente: {formatarMoeda(resumo.comissaoPendenteNoMes)}</span>
              </div>
            </div>
            <div className="rounded-xl border border-border bg-surface p-4">
              <p className="text-xs font-medium tracking-wide text-muted">Inadimplência</p>
              <p className="mt-1 text-lg font-semibold text-red">{formatarMoeda(resumo.inadimplenciaAtual)}</p>
              <p className="mt-1 text-xs text-muted">vencidas em meses anteriores</p>
            </div>
          </div>
        )}

        {/* Parcelas do mês */}
        <div className="space-y-3 rounded-xl border border-border bg-surface p-6">
          <h2 className="font-serif text-base font-semibold text-fg">Parcelas do mês</h2>
          {carregandoMensal ? (
            <p className="text-sm text-muted">Carregando...</p>
          ) : !mensal || mensal.parcelasDoMes.length === 0 ? (
            <p className="text-sm text-muted">Nenhuma parcela com vencimento em {labelMes(mes)}.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs font-medium tracking-wide text-muted">
                    <th className="px-3 py-2">Aluno</th>
                    <th className="px-3 py-2">Registro</th>
                    <th className="px-3 py-2">Vencimento</th>
                    <th className="px-3 py-2">Valor bruto</th>
                    <th className="px-3 py-2">Valor líquido</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2">Comissão</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {mensal.parcelasDoMes.map((p, i) => (
                    <tr key={i} className="border-b border-border last:border-0 hover:bg-bg">
                      <td className="px-3 py-2 font-medium">
                        <button
                          type="button"
                          onClick={() => router.push(`/mentoria/contratos/${p.contratoId}`)}
                          className="text-fg underline-offset-2 hover:text-gold hover:underline"
                        >
                          {p.alunoNome}
                        </button>
                      </td>
                      <td className="px-3 py-2 text-fg">{p.registro}</td>
                      <td className="px-3 py-2 text-fg">{formatarDataCurta(p.vencimento)}</td>
                      <td className="px-3 py-2 text-fg">{formatarMoeda(p.valorBruto)}</td>
                      <td className="px-3 py-2 text-fg">{p.valorLiquido !== null ? formatarMoeda(p.valorLiquido) : "—"}</td>
                      <td className="px-3 py-2">
                        {p.comissoesDaParcela.length === 0 ? (
                          <span className="text-xs text-muted">—</span>
                        ) : (
                          <div title={p.comissoesDaParcela.map((c) => `${c.comissionadoNome}: ${formatarMoeda(c.valor)}`).join(" · ")}>
                            <p className={p.comissoesDaParcela.every((c) => c.devida) ? "text-fg" : "text-muted"}>
                              {formatarMoeda(p.totalComissaoParcela)}
                            </p>
                            <p className="text-[11px] text-muted">
                              {p.comissoesDaParcela.map((c) => c.comissionadoNome).join(", ")}
                              {!p.comissoesDaParcela.every((c) => c.devida) && " (prevista)"}
                            </p>
                          </div>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${corStatusParcela(p.statusDerivado)}`}>
                          {statusParcelaLabel(p.statusDerivado)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        {p.statusDerivado === "ABERTA" && (
                          <button
                            type="button"
                            onClick={() =>
                              setParcelaBaixa({ id: p.parcelaId, numero: p.numero, valorLiquido: p.valorLiquido })
                            }
                            className="rounded-lg border border-gold px-3 py-1 text-xs font-medium text-gold hover:bg-gold/10"
                          >
                            Dar baixa
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Visão por aluno */}
        <div className="space-y-3 rounded-xl border border-border bg-surface p-6">
          <h2 className="font-serif text-base font-semibold text-fg">Visão por aluno</h2>
          {carregandoAlunos ? (
            <p className="text-sm text-muted">Carregando...</p>
          ) : !alunosData || alunosData.length === 0 ? (
            <p className="text-sm text-muted">Nenhum contrato ativo no momento.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs font-medium tracking-wide text-muted">
                    <th className="px-3 py-2">Aluno</th>
                    <th className="px-3 py-2">Produto</th>
                    <th className="px-3 py-2">Parcela atual</th>
                    <th className="px-3 py-2">Recebido acumulado</th>
                    <th className="px-3 py-2">Saldo a receber</th>
                  </tr>
                </thead>
                <tbody>
                  {alunosData.map((a) => (
                    <tr
                      key={a.contratoId}
                      onClick={() => router.push(`/mentoria/contratos/${a.contratoId}`)}
                      className="cursor-pointer border-b border-border last:border-0 hover:bg-bg"
                    >
                      <td className="px-3 py-2 font-medium text-fg">{a.alunoNome}</td>
                      <td className="px-3 py-2 text-fg">{a.pacote}</td>
                      <td className="px-3 py-2 text-fg">
                        {a.parcelaAtual} de {a.totalParcelas}
                      </td>
                      <td className="px-3 py-2 text-fg">{formatarMoeda(a.recebidoAcumulado)}</td>
                      <td className="px-3 py-2 text-fg">{formatarMoeda(a.saldoAReceber)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Comissões a pagar */}
        <div className="space-y-3 rounded-xl border border-border bg-surface p-6">
          <h2 className="font-serif text-base font-semibold text-fg">Comissões a pagar</h2>
          {carregandoComissoes ? (
            <p className="text-sm text-muted">Carregando...</p>
          ) : !comissoesData || comissoesData.comissionados.length === 0 ? (
            <p className="text-sm text-muted">Nenhuma comissão pendente.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs font-medium tracking-wide text-muted">
                    <th className="px-3 py-2">Comissionado</th>
                    <th className="px-3 py-2">Qtd. contratos</th>
                    <th className="px-3 py-2">Total a pagar</th>
                  </tr>
                </thead>
                <tbody>
                  {comissoesData.comissionados.map((c) => (
                    <tr key={c.id} className="border-b border-border last:border-0 hover:bg-bg">
                      <td className="px-3 py-2 font-medium">
                        <button
                          type="button"
                          onClick={() => router.push(`/mentoria/comissionados/${c.id}`)}
                          className="text-fg underline-offset-2 hover:text-gold hover:underline"
                        >
                          {c.nome}
                        </button>
                      </td>
                      <td className="px-3 py-2 text-fg">{c.qtdContratos}</td>
                      <td className="px-3 py-2 text-fg">{formatarMoeda(c.totalAPagar)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td className="px-3 py-2 text-xs font-medium text-muted">Total geral</td>
                    <td className="px-3 py-2"></td>
                    <td className="px-3 py-2 text-sm font-medium text-fg">
                      {formatarMoeda(comissoesData.totalGeralAPagar)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </div>
      </div>

      <ModalBaixaParcela
        parcela={parcelaBaixa}
        onClose={() => setParcelaBaixa(null)}
        onSucesso={recarregarAposBaixa}
      />
    </div>
  );
}
