// Extrai primeiro + último nome de um nome completo. Usado onde o nome
// completo do paciente seria informação demais — ex.: título do evento no
// Google Calendar/Meet, visível a quem participa da chamada.
// Ex.: "Maria Aparecida Silva Santos" -> "Maria Santos"
export function primeiroUltimoNome(nome: string): string {
  const partes = nome.trim().split(/\s+/).filter(Boolean);
  if (partes.length <= 1) return partes[0] ?? "";
  return `${partes[0]} ${partes[partes.length - 1]}`;
}
