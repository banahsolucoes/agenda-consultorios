import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { registrarLog } from "@/lib/auditoria";
import { ErroImportacao, lerEDeduplicarPlanilha, soDigitos } from "@/lib/importacao";
import { normalizarVazio } from "@/lib/validacao";

// Formato esperado de "Data de Nascimento" na planilha do Forms
// (brasileiro, DD/MM/AAAA). Paciente.dataNascimento é String? — não há
// parse/conversão pra Date em lugar nenhum do app (mesmo padrão de
// POST /api/pacientes, que também grava a string crua). Fora desse
// formato, o valor é gravado do mesmo jeito (nunca normalizado
// silenciosamente) — só vira aviso no log da importação, pra alguém
// revisar manualmente se quiser.
const DATA_NASCIMENTO_BR_REGEX = /^\d{2}\/\d{2}\/\d{4}$/;

// POST /api/importacao/executar — lê e deduplica a planilha configurada na
// clínica do usuário logado, e cria os pacientes marcados como "novo" cujo
// CPF normalizado está entre os selecionados pelo cliente. clinicaId vem
// sempre de getUsuarioLogado(), nunca do body — o único dado que vem do
// cliente é a lista de CPFs usada como seletor; todos os campos cadastrais
// vêm da planilha lida no servidor, nunca do body.
export async function POST(req: NextRequest) {
  const usuario = await getUsuarioLogado();
  if (!usuario) {
    return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const cpfsSelecionados = new Set(
    (Array.isArray(body?.cpfs) ? body.cpfs : [])
      .map((cpf: unknown) => soDigitos(String(cpf ?? "")))
      .filter(Boolean)
  );
  if (cpfsSelecionados.size === 0) {
    return NextResponse.json({ erro: "selecione ao menos um paciente para importar" }, { status: 400 });
  }

  try {
    const { registros } = await lerEDeduplicarPlanilha(usuario.clinicaId);
    const novos = registros.filter(
      (r) => r.status === "novo" && cpfsSelecionados.has(soDigitos(r.cpf || ""))
    );

    let criados = 0;
    let pulados = 0;
    let erros = 0;
    const avisosFormatoData: string[] = [];

    for (const registro of novos) {
      try {
        // Campos cadastrais que até 2026-08-06 só entravam no texto da
        // anamnese, nunca nas colunas próprias (achado da investigação do
        // caso Thaís Siqueira — ver ARCHITECTURE.md) — passam a ser
        // persistidos aqui também, em adição ao texto (que continua
        // intacto). Contrato de três estados (normalizarVazio): coluna
        // ausente na planilha ou célula vazia grava null, nunca "".
        const dataNascimento = (normalizarVazio(registro.dataNascimento) as string | null) ?? null;
        if (dataNascimento && !DATA_NASCIMENTO_BR_REGEX.test(dataNascimento)) {
          avisosFormatoData.push(`${registro.nome} (CPF ${soDigitos(registro.cpf || "") || "sem CPF"}): "${dataNascimento}"`);
        }

        await prisma.paciente.create({
          data: {
            clinicaId: usuario.clinicaId,
            nome: registro.nome,
            telefone: registro.telefone || null,
            email: registro.email || null,
            cpf: soDigitos(registro.cpf || "") || null,
            logradouro: registro.logradouro || null,
            cep: registro.cep || null,
            quemIndicou: registro.quemIndicou || null,
            rg: (normalizarVazio(registro.rg) as string | null) ?? null,
            // Sem parse — gravado como veio da planilha (string crua, formato
            // brasileiro DD/MM/AAAA esperado, mas não validado nem
            // convertido; ver DATA_NASCIMENTO_BR_REGEX acima).
            dataNascimento,
            estadoCivil: (normalizarVazio(registro.estadoCivil) as string | null) ?? null,
            nacionalidade: (normalizarVazio(registro.nacionalidade) as string | null) ?? null,
            profissao: (normalizarVazio(registro.profissao) as string | null) ?? null,
            instagram: (normalizarVazio(registro.instagram) as string | null) ?? null,
            origemCadastro: "FORMS",
            horarioFixo: "09:00",
            statusGeral: "ATIVO",
            // Só grava na criação — o dedupe por CPF já pula pacientes
            // existentes, então isso nunca sobrescreve observações que a
            // clínica já tenha editado na ficha.
            anamnese: registro.anamnese || null,
          },
        });
        criados++;
      } catch (err) {
        // P2002 = violação de constraint única (corrida entre o dedupe e a
        // criação, ex.: duas importações/cadastros concorrentes com o mesmo
        // CPF) — rede de segurança, conta como pulado e segue pro próximo.
        const codigo = (err as { code?: string } | null)?.code;
        if (codigo === "P2002") {
          pulados++;
        } else {
          console.error("Falha ao criar paciente importado:", err);
          erros++;
        }
      }
    }

    await registrarLog(
      usuario.clinicaId,
      usuario.id,
      "IMPORTACAO_SHEETS",
      `Importação de planilha executada: ${criados} criados, ${pulados} pulados, ${erros} erros` +
        (avisosFormatoData.length > 0
          ? ` — data de nascimento fora do formato DD/MM/AAAA (gravada como veio, sem normalizar): ${avisosFormatoData.join("; ")}`
          : "")
    );

    return NextResponse.json({ criados, pulados, erros, avisosFormatoData });
  } catch (err) {
    if (err instanceof ErroImportacao) {
      return NextResponse.json({ erro: err.message }, { status: 400 });
    }
    console.error("Falha inesperada ao executar a importação:", err);
    return NextResponse.json({ erro: "Não foi possível concluir a importação." }, { status: 500 });
  }
}
