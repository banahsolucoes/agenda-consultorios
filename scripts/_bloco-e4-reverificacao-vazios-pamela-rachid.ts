// Bloco E4 — reverificação (SOMENTE LEITURA) dos elegíveis da fase "vazios"
// de scripts/reprocessar-anamnese.ts, após correção manual de CPFs na
// planilha. Este script NUNCA escreve no banco — não tem flag --executar,
// propositalmente, pra não poder virar um caminho de escrita por engano.
//
// Reusa a mesma leitura/casamento de scripts/reprocessar-anamnese.ts
// (lerEDeduplicarPlanilha, soDigitos, cpfMatematicamenteValido,
// normalizarNome) e adiciona: (1) contagens por categoria, (2) quantos
// passam em --somente-validados (CPF válido + NOME COMPLETO idêntico após
// normalização — mesma regra do script oficial), (3) uma tabela de
// veredito por elegível com CPF válido?/primeiro nome idêntico?/score de
// similaridade (Levenshtein normalizado, 0-100), sem imprimir nome nem
// CPF — só índice da tabela. (4) localização do caso "Ala..." por índice.
//
// Conecta via DIRECT_URL (porta 5432), nunca o pooler.
//
// Uso: npx tsx scripts/_bloco-e4-reverificacao-vazios-pamela-rachid.ts

import "dotenv/config";
import pg from "pg";
import { prisma } from "@/lib/prisma";
import { ErroImportacao, lerEDeduplicarPlanilha, soDigitos, type RegistroPlanilha } from "@/lib/importacao";

const SLUG_CLINICA = "pamela-rachid";

// Mesma validação de scripts/reprocessar-anamnese.ts.
function cpfMatematicamenteValido(cpfDigitos: string): boolean {
  if (!/^\d{11}$/.test(cpfDigitos)) return false;
  if (/^(\d)\1{10}$/.test(cpfDigitos)) return false;

  const digitos = cpfDigitos.split("").map(Number);
  const calcularDv = (base: number[]): number => {
    let soma = 0;
    let peso = base.length + 1;
    for (const d of base) {
      soma += d * peso;
      peso--;
    }
    const resto = soma % 11;
    return resto < 2 ? 0 : 11 - resto;
  };

  if (calcularDv(digitos.slice(0, 9)) !== digitos[9]) return false;
  if (calcularDv(digitos.slice(0, 10)) !== digitos[10]) return false;
  return true;
}

// Mesma normalização de scripts/reprocessar-anamnese.ts.
function normalizarNome(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function primeiroNome(nomeNormalizado: string): string {
  return nomeNormalizado.split(" ")[0] ?? "";
}

// Distância de Levenshtein clássica (DP O(n*m)) — nomes de paciente são
// curtos, sem preocupação de performance.
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const custo = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + custo);
    }
  }
  return dp[m][n];
}

// Score 0-100: 100 = nomes normalizados idênticos, 0 = totalmente diferentes.
function scoreSimilaridade(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 100;
  const dist = levenshtein(a, b);
  return Math.round((1 - dist / maxLen) * 100);
}

interface PacienteRow {
  id: string;
  nome: string;
  cpf: string | null;
  anamnese: string | null;
}

interface Elegivel {
  indice: number;
  id: string;
  nomeSistemaNormalizado: string;
  nomePlanilhaNormalizado: string;
  cpfValido: boolean;
  primeiroNomeIdentico: boolean;
  nomeCompletoIdentico: boolean;
  score: number;
  passaRegraAutomatica: boolean; // CPF válido + nome COMPLETO idêntico (regra oficial de --somente-validados)
}

