import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { trocarCodePorTokensGoogle, resolverOrigemPublica } from "@/lib/google";
import { pode } from "@/lib/permissoes";

// GET /api/integracoes/google/callback — recebe o "code" do Google, troca
// pelos tokens e salva na clínica do usuário logado.
export async function GET(req: NextRequest) {
  const origem = resolverOrigemPublica(req);
  // A tela de Integração Google ainda mora em /legado (Bloco 2 da navegação
  // por seções só criou a casca, o conteúdo real ainda não migrou).
  const destino = new URL("/painel/configuracoes/legado", origem);

  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.redirect(new URL("/login", origem));
  if (!pode(usuario.papel, "gerirIntegracoes")) {
    return NextResponse.json({ erro: "sem permissão para esta ação" }, { status: 403 });
  }

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
        // Escopos realmente concedidos nesta autorização — usado pra saber se
        // a conexão já cobre Drive/Gmail sem precisar tentar a chamada.
        ...(tokens.scope ? { googleEscopos: tokens.scope } : {}),
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
