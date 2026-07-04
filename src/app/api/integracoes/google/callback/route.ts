import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { trocarCodePorTokensGoogle, resolverOrigemPublica } from "@/lib/google";

// GET /api/integracoes/google/callback — recebe o "code" do Google, troca
// pelos tokens e salva na clínica do usuário logado.
export async function GET(req: NextRequest) {
  const origem = resolverOrigemPublica(req);
  const destino = new URL("/painel/configuracoes", origem);

  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.redirect(new URL("/login", origem));

  const code = req.nextUrl.searchParams.get("code");
  const state = req.nextUrl.searchParams.get("state");
  const erroGoogle = req.nextUrl.searchParams.get("error");

  // state precisa bater com o usuário que iniciou o fluxo em /conectar
  if (erroGoogle || !code || state !== usuario.id) {
    destino.searchParams.set("google_erro", "1");
    return NextResponse.redirect(destino);
  }

  try {
    const tokens = await trocarCodePorTokensGoogle(code);
    if (!tokens.access_token) throw new Error("Google não retornou access_token");

    await prisma.clinica.update({
      where: { id: usuario.clinicaId },
      data: {
        googleAccessToken: tokens.access_token,
        // O refresh_token só volta quando o Google realmente exige consentimento
        // (garantido pelo prompt=consent usado ao gerar a URL). Se por algum
        // motivo não vier desta vez, preserva o que já estava salvo.
        ...(tokens.refresh_token ? { googleRefreshToken: tokens.refresh_token } : {}),
        googleTokenExpiry: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        googleConectado: true,
      },
    });
    destino.searchParams.set("google_conectado", "1");
  } catch (err) {
    console.error("Falha ao concluir OAuth do Google:", err);
    destino.searchParams.set("google_erro", "1");
  }

  return NextResponse.redirect(destino);
}
