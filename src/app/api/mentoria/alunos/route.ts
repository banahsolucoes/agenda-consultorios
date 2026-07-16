import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { registrarLog } from "@/lib/auditoria";
import { soDigitos } from "@/lib/importacao";
import { exigirAcessoMentoria } from "@/lib/mentoria";

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
      },
    });
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
    "CRIAR_ALUNO_MENTORIA",
    `Cadastrou o aluno de mentoria ${aluno.nomeCompleto}`
  );

  return NextResponse.json(aluno, { status: 201 });
}
