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
    "Seu CPF",
    "Seu RG",
    "Telefone (WhatsApp)",
    "Telefone",
    "E-mail",
    "Endereço Completo",
    "CEP",
    "Seu Instagram",
    "Data de Nascimento",
  ].map((s) => s.toLowerCase())
);

// Segurança adicional além do match por rótulo: qualquer sequência que
// pareça CPF (11 dígitos, com ou sem pontuação), telefone (10-11 dígitos)
// ou e-mail, em QUALQUER posição do texto — inclusive dentro de respostas
// livres onde o paciente pode ter digitado o próprio contato.
const REGEX_CPF_OU_TELEFONE = /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b|\b\d{10,11}\b/g;
const REGEX_EMAIL = /[\w.+-]+@[\w-]+\.[a-zA-Z]{2,}/g;

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

// TODA saída de amostra/diff do script passa obrigatoriamente por aqui —
// nenhum caminho pode imprimir texto de anamnese/campo de paciente sem
// redigir antes. Duas camadas: (1) linhas cujo rótulo é PII conhecida viram
// "[REDIGIDO]" por inteiro; (2) por segurança adicional, qualquer trecho do
// texto (mesmo fora de um rótulo mapeado) que pareça CPF/telefone/e-mail
// também é substituído.
function redigir(texto: string): string {
  const porRotulo = texto
    .split("\n")
    .map((linha) => {
      const idx = linha.indexOf(": ");
      if (idx === -1) return linha;
      const rotulo = linha.slice(0, idx).trim().toLowerCase();
      if (CAMPOS_PII_ROTULOS.has(rotulo)) return `${linha.slice(0, idx)}: [REDIGIDO]`;
      return linha;
    })
    .join("\n");

  return porRotulo.replace(REGEX_CPF_OU_TELEFONE, "[REDIGIDO]").replace(REGEX_EMAIL, "[REDIGIDO]");
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
  const semMudanca: string[] = [];
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

    // Nada a reescrever: se não há observação nenhuma abaixo do separador
    // E o trecho acima já é byte-idêntico ao que montarAnamnese produziria
    // agora, gravar de novo seria um no-op — pula, sem contar como
    // elegível. Isso torna reexecutar a fase inofensivo (evita o
    // reprocessamento em cascata quando "vazios" acabou de preencher o
    // mesmo registro na mesma sessão).
    const conteudoAtual = anamneseAtual!.slice(0, idxAntigo);
    const conteudoNovo = registro.anamnese.slice(0, idxNovo);
    const abaixoAtual = anamneseAtual!.slice(idxAntigo + MARCA_OBSERVACOES.length).trim();
    if (abaixoAtual.length === 0 && conteudoAtual === conteudoNovo) {
      semMudanca.push(p.id);
      continue;
    }

    const preservado = anamneseAtual!.slice(idxAntigo);
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
    console.log("sem mudança a aplicar (já reprocessado, nada a reescrever):", semMudanca.length);
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
