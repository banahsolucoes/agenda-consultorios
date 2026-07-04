// Integração Google Calendar/Meet (Tarefa 13) — OAuth por clínica (multi-tenant).
// Cada clínica conecta a própria conta Google; as credenciais do app (client
// id/secret/redirect) são únicas e ficam no .env.

import { google, calendar_v3 } from "googleapis";
import { prisma } from "@/lib/prisma";
import type { Clinica } from "@/generated/prisma";
import type { NextRequest } from "next/server";

const ESCOPOS_GOOGLE = ["https://www.googleapis.com/auth/calendar.events"];

// Reconstrói a origem pública da requisição para montar redirects internos
// (ex.: de volta pra /painel/configuracoes após o callback OAuth). Usar
// req.url/req.nextUrl.origin direto quebra atrás de proxy: no Codespaces, por
// exemplo, o Host encaminhado ao processo Next.js pode chegar como
// "<nome>-3000.app.github.dev:3000" — a porta interna colada num domínio
// público que já serve em 443, gerando um ":3000" a mais na URL final. Damos
// prioridade aos headers x-forwarded-* (é para isso que existem) e, quando o
// protocolo é https, descartamos qualquer porta pendurada no host — domínio
// público https não usa porta explícita. Em http (dev local) a porta é
// mantida normalmente.
export function resolverOrigemPublica(req: NextRequest): string {
  const proto = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "");
  let host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? req.nextUrl.host;

  if (proto === "https" && host.includes(":")) {
    host = host.split(":")[0];
  }

  return `${proto}://${host}`;
}

function criarOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

// Gera a URL de consentimento do Google. access_type=offline + prompt=consent
// são obrigatórios para garantir o refresh_token (sem isso o Google só manda
// o refresh_token na primeira autorização de todas — e não temos como saber
// se é a primeira vez para uma clínica).
export function gerarUrlConsentimentoGoogle(state: string) {
  const client = criarOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: ESCOPOS_GOOGLE,
    state,
  });
}

// Troca o "code" recebido no callback OAuth pelos tokens de acesso.
export async function trocarCodePorTokensGoogle(code: string) {
  const client = criarOAuthClient();
  const { tokens } = await client.getToken(code);
  return tokens;
}

// Monta um OAuth2Client autenticado para a clínica, renovando o access token
// automaticamente quando estiver expirado (ou perto disso) e persistindo a
// renovação no banco. Retorna null se a clínica não tiver o Google conectado.
export async function obterClienteGoogleDaClinica(clinica: Clinica) {
  if (!clinica.googleConectado || !clinica.googleRefreshToken) return null;

  const client = criarOAuthClient();
  client.setCredentials({
    refresh_token: clinica.googleRefreshToken,
    access_token: clinica.googleAccessToken ?? undefined,
    expiry_date: clinica.googleTokenExpiry?.getTime(),
  });

  // A lib dispara "tokens" toda vez que renova o access token sozinha (ou
  // recebe um refresh_token novo). Persistimos aqui para a próxima chamada
  // já reaproveitar o token válido em vez de renovar de novo.
  client.on("tokens", (tokens) => {
    prisma.clinica
      .update({
        where: { id: clinica.id },
        data: {
          ...(tokens.access_token ? { googleAccessToken: tokens.access_token } : {}),
          ...(tokens.expiry_date ? { googleTokenExpiry: new Date(tokens.expiry_date) } : {}),
          ...(tokens.refresh_token ? { googleRefreshToken: tokens.refresh_token } : {}),
        },
      })
      .catch((err) => console.error("Falha ao persistir tokens do Google:", err));
  });

  // Garante um access token válido já na saída da função (mesmo que o caller
  // não faça nenhuma chamada de API imediatamente depois).
  const expiraEm = clinica.googleTokenExpiry?.getTime() ?? 0;
  if (expiraEm < Date.now() + 60_000) {
    await client.getAccessToken();
  }

  return client;
}

// Cliente pronto do Google Calendar para a clínica, ou null se ela não tiver
// a integração conectada (o caller deve tratar isso como "sem integração",
// sem quebrar o fluxo local).
export async function obterCalendarDaClinica(
  clinica: Clinica
): Promise<calendar_v3.Calendar | null> {
  const auth = await obterClienteGoogleDaClinica(clinica);
  if (!auth) return null;
  return google.calendar({ version: "v3", auth });
}
