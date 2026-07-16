import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { registrarLog } from "@/lib/auditoria";
import { soDigitos } from "@/lib/importacao";
import { exigirAcessoMentoria } from "@/lib/mentoria";

const CAMPOS_EDITAVEIS = ["nomeCompleto", "cpf", "email", "telefone", "observacoes"] as const;

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

  const data: Record<string, unknown> = {};
  if (body.nomeCompleto !== undefined) data.nomeCompleto = body.nomeCompleto;
  if (body.cpf !== undefined) data.cpf = soDigitos(String(body.cpf ?? "")) || null;
  if (body.email !== undefined) data.email = body.email || null;
  if (body.telefone !== undefined) data.telefone = body.telefone || null;
  if (body.observacoes !== undefined) data.observacoes = body.observacoes || null;

  const camposAlterados = Object.keys(data);
  if (camposAlterados.length === 0) {
    return NextResponse.json({ erro: "nenhum campo para atualizar" }, { status: 400 });
  }

  let atualizado;
  try {
    atualizado = await prisma.mentoriaAluno.update({ where: { id }, data });
  } catch (err) {
    const codigo = (err as { code?: string } | null)?.code;
    if (codigo === "P2002") {
      return NextResponse.json({ erro: "CPF já cadastrado nesta clínica" }, { status: 409 });
    }
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
