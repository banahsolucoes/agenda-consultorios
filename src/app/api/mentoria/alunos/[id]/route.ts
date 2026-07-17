import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { registrarLog } from "@/lib/auditoria";
import { soDigitos } from "@/lib/importacao";
import { exigirAcessoMentoria } from "@/lib/mentoria";

const CAMPOS_EDITAVEIS = [
  "nomeCompleto",
  "cpf",
  "email",
  "telefone",
  "observacoes",
  "rg",
  "estadoCivil",
  "profissao",
  "nacionalidade",
  "enderecoCompleto",
  "cep",
  "cidadeUf",
  "dataNascimento",
  "aceiteTermos",
  "aceiteTermosTexto",
  "submitter",
  "submissionData",
  "submissionId",
] as const;

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

// GET /api/mentoria/alunos/[id] — aluno + contratos, escopado pela clínica logada
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  const erroAcesso = await exigirAcessoMentoria(usuario);
  if (erroAcesso) return erroAcesso;

  const { id } = await ctx.params;
  const aluno = await prisma.mentoriaAluno.findUnique({
    where: { id },
    include: {
      contratos: {
        select: { id: true, pacote: true, status: true, totalParcelas: true, valorTotal: true, assinaturaContrato: true },
        orderBy: { criadoEm: "desc" },
      },
    },
  });
  if (!aluno || aluno.clinicaId !== usuario.clinicaId) {
    return NextResponse.json({ erro: "aluno não encontrado" }, { status: 404 });
  }

  return NextResponse.json(aluno);
}

// PATCH /api/mentoria/alunos/[id] — edita o cadastro do aluno
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  const erroAcesso = await exigirAcessoMentoria(usuario);
  if (erroAcesso) return erroAcesso;

  const { id } = await ctx.params;
  const aluno = await prisma.mentoriaAluno.findUnique({ where: { id } });
  if (!aluno || aluno.clinicaId !== usuario.clinicaId) {
    return NextResponse.json({ erro: "aluno não encontrado" }, { status: 404 });
  }

  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ erro: "corpo da requisição inválido" }, { status: 400 });

  if (body.nomeCompleto !== undefined && (!body.nomeCompleto || typeof body.nomeCompleto !== "string")) {
    return NextResponse.json({ erro: "nomeCompleto não pode ser vazio" }, { status: 400 });
  }

  const dataNascimento = parseData(body.dataNascimento);
  if (dataNascimento === undefined && body.dataNascimento !== undefined && body.dataNascimento !== null) {
    return NextResponse.json({ erro: "dataNascimento inválida" }, { status: 400 });
  }
  const submissionData = parseData(body.submissionData);
  if (submissionData === undefined && body.submissionData !== undefined && body.submissionData !== null) {
    return NextResponse.json({ erro: "submissionData inválida" }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (body.nomeCompleto !== undefined) data.nomeCompleto = body.nomeCompleto;
  if (body.cpf !== undefined) data.cpf = soDigitos(String(body.cpf ?? "")) || null;
  if (body.email !== undefined) data.email = body.email || null;
  if (body.telefone !== undefined) data.telefone = body.telefone || null;
  if (body.observacoes !== undefined) data.observacoes = body.observacoes || null;
  if (body.rg !== undefined) data.rg = body.rg || null;
  if (body.estadoCivil !== undefined) data.estadoCivil = body.estadoCivil || null;
  if (body.profissao !== undefined) data.profissao = body.profissao || null;
  if (body.nacionalidade !== undefined) data.nacionalidade = body.nacionalidade || null;
  if (body.enderecoCompleto !== undefined) data.enderecoCompleto = body.enderecoCompleto || null;
  if (body.cep !== undefined) data.cep = body.cep || null;
  if (body.cidadeUf !== undefined) data.cidadeUf = body.cidadeUf || null;
  if (body.dataNascimento !== undefined) data.dataNascimento = dataNascimento;
  if (body.aceiteTermos !== undefined) data.aceiteTermos = body.aceiteTermos;
  if (body.aceiteTermosTexto !== undefined) data.aceiteTermosTexto = body.aceiteTermosTexto || null;
  if (body.submitter !== undefined) data.submitter = body.submitter || null;
  if (body.submissionData !== undefined) data.submissionData = submissionData;
  if (body.submissionId !== undefined) data.submissionId = body.submissionId || null;

  const camposAlterados = Object.keys(data);
  if (camposAlterados.length === 0) {
    return NextResponse.json({ erro: "nenhum campo para atualizar" }, { status: 400 });
  }

  let atualizado;
  try {
    atualizado = await prisma.mentoriaAluno.update({ where: { id }, data });
  } catch (err) {
    const resposta = erroDedupe(err);
    if (resposta) return resposta;
    throw err;
  }

  await registrarLog(
    usuario.clinicaId,
    usuario.id,
    "EDITAR_ALUNO_MENTORIA",
    `Editou o aluno de mentoria ${atualizado.nomeCompleto} (campos: ${camposAlterados.filter((c) => (CAMPOS_EDITAVEIS as readonly string[]).includes(c)).join(", ")})`
  );

  return NextResponse.json(atualizado);
}

// DELETE /api/mentoria/alunos/[id] — exclui definitivamente o aluno da
// clínica logada. Bloqueado se houver contratos vinculados (MentoriaContrato
// exige alunoId — apagar contratos/parcelas/comissões financeiras não é uma
// operação implícita de "excluir cadastro"), reportado ao usuário em vez de
// cascatear a exclusão.
export async function DELETE(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  const erroAcesso = await exigirAcessoMentoria(usuario);
  if (erroAcesso) return erroAcesso;

  const { id } = await ctx.params;
  const aluno = await prisma.mentoriaAluno.findUnique({
    where: { id },
    include: { _count: { select: { contratos: true } } },
  });
  if (!aluno || aluno.clinicaId !== usuario.clinicaId) {
    return NextResponse.json({ erro: "aluno não encontrado" }, { status: 404 });
  }

  if (aluno._count.contratos > 0) {
    return NextResponse.json(
      { erro: "não é possível excluir: este cliente possui contratos vinculados" },
      { status: 409 }
    );
  }

  await prisma.mentoriaAluno.delete({ where: { id } });

  await registrarLog(
    usuario.clinicaId,
    usuario.id,
    "EXCLUIR_ALUNO_MENTORIA",
    `Excluiu o aluno de mentoria ${aluno.nomeCompleto}`
  );

  return NextResponse.json({ ok: true });
}
