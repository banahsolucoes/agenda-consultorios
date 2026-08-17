// Somente leitura. Gera scripts/_conferencia-cpf-pamela.csv com os 17
// registros da fase "vazios" (clínica pamela-rachid) que NÃO foram
// executados pelo --somente-validados do BLOCO E3, para conferência manual
// da Daiane. Mesma lógica de match/validação do reprocessar-anamnese.ts e
// do script auxiliar do Bloco E2. NENHUM UPDATE/INSERT/DELETE.
//
// Uso: npx tsx scripts/_gerar-csv-conferencia-pamela.ts

import "dotenv/config";
import fs from "node:fs";
import pg from "pg";
import { prisma } from "@/lib/prisma";
import { lerEDeduplicarPlanilha, soDigitos } from "@/lib/importacao";

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

function normalizarNome(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

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

function similaridadeNormalizada(a: string, b: string): number {
  const na = normalizarNome(a);
  const nb = normalizarNome(b);
  const maxLen = Math.max(na.length, nb.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(na, nb) / maxLen;
}

function csvEscape(v: string): string {
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

interface PacienteRow {
  id: string;
  nome: string;
  cpf: string | null;
  anamnese: string | null;
}

async function main() {
  const slug = "pamela-rachid";
  const clinica = await prisma.clinica.findUnique({ where: { slug } });
  if (!clinica) {
    console.error(`ERRO: clínica "${slug}" não encontrada`);
    process.exitCode = 1;
    return;
  }

  const { registros } = await lerEDeduplicarPlanilha(clinica.id);
  const porCpf = new Map<string, typeof registros>();
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

  const linhas: string[] = [
    "indice;motivo;nome_no_sistema;nome_na_planilha;cpf_cadastrado;similaridade;APROVAR_SIM_NAO",
  ];

  let idx = 0;
  let naoExecutados = 0;
  for (const p of pacientes) {
    const cpfDigitos = soDigitos(p.cpf || "");
    if (!cpfDigitos) continue;

    const matches = porCpf.get(cpfDigitos) || [];
    if (matches.length !== 1) continue;

    const registro = matches[0];
    const preenchida = !!p.anamnese && p.anamnese.trim().length > 0;
    if (preenchida) continue;
    if (!registro.anamnese) continue;

    idx++;

    const cpfOk = cpfMatematicamenteValido(cpfDigitos);
    const sim = similaridadeNormalizada(p.nome || "", registro.nome || "");
    const nomeOk = sim === 1;
    if (cpfOk && nomeOk) continue; // esse foi executado no BLOCO E3

    naoExecutados++;
    const motivo = !cpfOk ? "CPF_INVALIDO" : "NOME_DIVERGENTE";
    linhas.push(
      [
        String(idx),
        motivo,
        csvEscape(p.nome || ""),
        csvEscape(registro.nome || ""),
        csvEscape(p.cpf || ""),
        sim.toFixed(3),
        "",
      ].join(";")
    );
  }

  const caminho = "scripts/_conferencia-cpf-pamela.csv";
  fs.writeFileSync(caminho, linhas.join("\n") + "\n", "utf8");
  console.log(`Arquivo gerado: ${caminho}`);
  console.log(`Linhas de dados (excluindo cabeçalho): ${naoExecutados}`);

  await client.end();
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("ERRO:", err);
  process.exitCode = 1;
});
