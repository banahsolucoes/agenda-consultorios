import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { registrarLog } from "@/lib/auditoria";
import { ErroImportacao, lerEDeduplicarPlanilha, soDigitos } from "@/lib/importacao";

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

    for (const registro of novos) {
      try {
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
            origemCadastro: "FORMS",
            horarioFixo: "09:00",
            statusGeral: "ATIVO",
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
      `Importação de planilha executada: ${criados} criados, ${pulados} pulados, ${erros} erros`
    );

    return NextResponse.json({ criados, pulados, erros });
  } catch (err) {
    if (err instanceof ErroImportacao) {
      return NextResponse.json({ erro: err.message }, { status: 400 });
    }
    console.error("Falha inesperada ao executar a importação:", err);
    return NextResponse.json({ erro: "Não foi possível concluir a importação." }, { status: 500 });
  }
}
