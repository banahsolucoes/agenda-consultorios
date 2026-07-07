import { inicioSemanaSP } from "./timezone";

const DIA_MS = 24 * 60 * 60 * 1000;

export interface SessaoParaConflito {
  id: string;
  inicio: Date;
  status: string;
}

// Janela [inicio, fim) da semana (segunda 00:00 a domingo 23:59:59) de
// `data`, no calendário de São Paulo.
export function calcularJanelaSemana(data: Date): { inicio: Date; fim: Date } {
  const inicio = inicioSemanaSP(data);
  return { inicio, fim: new Date(inicio.getTime() + 7 * DIA_MS) };
}

// Verdadeiro se alguma sessão em `outrasSessoes` (não cancelada) cai na mesma
// semana de `novaData` — usado para bloquear a edição de data de uma sessão
// quando isso criaria duas sessões do mesmo paciente na mesma semana.
export function existeConflitoDeSemana(novaData: Date, outrasSessoes: SessaoParaConflito[]): boolean {
  const { inicio, fim } = calcularJanelaSemana(novaData);
  return outrasSessoes.some(
    (s) => s.status !== "CANCELADA" && s.inicio >= inicio && s.inicio < fim
  );
}
