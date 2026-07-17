import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { registrarLog } from "@/lib/auditoria";
import { soDigitos } from "@/lib/importacao";
import { exigirAcessoMentoria } from "@/lib/mentoria";

function parseData(valor: unknown): Date | null | undefined {
  if (valor === undefined) return undefined;
  if (valor === null || valor === "") return null;
  const data = new Date(valor as string);
  return Number.isNaN(data.getTime()) ? undefined : data;
}

// Erro de unique constraint (P2002) — identifica se foi cpf ou submissionId
// pelo campo indicado em err.meta.target, pro erro devolvido fazer sentido.
function erroDedupe(err: unknown): NextResponse | null {
  const prismaErr = err as { code?: string; meta?: { target?: string[] } } | null;
  if (prismaErr?.code !== "P2002") return null;
  const alvo = prismaErr.meta?.target ?? [];
  if (alvo.some((c) => c.toLowerCase().includes("submissionid"))) {
    return NextResponse.json({ erro: "submissionId já cadastrado nesta clínica" }, { status: 409 });
  }
  return NextResponse.json({ erro: "CPF já cadastrado nesta clínica" }, { status: 409 });
}

// GET /api/mentoria/alunos — lista alunos da clínica logada, com a contagem de contratos
export async function GET() {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  const erroAcesso = await exigirAcessoMentoria(usuario);
  if (erroAcesso) return erroAcesso;

  const alunos = await prisma.mentoriaAluno.findMany({
    where: { clinicaId: usuario.clinicaId },
    orderBy: { nomeCompleto: "asc" },
    include: { _count: { select: { contratos: true } } },
  });

  return NextResponse.json(alunos);
}

// POST /api/mentoria/alunos — cadastra aluno na clínica logada
export async function POST(req: NextRequest) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  const erroAcesso = await exigirAcessoMentoria(usuario);
  if (erroAcesso) return erroAcesso;

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ erro: "corpo da requisição inválido" }, { status: 400 });

  if (!body.nomeCompleto || typeof body.nomeCompleto !== "string") {
    return NextResponse.json({ erro: "nomeCompleto é obrigatório" }, { status: 400 });
  }

  const dataNascimento = parseData(body.dataNascimento);
  if (dataNascimento === undefined && body.dataNascimento !== undefined) {
    return NextResponse.json({ erro: "dataNascimento inválida" }, { status: 400 });
  }
  const submissionData = parseData(body.submissionData);
  if (submissionData === undefined && body.submissionData !== undefined) {
    return NextResponse.json({ erro: "submissionData inválida" }, { status: 400 });
  }

  let aluno;
  try {
    aluno = await prisma.mentoriaAluno.create({
      data: {
        clinicaId: usuario.clinicaId, // vem do login, não do request
        nomeCompleto: body.nomeCompleto,
        cpf: soDigitos(String(body.cpf ?? "")) || null,
        email: body.email ?? null,
        telefone: body.telefone ?? null,
        observacoes: body.observacoes ?? null,
        rg: body.rg ?? null,
        estadoCivil: body.estadoCivil ?? null,
        profissao: body.profissao ?? null,
        nacionalidade: body.nacionalidade ?? null,
        enderecoCompleto: body.enderecoCompleto ?? null,
        cep: body.cep ?? null,
        cidadeUf: body.cidadeUf ?? null,
        dataNascimento: dataNascimento ?? null,
        aceiteTermos: body.aceiteTermos ?? null,
        aceiteTermosTexto: body.aceiteTermosTexto ?? null,
        submitter: body.submitter ?? null,
        submissionData: submissionData ?? null,
        submissionId: body.submissionId ?? null,
      },
    });
  } catch (err) {
    const resposta = erroDedupe(err);
    if (resposta) return resposta;
    throw err;
  }

  await registrarLog(
    usuario.clinicaId,
    usuario.id,
    "CRIAR_ALUNO_MENTORIA",
    `Cadastrou o aluno de mentoria ${aluno.nomeCompleto}`
  );

  return NextResponse.json(aluno, { status: 201 });
}
