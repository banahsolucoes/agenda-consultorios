// Reprocessamento retroativo do texto da anamnese (Bloco B) — usa
// montarAnamnese()/lerEDeduplicarPlanilha() (src/lib/importacao.ts) já
// existentes, nunca reimplementa leitura de planilha nem OAuth. Casamento
// planilha <-> paciente é SOMENTE por CPF (soDigitos). Leitura/escrita dos
// pacientes sempre via DIRECT_URL (porta 5432, nunca o pooler) — mesmo
// padrão dos demais scripts de backfill deste projeto.
//
// Uso:
//   npx tsx scripts/reprocessar-anamnese.ts --clinica=<slug> --fase=vazios|preenchidos [--executar]
//
// Sem --executar (padrão): dry-run, nenhuma escrita. Com --executar: grava
// backup em scripts/_backup-anamnese-<clinica>-<timestamp>.json (nunca
// commitado, ver .gitignore) antes de qualquer UPDATE.
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { prisma } from "@/lib/prisma";
import { ErroImportacao, lerEDeduplicarPlanilha, soDigitos, type RegistroPlanilha } from "@/lib/importacao";

const MARCA_OBSERVACOES = "--- OBSERVAÇÕES ---";

const CAMPOS_PII_ROTULOS = new Set(
  [
    "Nome Completo",
    "E-mail",
    "Endereço Completo",
    "Seu RG",
    "Seu CPF",
    "Telefone (WhatsApp)",
    "Telefone",
    "Seu Instagram",
  ].map((s) => s.toLowerCase())
);

function parseArgs(): { clinica: string; fase: "vazios" | "preenchidos"; executar: boolean } {
  const args = process.argv.slice(2);
  const get = (nome: string): string | undefined => {
    const prefixo = `--${nome}=`;
    const achado = args.find((a) => a.startsWith(prefixo));
    return achado ? achado.slice(prefixo.length) : undefined;
  };

  const clinica = get("clinica");
  const fase = get("fase");
  const executar = args.includes("--executar");

  if (!clinica) throw new Error("--clinica=<slug> é obrigatório");
  if (fase !== "vazios" && fase !== "preenchidos") {
    throw new Error('--fase=vazios|preenchidos é obrigatório');
  }
  return { clinica, fase, executar };
}

// Só usada no relatório do dry-run — troca as linhas cadastrais sensíveis
// por [REDIGIDO], preserva o resto pra mostrar a estrutura.
function redigir(texto: string): string {
  return texto
    .split("\n")
    .map((linha) => {
      const idx = linha.indexOf(": ");
      if (idx === -1) return linha;
      const rotulo = linha.slice(0, idx).trim().toLowerCase();
      if (CAMPOS_PII_ROTULOS.has(rotulo)) return `${linha.slice(0, idx)}: [REDIGIDO]`;
      return linha;
    })
    .join("\n");
}

interface PacienteRow {
  id: string;
  cpf: string | null;
  anamnese: string | null;
}

