import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { registrarLog } from "@/lib/auditoria";
import { pareceUrl } from "@/lib/validacao";
import { enfileirar } from "@/lib/sincronizacao";
import { soDigitos } from "@/lib/importacao";

// GET /api/pacientes — lista pacientes da clínica do usuário logado
// ?filtro=ativos (default) | finalizados | cancelados | todos
// ?busca=<texto> — busca por nome (contains) ou CPF (dígitos), ignora o
// filtro de status (usado pela busca manual de paciente na fila de
// anamnese, F2.5 — quer encontrar o paciente independente do status).
export async function GET(req: NextRequest) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const busca = searchParams.get("busca")?.trim();

  if (busca) {
    const buscaDigitos = soDigitos(busca);
    const pacientes = await prisma.paciente.findMany({
      where: {
        clinicaId: usuario.clinicaId,
        OR: [
          { nome: { contains: busca, mode: "insensitive" } },
          ...(buscaDigitos ? [{ cpf: { contains: buscaDigitos } }] : []),
        ],
      },
      orderBy: { nome: "asc" },
      take: 20,
      select: { id: true, nome: true, telefone: true, cpf: true, statusGeral: true },
    });
    return NextResponse.json(pacientes);
  }

  const filtro = searchParams.get("filtro") ?? "ativos";
  const statusGeral =
    filtro === "ativos"
      ? "ATIVO"
      : filtro === "finalizados"
        ? "FINALIZADO"
        : filtro === "cancelados"
          ? "CANCELADO"
          : undefined;

  const pacientes = await prisma.paciente.findMany({
    where: { clinicaId: usuario.clinicaId, ...(statusGeral ? { statusGeral } : {}) },
    orderBy: { nome: "asc" },
    // A lista renderiza só nome/telefone/status (painel/page.tsx) — o
    // cadastro completo (CPF, RG, endereço, anamnese etc.) é buscado sob
    // demanda via GET /api/pacientes/[id] ao abrir o painel/modal.
    select: { id: true, nome: true, telefone: true, statusGeral: true },
  });

  return NextResponse.json(pacientes);
}

// POST /api/pacientes — cadastra paciente na clínica do usuário logado
export async function POST(req: NextRequest) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });

  const body = await req.json();
  const obrigatorios = ["nome", "diaPreferido", "horarioFixo", "tipoSessaoId"];
  for (const campo of obrigatorios) {
    if (!body[campo]) {
      return NextResponse.json({ erro: `${campo} é obrigatório` }, { status: 400 });
    }
  }

  const tipoSessao = await prisma.tipoSessao.findUnique({ where: { id: body.tipoSessaoId } });
  if (!tipoSessao || tipoSessao.clinicaId !== usuario.clinicaId) {
    return NextResponse.json({ erro: "tipoSessaoId inválido" }, { status: 400 });
  }

  if (body.origemCadastro && !["MANUAL", "FORMS"].includes(body.origemCadastro)) {
    return NextResponse.json({ erro: "origemCadastro inválida" }, { status: 400 });
  }
  if (body.pastaDriveUrl && !pareceUrl(body.pastaDriveUrl)) {
    return NextResponse.json({ erro: "pastaDriveUrl deve ser uma URL válida" }, { status: 400 });
  }

  let paciente;
  try {
    paciente = await prisma.paciente.create({
      data: {
        clinicaId: usuario.clinicaId,  // vem do login, não do request
        nome: body.nome,
        telefone: body.telefone ?? null,
        email: body.email ?? null,
        cpf: soDigitos(String(body.cpf ?? "")) || null,
        rg: body.rg ?? null,
        logradouro: body.logradouro ?? null,
        numero: body.numero ?? null,
        complemento: body.complemento ?? null,
        bairro: body.bairro ?? null,
        cidade: body.cidade ?? null,
        estado: body.estado ?? null,
        cep: body.cep ?? null,
        quemIndicou: body.quemIndicou ?? null,
        dataNascimento: body.dataNascimento ?? null,
        estadoCivil: body.estadoCivil ?? null,
        nacionalidade: body.nacionalidade ?? null,
        profissao: body.profissao ?? null,
        instagram: body.instagram ?? null,
        pastaDriveUrl: body.pastaDriveUrl ?? null,
        origemCadastro: body.origemCadastro ?? "MANUAL",
        diaPreferido: body.diaPreferido,
        horarioFixo: body.horarioFixo,
        tipoSessaoId: body.tipoSessaoId,
      },
    });
  } catch (err) {
    const codigo = (err as { code?: string } | null)?.code;
    if (codigo === "P2002") {
      return NextResponse.json({ erro: "CPF já cadastrado nesta clínica" }, { status: 409 });
    }
    throw err;
  }

  await registrarLog(usuario.clinicaId, usuario.id, "CRIAR_PACIENTE", `Cadastrou o paciente ${paciente.nome}`);

  // Cria a pasta do paciente no Drive da clínica via outbox — só quando não
  // veio uma URL manual no cadastro, o Google está conectado e a clínica já
  // configurou a pasta-mãe (o worker relê pastaRaizDriveId na hora de
  // processar, mas checar aqui evita enfileirar um item fadado a FALHA
  // quando a clínica nunca configurou a pasta-mãe). enfileirar() nunca
  // lança — o cadastro do paciente, já concluído acima, nunca é afetado.
  if (!paciente.pastaDriveUrl) {
    const clinica = await prisma.clinica.findUnique({ where: { id: usuario.clinicaId } });
    if (clinica?.googleConectado && clinica.pastaRaizDriveId) {
      await enfileirar(usuario.clinicaId, "DRIVE_CRIAR_PASTA", { pacienteId: paciente.id });
    }
  }

  return NextResponse.json(paciente, { status: 201 });
}
