import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { BUCKET_ANEXOS, TIPOS_PERMITIDOS, TAMANHO_MAX_BYTES, caminhoAnexo } from "@/lib/anexos";

// POST /api/pacientes/[id]/anexos/upload-url — gera uma signed upload URL do
// Supabase Storage para o navegador enviar um anexo (exame) direto pro
// bucket privado "anexos-pacientes", sem o arquivo passar pelo nosso
// servidor. A validação aqui é a que vale (a do cliente é só UX).
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

  const path = caminhoAnexo(usuario.clinicaId, pacienteId, nomeArquivo);
  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(BUCKET_ANEXOS).createSignedUploadUrl(path);
  if (error) {
    console.error("Falha ao gerar URL de upload assinada:", error);
    return NextResponse.json({ erro: "não foi possível gerar a URL de upload" }, { status: 502 });
  }

  return NextResponse.json({ signedUrl: data.signedUrl, token: data.token, path });
}
