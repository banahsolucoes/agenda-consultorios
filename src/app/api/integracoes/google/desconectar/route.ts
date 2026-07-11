import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { pode } from "@/lib/permissoes";

// POST /api/integracoes/google/desconectar — apaga os tokens do Google
// salvos na clínica do usuário logado.
export async function POST() {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  if (!pode(usuario.papel, "gerirIntegracoes")) {
    return NextResponse.json({ erro: "sem permissão para esta ação" }, { status: 403 });
  }

  await prisma.clinica.update({
    where: { id: usuario.clinicaId },
    data: {
      googleRefreshToken: null,
      googleAccessToken: null,
      googleTokenExpiry: null,
      googleConectado: false,
    },
  });

  return NextResponse.json({ ok: true });
}
