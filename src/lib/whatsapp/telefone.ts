// Telefone da Meta (campo "from"/"to") é sempre dígitos puros com DDI, sem
// "+"/espaços/máscara — normaliza o que estiver salvo em Paciente.telefone
// (formato inconsistente hoje: com/sem DDI, com máscara) sem alterar o
// cadastro. Só assume Brasil (prefixa "55") quando o número tem a
// quantidade de dígitos de um celular/fixo BR sem DDI (10-11); números que
// já vêm com 12-13 dígitos (qualquer DDI, não só 55) são usados como estão.
export function normalizarTelefoneE164(telefoneBruto: string): string | null {
  const digitos = telefoneBruto.replace(/\D/g, "");
  if (digitos.length === 10 || digitos.length === 11) return `55${digitos}`;
  if (digitos.length === 12 || digitos.length === 13) return digitos;
  return null;
}
