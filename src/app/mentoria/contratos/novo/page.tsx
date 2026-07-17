"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import DatePickerSP from "../../../painel/DatePickerSP";

type Modalidade = "AVISTA" | "PARCELADO";

interface ParcelaForm {
  valorBruto: string;
  valorLiquido: string;
  vencimento: string; // "YYYY-MM-DD"
}

function diasNoMes(ano: number, mes: number): number {
  // dia 0 do próximo mês = último dia do mês atual (só contagem de dias, não gera instante de sessão)
  return new Date(ano, mes, 0).getDate();
}

function somarMeses(ano: number, mes: number, dia: number, incremento: number) {
  const totalMeses = mes - 1 + incremento;
  const novoAno = ano + Math.floor(totalMeses / 12);
  const novoMes = (((totalMeses % 12) + 12) % 12) + 1;
  const diaClamped = Math.min(dia, diasNoMes(novoAno, novoMes));
  return { ano: novoAno, mes: novoMes, dia: diaClamped };
}

function formatarYMD(c: { ano: number; mes: number; dia: number }): string {
  return `${c.ano}-${String(c.mes).padStart(2, "0")}-${String(c.dia).padStart(2, "0")}`;
}

export default function NovoContratoMentoriaPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const alunoId = searchParams.get("aluno") ?? "";

  const [alunoNome, setAlunoNome] = useState("");
  const [carregandoAluno, setCarregandoAluno] = useState(true);
  const [erroAluno, setErroAluno] = useState("");

  const [pacote, setPacote] = useState("");
  const [valorTotal, setValorTotal] = useState("");
  const [taxaImpostoPct, setTaxaImpostoPct] = useState("6");
  const [assinaturaContrato, setAssinaturaContrato] = useState("");
  const [modalidade, setModalidade] = useState<Modalidade>("AVISTA");

  // Campos auxiliares só do modo Parcelado — usados para gerar o grid, que
  // depois é livremente editável (ponto de partida, não trava os valores).
  const [nParcelas, setNParcelas] = useState("2");
  const [valorEntrada, setValorEntrada] = useState("0");
  const [valorParcela, setValorParcela] = useState("");
  const [diaVencimento, setDiaVencimento] = useState("10");
  const [mesAnoPrimeiraParcela, setMesAnoPrimeiraParcela] = useState("");

  const [parcelas, setParcelas] = useState<ParcelaForm[]>([]);
  const [erroGeracao, setErroGeracao] = useState("");

  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => {
    if (!alunoId) {
      setErroAluno("nenhum aluno informado na URL (?aluno=<id>)");
      setCarregandoAluno(false);
      return;
    }
    fetch(`/api/mentoria/alunos/${alunoId}`)
      .then(async (r) => {
        if (!r.ok) {
          setErroAluno(r.status === 404 ? "aluno não encontrado" : "não foi possível carregar o aluno");
          return;
        }
        const dados = await r.json();
        setAlunoNome(dados.nomeCompleto);
      })
      .finally(() => setCarregandoAluno(false));
  }, [alunoId]);

  function handleGerarParcelas() {
    setErroGeracao("");

    if (modalidade === "AVISTA") {
      if (!valorTotal || Number(valorTotal) <= 0) {
        setErroGeracao("informe o valorTotal antes de gerar a parcela");
        return;
      }
      if (!assinaturaContrato) {
        setErroGeracao("informe a data de assinatura antes de gerar a parcela");
        return;
      }
      setParcelas([{ valorBruto: valorTotal, valorLiquido: valorTotal, vencimento: assinaturaContrato }]);
      return;
    }

    // Parcelado
    const n = Number(nParcelas);
    const entrada = Number(valorEntrada || 0);
    const parcela = Number(valorParcela);
    const dia = Number(diaVencimento);

    if (!Number.isInteger(n) || n < 1) {
      setErroGeracao("nº de parcelas deve ser um inteiro maior ou igual a 1");
      return;
    }
    if (!(parcela > 0)) {
      setErroGeracao("informe o valor da parcela recorrente");
      return;
    }
    if (!Number.isInteger(dia) || dia < 1 || dia > 31) {
      setErroGeracao("dia de vencimento deve ser um inteiro entre 1 e 31");
      return;
    }
    const [anoStr, mesStr] = mesAnoPrimeiraParcela.split("-");
    const ano = Number(anoStr);
    const mes = Number(mesStr);
    if (!ano || !mes) {
      setErroGeracao("informe o mês/ano da primeira parcela");
      return;
    }

    const geradas: ParcelaForm[] = [];
    const primeiroVencimento = formatarYMD(somarMeses(ano, mes, dia, 0));

    if (entrada > 0) {
      geradas.push({ valorBruto: String(entrada), valorLiquido: String(entrada), vencimento: primeiroVencimento });
      for (let i = 1; i < n; i++) {
        geradas.push({
          valorBruto: String(parcela),
          valorLiquido: String(parcela),
          vencimento: formatarYMD(somarMeses(ano, mes, dia, i)),
        });
      }
    } else {
      for (let i = 0; i < n; i++) {
        geradas.push({
          valorBruto: String(parcela),
          valorLiquido: String(parcela),
          vencimento: formatarYMD(somarMeses(ano, mes, dia, i)),
        });
      }
    }

    setParcelas(geradas);
  }

  function alterarParcela(index: number, campo: keyof ParcelaForm, valor: string) {
    setParcelas((atual) => atual.map((p, i) => (i === index ? { ...p, [campo]: valor } : p)));
  }

  function removerParcela(index: number) {
    setParcelas((atual) => atual.filter((_, i) => i !== index));
  }

  function adicionarParcela() {
    setParcelas((atual) => [...atual, { valorBruto: "", valorLiquido: "", vencimento: "" }]);
  }

  const somaBrutos = parcelas.reduce((soma, p) => soma + (Number(p.valorBruto) || 0), 0);
  const somaLiquidos = parcelas.reduce((soma, p) => soma + (Number(p.valorLiquido) || 0), 0);
  const diferencaLiquido = Math.round((somaLiquidos - (Number(valorTotal) || 0)) * 100) / 100;
  const somaLiquidoBate = parcelas.length > 0 && Math.abs(diferencaLiquido) <= 0.01;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
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
      setErro("gere ou adicione ao menos uma parcela");
      return;
    }
    for (const p of parcelas) {
      if (
        !p.valorBruto ||
        Number(p.valorBruto) <= 0 ||
        !p.valorLiquido ||
        Number(p.valorLiquido) <= 0 ||
        !p.vencimento
      ) {
        setErro("toda parcela precisa de valorBruto, valorLiquido (maiores que zero) e vencimento preenchidos");
        return;
      }
    }
    if (!somaLiquidoBate) {
      setErro(
        `a soma dos valores líquidos (${somaLiquidos.toFixed(2)}) não bate com o valor total (${Number(valorTotal).toFixed(2)})`
      );
      return;
    }

    setSalvando(true);
    try {
      const res = await fetch("/api/mentoria/contratos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          alunoId,
          pacote: pacote.trim(),
          valorTotal: Number(valorTotal),
          taxaImpostoPct: Number(taxaImpostoPct) / 100,
          assinaturaContrato,
          totalParcelas: parcelas.length,
          parcelas: parcelas.map((p, i) => ({
            numero: i + 1,
            valorBruto: Number(p.valorBruto),
            valorLiquido: Number(p.valorLiquido),
            vencimento: p.vencimento,
          })),
        }),
      });
      const data = await res.json().catch(() => null);

      if (!res.ok) {
        setErro(data?.erro ?? "não foi possível criar o contrato");
        return;
      }

      router.push(`/mentoria/alunos/${alunoId}`);
    } catch {
      setErro("não foi possível criar o contrato");
    } finally {
      setSalvando(false);
    }
  }

  if (carregandoAluno) {
    return <div className="flex min-h-screen items-center justify-center bg-bg text-sm text-muted">Carregando...</div>;
  }

  if (erroAluno) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 bg-bg text-sm text-muted">
        <p>{erroAluno}</p>
        <button onClick={() => router.push("/mentoria/alunos")} className="text-gold hover:underline">
          ← Voltar para Alunos
        </button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bg">
      <header className="border-b border-border bg-surface">
        <div className="mx-auto flex max-w-3xl items-center gap-3 px-6 py-4">
          <button onClick={() => router.push(`/mentoria/alunos/${alunoId}`)} className="text-sm text-muted hover:text-fg">
            ← {alunoNome}
          </button>
          <h1 className="font-serif text-lg font-semibold text-fg">Novo contrato</h1>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-6 py-8">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="space-y-4 rounded-xl border border-border bg-surface p-6">
            <h2 className="font-serif text-base font-semibold text-fg">Dados do contrato</h2>

            <div>
              <label className="mb-1 block text-sm font-medium text-fg">Pacote</label>
              <input
                type="text"
                required
                value={pacote}
                onChange={(e) => setPacote(e.target.value)}
                className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-fg">Valor total (R$)</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  required
                  value={valorTotal}
                  onChange={(e) => setValorTotal(e.target.value)}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-fg">Taxa de imposto (%)</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={taxaImpostoPct}
                  onChange={(e) => setTaxaImpostoPct(e.target.value)}
                  className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                />
              </div>
              <div>
                <label className="mb-1 block whitespace-nowrap text-sm font-medium text-fg">Assinatura do contrato</label>
                <DatePickerSP value={assinaturaContrato} onChange={setAssinaturaContrato} />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-fg">Modalidade</label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm text-fg">
                  <input
                    type="radio"
                    name="modalidade"
                    checked={modalidade === "AVISTA"}
                    onChange={() => {
                      setModalidade("AVISTA");
                      setParcelas([]);
                    }}
                  />
                  À vista
                </label>
                <label className="flex items-center gap-2 text-sm text-fg">
                  <input
                    type="radio"
                    name="modalidade"
                    checked={modalidade === "PARCELADO"}
                    onChange={() => {
                      setModalidade("PARCELADO");
                      setParcelas([]);
                    }}
                  />
                  Parcelado
                </label>
              </div>
            </div>

            {modalidade === "PARCELADO" && (
              <div className="grid grid-cols-1 gap-4 rounded-lg bg-bg p-4 sm:grid-cols-2">
                <div>
                  <label className="mb-1 block text-sm font-medium text-fg">Nº de parcelas</label>
                  <input
                    type="number"
                    min={1}
                    value={nParcelas}
                    onChange={(e) => setNParcelas(e.target.value)}
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-fg">Valor da entrada (R$, opcional)</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={valorEntrada}
                    onChange={(e) => setValorEntrada(e.target.value)}
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-fg">Valor da parcela recorrente (R$)</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={valorParcela}
                    onChange={(e) => setValorParcela(e.target.value)}
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-fg">Dia de vencimento (1–31)</label>
                  <input
                    type="number"
                    min={1}
                    max={31}
                    value={diaVencimento}
                    onChange={(e) => setDiaVencimento(e.target.value)}
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-fg">Mês/ano da 1ª parcela</label>
                  <input
                    type="month"
                    value={mesAnoPrimeiraParcela}
                    onChange={(e) => setMesAnoPrimeiraParcela(e.target.value)}
                    className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                  />
                </div>
              </div>
            )}

            {erroGeracao && <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red">{erroGeracao}</p>}

            <button
              type="button"
              onClick={handleGerarParcelas}
              className="rounded-lg border border-gold px-4 py-2 text-sm font-medium text-gold hover:bg-gold/10"
            >
              Gerar parcelas
            </button>
          </div>

          <div className="space-y-3 rounded-xl border border-border bg-surface p-6">
            <div className="flex items-center justify-between">
              <h2 className="font-serif text-base font-semibold text-fg">Parcelas</h2>
              <button
                type="button"
                onClick={adicionarParcela}
                className="text-sm font-medium text-gold hover:underline"
              >
                + Adicionar parcela
              </button>
            </div>

            {parcelas.length === 0 ? (
              <p className="text-sm text-muted">Nenhuma parcela ainda — gere a partir dos dados acima ou adicione manualmente.</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-left text-xs font-medium uppercase tracking-wide text-muted">
                      <th className="px-3 py-2">Nº</th>
                      <th className="px-3 py-2">Valor bruto (R$)</th>
                      <th className="px-3 py-2">Valor líquido (R$)</th>
                      <th className="px-3 py-2">Vencimento</th>
                      <th className="px-3 py-2"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {parcelas.map((p, i) => (
                      <tr key={i} className="border-b border-border last:border-0">
                        <td className="px-3 py-2 text-fg">{i + 1}</td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            value={p.valorBruto}
                            onChange={(e) => alterarParcela(i, "valorBruto", e.target.value)}
                            className="w-32 rounded-lg border border-border bg-bg px-2 py-1 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            value={p.valorLiquido}
                            onChange={(e) => alterarParcela(i, "valorLiquido", e.target.value)}
                            className="w-32 rounded-lg border border-border bg-bg px-2 py-1 text-fg outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                          />
                        </td>
                        <td className="px-3 py-2">
                          <DatePickerSP value={p.vencimento} onChange={(v) => alterarParcela(i, "vencimento", v)} />
                        </td>
                        <td className="px-3 py-2">
                          <button
                            type="button"
                            onClick={() => removerParcela(i)}
                            className="text-xs text-red hover:underline"
                          >
                            Remover
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td className="px-3 py-2 text-xs font-medium text-muted">Soma</td>
                      <td className="px-3 py-2 text-sm font-medium text-fg">
                        {somaBrutos.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                        <span className="ml-1 text-xs font-normal text-muted">(bruto, informativo)</span>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`text-sm font-medium ${somaLiquidoBate ? "text-green" : "text-red"}`}>
                          {somaLiquidos.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                        </span>
                        {!somaLiquidoBate && (
                          <span className="ml-1 text-xs text-red">
                            diferença de {diferencaLiquido.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} em
                            relação ao valor total
                          </span>
                        )}
                      </td>
                      <td colSpan={2} className="px-3 py-2 text-xs text-muted"></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>

          {erro && <p className="rounded-lg bg-red/10 px-3 py-2 text-sm text-red">{erro}</p>}

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={() => router.push(`/mentoria/alunos/${alunoId}`)}
              disabled={salvando}
              className="rounded-lg border border-border px-4 py-2 text-sm font-medium text-fg hover:bg-bg disabled:cursor-not-allowed disabled:opacity-60"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={salvando || !somaLiquidoBate}
              className="rounded-lg bg-gold px-4 py-2 text-sm font-medium text-bg hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {salvando ? "Salvando..." : "Criar contrato"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
