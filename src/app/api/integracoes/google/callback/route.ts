import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getUsuarioLogado } from "@/lib/auth";
import { trocarCodePorTokensGoogle, resolverOrigemPublica } from "@/lib/google";
import { pode } from "@/lib/permissoes";

// Página mínima servida quando o callback foi aberto num popup
// (GoogleReconexaoModal, via window.open com ?popup=1 em /conectar): avisa
// a janela que abriu (window.opener) pelo postMessage e se fecha sozinha —
// preserva a tela original, sem redirect/reload. postMessage restrito à
// própria origem (nunca "*") para não vazar o resultado a um listener
// alheio caso o popup tenha sido, por algum motivo, aberto a partir de
// outra origem. Fallback visível (texto + link) para o caso raro de
// window.close() ser bloqueado pelo navegador.
function respostaPopup(origem: string, sucesso: boolean): NextResponse {
  const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><title>Google</title></head>
<body>
<p>${sucesso ? "Conectado com sucesso." : "Não foi possível conectar."} Você pode fechar esta janela.</p>
<script>
  (function () {
    try {
      if (window.opener) {
        window.opener.postMessage({ tipo: "google-oauth-resultado", ok: ${sucesso} }, ${JSON.stringify(origem)});
      }
    } catch (e) {}
    window.close();
  })();
</script>
</body></html>`;
  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}

// GET /api/integracoes/google/callback — recebe o "code" do Google, troca
// pelos tokens e salva na clínica do usuário logado. Responde de dois jeitos
// dependendo de como /conectar foi chamado (ver marca ":popup" no state):
// popup (GoogleReconexaoModal) -> postMessage + window.close(); navegação
// normal (botão em Configurações → Integrações) -> redirect de sempre.
export async function GET(req: NextRequest) {
  const origem = resolverOrigemPublica(req);
  const destino = new URL("/painel/configuracoes/integracoes", origem);

  const usuario = await getUsuarioLogado();
  if (!usuario) return NextResponse.redirect(new URL("/login", origem));
  if (!pode(usuario.papel, "gerirIntegracoes")) {
    return NextResponse.json({ erro: "sem permissão para esta ação" }, { status: 403 });
  }

  const code = req.nextUrl.searchParams.get("code");
  const stateBruto = req.nextUrl.searchParams.get("state");
  const erroGoogle = req.nextUrl.searchParams.get("error");

  // state = "<usuarioId>" ou "<usuarioId>:popup" (ver /conectar) — só o
  // primeiro pedaço importa pra checagem anti-CSRF.
  const [stateUsuarioId, stateModo] = (stateBruto ?? "").split(":");
  const ehPopup = stateModo === "popup";

  // state precisa bater com o usuário que iniciou o fluxo em /conectar
  if (erroGoogle || !code || stateUsuarioId !== usuario.id) {
    if (ehPopup) return respostaPopup(origem, false);
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
        // Reconectar com sucesso é prova de que o token voltou a funcionar —
        // limpa o estado de falha que a detecção de invalid_grant (google.ts)
        // possa ter marcado, e também o alerta genérico do outbox
        // (googleUltimoErro/Em, 2026-08-14) — sem isso, o popup de reconexão
        // podia continuar aparecendo logo após reconectar com sucesso, se
        // houvesse uma falha recente do outbox dentro da janela de 2h
        // (ver googlePrecisaReconectar).
        googleTokenValido: true,
        googleUltimaFalhaEm: null,
        googleUltimoErro: null,
        googleUltimoErroEm: null,
      },
    });

    if (ehPopup) return respostaPopup(origem, true);
    destino.searchParams.set("google_conectado", "1");
  } catch (err) {
    console.error("Falha ao concluir OAuth do Google:", err);
    if (ehPopup) return respostaPopup(origem, false);
    destino.searchParams.set("google_erro", "1");
  }

  return NextResponse.redirect(destino);
}
