import { NextRequest, NextResponse } from "next/server";
import { getUsuarioLogado } from "@/lib/auth";
import { gerarUrlConsentimentoGoogle, resolverOrigemPublica } from "@/lib/google";

// GET /api/integracoes/google/conectar — inicia o fluxo OAuth do Google para
// a clínica do usuário logado, redirecionando para a tela de consentimento.
export async function GET(req: NextRequest) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.redirect(new URL("/login", resolverOrigemPublica(req)));

  // state = id do usuário, conferido no callback como proteção anti-CSRF
  const url = gerarUrlConsentimentoGoogle(usuario.id);
  return NextResponse.redirect(url);
}