async function main() {
  const { clinica: slug, fase, executar } = parseArgs();

  const clinica = await prisma.clinica.findUnique({ where: { slug } });
  if (!clinica) {
    console.error(`ERRO: clínica "${slug}" não encontrada`);
    process.exitCode = 1;
    return;
  }

  console.log(`Clínica: ${clinica.nome} (${clinica.id})`);
  console.log(`Fase: ${fase}`);
  console.log(`Modo: ${executar ? "EXECUÇÃO (grava no banco)" : "DRY-RUN (nenhuma escrita)"}`);
  console.log("");

  let registros: RegistroPlanilha[];
  try {
    ({ registros } = await lerEDeduplicarPlanilha(clinica.id));
  } catch (err) {
    if (err instanceof ErroImportacao) {
      console.error(`ERRO: ${err.message}`);
      process.exitCode = 1;
      return;
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
    `SELECT id, cpf, anamnese FROM "Paciente" WHERE "clinicaId" = $1`,
    [clinica.id]
  );

  const semCpf: string[] = [];
  const semMatch: string[] = [];
  const multiplasLinhas: { id: string; linhas: number }[] = [];
  const foraDeFase: string[] = [];
  const semSeparador: string[] = [];
  const planilhaSemConteudo: string[] = [];
  const elegiveis: { id: string; novoTexto: string }[] = [];

  for (const p of pacientes) {
    const cpfDigitos = soDigitos(p.cpf || "");
    if (!cpfDigitos) {
      semCpf.push(p.id);
      continue;
    }

    const matches = porCpf.get(cpfDigitos) || [];
    if (matches.length === 0) {
      semMatch.push(p.id);
      continue;
    }
    if (matches.length > 1) {
      multiplasLinhas.push({ id: p.id, linhas: matches.length });
      continue;
    }

    const registro = matches[0];
    const anamneseAtual = p.anamnese;
    const preenchida = !!anamneseAtual && anamneseAtual.trim().length > 0;

    if (fase === "vazios") {
      if (preenchida) {
        foraDeFase.push(p.id);
        continue;
      }
      if (!registro.anamnese) {
        planilhaSemConteudo.push(p.id);
        continue;
      }
      elegiveis.push({ id: p.id, novoTexto: registro.anamnese });
      continue;
    }

    // fase === "preenchidos"
    if (!preenchida) {
      foraDeFase.push(p.id);
      continue;
    }
    const idxAntigo = anamneseAtual!.indexOf(MARCA_OBSERVACOES);
    if (idxAntigo === -1) {
      semSeparador.push(p.id);
      continue;
    }
    const idxNovo = registro.anamnese.indexOf(MARCA_OBSERVACOES);
    if (idxNovo === -1) {
      planilhaSemConteudo.push(p.id);
      continue;
    }

    const preservado = anamneseAtual!.slice(idxAntigo);
    const conteudoNovo = registro.anamnese.slice(0, idxNovo);
    const novoTexto = conteudoNovo + preservado;

    // Garantia obrigatória: o que está abaixo do separador nunca pode mudar.
    const idxVerificacao = novoTexto.indexOf(MARCA_OBSERVACOES);
    const abaixoDepois = idxVerificacao === -1 ? null : novoTexto.slice(idxVerificacao);
    if (abaixoDepois !== preservado) {
      console.error(`ABORTADO (divergência abaixo do separador, não gravado): paciente ${p.id}`);
      continue;
    }

    elegiveis.push({ id: p.id, novoTexto });
  }

  console.log("----- CONTAGENS -----");
  console.log("total de pacientes na clínica:", pacientes.length);
  console.log("sem CPF (nunca tocado):", semCpf.length);
  console.log("CPF sem linha correspondente na planilha (nunca tocado):", semMatch.length);
  console.log("CPF com múltiplas linhas na planilha (nunca tocado):", multiplasLinhas.length);
  multiplasLinhas.forEach((m) => console.log(`  - ${m.id}: ${m.linhas} linhas`));
  console.log("fora da fase atual (não elegível para esta fase):", foraDeFase.length);
  if (fase === "preenchidos") {
    console.log(`sem marca "${MARCA_OBSERVACOES}" (formato antigo, nunca tocado):`, semSeparador.length);
    semSeparador.forEach((id) => console.log(`  - ${id}`));
  }
  console.log("linha da planilha sem conteúdo aproveitável:", planilhaSemConteudo.length);
  console.log("ELEGÍVEIS para escrita:", elegiveis.length);

  console.log("\n----- AMOSTRA (até 2 registros elegíveis, PII redigida) -----");
  for (const e of elegiveis.slice(0, 2)) {
    const antes = pacientes.find((p) => p.id === e.id)?.anamnese ?? null;
    console.log(`\nPaciente ${e.id}`);
    console.log("--- ANTES ---");
    console.log(antes ? redigir(antes) : "(vazio)");
    console.log("--- DEPOIS ---");
    console.log(redigir(e.novoTexto));
  }

  if (!executar) {
    console.log("\nDRY-RUN — nenhuma escrita realizada. Rode com --executar para gravar.");
    await client.end();
    await prisma.$disconnect();
    return;
  }

  if (elegiveis.length === 0) {
    console.log("\nNada elegível para gravar.");
    await client.end();
    await prisma.$disconnect();
    return;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join("scripts", `_backup-anamnese-${slug}-${timestamp}.json`);
  const backup = elegiveis.map((e) => ({
    id: e.id,
    anamnese: pacientes.find((p) => p.id === e.id)?.anamnese ?? null,
  }));
  fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2), "utf8");
  console.log(`\nBackup gravado em ${backupPath} (${backup.length} registro(s)) — nunca commitar.`);

  let gravados = 0;
  for (const e of elegiveis) {
    await client.query(`UPDATE "Paciente" SET anamnese = $1 WHERE id = $2 AND "clinicaId" = $3`, [
      e.novoTexto,
      e.id,
      clinica.id,
    ]);
    gravados++;
  }
  console.log(`${gravados} paciente(s) atualizado(s).`);

  await client.end();
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("ERRO:", err);
  process.exitCode = 1;
});
