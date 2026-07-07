import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { extrairIdPastaDrive, pareceIdPastaDriveValido } from "@/lib/validacao";
import { obterDriveDaClinica, verificarPastaDriveAcessivel } from "@/lib/google";
import { OPCOES_AJUSTE_FUNDO } from "@/lib/fundo";

// Campos que podem ser alterados pela tela de Configurações. "logo" e
// "fundoUrl" ficam de fora de propósito — só mudam via upload em
// /api/clinica/branding, nunca aceitando uma URL arbitrária digitada aqui.
const CAMPOS_EDITAVEIS = [
  "nome",
  "nomeExibicao",
  "corPrimaria",
  "corSecundaria",
  "duracaoPadraoMin",
  "nomeAssistente",
  "horarioLimiteConfirmacao",
  "pastaRaizDriveId",
  "emailBoasVindasAssunto",
  "emailBoasVindasCorpo",
  "templateConfirmacao",
  "templateMeet",
  "fundoOpacidade",
  "fundoAjuste",
] as const;

const SELECT_CLINICA = {
  id: true,
  nome: true,
  nomeExibicao: true,
  slug: true,
  logo: true,
  fundoUrl: true,
  fundoOpacidade: true,
  fundoAjuste: true,
  corPrimaria: true,
  corSecundaria: true,
  duracaoPadraoMin: true,
  nomeAssistente: true,
  horarioLimiteConfirmacao: true,
  criadoEm: true,
  googleConectado: true,
  googleCalendarId: true,
  pastaRaizDriveId: true,
  emailBoasVindasAssunto: true,
  emailBoasVindasCorpo: true,
  templateConfirmacao: true,
  templateMeet: true,
} as const;

// GET /api/clinica — dados gerais da clínica do usuário logado
// (tokens do Google ficam de fora da resposta — não devem sair do servidor)
export async function GET() {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });

  const clinica = await prisma.clinica.findUnique({
    where: { id: usuario.clinicaId },
    select: SELECT_CLINICA,
  });
  if (!clinica) return NextResponse.json({ erro: "clínica não encontrada" }, { status: 404 });

  return NextResponse.json(clinica);
}

// PATCH /api/clinica — atualiza dados gerais/white-label da clínica do usuário logado
export async function PATCH(req: NextRequest) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });

  const body = await req.json();
  const data: Record<string, unknown> = {};
  for (const campo of CAMPOS_EDITAVEIS) {
    if (body[campo] !== undefined) data[campo] = body[campo];
  }

  if (data.duracaoPadraoMin !== undefined) {
    data.duracaoPadraoMin = Number(data.duracaoPadraoMin);
  }

  if (data.fundoOpacidade !== undefined) {
    const opacidade = Number(data.fundoOpacidade);
    if (!Number.isInteger(opacidade) || opacidade < 0 || opacidade > 100) {
      return NextResponse.json({ erro: "fundoOpacidade deve ser um inteiro entre 0 e 100" }, { status: 400 });
    }
    data.fundoOpacidade = opacidade;
  }

  if (data.fundoAjuste !== undefined) {
    const valores = OPCOES_AJUSTE_FUNDO.map((o) => o.valor);
    if (typeof data.fundoAjuste !== "string" || !valores.includes(data.fundoAjuste)) {
      return NextResponse.json(
        { erro: `fundoAjuste deve ser um dos valores: ${valores.join(", ")}` },
        { status: 400 }
      );
    }
  }

  if (data.nomeExibicao === "") {
    data.nomeExibicao = null;
  }

  if (data.emailBoasVindasAssunto !== undefined && !data.emailBoasVindasAssunto) {
    return NextResponse.json({ erro: "emailBoasVindasAssunto não pode ser vazio" }, { status: 400 });
  }
  if (data.emailBoasVindasCorpo !== undefined && !data.emailBoasVindasCorpo) {
    return NextResponse.json({ erro: "emailBoasVindasCorpo não pode ser vazio" }, { status: 400 });
  }
  if (data.templateConfirmacao !== undefined && !data.templateConfirmacao) {
    return NextResponse.json({ erro: "templateConfirmacao não pode ser vazio" }, { status: 400 });
  }
  if (data.templateMeet !== undefined && !data.templateMeet) {
    return NextResponse.json({ erro: "templateMeet não pode ser vazio" }, { status: 400 });
  }

  // Aceita o operador colar tanto um link do Drive quanto já o próprio ID da
  // pasta-mãe — sempre normaliza e guarda só o ID. Mudar essa configuração
  // afeta onde as pastas de pacientes novos são criadas, então validamos
  // com cuidado antes de salvar: formato do ID e, se o Google já estiver
  // conectado, que a pasta realmente existe e está acessível.
  if (typeof data.pastaRaizDriveId === "string" && data.pastaRaizDriveId) {
    const idExtraido = extrairIdPastaDrive(data.pastaRaizDriveId);
    if (!pareceIdPastaDriveValido(idExtraido)) {
      return NextResponse.json(
        { erro: "isso não parece um ID ou link válido de pasta do Drive" },
        { status: 400 }
      );
    }

    const clinicaAtual = await prisma.clinica.findUnique({ where: { id: usuario.clinicaId } });
    if (clinicaAtual?.googleConectado) {
      const drive = await obterDriveDaClinica(clinicaAtual);
      const acessivel = drive ? await verificarPastaDriveAcessivel(drive, idExtraido) : false;
      if (!acessivel) {
        return NextResponse.json({ erro: "pasta não encontrada ou sem acesso" }, { status: 400 });
      }
    }

    data.pastaRaizDriveId = idExtraido;
  } else if (data.pastaRaizDriveId === "") {
    data.pastaRaizDriveId = null;
  }

  const clinica = await prisma.clinica.update({
    where: { id: usuario.clinicaId },
    data,
    select: SELECT_CLINICA,
  });

  return NextResponse.json(clinica);
}
