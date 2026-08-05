import { primeiroUltimoNome } from "@/lib/nomes";

// Nome de exibição de uma sessão — de paciente ou de mentorado (avulsa,
// sem pacote). Ponto único pra não espalhar `paciente?.nome ?? aluno?.nomeCompleto`
// pelas rotas de sessão.
export function nomeSessao(sessao: {
  paciente?: { nome: string } | null;
  aluno?: { nomeCompleto: string } | null;
}): string {
  return sessao.paciente?.nome ?? sessao.aluno?.nomeCompleto ?? "";
}

// Título do evento do Google Calendar/Meet para reunião avulsa de mentorado
// (sem pacote, sem numeração) — formato fixo definido para o lançamento do
// módulo de mentoria na agenda: "FonoElite (Pâmela & {nomeMentorado})".
export function formatarTituloMentorado(nomeMentorado: string): string {
  return `FonoElite (Pâmela & ${nomeMentorado})`;
}

// Texto da primeira linha do bloco de sessão na agenda visual: primeiro nome
// do paciente + numeração do pacote (ou o nome do tipo, se for atendimento
// único — ex.: avaliação, que não faz sentido numerar), com um ✅ ao final
// quando a sessão foi marcada como confirmada. A confirmação é independente
// do status da sessão.
export function textoLinhaBlocoAgenda(
  nomePaciente: string,
  numeroSessao: number,
  totalPacote: number,
  confirmada: boolean,
  ehAtendimentoUnico: boolean = false,
  tipoSessaoNome: string | null = null
): string {
  const primeiroNome = nomePaciente.split(" ")[0];
  const base =
    ehAtendimentoUnico && tipoSessaoNome
      ? `${primeiroNome} - ${tipoSessaoNome}`
      : `${primeiroNome} ${numeroSessao}/${totalPacote}`;
  return confirmada ? `${base} ✅` : base;
}

// Ponto único de formatação do título de agendamento usado no evento do
// Google Calendar/Meet (e nos demais rótulos "{paciente} (N/T)" espalhados
// pelas rotas de sessão): quando o tipo de sessão é de atendimento único
// (ex.: avaliação), o rótulo vira "{paciente} - {nome do tipo}" em vez da
// numeração do pacote, já que só acontece uma vez. Se o tipo não tiver nome
// resolvido, cai no formato numerado — nunca gera título terminando em traço.
export function formatarTituloAgendamento({
  nomePaciente,
  tipoSessaoNome,
  ehAtendimentoUnico,
  numeroSessao,
  totalPacote,
}: {
  nomePaciente: string;
  tipoSessaoNome: string | null | undefined;
  ehAtendimentoUnico: boolean;
  numeroSessao: number;
  totalPacote: number;
}): string {
  const nome = primeiroUltimoNome(nomePaciente);
  if (ehAtendimentoUnico && tipoSessaoNome) {
    return `${nome} - ${tipoSessaoNome}`;
  }
  return `${nome} (${numeroSessao}/${totalPacote})`;
}
