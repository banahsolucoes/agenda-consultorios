import { google } from "googleapis";
import { prisma } from "@/lib/prisma";
import { obterClienteGoogleDaClinica } from "@/lib/google";
import { ErroImportacao, soDigitos } from "@/lib/importacao";

// Importação de clientes do módulo Mentoria (Google Sheets → seleção manual
// → gravação) — mesmo fluxo da importação de pacientes da Agenda
// (src/lib/importacao.ts), mudando só a fonte (planilha/aba fixas do
// programa de mentoria) e o destino (MentoriaAluno). Reaproveita o mesmo
// client OAuth já usado pela integração Google da clínica.
const SPREADSHEET_ID_MENTORIA = "1jbI8UUr1ac0fSSGqYaoLr6zu0Gsubpy4kMeIBRTFraw";
const ABA_MENTORIA = "clientes";

function normalizarCabecalho(s: string): string {
  return (s || "")
    .normalize("NFD")
    .replace(/\p{Mark}/gu, "")
    .toLowerCase()
    .trim();
}

// Mapa: nome normalizado da coluna na planilha -> campo do MentoriaAluno
const MAPA: Record<string, string> = {
  "nome completo": "nomeCompleto",
  "rg": "rg",
  "cpf": "cpf",
  "estado civil": "estadoCivil",
  "profissao": "profissao",
  "nacionalidade": "nacionalidade",
  "endereco completo": "enderecoCompleto",
  "cep": "cep",
  "cidade / uf": "cidadeUf",
  "cidade/uf": "cidadeUf",
  "data de nascimento": "dataNascimento",
  "telefone": "telefone",
  "email": "email",
  "e-mail": "email",
  "termos e condicoes": "aceiteTermosTexto",
  "submitter": "submitter",
  "submission date": "submissionData",
  "submission id": "submissionId",
};

export interface RegistroPlanilhaMentoria extends Record<string, string> {
  status: "novo" | "existente";
}

export interface ResultadoLeituraPlanilhaMentoria {
  total: number;
  novos: number;
  existentes: number;
  registros: RegistroPlanilhaMentoria[];
}

// Converte datas no formato brasileiro usado pela planilha ("dd/mm/aaaa" ou
// "dd/mm/aaaa, HH:mm:ss") para Date. Retorna null se não for possível
// interpretar — nunca lança, quem grava decide o que fazer com null.
export function parseDataBR(valor: string): Date | null {
  const v = (valor || "").trim();
  if (!v) return null;
  const m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:,?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?$/);
  if (!m) return null;
  const [, dia, mes, ano, hora, minuto, segundo] = m;
  const data = new Date(
    Number(ano),
    Number(mes) - 1,
    Number(dia),
    Number(hora ?? 0),
    Number(minuto ?? 0),
    Number(segundo ?? 0)
  );
  return Number.isNaN(data.getTime()) ? null : data;
}

// Lê a planilha fixa de clientes da Mentoria, aplica o mapa de colunas e
// marca cada linha como "novo" ou "existente" comparando o CPF (normalizado,
// só dígitos) contra os alunos já cadastrados na clínica. Não grava nada no
// banco — usado tanto pelo preview quanto, antes de criar, pela execução.
export async function lerEDeduplicarPlanilhaMentoria(
  clinicaId: string
): Promise<ResultadoLeituraPlanilhaMentoria> {
  const clinica = await prisma.clinica.findUnique({ where: { id: clinicaId } });
  if (!clinica) {
    throw new ErroImportacao("clínica não encontrada");
  }

  const auth = await obterClienteGoogleDaClinica(clinica).catch(() => null);
  if (!auth) {
    throw new ErroImportacao(
      "Google não conectado ou sem permissão de planilhas — reconecte nas Configurações"
    );
  }

  const sheets = google.sheets({ version: "v4", auth });

  let valores: string[][] = [];
  try {
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID_MENTORIA,
      range: ABA_MENTORIA,
    });
    valores = (resp.data.values as string[][]) || [];
  } catch (err: unknown) {
    console.error("Falha ao ler a planilha de clientes da Mentoria:", err);
    throw new ErroImportacao("Não foi possível ler a planilha de clientes da Mentoria.");
  }

  if (valores.length < 2) {
    return { total: 0, novos: 0, existentes: 0, registros: [] };
  }

  const cabecalhoOriginal = valores[0];
  const cabecalho = cabecalhoOriginal.map(normalizarCabecalho);
  const linhas = valores.slice(1);

  // CPFs já existentes entre os alunos da clínica
  const alunosExistentes = await prisma.mentoriaAluno.findMany({
    where: { clinicaId, cpf: { not: null } },
    select: { cpf: true },
  });
  const cpfsExistentes = new Set(
    alunosExistentes.map((a) => soDigitos(a.cpf || "")).filter(Boolean)
  );

  const registros = linhas
    .map((linha) => {
      const dados: Record<string, string> = {};
      cabecalho.forEach((col, i) => {
        const valor = (linha[i] || "").trim();
        const campo = MAPA[col];
        if (campo) dados[campo] = valor;
      });
      return dados;
    })
    .filter((d) => (d.nomeCompleto && d.nomeCompleto.length > 0) || (d.cpf && d.cpf.length > 0))
    .map((d): RegistroPlanilhaMentoria => {
      const cpfDigitos = soDigitos(d.cpf || "");
      const jaExiste = cpfDigitos.length > 0 && cpfsExistentes.has(cpfDigitos);
      return { ...d, status: jaExiste ? "existente" : "novo" };
    });

  const novos = registros.filter((r) => r.status === "novo").length;
  const existentes = registros.filter((r) => r.status === "existente").length;

  return { total: registros.length, novos, existentes, registros };
}
