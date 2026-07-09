// Normaliza cabeçalho: minúsculo, sem acento, sem espaços extras
export function normalizarCabecalho(s: string): string {
  return (s || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

// Mapa: nome normalizado da coluna na planilha -> campo do paciente
export const MAPA: Record<string, string> = {
  "nome completo": "nome",
  "data de nascimento": "dataNascimento",
  "estado civil": "estadoCivil",
  "nacionalidade": "nacionalidade",
  "seu instagram": "instagram",
  "e-mail": "email",
  "email": "email",
  "endereco completo": "logradouro",
  "cep": "cep",
  "profissao": "profissao",
  "telefone (whatsapp)": "telefone",
  "telefone": "telefone",
  "seu rg": "rg",
  "seu cpf": "cpf",
  "quem indicou?": "quemIndicou",
  "quem indicou": "quemIndicou",
  "carimbo de data/hora": "dataCadastroForms",
  "timestamp": "dataCadastroForms",
};

export function soDigitos(s: string): string {
  return (s || "").replace(/\D/g, "");
}