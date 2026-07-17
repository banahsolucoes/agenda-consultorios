import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

// Papéis liberados para o módulo Mentoria — não existe capacidade
// correspondente em permissoes.ts (é um par de papéis, não uma capacidade),
// então a checagem é direta contra usuario.papel, como já se faz em outros
// pontos do código (ex.: POST /api/auth/signup).
const PAPEIS_MENTORIA = ["PROFISSIONAL", "ADMIN"];

// Guarda de acesso comum a todas as rotas de /api/mentoria/**: exige papel
// PROFISSIONAL/ADMIN e a clínica com o módulo ativado (Clinica.mentoriaAtivada).
// Retorna a NextResponse de erro (403) pra rota devolver direto, ou null se liberado.
export async function exigirAcessoMentoria(usuario: { clinicaId: string; papel: string }): Promise<NextResponse | null> {
  if (!PAPEIS_MENTORIA.includes(usuario.papel)) {
    return NextResponse.json({ erro: "sem permissão para o módulo Mentoria" }, { status: 403 });
  }

  const clinica = await prisma.clinica.findUnique({
    where: { id: usuario.clinicaId },
    select: { mentoriaAtivada: true },
  });
  if (!clinica?.mentoriaAtivada) {
    return NextResponse.json({ erro: "módulo Mentoria não está ativado para esta clínica" }, { status: 403 });
  }

  return null;
}

export type ResultadoValidacaoSoma =
  | { ok: true }
  | { ok: false; esperado: number; informado: number; diferenca: number };

// Regra de negócio: a soma dos valorLiquido de todas as parcelas de um
// contrato tem que bater com valorTotal, com tolerância de arredondamento de
// ±R$0,01. valorBruto fica de fora dessa checagem — a diferença bruto x
// líquido é a taxa de cartão, esperada e nunca validada contra o total.
export function validarSomaLiquido(parcelas: { valorLiquido: number }[], valorTotal: number): ResultadoValidacaoSoma {
  const somaBruta = parcelas.reduce((soma, p) => soma + p.valorLiquido, 0);
  const informado = Math.round(somaBruta * 100) / 100;
  const diferenca = Math.round((informado - valorTotal) * 100) / 100;
  if (Math.abs(diferenca) > 0.01) {
    return { ok: false, esperado: valorTotal, informado, diferenca };
  }
  return { ok: true };
}

// Comissão é sobre o contrato cheio e adiantada — nunca depende de parcelas
// pagas nem do quanto o aluno já pagou. Nenhum desses valores é persistido;
// são sempre recalculados a partir de valorTotal/taxaImpostoPct/percentual.
export function calcularBaseComissionavel(valorTotal: number, taxaImpostoPct: number): number {
  return Math.round(valorTotal * (1 - taxaImpostoPct) * 100) / 100;
}

export function calcularValorComissao(baseComissionavel: number, percentual: number): number {
  return Math.round(baseComissionavel * percentual * 100) / 100;
}

// Arredondamento padrão de valores monetários — 2 casas, tolerância de
// arredondamento em todas as somas do dashboard.
export function arred2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Converte um valor possivelmente nulo/indefinido (ex.: campo Decimal? do
// Prisma) num number seguro, nunca NaN — guarda contra valor nulo nas somas.
export function numOrZero(valor: unknown): number {
  const n = Number(valor);
  return Number.isFinite(n) ? n : 0;
}

export interface InfoMes {
  ano: number;
  mes: number;
  inicio: Date;
  fim: Date;
}

// Parseia o parâmetro ?mes=YYYYMM. Sem valor → mês atual (válido). Valor
// presente mas mal formado (não YYYYMM ou mês fora de 1-12) → null, pra rota
// responder 400.
export function parseMesParam(valor: string | null): InfoMes | null {
  let str = valor;
  if (!str) {
    const agora = new Date();
    str = `${agora.getUTCFullYear()}${String(agora.getUTCMonth() + 1).padStart(2, "0")}`;
  }
  if (!/^\d{6}$/.test(str)) return null;
  const ano = Number(str.slice(0, 4));
  const mes = Number(str.slice(4, 6));
  if (mes < 1 || mes > 12) return null;

  return {
    ano,
    mes,
    inicio: new Date(Date.UTC(ano, mes - 1, 1)),
    fim: new Date(Date.UTC(ano, mes, 1)),
  };
}

// Status derivado da parcela — mesma regra usada na tela de contrato
// (src/app/mentoria/contratos/[id]/page.tsx): ESTORNADA > PAGA > CANCELADA
// (contrato cancelado) > ABERTA. Nunca persistido.
export function derivarStatusParcela(
  p: { dataPagamento: Date | null; estornoEm: Date | null },
  statusContrato: string
): "ESTORNADA" | "PAGA" | "CANCELADA" | "ABERTA" {
  if (p.estornoEm !== null) return "ESTORNADA";
  if (p.dataPagamento !== null) return "PAGA";
  if (statusContrato === "CANCELADO") return "CANCELADA";
  return "ABERTA";
}

export interface AgregadosMensais {
  recebidoNoMes: number;
  estornadoNoMes: number;
  recebidoLiquidoNoMes: number;
  aReceberNoMes: number;
  inadimplenteNoMes: number;
}

// Núcleo de cálculo compartilhado entre /dashboard/mensal e /dashboard/resumo
// — mesma definição de RECEBIDA/A RECEBER/INADIMPLENTE/ESTORNO nas duas rotas.
export async function calcularAgregadosMensais(clinicaId: string, inicio: Date, fim: Date): Promise<AgregadosMensais> {
  const agora = new Date();

  const [recebidas, estornadas, aReceber] = await Promise.all([
    prisma.mentoriaParcela.findMany({
      where: { clinicaId, dataPagamento: { gte: inicio, lt: fim }, estornoEm: null },
      select: { valorLiquido: true },
    }),
    prisma.mentoriaParcela.findMany({
      where: { clinicaId, estornoEm: { gte: inicio, lt: fim } },
      select: { valorEstornado: true },
    }),
    prisma.mentoriaParcela.findMany({
      where: {
        clinicaId,
        dataPagamento: null,
        estornoEm: null,
        vencimento: { gte: inicio, lt: fim },
        contrato: { status: "ATIVO" },
      },
      select: { valorBruto: true, vencimento: true },
    }),
  ]);

  const recebidoNoMes = arred2(recebidas.reduce((soma, p) => soma + numOrZero(p.valorLiquido), 0));
  const estornadoNoMes = arred2(estornadas.reduce((soma, p) => soma + numOrZero(p.valorEstornado), 0));
  const recebidoLiquidoNoMes = arred2(recebidoNoMes - estornadoNoMes);
  const aReceberNoMes = arred2(aReceber.reduce((soma, p) => soma + numOrZero(p.valorBruto), 0));
  const inadimplenteNoMes = arred2(
    aReceber
      .filter((p) => p.vencimento.getTime() < agora.getTime())
      .reduce((soma, p) => soma + numOrZero(p.valorBruto), 0)
  );

  return { recebidoNoMes, estornadoNoMes, recebidoLiquidoNoMes, aReceberNoMes, inadimplenteNoMes };
}
