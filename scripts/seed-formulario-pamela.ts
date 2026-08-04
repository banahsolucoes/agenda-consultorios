// BLOCO F1 — seed do FormularioAnamnese + PerguntaFormulario da clínica
// pamela-rachid, slug "anamnese". Lê o cabeçalho REAL da planilha
// configurada em Clinica.sheetsPlanilhaId (nunca digitado de memória) e usa
// o MAPA de src/lib/importacao.ts como fonte das 13 colunas cadastrais.
// Idempotente: rodar duas vezes não duplica formulário nem perguntas
// (upsert por slug e por (formularioId, ordem)).
//
// Uso: npx tsx scripts/seed-formulario-pamela.ts

import "dotenv/config";
import { prisma } from "@/lib/prisma";
import { obterClienteGoogleDaClinica } from "@/lib/google";
import { google } from "googleapis";

// Mesmo MAPA de src/lib/importacao.ts (não exportado de lá) — fonte da
// correspondência coluna da planilha -> campo do Paciente.
const MAPA_CADASTRAL: Record<string, string> = {
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
};

// Tipo por campoPaciente cadastral (regra do BLOCO F1) — demais cadastrais
// (sem entrada aqui) caem em TEXTO_CURTO.
const TIPO_POR_CAMPO_PACIENTE: Record<string, string> = {
  cpf: "CPF",
  email: "EMAIL",
  telefone: "TELEFONE",
  cep: "CEP",
  dataNascimento: "DATA",
};

const OBRIGATORIAS_CAMPO_PACIENTE = new Set(["nome", "cpf", "telefone"]);

// Metadados de submissão do forms.app — mesmo filtro de importacao.ts,
// ignorados na formação do formulário.
const COLUNAS_METADADOS_FORMS = new Set(["submitter", "submission date", "submission id", "idade"]);
const REGEX_COLUNA_SUBMISSION = /^submission/;
const REGEX_COLUNA_ACEITE = /aceit|consint|consent|concord|autoriz/;

function normalizarCabecalho(s: string): string {
  return (s || "")
    .normalize("NFD")
    .replace(/\p{Mark}/gu, "")
    .toLowerCase()
    .trim();
}

function limparRotulo(rotuloOriginal: string): string {
  return rotuloOriginal.trim().replace(/:$/, "");
}

const TEXTO_CONSENTIMENTO = `Ao preencher e enviar este formulário de anamnese, você consente com o tratamento dos seus dados pessoais e de saúde pela Fono Pâmela Rachid, para a finalidade exclusiva de avaliação, planejamento e acompanhamento do seu atendimento fonoaudiológico.

Dados de saúde (histórico clínico, hábitos vocais, condições médicas) são tratados pela Lei Geral de Proteção de Dados (Lei 13.709/2018) como categoria sensível, recebendo grau reforçado de proteção. Esses dados são usados apenas pela equipe responsável pelo seu atendimento e não são compartilhados com terceiros para finalidade diversa da assistência à saúde, exceto quando exigido por lei.

Você pode, a qualquer momento, solicitar acesso, correção ou exclusão dos seus dados, revogar este consentimento e obter informações sobre como seus dados são tratados, entrando em contato diretamente com a clínica. A revogação do consentimento não afeta o tratamento realizado com base nele antes da revogação.`;

interface PerguntaSeed {
  ordem: number;
  rotulo: string;
  tipo: string;
  obrigatoria: boolean;
  campoPaciente: string | null;
}

