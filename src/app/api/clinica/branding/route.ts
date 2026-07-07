import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { registrarLog } from "@/lib/auditoria";
import { createAdminClient } from "@/lib/supabase/admin";

const BUCKET = "branding";
const TAMANHO_MAX_BYTES = 5 * 1024 * 1024; // 5MB
const EXTENSAO_POR_TIPO: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/svg+xml": "svg",
  "image/webp": "webp",
};

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

// POST /api/clinica/branding — upload de logo ou fundo de tela da clínica do
// usuário logado. multipart/form-data: "tipo" ("logo" | "fundo") + "arquivo".
export async function POST(req: NextRequest) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });

  const form = await req.formData();
  const tipo = form.get("tipo");
  const arquivo = form.get("arquivo");

  if (tipo !== "logo" && tipo !== "fundo") {
    return NextResponse.json({ erro: "tipo deve ser 'logo' ou 'fundo'" }, { status: 400 });
  }
  if (!(arquivo instanceof File)) {
    return NextResponse.json({ erro: "arquivo é obrigatório" }, { status: 400 });
  }

  const extensao = EXTENSAO_POR_TIPO[arquivo.type];
  if (!extensao) {
    return NextResponse.json(
      { erro: "formato inválido — envie PNG, JPG, SVG ou WEBP" },
      { status: 400 }
    );
  }
  if (arquivo.size > TAMANHO_MAX_BYTES) {
    return NextResponse.json({ erro: "arquivo muito grande — o limite é 5MB" }, { status: 400 });
  }

  const caminho = `clinicas/${usuario.clinicaId}/${tipo}-${Date.now()}.${extensao}`;
  const admin = createAdminClient();
  const { error: erroUpload } = await admin.storage.from(BUCKET).upload(caminho, arquivo, {
    contentType: arquivo.type,
    upsert: false,
  });
  if (erroUpload) {
    console.error("Falha ao enviar imagem para o Supabase Storage:", erroUpload);
    return NextResponse.json({ erro: "não foi possível enviar a imagem" }, { status: 502 });
  }

  const { data: publicUrlData } = admin.storage.from(BUCKET).getPublicUrl(caminho);

  const campo = tipo === "logo" ? "logo" : "fundoUrl";
  const clinica = await prisma.clinica.update({
    where: { id: usuario.clinicaId },
    data: { [campo]: publicUrlData.publicUrl },
    select: SELECT_CLINICA,
  });

  await registrarLog(
    usuario.clinicaId,
    usuario.id,
    "ATUALIZAR_IDENTIDADE_VISUAL",
    `Atualizou ${tipo === "logo" ? "a logo" : "o fundo de tela"} da clínica`
  );

  return NextResponse.json(clinica);
}
