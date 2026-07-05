// Fuso horário único da aplicação. Toda sessão é criada/editada/exibida no
// horário de parede de São Paulo — independente do fuso em que o processo
// Node roda (em produção na Vercel, o runtime é UTC, não America/Sao_Paulo).
// Por isso nunca usamos os métodos locais do Date (getHours/getDay/setDate
// etc.) para interpretar ou construir os horários de sessão: eles dependem do
// fuso do processo. Em vez disso, tudo passa pelos helpers abaixo, que usam
// Intl.DateTimeFormat com timeZone explícito.
export const TIMEZONE = "America/Sao_Paulo";

export interface ComponentesDataSP {
  ano: number;
  mes: number; // 1-12
  dia: number;
  hora: number;
  minuto: number;
  segundo: number;
  diaSemana: number; // 0 = domingo ... 6 = sábado
}

const DIA_SEMANA_INDICE: Record<string, number> = {
  Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
};

const formatter = new Intl.DateTimeFormat("en-US", {
  timeZone: TIMEZONE,
  hourCycle: "h23",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  weekday: "short",
});

// Componentes de data/hora de `date` no fuso America/Sao_Paulo, sejam quais
// forem o fuso do processo que está rodando este código.
export function componentesSP(date: Date): ComponentesDataSP {
  const partes = formatter.formatToParts(date).reduce<Record<string, string>>((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {});
  return {
    ano: Number(partes.year),
    mes: Number(partes.month),
    dia: Number(partes.day),
    hora: Number(partes.hour),
    minuto: Number(partes.minute),
    segundo: Number(partes.second),
    diaSemana: DIA_SEMANA_INDICE[partes.weekday],
  };
}

// Inverso de componentesSP: dado um horário de parede em América/Sao_Paulo,
// devolve o instante (UTC) correspondente.
export function criarDataSP(ano: number, mes: number, dia: number, hora = 0, minuto = 0, segundo = 0): Date {
  const chute = new Date(Date.UTC(ano, mes - 1, dia, hora, minuto, segundo));
  const p = componentesSP(chute);
  const comoUTC = Date.UTC(p.ano, p.mes - 1, p.dia, p.hora, p.minuto, p.segundo);
  const offset = comoUTC - chute.getTime();
  return new Date(chute.getTime() - offset);
}

export function formatarHoraSP(date: Date): string {
  return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: TIMEZONE });
}

export function formatarDataCurtaSP(date: Date): string {
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: TIMEZONE });
}

export function formatarDataHoraSP(date: Date): string {
  return date.toLocaleString("pt-BR", {
    weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: TIMEZONE,
  });
}