async function main() {
  const slug = "pamela-rachid";
  const clinica = await prisma.clinica.findUnique({ where: { slug } });
  if (!clinica) {
    console.error(`ERRO: clínica "${slug}" não encontrada`);
    process.exitCode = 1;
    return;
  }
  if (!clinica.sheetsPlanilhaId) {
    console.error("ERRO: clínica sem sheetsPlanilhaId configurado");
    process.exitCode = 1;
    return;
  }

  const auth = await obterClienteGoogleDaClinica(clinica);
  if (!auth) {
    console.error("ERRO: Google não conectado ou sem permissão de planilhas — reconecte nas Configurações");
    process.exitCode = 1;
    return;
  }
  const sheets = google.sheets({ version: "v4", auth });
  const aba = clinica.sheetsAba || "Página1";
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId: clinica.sheetsPlanilhaId,
    range: aba,
  });
  const valores = (resp.data.values as string[][]) || [];
  if (valores.length === 0) {
    console.error("ERRO: planilha sem cabeçalho");
    process.exitCode = 1;
    return;
  }
  const cabecalhoOriginal = valores[0];
  const cabecalhoNormalizado = cabecalhoOriginal.map(normalizarCabecalho);

  const perguntas: PerguntaSeed[] = [];
  let ordem = 0;

  for (let i = 0; i < cabecalhoOriginal.length; i++) {
    const colOriginal = cabecalhoOriginal[i];
    const colNorm = cabecalhoNormalizado[i];

    if (COLUNAS_METADADOS_FORMS.has(colNorm) || REGEX_COLUNA_SUBMISSION.test(colNorm)) continue;
    if (REGEX_COLUNA_ACEITE.test(colNorm)) continue;

    const rotulo = limparRotulo(colOriginal);
    if (!rotulo) continue;

    const campoPaciente = MAPA_CADASTRAL[colNorm] || null;

    let tipo: string;
    let obrigatoria = false;

    if (campoPaciente) {
      tipo = TIPO_POR_CAMPO_PACIENTE[campoPaciente] || "TEXTO_CURTO";
      obrigatoria = OBRIGATORIAS_CAMPO_PACIENTE.has(campoPaciente);
    } else if (colOriginal.trim().endsWith(":")) {
      tipo = "TEXTO_LONGO";
    } else if (colNorm === "faz uso de bebidas alcoolicas? com que frequencia?") {
      // Não termina em ":" nem é Sim/Não simples — resposta observada nos
      // dados reais é texto livre ("socialmente", "Pouco"). Decisão
      // explícita do operador (BLOCO F1, coluna que não batia nas regras
      // automáticas): tratar como TEXTO_LONGO.
      tipo = "TEXTO_LONGO";
    } else {
      tipo = "SIM_NAO";
    }

    ordem++;
    perguntas.push({ ordem, rotulo, tipo, obrigatoria, campoPaciente });
  }

  console.log(`Perguntas extraídas da planilha: ${perguntas.length}`);

  const formulario = await prisma.formularioAnamnese.upsert({
    where: { clinicaId_slug: { clinicaId: clinica.id, slug: "anamnese" } },
    update: {
      titulo: "Anamnese",
      textoConsentimento: TEXTO_CONSENTIMENTO,
    },
    create: {
      clinicaId: clinica.id,
      slug: "anamnese",
      titulo: "Anamnese",
      textoConsentimento: TEXTO_CONSENTIMENTO,
    },
  });

  console.log(`FormularioAnamnese: ${formulario.id} (slug=${formulario.slug})`);

  for (const p of perguntas) {
    const existente = await prisma.perguntaFormulario.findFirst({
      where: { formularioId: formulario.id, ordem: p.ordem },
    });
    if (existente) {
      await prisma.perguntaFormulario.update({
        where: { id: existente.id },
        data: {
          rotulo: p.rotulo,
          tipo: p.tipo as never,
          obrigatoria: p.obrigatoria,
          campoPaciente: p.campoPaciente,
        },
      });
    } else {
      await prisma.perguntaFormulario.create({
        data: {
          formularioId: formulario.id,
          ordem: p.ordem,
          rotulo: p.rotulo,
          tipo: p.tipo as never,
          obrigatoria: p.obrigatoria,
          campoPaciente: p.campoPaciente,
        },
      });
    }
  }

  console.log(`Perguntas gravadas/atualizadas: ${perguntas.length}`);

  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("ERRO:", err);
  process.exitCode = 1;
});