async function classificar() {
  const clinica = await prisma.clinica.findUnique({ where: { slug: SLUG_CLINICA } });
  if (!clinica) {
    console.error(`ERRO: clínica "${SLUG_CLINICA}" não encontrada`);
    process.exitCode = 1;
    return null;
  }

  let registros: RegistroPlanilha[];
  try {
    ({ registros } = await lerEDeduplicarPlanilha(clinica.id));
  } catch (err) {
    if (err instanceof ErroImportacao) {
      console.error(`ERRO: ${err.message}`);
      process.exitCode = 1;
      return null;
    }
    throw err;
  }

  const porCpf = new Map<string, RegistroPlanilha[]>();
  for (const r of registros) {
    const cpfDigitos = soDigitos(r.cpf || "");
    if (!cpfDigitos) continue;
    const lista = porCpf.get(cpfDigitos) || [];
    lista.push(r);
    porCpf.set(cpfDigitos, lista);
  }

  const client = new pg.Client({ connectionString: process.env.DIRECT_URL });
  await client.connect();
  const { rows: pacientes } = await client.query<PacienteRow>(
    `SELECT id, nome, cpf, anamnese FROM "Paciente" WHERE "clinicaId" = $1`,
    [clinica.id]
  );
  await client.end();

  const semCpf: PacienteRow[] = [];
  const semMatch: PacienteRow[] = [];
  const multiplasLinhas: { p: PacienteRow; linhas: number }[] = [];
  const jaPreenchidos: PacienteRow[] = [];
  const planilhaSemConteudo: PacienteRow[] = [];
  const elegiveisBrutos: { p: PacienteRow; registro: RegistroPlanilha }[] = [];

  for (const p of pacientes) {
    const cpfDigitos = soDigitos(p.cpf || "");
    if (!cpfDigitos) {
      semCpf.push(p);
      continue;
    }
    const matches = porCpf.get(cpfDigitos) || [];
    if (matches.length === 0) {
      semMatch.push(p);
      continue;
    }
    if (matches.length > 1) {
      multiplasLinhas.push({ p, linhas: matches.length });
      continue;
    }
    const registro = matches[0];
    const preenchida = !!p.anamnese && p.anamnese.trim().length > 0;
    if (preenchida) {
      jaPreenchidos.push(p);
      continue;
    }
    if (!registro.anamnese) {
      planilhaSemConteudo.push(p);
      continue;
    }
    elegiveisBrutos.push({ p, registro });
  }

  const elegiveis: Elegivel[] = elegiveisBrutos.map(({ p, registro }, idx) => {
    const cpfDigitos = soDigitos(p.cpf || "");
    const nomeSistemaNorm = normalizarNome(p.nome || "");
    const nomePlanilhaNorm = normalizarNome(registro.nome || "");
    const cpfValido = cpfMatematicamenteValido(cpfDigitos);
    const nomeCompletoIdentico = nomeSistemaNorm === nomePlanilhaNorm;
    const primeiroNomeIdentico = primeiroNome(nomeSistemaNorm) === primeiroNome(nomePlanilhaNorm);
    const score = scoreSimilaridade(nomeSistemaNorm, nomePlanilhaNorm);
    return {
      indice: idx + 1,
      id: p.id,
      nomeSistemaNormalizado: nomeSistemaNorm,
      nomePlanilhaNormalizado: nomePlanilhaNorm,
      cpfValido,
      primeiroNomeIdentico,
      nomeCompletoIdentico,
      score,
      passaRegraAutomatica: cpfValido && nomeCompletoIdentico,
    };
  });

  return {
    clinica,
    totalPacientes: pacientes.length,
    semCpf,
    semMatch,
    multiplasLinhas,
    jaPreenchidos,
    planilhaSemConteudo,
    elegiveis,
    pacientesPorId: new Map(pacientes.map((p) => [p.id, p])),
  };
}

