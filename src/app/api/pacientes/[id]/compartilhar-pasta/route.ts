import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { registrarLog } from "@/lib/auditoria";
import { extrairIdPastaDrive } from "@/lib/validacao";
import {
  obterDriveDaClinica,
  obterGmailDaClinica,
  compartilharPastaComEmail,
  enviarEmailBoasVindas,
} from "@/lib/google";
import { renderizarCorpoEmailHtml } from "@/lib/emailBoasVindas";

// POST /api/pacientes/[id]/compartilhar-pasta — compartilha a pasta do Drive
// do paciente (permissão de leitura) com o e-mail dele e envia o e-mail de
// boas-vindas pela conta Google conectada da clínica. Ação irreversível e
// sensível (dado de saúde) — o operador já confirmou o destinatário e o
// conteúdo na tela de confirmação antes desta chamada.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });

  const { id } = await ctx.params;
  const paciente = await prisma.paciente.findUnique({ where: { id } });
  if (!paciente || paciente.clinicaId !== usuario.clinicaId) {
    return NextResponse.json({ erro: "paciente não encontrado" }, { status: 404 });
  }
  if (!paciente.email) {
    return NextResponse.json({ erro: "paciente não tem e-mail cadastrado" }, { status: 400 });
  }
  if (!paciente.pastaDriveUrl) {
    return NextResponse.json({ erro: "paciente não tem pasta do Drive cadastrada" }, { status: 400 });
  }

  const body = await req.json();
  const assunto = typeof body.assunto === "string" ? body.assunto.trim() : "";
  const corpo = typeof body.corpo === "string" ? body.corpo.trim() : "";
  if (!assunto || !corpo) {
    return NextResponse.json({ erro: "assunto e corpo são obrigatórios" }, { status: 400 });
  }

  const clinica = await prisma.clinica.findUnique({ where: { id: usuario.clinicaId } });
  if (!clinica?.googleConectado) {
    return NextResponse.json({ erro: "Google não conectado" }, { status: 400 });
  }

  const [drive, gmail] = await Promise.all([obterDriveDaClinica(clinica), obterGmailDaClinica(clinica)]);
  if (!drive || !gmail) {
    return NextResponse.json(
      { erro: "não foi possível autenticar com o Google — reconecte em Configurações" },
      { status: 400 }
    );
  }

  const pastaDriveId = extrairIdPastaDrive(paciente.pastaDriveUrl);
  const [resultadoPasta, resultadoEmail] = await Promise.all([
    compartilharPastaComEmail(drive, pastaDriveId, paciente.email, clinica.id),
    enviarEmailBoasVindas(gmail, paciente.email, assunto, renderizarCorpoEmailHtml(corpo), clinica.id),
  ]);

  await registrarLog(
    usuario.clinicaId,
    usuario.id,
    "COMPARTILHAR_PASTA_EMAIL",
    `Compartilhou a pasta e enviou boas-vindas para ${paciente.nome} (${paciente.email}) — ` +
      `pasta: ${resultadoPasta.compartilhado ? "ok" : "falhou"}, e-mail: ${resultadoEmail.enviado ? "ok" : "falhou"}`
  );

  return NextResponse.json({
    pastaCompartilhada: resultadoPasta.compartilhado,
    emailEnviado: resultadoEmail.enviado,
  });
}
