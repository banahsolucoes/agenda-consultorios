import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { registrarLog } from "@/lib/auditoria";
import { pareceUrl } from "@/lib/validacao";
import { obterDriveDaClinica, criarPastaPacienteDrive } from "@/lib/google";

// GET /api/pacientes — lista pacientes da clínica do usuário logado
// ?filtro=ativos (default) | finalizados | cancelados | todos
export async function GET(req: NextRequest) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });

  const { searchParams } = new URL(req.url);
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
      pastaDriveUrl: body.pastaDriveUrl ?? null,
      origemCadastro: body.origemCadastro ?? "MANUAL",
      diaPreferido: body.diaPreferido,
      horarioFixo: body.horarioFixo,
      tipoSessaoId: body.tipoSessaoId,
    },
  });

  await registrarLog(usuario.clinicaId, usuario.id, "CRIAR_PACIENTE", `Cadastrou o paciente ${paciente.nome}`);

  // Cria a pasta do paciente no Drive da clínica, melhor esforço: só quando
  // não veio uma URL manual no cadastro, o Google está conectado e a
  // clínica já configurou a pasta-mãe. Qualquer falha aqui (Google
  // desconectado, pasta-mãe inválida, erro de rede) nunca deve derrubar o
  // cadastro do paciente, que já foi concluído com sucesso.
  if (!paciente.pastaDriveUrl) {
    try {
      const clinica = await prisma.clinica.findUnique({ where: { id: usuario.clinicaId } });
      if (clinica?.googleConectado && clinica.pastaRaizDriveId) {
        const drive = await obterDriveDaClinica(clinica);
        if (drive) {
          const pasta = await criarPastaPacienteDrive(drive, clinica.pastaRaizDriveId, paciente.nome);
          if (pasta.pastaDriveUrl) {
            await prisma.paciente.update({
              where: { id: paciente.id },
              data: { pastaDriveUrl: pasta.pastaDriveUrl },
            });
            paciente.pastaDriveUrl = pasta.pastaDriveUrl;
          }
        }
      }
    } catch (err) {
      console.error("Falha ao criar pasta do paciente no Drive:", err);
    }
  }

  return NextResponse.json(paciente, { status: 201 });
}
