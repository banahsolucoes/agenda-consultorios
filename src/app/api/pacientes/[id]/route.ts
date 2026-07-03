import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";

const CAMPOS_EDITAVEIS = [
  "nome",
  "telefone",
  "email",
  "cpf",
  "logradouro",
  "numero",
  "complemento",
  "bairro",
  "cidade",
  "estado",
  "cep",
  "quemIndicou",
  "origemCadastro",
  "diaPreferido",
  "horarioFixo",
  "tipoSessaoId",
] as const;

const DIAS_VALIDOS = ["SEGUNDA", "TERCA", "QUARTA", "QUINTA", "SEXTA", "SABADO", "DOMINGO"];
const ORIGENS_VALIDAS = ["MANUAL", "FORMS"];
const HORA_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

// PATCH /api/pacientes/[id] — edita o cadastro de um paciente da clínica logada
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });

  const { id } = await ctx.params;
  const paciente = await prisma.paciente.findUnique({ where: { id } });
  if (!paciente || paciente.clinicaId !== usuario.clinicaId) {
    return NextResponse.json({ erro: "paciente não encontrado" }, { status: 404 });
  }

  const body = await req.json();

  if (body.diaPreferido !== undefined && !DIAS_VALIDOS.includes(body.diaPreferido)) {
    return NextResponse.json({ erro: "diaPreferido inválido" }, { status: 400 });
  }
  if (body.horarioFixo !== undefined && !HORA_REGEX.test(body.horarioFixo)) {
    return NextResponse.json({ erro: "horarioFixo deve estar no formato HH:MM" }, { status: 400 });
  }
  if (body.origemCadastro !== undefined && !ORIGENS_VALIDAS.includes(body.origemCadastro)) {
    return NextResponse.json({ erro: "origemCadastro inválida" }, { status: 400 });
  }
  if (body.tipoSessaoId) {
    const tipoSessao = await prisma.tipoSessao.findUnique({ where: { id: body.tipoSessaoId } });
    if (!tipoSessao || tipoSessao.clinicaId !== usuario.clinicaId) {
      return NextResponse.json({ erro: "tipoSessaoId inválido" }, { status: 400 });
    }
  }

  const data: Record<string, unknown> = {};
  for (const campo of CAMPOS_EDITAVEIS) {
    if (body[campo] !== undefined) data[campo] = body[campo];
  }

  const atualizado = await prisma.paciente.update({ where: { id }, data });
  return NextResponse.json(atualizado);
}
