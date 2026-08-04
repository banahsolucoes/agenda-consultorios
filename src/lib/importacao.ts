import { google } from "googleapis";
import { prisma } from "@/lib/prisma";
import { obterClienteGoogleDaClinica } from "@/lib/google";

// Erro esperado/tratável do fluxo de importação (configuração ausente, Google
// desconectado, planilha ilegível) — a mensagem já é segura pra mostrar ao
// cliente. Qualquer outro erro (não é ErroImportacao) é inesperado e os
// callers devem responder com uma mensagem genérica em vez de vazar detalhe.
export class ErroImportacao extends Error {}

// Normaliza cabeçalho: minúsculo, sem acento, sem espaços extras
function normalizarCabecalho(s: string): string {
  return (s || "")
    .normalize("NFD")
    .replace(/\p{Mark}/gu, "")
    .toLowerCase()
    .trim();
}

// Mapa: nome normalizado da coluna na planilha -> campo do paciente
const MAPA: Record<string, string> = {
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

// Colunas de meta (não é dado cadastral nem pergunta de anamnese): timestamp
// do formulário (já cai em "dataCadastroForms" via MAPA) e a coluna de
// aceite/consentimento do forms.app — a validação do consentimento já
// acontece lá, aqui só não queremos o texto dela poluindo a anamnese.
const REGEX_COLUNA_ACEITE = /aceit|consint|consent|concord|autoriz/;

// Metadados de submissão do forms.app (não são cadastro nem pergunta de
// anamnese) — nunca devem virar linha no texto. Comparado contra o
// cabeçalho já normalizado por normalizarCabecalho().
const COLUNAS_METADADOS_FORMS = new Set(["submitter", "submission date", "submission id", "idade"]);
const REGEX_COLUNA_SUBMISSION = /^submission/;

const SEPARADOR_OBSERVACOES = "\n\n--- OBSERVAÇÕES ---\n";

export function soDigitos(s: string): string {
  return (s || "").replace(/\D/g, "");
}

// Monta o texto da anamnese a partir de uma linha da planilha — toda coluna
// vira uma linha "Pergunta: Resposta" no texto, na ordem em que aparece,
// inclusive as cadastrais (que também vão pros campos próprios do Paciente,
// fora desta função). Só ficam de fora: dataCadastroForms, aceite/
// consentimento e metadados de submissão do forms.app (Submitter/Submission
// Date/Submission ID/Idade). Único ponto de formatação do texto — usado por
// lerEDeduplicarPlanilha e pelo script de reprocessamento retroativo.
export function montarAnamnese(
  cabecalhoOriginal: string[],
  cabecalhoNormalizado: string[],
  linha: string[]
): string {
  const linhasAnamnese: string[] = [];
  cabecalhoNormalizado.forEach((col, i) => {
    const valor = (linha[i] || "").trim();
    const campo = MAPA[col];
    // dataCadastroForms é metadado do forms.app, não pergunta de anamnese
    // nem dado que a clínica queira ver no texto — fora do texto, mesma
    // exceção de sempre.
    if (campo === "dataCadastroForms") return;
    if (REGEX_COLUNA_ACEITE.test(col)) return;
    if (COLUNAS_METADADOS_FORMS.has(col) || REGEX_COLUNA_SUBMISSION.test(col)) return;
    const rotulo = (cabecalhoOriginal[i] || "").trim().replace(/:$/, "");
    if (!rotulo) return;
    linhasAnamnese.push(`${rotulo}: ${valor}`);
  });
  return linhasAnamnese.length > 0 ? linhasAnamnese.join("\n") + SEPARADOR_OBSERVACOES : "";
}

// Mesmo formato de montarAnamnese(), a partir de RespostaFormulario (F2.5 —
// fila de envios do formulário próprio) em vez de uma linha de planilha:
// uma linha "rótulo: valor" por resposta, na ordem recebida (quem chama já
// busca ordenado por PerguntaFormulario.ordem), terminando no mesmo
// SEPARADOR_OBSERVACOES. Usa rotuloSnapshot (nunca o rótulo atual da
// pergunta) — é o texto que a pessoa efetivamente viu ao responder.
export function montarAnamneseDeRespostas(respostas: { rotuloSnapshot: string; valor: string }[]): string {
  const linhas = respostas
    .filter((r) => r.valor.trim().length > 0)
    .map((r) => `${r.rotuloSnapshot}: ${r.valor}`);
  return linhas.length > 0 ? linhas.join("\n") + SEPARADOR_OBSERVACOES : "";
}

export interface RegistroPlanilha extends Record<string, string> {
  status: "novo" | "existente";
}

export interface ResultadoLeituraPlanilha {
  total: number;
  novos: number;
  existentes: number;
  registros: RegistroPlanilha[];
}

// Lê a planilha do Google Sheets configurada na clínica, aplica o mapa de
// colunas e marca cada linha como "novo" ou "existente" comparando o CPF
// (normalizado, só dígitos) contra os pacientes já cadastrados na clínica.
// Não grava nada no banco — usado tanto pelo preview quanto, antes de criar,
// pela execução da importação.
export async function lerEDeduplicarPlanilha(clinicaId: string): Promise<ResultadoLeituraPlanilha> {
  const clinica = await prisma.clinica.findUnique({ where: { id: clinicaId } });
  if (!clinica) {
    throw new ErroImportacao("clínica não encontrada");
  }

  if (!clinica.sheetsPlanilhaId) {
    throw new ErroImportacao("planilha não configurada nas Configurações");
  }

  const auth = await obterClienteGoogleDaClinica(clinica).catch(() => null);
  if (!auth) {
    throw new ErroImportacao(
      "Google não conectado ou sem permissão de planilhas — reconecte nas Configurações"
    );
  }

  const sheets = google.sheets({ version: "v4", auth });
  const aba = clinica.sheetsAba || "Página1";

  let valores: string[][] = [];
  try {
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: clinica.sheetsPlanilhaId,
      range: aba,
    });
    valores = (resp.data.values as string[][]) || [];
  } catch (err: unknown) {
    console.error("Falha ao ler a planilha do Google Sheets:", err);
    throw new ErroImportacao("Não foi possível ler a planilha. Verifique se a URL/ID e a aba estão corretos.");
  }

  if (valores.length < 2) {
    return { total: 0, novos: 0, existentes: 0, registros: [] };
  }

  const cabecalhoOriginal = valores[0];
  const cabecalho = cabecalhoOriginal.map(normalizarCabecalho);
  const linhas = valores.slice(1);

  // CPFs já existentes na clínica
  const pacientesExistentes = await prisma.paciente.findMany({
    where: { clinicaId, cpf: { not: null } },
    select: { cpf: true },
  });
  const cpfsExistentes = new Set(
    pacientesExistentes.map((p) => soDigitos(p.cpf || "")).filter(Boolean)
  );

  const registros = linhas
    .map((linha) => {
      const dados: Record<string, string> = {};
      cabecalho.forEach((col, i) => {
        const campo = MAPA[col];
        if (campo) dados[campo] = (linha[i] || "").trim();
      });
      dados.anamnese = montarAnamnese(cabecalhoOriginal, cabecalho, linha);
      return dados;
    })
    .filter((d) => (d.nome && d.nome.length > 0) || (d.cpf && d.cpf.length > 0)) // ignora linhas vazias
    .map((d): RegistroPlanilha => {
      const cpfDigitos = soDigitos(d.cpf || "");
      const jaExiste = cpfDigitos.length > 0 && cpfsExistentes.has(cpfDigitos);
      return { ...d, status: jaExiste ? "existente" : "novo" };
    });

  const novos = registros.filter((r) => r.status === "novo").length;
  const existentes = registros.filter((r) => r.status === "existente").length;

  return { total: registros.length, novos, existentes, registros };
}
