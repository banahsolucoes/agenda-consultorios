import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";

// GET /api/pacientes — lista pacientes da clínica do usuário logado
export async function GET() {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });

  const pacientes = await prisma.paciente.findMany({
    where: { clinicaId: usuario.clinicaId },
    orderBy: { nome: "asc" },
  });

  return NextResponse.json(pacientes);
}

// POST /api/pacientes — cadastra paciente na clínica do usuário logado
export async function POST(req: NextRequest) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });

  const body = await req.json();
  const obrigatorios = ["nome", "diaPreferido", "horarioFixo", "tipoSessao"];
  for (const campo of obrigatorios) {
    if (!body[campo]) {
      return NextResponse.json({ erro: `${campo} é obrigatório` }, { status: 400 });
    }
  }

  const paciente = await prisma.paciente.create({
    data: {
      clinicaId: usuario.clinicaId,  // vem do login, não do request
      nome: body.nome,
      telefone: body.telefone ?? null,
      email: body.email ?? null,
      cpf: body.cpf ?? null,
      logradouro: body.logradouro ?? null,
      numero: body.numero ?? null,
      complemento: body.complemento ?? null,
      bairro: body.bairro ?? null,
      cidade: body.cidade ?? null,
      estado: body.estado ?? null,
      cep: body.cep ?? null,
      quemIndicou: body.quemIndicou ?? null,
      diaPreferido: body.diaPreferido,
      horarioFixo: body.horarioFixo,
      tipoSessao: body.tipoSessao,
    },
  });

  return NextResponse.json(paciente, { status: 201 });
}
