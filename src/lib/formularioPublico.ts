// Lógica compartilhada do formulário público de anamnese (F2) — puro, sem
// dependências de servidor, usado tanto no wizard (Client Component) quanto
// na rota de envio (Route Handler), para as duas camadas de validação
// (cliente + servidor) nunca divergirem.

import { cpfMatematicamenteValido } from "@/lib/cpf";

export interface PerguntaPublica {
  id: string;
  ordem: number;
  rotulo: string;
  descricao: string | null;
  tipo: string;
  obrigatoria: boolean;
  opcoes: string[];
  campoPaciente: string | null;
}

export interface Etapa {
  nome: string;
  perguntas: PerguntaPublica[];
}

// Campos cadastrais que identificam a pessoa — o resto dos campoPaciente
// (telefone, e-mail, endereço, etc.) vira a etapa de contato. Divisão por
// significado do campo (já gravado em PerguntaFormulario.campoPaciente pelo
// seed do F1), nunca por posição/índice fixo na lista.
const CAMPOS_IDENTIDADE = new Set(["nome", "cpf", "rg", "dataNascimento", "estadoCivil", "nacionalidade"]);

// Agrupa as perguntas ativas (já ordenadas por `ordem`) em até 5 etapas:
// dados pessoais / contato e endereço / saúde geral / voz e hábitos /
// relatos abertos. Etapas sem nenhuma pergunta são omitidas (formulário
// pode não ter perguntas de um tipo). Nenhum índice numérico fixo é usado —
// a divisão vem de `campoPaciente` (estrutural) e `tipo` (TEXTO_LONGO =
// relato aberto), preservando a ordem original dentro de cada grupo.
export function montarEtapas(perguntas: PerguntaPublica[]): Etapa[] {
  const cadastrais = perguntas.filter((p) => p.campoPaciente);
  const dadosPessoais = cadastrais.filter((p) => CAMPOS_IDENTIDADE.has(p.campoPaciente!));
  const contato = cadastrais.filter((p) => !CAMPOS_IDENTIDADE.has(p.campoPaciente!));

  const naoCadastrais = perguntas.filter((p) => !p.campoPaciente);
  const relatos = naoCadastrais.filter((p) => p.tipo === "TEXTO_LONGO");
  const clinicas = naoCadastrais.filter((p) => p.tipo !== "TEXTO_LONGO");
  const meio = Math.ceil(clinicas.length / 2);
  const saudeGeral = clinicas.slice(0, meio);
  const vozHabitos = clinicas.slice(meio);

  return [
    { nome: "Dados pessoais", perguntas: dadosPessoais },
    { nome: "Contato e endereço", perguntas: contato },
    { nome: "Saúde geral", perguntas: saudeGeral },
    { nome: "Voz e hábitos", perguntas: vozHabitos },
    { nome: "Relatos abertos", perguntas: relatos },
  ].filter((etapa) => etapa.perguntas.length > 0);
}

export function telefoneValido(valor: string): boolean {
  const digitos = valor.replace(/\D/g, "");
  return digitos.length === 10 || digitos.length === 11;
}

const REGEX_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function emailValido(valor: string): boolean {
  return REGEX_EMAIL.test(valor.trim());
}

// Aceita "AAAA-MM-DD" (formato nativo de <input type="date">). Rejeita data
// inexistente (ex.: 2026-02-30) e data futura (nascimento não pode ser no
// futuro).
export function dataNascimentoValida(valor: string): boolean {
  const m = valor.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return false;
  const [, anoStr, mesStr, diaStr] = m;
  const ano = Number(anoStr);
  const mes = Number(mesStr);
  const dia = Number(diaStr);
  const data = new Date(Date.UTC(ano, mes - 1, dia));
  const dataValida =
    data.getUTCFullYear() === ano && data.getUTCMonth() === mes - 1 && data.getUTCDate() === dia;
  if (!dataValida) return false;

  const hoje = new Date();
  const hojeUTC = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth(), hoje.getUTCDate()));
  return data.getTime() <= hojeUTC.getTime();
}

// Valida uma resposta individual conforme o tipo da pergunta. Retorna a
// mensagem de erro (string) ou null se válida. Não valida obrigatoriedade
// aqui — isso é responsabilidade de quem chama (varia por etapa/campo).
export function validarValorPorTipo(tipo: string, valor: string): string | null {
  const v = (valor || "").trim();
  if (!v) return null; // vazio: obrigatoriedade é checada à parte

  switch (tipo) {
    case "CPF":
      return cpfValidoOuErro(v);
    case "TELEFONE":
      return telefoneValido(v) ? null : "Telefone deve ter 10 ou 11 dígitos";
    case "EMAIL":
      return emailValido(v) ? null : "E-mail inválido";
    case "DATA":
      return dataNascimentoValida(v) ? null : "Data inválida";
    default:
      return null;
  }
}

function cpfValidoOuErro(valor: string): string | null {
  return cpfMatematicamenteValido(valor) ? null : "CPF inválido";
}
