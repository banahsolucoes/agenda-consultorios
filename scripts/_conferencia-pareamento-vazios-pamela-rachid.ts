// Somente leitura. Conferência de pareamento (paciente x linha da planilha)
// para o BLOCO E — reprocessamento da fase "vazios" da anamnese, clínica
// pamela-rachid. Reusa lerEDeduplicarPlanilha()/soDigitos() de
// src/lib/importacao.ts (mesma lógica de match por CPF do
// reprocessar-anamnese.ts) e a leitura de pacientes via DIRECT_URL (porta
// 5432, nunca o pooler). Nenhum UPDATE/INSERT/DELETE.
//
// Uso: npx tsx scripts/_conferencia-pareamento-vazios-pamela-rachid.ts

import "dotenv/config";
import pg from "pg";
import { prisma } from "@/lib/prisma";
import { lerEDeduplicarPlanilha, soDigitos } from "@/lib/importacao";

// Mesma camada de segurança adicional do redigir() em reprocessar-anamnese.ts:
// qualquer sequência que pareça CPF/telefone/e-mail na linha final é
// substituída, como rede de segurança extra sobre o truncamento manual.
const REGEX_CPF_OU_TELEFONE = /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b|\b\d{10,11}\b/g;
const REGEX_EMAIL = /[\w.+-]+@[\w-]+\.[a-zA-Z]{2,}/g;
function redigirCamadaAdicional(texto: string): string {
  return texto.replace(REGEX_CPF_OU_TELEFONE, "[REDIGIDO]").replace(REGEX_EMAIL, "[REDIGIDO]");
}

function truncar3x3(s: string): string {
  const limpo = s.trim();
  if (limpo.length <= 6) return limpo;
  return `${limpo.slice(0, 3)}...${limpo.slice(-3)}`;
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

  console.log("----- CONFERÊNCIA DE PAREAMENTO (fase=vazios) -----\n");

  let contagem = 0;
  for (const p of pacientes) {
    const cpfDigitos = soDigitos(p.cpf || "");
    if (!cpfDigitos) continue;

    const matches = porCpf.get(cpfDigitos) || [];
    if (matches.length !== 1) continue;

    const registro = matches[0];
    const preenchida = !!p.anamnese && p.anamnese.trim().length > 0;
    if (preenchida) continue; // fora da fase "vazios"
    if (!registro.anamnese) continue; // sem conteúdo aproveitável

    contagem++;
    const nomeSistema = truncar3x3(p.nome || "");
    const nomePlanilha = truncar3x3(registro.nome || "");
    const cpfPrefixo = `${cpfDigitos.slice(0, 3)}********`;

    let linha = `${contagem}. sistema="${nomeSistema}" | planilha="${nomePlanilha}" | cpf=${cpfPrefixo}`;
    linha = redigirCamadaAdicional(linha);

    // Comparação grosseira: mesma inicial e mesma terminação sugerem a
    // mesma pessoa; qualquer divergência visível é destacada para revisão
    // humana (o script não decide, só sinaliza).
    const iniSistema = (p.nome || "").trim().slice(0, 1).toLowerCase();
    const iniPlanilha = (registro.nome || "").trim().slice(0, 1).toLowerCase();
    if (iniSistema && iniPlanilha && iniSistema !== iniPlanilha) {
      linha += "  <<< DIVERGÊNCIA: iniciais diferentes, CONFERIR";
    }

    console.log(linha);
  }

  console.log(`\nTotal de linhas elegíveis conferidas: ${contagem}`);

  await client.end();
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("ERRO:", err);
  process.exitCode = 1;
});
