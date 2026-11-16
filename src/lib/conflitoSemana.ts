import { componentesSP, formatarDataHoraSP, inicioSemanaSP } from "./timezone";

const DIA_MS = 24 * 60 * 60 * 1000;

// Mínimo de dias de calendário (SP) entre duas sessões do mesmo paciente na
// mesma semana quando o pacote é 2x/semana: ter+qui ok, seg+ter bloqueia.
export const INTERVALO_MINIMO_DIAS = 2;

export interface SessaoParaConflito {
  id: string;
  inicio: Date;
  status: string;
}

export type MotivoCadencia = "SEMANA_CHEIA" | "MESMO_DIA" | "INTERVALO_MINIMO";

export type ResultadoCadencia =
  | { ok: true }
  | { ok: false; motivo: MotivoCadencia; mensagem: string };

// Janela [inicio, fim) da semana (segunda 00:00 a domingo 23:59:59) de
// `data`, no calendário de São Paulo.
export function calcularJanelaSemana(data: Date): { inicio: Date; fim: Date } {
  const inicio = inicioSemanaSP(data);
  return { inicio, fim: new Date(inicio.getTime() + 7 * DIA_MS) };
}

// Índice do dia de calendário em SP (dias desde a época) — usado só para
// comparar distância em dias, nunca como instante real.
function indiceDiaSP(data: Date): number {
  const c = componentesSP(data);
  return Math.round(Date.UTC(c.ano, c.mes - 1, c.dia) / DIA_MS);
}

// Regra de cadência semanal do paciente (D1/D3 da especificação):
// - conta sessões não canceladas de `outrasSessoes` na semana SP de `novaData`;
// - `limite` = frequenciaSemanal do pacote da sessão criada/movida (1 ou 2);
// - limite 1: qualquer outra sessão na semana bloqueia (comportamento
//   histórico, idêntico ao antigo existeConflitoDeSemana);
// - limite 2: no máximo 2 na semana, nunca no mesmo dia e com pelo menos
//   INTERVALO_MINIMO_DIAS de diferença. Não valida entre semanas diferentes
//   (domingo + segunda seguinte é permitido).
export function validarCadencia({
  novaData,
  outrasSessoes,
  limite,
}: {
  novaData: Date;
  outrasSessoes: SessaoParaConflito[];
  limite: number;
}): ResultadoCadencia {
  const maximo = limite === 2 ? 2 : 1;
  const { inicio, fim } = calcularJanelaSemana(novaData);
  const naSemana = outrasSessoes.filter(
    (s) => s.status !== "CANCELADA" && s.inicio >= inicio && s.inicio < fim
  );

  if (naSemana.length >= maximo) {
    return {
      ok: false,
      motivo: "SEMANA_CHEIA",
      mensagem:
        maximo === 1
          ? "já existe uma sessão deste paciente nesta semana"
          : "este paciente já tem 2 sessões nesta semana",
    };
  }

  // Só chega aqui com limite 2 e no máximo 1 sessão na semana.
  const diaNovo = indiceDiaSP(novaData);
  for (const s of naSemana) {
    const distancia = Math.abs(indiceDiaSP(s.inicio) - diaNovo);
    if (distancia === 0) {
      return { ok: false, motivo: "MESMO_DIA", mensagem: "já existe uma sessão deste paciente neste dia" };
    }
    if (distancia < INTERVALO_MINIMO_DIAS) {
      return {
        ok: false,
        motivo: "INTERVALO_MINIMO",
        mensagem: `sessões na mesma semana precisam de pelo menos ${INTERVALO_MINIMO_DIAS} dias de intervalo (ex.: terça e quinta)`,
      };
    }
  }

  return { ok: true };
}

// Verdadeiro se alguma sessão em `outrasSessoes` (não cancelada) cai na mesma
// semana de `novaData` — wrapper de validarCadencia com limite 1, mantido
// para compatibilidade.
export function existeConflitoDeSemana(novaData: Date, outrasSessoes: SessaoParaConflito[]): boolean {
  return !validarCadencia({ novaData, outrasSessoes, limite: 1 }).ok;
}

export interface ItemCadencia {
  id: string;
  novaData: Date;
  limite: number;
  // Rótulo curto para a mensagem (ex.: "sessão 3"); opcional.
  rotulo?: string;
}

export interface ConflitoCadencia {
  id: string;
  novaData: Date;
  motivo: MotivoCadencia;
  mensagem: string;
}

// Valida um conjunto de sessões criadas/movidas de uma vez: cada item contra
// as sessões que ficam paradas (`fixas`) E contra os itens anteriores do
// próprio conjunto (já nas novas datas) — cobre a colisão ENTRE as sessões
// movidas, que as checagens antigas de empurrar/trazer ignoravam. Toda
// combinação de pares é coberta (o par (a, b) é checado quando b é
// processado). Devolve todos os conflitos (vazio = ok), para a resposta 409
// poder listar as datas.
export function validarCadenciaLote(itens: ItemCadencia[], fixas: SessaoParaConflito[]): ConflitoCadencia[] {
  const idsItens = new Set(itens.map((i) => i.id));
  const base = fixas.filter((s) => !idsItens.has(s.id));
  const jaProcessadas: SessaoParaConflito[] = [];
  const conflitos: ConflitoCadencia[] = [];

  for (const item of itens) {
    const r = validarCadencia({ novaData: item.novaData, outrasSessoes: [...base, ...jaProcessadas], limite: item.limite });
    if (!r.ok) {
      conflitos.push({
        id: item.id,
        novaData: item.novaData,
        motivo: r.motivo,
        mensagem: `${item.rotulo ? `${item.rotulo} ` : ""}(${formatarDataHoraSP(item.novaData)}): ${r.mensagem}`,
      });
    }
    jaProcessadas.push({ id: item.id, inicio: item.novaData, status: "AGENDADA" });
  }

  return conflitos;
}
