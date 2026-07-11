import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { registrarLog } from "@/lib/auditoria";
import { TIPOS_PERMITIDOS, TAMANHO_MAX_BYTES } from "@/lib/anexos";

// GET /api/pacientes/[id]/anexos — lista os anexos do paciente da clínica logada
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });

  const { id: pacienteId } = await ctx.params;
  const paciente = await prisma.paciente.findUnique({ where: { id: pacienteId } });
  if (!paciente || paciente.clinicaId !== usuario.clinicaId) {
    return NextResponse.json({ erro: "paciente não encontrado" }, { status: 404 });
  }

  const anexos = await prisma.anexo.findMany({
    where: { pacienteId, clinicaId: usuario.clinicaId },
    orderBy: { criadoEm: "desc" },
  });

  return NextResponse.json(anexos);
}

// POST /api/pacientes/[id]/anexos — confirma um upload já enviado pro
// Storage via URL assinada (upload-url) e grava o registro do anexo.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });

  const { id: pacienteId } = await ctx.params;
  const paciente = await prisma.paciente.findUnique({ where: { id: pacienteId } });
  if (!paciente || paciente.clinicaId !== usuario.clinicaId) {
    return NextResponse.json({ erro: "paciente não encontrado" }, { status: 404 });
  }

  const body = await req.json();
  const nomeArquivo = typeof body.nomeArquivo === "string" ? body.nomeArquivo.trim() : "";
  const mimeType = typeof body.mimeType === "string" ? body.mimeType : "";
  const tamanho = Number(body.tamanho);
  const path = typeof body.path === "string" ? body.path : "";

  if (!nomeArquivo) {
    return NextResponse.json({ erro: "nomeArquivo é obrigatório" }, { status: 400 });
  }
  if (!TIPOS_PERMITIDOS.includes(mimeType as (typeof TIPOS_PERMITIDOS)[number])) {
    return NextResponse.json(
      { erro: "tipo de arquivo inválido — envie imagem (JPG/PNG) ou PDF" },
      { status: 400 }
    );
  }
  if (!Number.isFinite(tamanho) || tamanho <= 0 || tamanho > TAMANHO_MAX_BYTES) {
    return NextResponse.json({ erro: "arquivo muito grande — o limite é 4,5MB" }, { status: 400 });
  }
  // O path é gerado pelo servidor em upload-url e sempre começa com
  // {clinicaId}/{pacienteId}/ — rejeita qualquer path que não bata com isso
  // pra não deixar o cliente forjar um registro apontando pra outro arquivo.
  const prefixoEsperado = `${usuario.clinicaId}/${pacienteId}/`;
  if (!path.startsWith(prefixoEsperado)) {
    return NextResponse.json({ erro: "path inválido" }, { status: 400 });
  }

  const anexo = await prisma.anexo.create({
    data: {
      clinicaId: usuario.clinicaId,
      pacienteId,
      nomeArquivo,
      mimeType,
      tamanho,
      path,
    },
  });

  await registrarLog(
    usuario.clinicaId,
    usuario.id,
    "ANEXAR_ARQUIVO_PACIENTE",
    `Anexou o arquivo "${nomeArquivo}" ao paciente ${paciente.nome}`
  );

  return NextResponse.json(anexo);
}
