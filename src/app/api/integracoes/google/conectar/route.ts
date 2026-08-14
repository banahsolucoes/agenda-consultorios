import { NextRequest, NextResponse } from "next/server";
import { getUsuarioLogado } from "@/lib/auth";
import { gerarUrlConsentimentoGoogle, resolverOrigemPublica } from "@/lib/google";
import { pode } from "@/lib/permissoes";

// GET /api/integracoes/google/conectar — inicia o fluxo OAuth do Google para
// a clínica do usuário logado, redirecionando para a tela de consentimento.
// ?popup=1 (usado pelo GoogleReconexaoModal global, aberto via window.open)
// marca o modo no próprio state — o callback usa essa marca pra responder
// com postMessage + window.close() em vez de redirecionar de volta pro app,
// preservando a tela que abriu o popup. Sem o parâmetro, comportamento
// idêntico ao de sempre (usado pelo botão "Conectar Google" em
// Configurações → Integrações, navegação de página inteira).
export async function GET(req: NextRequest) {
  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.redirect(new URL("/login", resolverOrigemPublica(req)));
  if (!pode(usuario.papel, "gerirIntegracoes")) {
    return NextResponse.json({ erro: "sem permissão para esta ação" }, { status: 403 });
  }

  // state = id do usuário (+ marca de popup, opcional), conferido no
  // callback como proteção anti-CSRF — usuario.id nunca contém ":", então
  // separar por ":" na volta é seguro.
  const ehPopup = req.nextUrl.searchParams.get("popup") === "1";
  const state = ehPopup ? `${usuario.id}:popup` : usuario.id;
  const url = gerarUrlConsentimentoGoogle(state);
  return NextResponse.redirect(url);
}
