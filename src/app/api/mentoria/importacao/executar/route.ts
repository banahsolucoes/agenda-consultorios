import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { exigirAcessoMentoria } from "@/lib/mentoria";
import { ErroImportacao, soDigitos } from "@/lib/importacao";
import { lerEDeduplicarPlanilhaMentoria, parseDataBR } from "@/lib/importacaoMentoria";

// POST /api/mentoria/importacao/executar — lê e deduplica a planilha fixa de
// clientes da Mentoria e cria os alunos marcados como "novo" cujo CPF
// normalizado está entre os selecionados pelo cliente. clinicaId vem sempre
// de getUsuarioLogado(), nunca do body — o único dado que vem do cliente é a
// lista de CPFs usada como seletor; todos os campos cadastrais vêm da
// planilha lida no servidor, nunca do body.
export async function POST(req: NextRequest) {
  const usuario = await getUsuarioLogado();
  if (!usuario) {
    return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  }
  const erroAcesso = await exigirAcessoMentoria(usuario);
  if (erroAcesso) return erroAcesso;

  const body = await req.json().catch(() => null);
  const cpfsSelecionados = new Set(
    (Array.isArray(body?.cpfs) ? body.cpfs : [])
      .map((cpf: unknown) => soDigitos(String(cpf ?? "")))
      .filter(Boolean)
  );
  if (cpfsSelecionados.size === 0) {
    return NextResponse.json({ erro: "selecione ao menos um cliente para importar" }, { status: 400 });
  }

  try {
    const { registros } = await lerEDeduplicarPlanilhaMentoria(usuario.clinicaId);
    const novos = registros.filter(
      (r) => r.status === "novo" && cpfsSelecionados.has(soDigitos(r.cpf || ""))
    );

    let criados = 0;
    let pulados = 0;
    let erros = 0;

    for (const registro of novos) {
      try {
        await prisma.mentoriaAluno.create({
          data: {
            clinicaId: usuario.clinicaId,
            nomeCompleto: registro.nomeCompleto,
            cpf: soDigitos(registro.cpf || "") || null,
            email: registro.email || null,
            telefone: registro.telefone || null,
            rg: registro.rg || null,
            estadoCivil: registro.estadoCivil || null,
            profissao: registro.profissao || null,
            nacionalidade: registro.nacionalidade || null,
            enderecoCompleto: registro.enderecoCompleto || null,
            cep: registro.cep || null,
            cidadeUf: registro.cidadeUf || null,
            dataNascimento: parseDataBR(registro.dataNascimento || ""),
            aceiteTermos: registro.aceiteTermosTexto ? registro.aceiteTermosTexto.trim() !== "" : null,
            aceiteTermosTexto: registro.aceiteTermosTexto || null,
            submitter: registro.submitter || null,
            submissionData: parseDataBR(registro.submissionData || ""),
            submissionId: registro.submissionId || null,
          },
        });
        criados++;
      } catch (err) {
        // P2002 = violação de constraint única (corrida entre o dedupe e a
        // criação) — rede de segurança, conta como pulado e segue pro próximo.
        const codigo = (err as { code?: string } | null)?.code;
        if (codigo === "P2002") {
          pulados++;
        } else {
          console.error("Falha ao criar cliente de Mentoria importado:", err);
          erros++;
        }
      }
    }

    return NextResponse.json({ criados, pulados, erros });
  } catch (err) {
    if (err instanceof ErroImportacao) {
      return NextResponse.json({ erro: err.message }, { status: 400 });
    }
    console.error("Falha inesperada ao executar a importação de clientes da Mentoria:", err);
    return NextResponse.json({ erro: "Não foi possível concluir a importação." }, { status: 500 });
  }
}
