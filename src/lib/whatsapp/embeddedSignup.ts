// Constantes do Embedded Signup da Meta (conexão de número pela própria
// clínica, modo Coexistência — 2026-11-06). Nada aqui é segredo: App ID e
// Config ID vão para o navegador de qualquer forma (FB.init/FB.login). O app
// secret continua só no servidor (WHATSAPP_APP_SECRET), lido na rota
// POST /api/whatsapp/conectar.
//
// Arquivo importado tanto pela página client (/painel/whatsapp/conectar)
// quanto pela rota — por isso não pode importar nada server-only.

export const META_APP_ID = "27563363136688889";
export const META_EMBEDDED_SIGNUP_CONFIG_ID = "2264260030820779";
export const META_FEATURE_TYPE_COEXISTENCIA = "whatsapp_business_app_onboarding";

// Mesma versão da Graph API usada em enviarMensagem.ts/enviarTemplate.ts.
export const META_GRAPH_API_VERSION = "v25.0";
