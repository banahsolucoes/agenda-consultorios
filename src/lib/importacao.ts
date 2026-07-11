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

const SEPARADOR_OBSERVACOES = "\n\n--- OBSERVAÇÕES ---\n";

export function soDigitos(s: string): string {
  return (s || "").replace(/\D/g, "");
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
      // Colunas não mapeadas (nem cadastrais nem meta) = perguntas da
      // anamnese, uma linha "Pergunta: Resposta" por coluna, na ordem em
      // que aparecem na planilha.
      const linhasAnamnese: string[] = [];
      cabecalho.forEach((col, i) => {
        const valor = (linha[i] || "").trim();
        const campo = MAPA[col];
        if (campo) {
          dados[campo] = valor;
          return;
        }
        if (REGEX_COLUNA_ACEITE.test(col)) return;
        const rotulo = (cabecalhoOriginal[i] || "").trim();
        if (!rotulo) return;
        linhasAnamnese.push(`${rotulo}: ${valor}`);
      });
      dados.anamnese =
        linhasAnamnese.length > 0 ? linhasAnamnese.join("\n") + SEPARADOR_OBSERVACOES : "";
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
