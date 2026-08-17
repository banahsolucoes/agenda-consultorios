// Somente leitura. BLOCO E2 — verificação objetiva (CPF, data de nascimento,
// similaridade de nome) dos 24 elegíveis da fase "vazios", clínica
// pamela-rachid, antes de liberar a escrita do BLOCO E. Reusa
// lerEDeduplicarPlanilha()/soDigitos() de src/lib/importacao.ts (mesma
// lógica de match por CPF do reprocessar-anamnese.ts) e leitura de
// pacientes via DIRECT_URL (porta 5432, nunca o pooler). NENHUM
// UPDATE/INSERT/DELETE — este script não tem flag --executar.
//
// Uso: npx tsx scripts/_verificacao-objetiva-vazios-pamela-rachid.ts

import "dotenv/config";
import pg from "pg";
import { prisma } from "@/lib/prisma";
import { lerEDeduplicarPlanilha, soDigitos } from "@/lib/importacao";

function validarCpf(cpfDigitos: string): boolean {
  if (!/^\d{11}$/.test(cpfDigitos)) return false;
  if (/^(\d)\1{10}$/.test(cpfDigitos)) return false; // todos os dígitos iguais

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

  const dv1 = calcularDv(digitos.slice(0, 9));
  if (dv1 !== digitos[9]) return false;
  const dv2 = calcularDv(digitos.slice(0, 10));
  if (dv2 !== digitos[10]) return false;

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
  const dist = levenshtein(na, nb);
  return 1 - dist / maxLen;
}

function normalizarData(s: string): string | null {
  const limpo = s.trim();
  if (!limpo) return null;
  // aceita dd/mm/aaaa, dd-mm-aaaa, aaaa-mm-dd
  let m = limpo.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (m) {
    const [, d, mo, y] = m;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  m = limpo.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) {
    const [, y, mo, d] = m;
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return limpo; // formato desconhecido, compara como string mesmo
}

interface PacienteRow {
  id: string;
  nome: string;
  cpf: string | null;
  anamnese: string | null;
  dataNascimento: string | null;
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
    `SELECT id, nome, cpf, anamnese, "dataNascimento" FROM "Paciente" WHERE "clinicaId" = $1`,
    [clinica.id]
  );

  type Elegivel = {
    idx: number;
    id: string;
    cpfDigitos: string;
    nomeSistema: string;
    nomePlanilha: string;
    dataSistema: string | null;
    dataPlanilha: string | null;
  };

  const elegiveis: Elegivel[] = [];
  for (const p of pacientes) {
    const cpfDigitos = soDigitos(p.cpf || "");
    if (!cpfDigitos) continue;

    const matches = porCpf.get(cpfDigitos) || [];
    if (matches.length !== 1) continue;

    const registro = matches[0];
    const preenchida = !!p.anamnese && p.anamnese.trim().length > 0;
    if (preenchida) continue;
    if (!registro.anamnese) continue;

    elegiveis.push({
      idx: elegiveis.length + 1,
      id: p.id,
      cpfDigitos,
      nomeSistema: p.nome || "",
      nomePlanilha: registro.nome || "",
      dataSistema: p.dataNascimento,
      dataPlanilha: (registro as Record<string, string>).dataNascimento || null,
    });
  }

  console.log(`Total de elegíveis conferidos: ${elegiveis.length} (esperado: 24)\n`);

  // ----- 1. VALIDAÇÃO DE CPF -----
  console.log("----- 1. VALIDAÇÃO DE CPF (dígito verificador) -----");
  const invalidos: number[] = [];
  for (const e of elegiveis) {
    const ok = validarCpf(e.cpfDigitos);
    if (!ok) invalidos.push(e.idx);
  }
  console.log(`CPFs matematicamente inválidos: ${invalidos.length}`);
  if (invalidos.length > 0) console.log(`Índices: ${invalidos.join(", ")}`);
  console.log("");

  // ----- 2. DESEMPATE POR DATA DE NASCIMENTO -----
  console.log("----- 2. DATA DE NASCIMENTO (sistema x planilha) -----");
  const cont = { IGUAL: 0, DIFERENTE: 0, AUSENTE_NO_BANCO: 0, AUSENTE_NA_PLANILHA: 0 };
  const diferentes: number[] = [];
  const classificacoes: { idx: number; classe: string }[] = [];
  for (const e of elegiveis) {
    const dSistema = e.dataSistema ? normalizarData(e.dataSistema) : null;
    const dPlanilha = e.dataPlanilha ? normalizarData(e.dataPlanilha) : null;

    let classe: keyof typeof cont;
    if (!dSistema && !dPlanilha) {
      classe = "AUSENTE_NO_BANCO"; // ambas ausentes: prioriza sinalizar banco vazio
    } else if (!dSistema) {
      classe = "AUSENTE_NO_BANCO";
    } else if (!dPlanilha) {
      classe = "AUSENTE_NA_PLANILHA";
    } else if (dSistema === dPlanilha) {
      classe = "IGUAL";
    } else {
      classe = "DIFERENTE";
      diferentes.push(e.idx);
    }
    cont[classe]++;
    classificacoes.push({ idx: e.idx, classe });
  }
  console.log(`IGUAL: ${cont.IGUAL}`);
  console.log(`DIFERENTE: ${cont.DIFERENTE}`);
  console.log(`AUSENTE_NO_BANCO: ${cont.AUSENTE_NO_BANCO}`);
  console.log(`AUSENTE_NA_PLANILHA: ${cont.AUSENTE_NA_PLANILHA}`);
  if (diferentes.length > 0) console.log(`Índices DIFERENTE: ${diferentes.join(", ")}`);
  console.log("");

  const e9 = elegiveis.find((e) => e.idx === 9);
  const e10 = elegiveis.find((e) => e.idx === 10);
  console.log("Confirmação específica #9 e #10:");
  for (const e of [e9, e10]) {
    if (!e) continue;
    const classe = classificacoes.find((c) => c.idx === e.idx)?.classe;
    console.log(`  #${e.idx}: classe=${classe}`);
  }
  console.log("");

  // ----- 3. SIMILARIDADE DE NOME COMPLETO -----
  console.log("----- 3. SIMILARIDADE DE NOME (Levenshtein normalizado, 0-1) -----");
  for (const e of elegiveis) {
    const sim = similaridadeNormalizada(e.nomeSistema, e.nomePlanilha);
    console.log(`#${e.idx}: similaridade=${sim.toFixed(3)}`);
  }

  await client.end();
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("ERRO:", err);
  process.exitCode = 1;
});
