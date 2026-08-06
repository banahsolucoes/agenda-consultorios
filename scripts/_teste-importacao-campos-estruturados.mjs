// Teste de validação (clinica-teste, não produção) do bloco "persistência de
// campos estruturados no importador" — POST /api/importacao/executar não dá
// pra exercitar via HTTP real porque clinica-teste não tem planilha do
// Google Sheets configurada (sheetsPlanilhaId null, Google desconectado).
// Este script reaplica exatamente a mesma lógica de mapeamento
// registro -> data do Prisma (cópia fiel de
// src/app/api/importacao/executar/route.ts) contra dois registros
// sintéticos — um com os 6 campos preenchidos, outro vazio — grava de fato
// em clinica-teste via prisma.paciente.create, confere o resultado, e
// remove os dois pacientes de teste ao final.
//
// Conecta via DIRECT_URL (porta 5432).
//
// Uso: node scripts/_teste-importacao-campos-estruturados.mjs

import "dotenv/config";
import { PrismaClient } from "../src/generated/prisma/index.js";
import { PrismaPg } from "@prisma/adapter-pg";

if (!process.env.DIRECT_URL) {
  console.error("DIRECT_URL não definida no ambiente.");
  process.exit(1);
}

const adapter = new PrismaPg({ connectionString: process.env.DIRECT_URL });
const prisma = new PrismaClient({ adapter });

function normalizarVazio(valor) {
  return valor === "" ? null : valor;
}

const DATA_NASCIMENTO_BR_REGEX = /^\d{2}\/\d{2}\/\d{4}$/;

function montarData(clinicaId, registro) {
  const dataNascimento = normalizarVazio(registro.dataNascimento) ?? null;
  const avisoFormato = dataNascimento && !DATA_NASCIMENTO_BR_REGEX.test(dataNascimento);
  return {
    data: {
      clinicaId,
      nome: registro.nome,
      telefone: registro.telefone || null,
      email: registro.email || null,
      cpf: (registro.cpf || "").replace(/\D/g, "") || null,
      logradouro: registro.logradouro || null,
      cep: registro.cep || null,
      quemIndicou: registro.quemIndicou || null,
      rg: normalizarVazio(registro.rg) ?? null,
      dataNascimento,
      estadoCivil: normalizarVazio(registro.estadoCivil) ?? null,
      nacionalidade: normalizarVazio(registro.nacionalidade) ?? null,
      profissao: normalizarVazio(registro.profissao) ?? null,
      instagram: normalizarVazio(registro.instagram) ?? null,
      origemCadastro: "FORMS",
      horarioFixo: "09:00",
      statusGeral: "ATIVO",
      anamnese: registro.anamnese || null,
    },
    avisoFormato,
  };
}

async function main() {
  const clinica = await prisma.clinica.findFirst({ where: { slug: "clinica-teste" } });
  if (!clinica) {
    console.error("Clínica de teste (slug=clinica-teste) não encontrada — abortando.");
    process.exit(1);
  }
  console.log(`Clínica de teste: ${clinica.nome} (${clinica.id})`);

  const registroCompleto = {
    nome: "Teste Importação Completo",
    cpf: "11144477735", // CPF matematicamente válido (uso didático padrão)
    telefone: "11999998888",
    email: "teste.completo@example.com",
    logradouro: "Rua Teste, 123",
    cep: "01000000",
    quemIndicou: "Fulano",
    rg: "123456789",
    dataNascimento: "15/03/1990",
    estadoCivil: "Solteira",
    nacionalidade: "Brasileira",
    profissao: "Engenheira",
    instagram: "@teste_completo",
    anamnese: "Nome Completo: Teste Importação Completo\nSeu RG: 123456789\n\n--- OBSERVAÇÕES ---\n",
  };

  const registroVazio = {
    nome: "Teste Importação Vazio",
    cpf: "22233344405", // outro CPF de teste, dígito verificador ok
    telefone: "",
    email: "",
    logradouro: "",
    cep: "",
    quemIndicou: "",
    rg: "",
    dataNascimento: "",
    estadoCivil: "",
    nacionalidade: "",
    profissao: "",
    instagram: "",
    anamnese: "",
  };

  const registroFormatoRuim = {
    nome: "Teste Importação Data Ruim",
    cpf: "33322211100",
    dataNascimento: "1990-03-15", // formato ISO, não DD/MM/AAAA — deve gravar como veio + avisar
    rg: "",
    estadoCivil: "",
    nacionalidade: "",
    profissao: "",
    instagram: "",
    anamnese: "",
  };

  const idsCriados = [];
  try {
    for (const [rotulo, registro] of [
      ["COMPLETO", registroCompleto],
      ["VAZIO", registroVazio],
      ["FORMATO RUIM", registroFormatoRuim],
    ]) {
      const { data, avisoFormato } = montarData(clinica.id, registro);
      console.log(`\n=== Criando paciente de teste: ${rotulo} ===`);
      if (avisoFormato) {
        console.log(`  ⚠ aviso de formato: dataNascimento="${data.dataNascimento}" fora de DD/MM/AAAA — gravando como veio`);
      }
      const criado = await prisma.paciente.create({ data });
      idsCriados.push(criado.id);
      console.log(`  criado: ${criado.id}`);

      const lido = await prisma.paciente.findUnique({
        where: { id: criado.id },
        select: {
          rg: true, dataNascimento: true, estadoCivil: true, nacionalidade: true,
          profissao: true, instagram: true, anamnese: true,
        },
      });
      console.log("  colunas gravadas:", JSON.stringify(lido, null, 2));
    }

    console.log("\n=== Verificação ===");
    const completo = await prisma.paciente.findUnique({ where: { id: idsCriados[0] } });
    const okCompleto =
      completo.rg === "123456789" &&
      completo.dataNascimento === "15/03/1990" &&
      completo.estadoCivil === "Solteira" &&
      completo.nacionalidade === "Brasileira" &&
      completo.profissao === "Engenheira" &&
      completo.instagram === "@teste_completo" &&
      completo.anamnese && completo.anamnese.length > 0;
    console.log(`Caso COMPLETO — todas as 6 colunas + anamnese preenchidas: ${okCompleto ? "OK" : "FALHOU"}`);

    const vazio = await prisma.paciente.findUnique({ where: { id: idsCriados[1] } });
    const okVazio =
      vazio.rg === null &&
      vazio.dataNascimento === null &&
      vazio.estadoCivil === null &&
      vazio.nacionalidade === null &&
      vazio.profissao === null &&
      vazio.instagram === null;
    console.log(`Caso VAZIO — todas as 6 colunas null, sem erro: ${okVazio ? "OK" : "FALHOU"}`);

    const formatoRuim = await prisma.paciente.findUnique({ where: { id: idsCriados[2] } });
    const okFormato = formatoRuim.dataNascimento === "1990-03-15";
    console.log(`Caso FORMATO RUIM — gravado como veio (sem normalizar): ${okFormato ? "OK" : "FALHOU"}`);

    console.log(`\n=== RESULTADO GERAL: ${okCompleto && okVazio && okFormato ? "PASSOU" : "FALHOU"} ===`);
  } finally {
    if (idsCriados.length > 0) {
      await prisma.paciente.deleteMany({ where: { id: { in: idsCriados } } });
      console.log(`\nLimpeza concluída: ${idsCriados.length} paciente(s) de teste removido(s).`);
    }
  }
}

main()
  .catch((err) => {
    console.error("ERRO:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
