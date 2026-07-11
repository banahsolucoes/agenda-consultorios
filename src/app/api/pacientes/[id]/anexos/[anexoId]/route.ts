import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { BUCKET_ANEXOS } from "@/lib/anexos";

const VALIDADE_URL_DOWNLOAD_SEGUNDOS = 60;

// GET /api/pacientes/[id]/anexos/[anexoId] — gera uma signed download URL de
// curta duração pro anexo, só depois de confirmar que ele pertence ao
// paciente e à clínica do usuário logado. O bucket é privado e o path nunca
// é exposto direto.
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string; anexoId: string }> }) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });

  const { id: pacienteId, anexoId } = await ctx.params;
  const anexo = await prisma.anexo.findUnique({ where: { id: anexoId } });
  if (!anexo || anexo.clinicaId !== usuario.clinicaId || anexo.pacienteId !== pacienteId) {
    return NextResponse.json({ erro: "anexo não encontrado" }, { status: 404 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from(BUCKET_ANEXOS)
    .createSignedUrl(anexo.path, VALIDADE_URL_DOWNLOAD_SEGUNDOS, {
      download: anexo.nomeArquivo,
    });
  if (error) {
    console.error("Falha ao gerar URL de download assinada:", error);
    return NextResponse.json({ erro: "não foi possível gerar a URL de download" }, { status: 502 });
  }

  return NextResponse.json({ url: data.signedUrl, nomeArquivo: anexo.nomeArquivo });
}
