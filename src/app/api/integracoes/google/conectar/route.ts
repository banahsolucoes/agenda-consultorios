import { NextRequest, NextResponse } from "next/server";
import { getUsuarioLogado } from "@/lib/auth";
import { gerarUrlConsentimentoGoogle, resolverOrigemPublica } from "@/lib/google";
import { pode } from "@/lib/permissoes";

// GET /api/integracoes/google/conectar — inicia o fluxo OAuth do Google para
// a clínica do usuário logado, redirecionando para a tela de consentimento.
export async function GET(req: NextRequest) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.redirect(new URL("/login", resolverOrigemPublica(req)));
  if (!pode(usuario.papel, "gerirIntegracoes")) {
    return NextResponse.json({ erro: "sem permissão para esta ação" }, { status: 403 });
  }

  // state = id do usuário, conferido no callback como proteção anti-CSRF
  const url = gerarUrlConsentimentoGoogle(usuario.id);
  return NextResponse.redirect(url);
}
