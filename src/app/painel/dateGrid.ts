// Lógica pura de calendário (sem JSX) usada pelo DatePickerSP — separada para
// poder ser testada isoladamente.

export interface ComponentesData {
  ano: number;
  mes: number; // 1-12
  dia: number;
}

export function parseISO(valor: string): ComponentesData | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor);
  if (!m) return null;
  return { ano: Number(m[1]), mes: Number(m[2]), dia: Number(m[3]) };
}

export function formatarExibicao(valor: string): string {
  const c = parseISO(valor);
  if (!c) return valor;
  return `${String(c.dia).padStart(2, "0")}/${String(c.mes).padStart(2, "0")}/${c.ano}`;
}

// Grade de células (múltiplo de 7) do mês, com blanks (null) antes do dia 1 e
// depois do último dia — semanas sempre iniciando no domingo.
export function construirCelulas(ano: number, mes: number): (number | null)[] {
  const primeiroDiaSemana = new Date(Date.UTC(ano, mes - 1, 1)).getUTCDay();
  const diasNoMes = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  const celulas: (number | null)[] = Array(primeiroDiaSemana).fill(null);
  for (let d = 1; d <= diasNoMes; d++) celulas.push(d);
  while (celulas.length % 7 !== 0) celulas.push(null);
  return celulas;
}
