import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { registrarLog } from "@/lib/auditoria";

// POST /api/anamneses/[id]/ignorar — Ação C da fila (F2.5): marca um
// EnvioFormulario PENDENTE como IGNORADO, com motivo obrigatório. Nunca
// deleta o envio nem suas respostas — só muda o status, fica consultável
// no filtro de ignorados.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const motivo = typeof body?.motivo === "string" ? body.motivo.trim() : "";
  if (!motivo) {
    return NextResponse.json({ erro: "motivo é obrigatório" }, { status: 400 });
  }

  const envio = await prisma.envioFormulario.findUnique({
    where: { id },
    select: { id: true, clinicaId: true, status: true },
  });
  if (!envio || envio.clinicaId !== usuario.clinicaId) {
    return NextResponse.json({ erro: "envio não encontrado" }, { status: 404 });
  }

  const guarda = await prisma.envioFormulario.updateMany({
    where: { id: envio.id, status: "PENDENTE" },
    data: { status: "IGNORADO", observacaoProcessamento: motivo },
  });
  if (guarda.count !== 1) {
    return NextResponse.json({ erro: "este envio já foi processado" }, { status: 409 });
  }

  await registrarLog(usuario.clinicaId, usuario.id, "IGNORAR_ANAMNESE", `Ignorou o envio ${envio.id}: ${motivo}`);

  return NextResponse.json({ ok: true });
}