async function main() {
  const resultado = await classificar();
  if (!resultado) return;

  const {
    clinica,
    totalPacientes,
    semCpf,
    semMatch,
    multiplasLinhas,
    jaPreenchidos,
    planilhaSemConteudo,
    elegiveis,
  } = resultado;

  console.log(`Clínica: ${clinica.nome} (${clinica.id})`);
  console.log("Modo: DRY-RUN — nenhuma escrita (script sem --executar)\n");

  console.log("===== 1) --fase=vazios — contagens por categoria =====");
  console.log("total de pacientes na clínica:", totalPacientes);
  console.log("sem CPF:", semCpf.length);
  console.log("sem match na planilha:", semMatch.length);
  console.log("múltiplas linhas na planilha:", multiplasLinhas.length);
  console.log("já preenchidos (fora da fase vazios):", jaPreenchidos.length);
  console.log("linha da planilha sem conteúdo aproveitável:", planilhaSemConteudo.length);
  console.log("ELEGÍVEIS:", elegiveis.length);

  console.log("\n===== 2) --somente-validados — quantos passam na regra automática =====");
  console.log("regra: CPF válido (dígito verificador) + NOME COMPLETO idêntico após normalização");
  const passam = elegiveis.filter((e) => e.passaRegraAutomatica);
  const reprovados = elegiveis.filter((e) => !e.passaRegraAutomatica);
  console.log("passam:", passam.length, "de", elegiveis.length);
  console.log("reprovados:", reprovados.length);

  console.log("\n===== 3) Tabela de veredito por elegível (sem PII) =====");
  console.log("indice | CPF válido? | primeiro nome idêntico? | nome completo idêntico? | score | passa regra automática?");
  for (const e of elegiveis) {
    console.log(
      `${String(e.indice).padStart(3, " ")}    | ${e.cpfValido ? "sim" : "NÃO"}          | ${e.primeiroNomeIdentico ? "sim" : "não"}                     | ${e.nomeCompletoIdentico ? "sim" : "não"}                      | ${String(e.score).padStart(3, " ")}   | ${e.passaRegraAutomatica ? "PASSA" : "reprovado"}`
    );
  }

  console.log('\n===== 4) Caso "Ala..." (primeiro nome do sistema começa com "Ala") =====');
  const casoAla = elegiveis.find((e) => primeiroNome(e.nomeSistemaNormalizado).startsWith("ala"));
  if (!casoAla) {
    // Verifica também fora do conjunto elegível, pra dizer em qual categoria caiu, se caiu em outra.
    const todosBuckets: { nome: string; lista: PacienteRow[] }[] = [
      { nome: "sem CPF", lista: semCpf },
      { nome: "sem match na planilha", lista: semMatch },
      { nome: "múltiplas linhas na planilha", lista: multiplasLinhas.map((m) => m.p) },
      { nome: "já preenchidos", lista: jaPreenchidos },
      { nome: "planilha sem conteúdo aproveitável", lista: planilhaSemConteudo },
    ];
    let achado: string | null = null;
    for (const bucket of todosBuckets) {
      if (bucket.lista.some((p) => primeiroNome(normalizarNome(p.nome || "")).startsWith("ala"))) {
        achado = bucket.nome;
        break;
      }
    }
    if (achado) {
      console.log(`Não está entre os elegíveis. Encontrada na categoria: "${achado}".`);
    } else {
      console.log("Nenhuma paciente com primeiro nome começando com \"Ala\" encontrada em nenhuma categoria.");
    }
  } else {
    console.log(`Elegível — índice ${casoAla.indice} na tabela acima.`);
    console.log(`  CPF válido? ${casoAla.cpfValido ? "sim" : "NÃO"}`);
    console.log(`  primeiro nome idêntico? ${casoAla.primeiroNomeIdentico ? "sim" : "não"}`);
    console.log(`  nome completo idêntico? ${casoAla.nomeCompletoIdentico ? "sim" : "não"}`);
    console.log(`  score de similaridade: ${casoAla.score}`);
    console.log(`  veredito da regra automática: ${casoAla.passaRegraAutomatica ? "PASSA" : "reprovado"}`);
  }

  console.log("\nDRY-RUN — nenhuma escrita realizada. Aguardando decisão sobre o que liberar.");
}

main()
  .catch((err) => {
    console.error("ERRO:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
