// Constantes compartilhadas entre as rotas de anexos de paciente e o
// formulário no painel — mantém a validação de tipo/tamanho igual dos dois
// lados (cliente é só UX, servidor é o que vale).
export const BUCKET_ANEXOS = "anexos-pacientes";
export const TIPOS_PERMITIDOS = ["image/jpeg", "image/png", "application/pdf"] as const;
export const TAMANHO_MAX_BYTES = Math.floor(4.5 * 1024 * 1024); // 4,5MB

// Caminho no Storage sempre começa com o clinicaId — amarra o arquivo à
// clínica já no caminho físico, mesmo que o bucket seja privado.
export function caminhoAnexo(clinicaId: string, pacienteId: string, nomeArquivo: string) {
  const nomeSanitizado = nomeArquivo.trim().replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${clinicaId}/${pacienteId}/${crypto.randomUUID()}-${nomeSanitizado}`;
}
