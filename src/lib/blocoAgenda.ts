// Texto da primeira linha do bloco de sessão na agenda visual: primeiro nome
// do paciente + numeração do pacote, com um ✅ ao final quando a sessão foi
// marcada como confirmada. A confirmação é independente do status da sessão.
export function textoLinhaBlocoAgenda(
  nomePaciente: string,
  numeroSessao: number,
  totalPacote: number,
  confirmada: boolean
): string {
  const primeiroNome = nomePaciente.split(" ")[0];
  const base = `${primeiroNome} ${numeroSessao}/${totalPacote}`;
  return confirmada ? `${base} ✅` : base;
}
