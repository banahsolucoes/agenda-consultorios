import { componentesSP } from "@/lib/timezone";

// Status que só fazem sentido para uma sessão que já aconteceu (ou deveria
// ter acontecido) — nunca para uma sessão futura.
const STATUS_EXIGE_NAO_FUTURA = ["REALIZADA", "NAO_REALIZADA"];

export type ResultadoValidacaoStatus = { valido: true } | { valido: false; erro: string };

// Mesma noção de "futura" usada pela trava abaixo: dia-calendário em São
// Paulo estritamente maior que o de hoje. Reaproveitada pela rota de
// reversão de sessões futuras marcadas incorretamente.
export function dataEhFutura(data: Date): boolean {
  const hoje = componentesSP(new Date());
  const dia = componentesSP(data);
  return (
    dia.ano > hoje.ano ||
    (dia.ano === hoje.ano && dia.mes > hoje.mes) ||
    (dia.ano === hoje.ano && dia.mes === hoje.mes && dia.dia > hoje.dia)
  );
}

// Trava central: nenhum caminho que grava Agendamento.status pode marcar uma
// sessão como Realizada/Não realizada se a data dela ainda não chegou.
// "Futura" é comparado por dia-calendário no fuso de São Paulo (mesma noção
// de dia usada pelo DatePickerSP via componentesSP) — não por timestamp, pra
// uma sessão de hoje à noite não ser barrada perto da meia-noite UTC.
export function validarStatusSessao(status: string, dataSessao: Date): ResultadoValidacaoStatus {
  if (!STATUS_EXIGE_NAO_FUTURA.includes(status)) return { valido: true };

  if (dataEhFutura(dataSessao)) {
    return { valido: false, erro: "Não é possível marcar uma sessão futura como Realizada/Não realizada." };
  }
  return { valido: true };
}
