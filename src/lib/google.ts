// Integração Google Calendar/Meet (Tarefa 13) — OAuth por clínica (multi-tenant).
// Cada clínica conecta a própria conta Google; as credenciais do app (client
// id/secret/redirect) são únicas e ficam no .env.

import { google, calendar_v3, drive_v3, gmail_v1 } from "googleapis";
import { prisma } from "@/lib/prisma";
import type { Clinica } from "@/generated/prisma";
import type { NextRequest } from "next/server";
import { TIMEZONE } from "@/lib/timezone";

// calendar.events cobre a integração de agenda/Meet; userinfo.email é só
// para exibir o e-mail da conta conectada na tela de Configurações — sem
// esse escopo, oauth2.userinfo.get() responde 401 (a busca do e-mail já é
// tolerante a essa falha, mas o escopo certo evita o erro na origem).
// drive.file é o escopo mínimo do Drive: só enxerga/edita arquivos e pastas
// criados pelo próprio app — nunca os demais arquivos do Drive da clínica.
// gmail.send só permite enviar e-mail em nome da clínica — não lê a caixa.
export const ESCOPO_DRIVE = "https://www.googleapis.com/auth/drive.file";
export const ESCOPO_GMAIL = "https://www.googleapis.com/auth/gmail.send";
const ESCOPOS_GOOGLE = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/userinfo.email",
  ESCOPO_DRIVE,
  ESCOPO_GMAIL,
];

// Confere se a última autorização OAuth da clínica concedeu um escopo
// específico — usado pra saber se dá pra compartilhar pasta/mandar e-mail
// sem precisar tentar a chamada pra descobrir.
export function clinicaTemEscopo(clinica: Pick<Clinica, "googleEscopos">, escopo: string): boolean {
  return (clinica.googleEscopos ?? "").split(" ").includes(escopo);
}

// Pronta pra "Compartilhar pasta e enviar boas-vindas": conectada e com os
// dois escopos (Drive + Gmail) concedidos na autorização.
export function clinicaProntaParaCompartilhar(
  clinica: Pick<Clinica, "googleConectado" | "googleEscopos">
): boolean {
  return clinica.googleConectado && clinicaTemEscopo(clinica, ESCOPO_DRIVE) && clinicaTemEscopo(clinica, ESCOPO_GMAIL);
}

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

// Cliente pronto do Google Drive para a clínica, ou null se ela não tiver a
// integração conectada — mesmo padrão do obterCalendarDaClinica.
export async function obterDriveDaClinica(clinica: Clinica): Promise<drive_v3.Drive | null> {
  const auth = await obterClienteGoogleDaClinica(clinica);
  if (!auth) return null;
  return google.drive({ version: "v3", auth });
}

// Cria a pasta de um paciente dentro da pasta-mãe configurada pela clínica.
// Tolerante a falha: qualquer erro (pasta-mãe inválida, permissão, rede)
// devolve tudo null — o cadastro do paciente nunca deve travar por causa
// disso, a pasta pode ser criada/vinculada manualmente depois.
export async function criarPastaPacienteDrive(
  drive: drive_v3.Drive,
  pastaRaizDriveId: string,
  nomePaciente: string
): Promise<{ pastaDriveId: string | null; pastaDriveUrl: string | null }> {
  try {
    const { data } = await drive.files.create({
      requestBody: {
        name: nomePaciente,
        mimeType: "application/vnd.google-apps.folder",
        parents: [pastaRaizDriveId],
      },
      fields: "id, webViewLink",
    });

    return { pastaDriveId: data.id ?? null, pastaDriveUrl: data.webViewLink ?? null };
  } catch (err) {
    console.error("Falha ao criar pasta do paciente no Google Drive:", err);
    return { pastaDriveId: null, pastaDriveUrl: null };
  }
}

// Compartilha a pasta do paciente com o e-mail informado, permissão de
// leitura. sendNotificationEmail:false porque o e-mail de boas-vindas
// (enviarEmailBoasVindas) já avisa o paciente — evita duplicar com o aviso
// genérico do próprio Google. Tolerante a falha: nunca lança.
export async function compartilharPastaComEmail(
  drive: drive_v3.Drive,
  pastaDriveId: string,
  email: string
): Promise<{ compartilhado: boolean }> {
  try {
    await drive.permissions.create({
      fileId: pastaDriveId,
      sendNotificationEmail: false,
      requestBody: { role: "reader", type: "user", emailAddress: email },
    });
    return { compartilhado: true };
  } catch (err) {
    console.error("Falha ao compartilhar pasta do Drive:", err);
    return { compartilhado: false };
  }
}

// Cliente pronto do Gmail para a clínica, ou null se ela não tiver a
// integração conectada — mesmo padrão do obterCalendarDaClinica.
export async function obterGmailDaClinica(clinica: Clinica): Promise<gmail_v1.Gmail | null> {
  const auth = await obterClienteGoogleDaClinica(clinica);
  if (!auth) return null;
  return google.gmail({ version: "v1", auth });
}

function codificarAssuntoMime(assunto: string): string {
  return `=?UTF-8?B?${Buffer.from(assunto, "utf-8").toString("base64")}?=`;
}

function base64UrlEncode(texto: string): string {
  return Buffer.from(texto, "utf-8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function montarMensagemGmailRaw(para: string, assunto: string, corpoHtml: string): string {
  const mensagem = [
    `To: ${para}`,
    `Subject: ${codificarAssuntoMime(assunto)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(corpoHtml, "utf-8").toString("base64"),
  ].join("\r\n");
  return base64UrlEncode(mensagem);
}

// Envia o e-mail de boas-vindas pela conta Gmail conectada da clínica (o
// "From" fica a cargo do próprio Gmail — sempre a conta autenticada, nunca
// um remetente arbitrário). Tolerante a falha: nunca lança.
export async function enviarEmailBoasVindas(
  gmail: gmail_v1.Gmail,
  para: string,
  assunto: string,
  corpoHtml: string
): Promise<{ enviado: boolean }> {
  try {
    await gmail.users.messages.send({
      userId: "me",
      requestBody: { raw: montarMensagemGmailRaw(para, assunto, corpoHtml) },
    });
    return { enviado: true };
  } catch (err) {
    console.error("Falha ao enviar e-mail de boas-vindas via Gmail:", err);
    return { enviado: false };
  }
}

// Cria o evento no Google Calendar com Meet automático. Retorna os campos
// prontos para gravar no Agendamento — ou tudo null se a chamada falhar,
// para nunca impedir a criação/edição da sessão local.
export async function criarEventoGoogleMeet(
  calendar: calendar_v3.Calendar,
  googleCalendarId: string,
  dados: { titulo: string; inicio: Date; duracaoMin: number }
): Promise<{ googleEventId: string | null; googleCalendarId: string | null; linkMeet: string | null }> {
  try {
    const fim = new Date(dados.inicio.getTime() + dados.duracaoMin * 60_000);
    const { data: evento } = await calendar.events.insert({
      calendarId: googleCalendarId,
      conferenceDataVersion: 1,
      requestBody: {
        summary: dados.titulo,
        start: { dateTime: dados.inicio.toISOString(), timeZone: TIMEZONE },
        end: { dateTime: fim.toISOString(), timeZone: TIMEZONE },
        conferenceData: {
          createRequest: {
            requestId: crypto.randomUUID(),
            conferenceSolutionKey: { type: "hangoutsMeet" },
          },
        },
      },
    });

    return {
      googleEventId: evento.id ?? null,
      googleCalendarId,
      linkMeet: evento.hangoutLink ?? null,
    };
  } catch (err) {
    console.error("Falha ao criar evento no Google Calendar:", err);
    return { googleEventId: null, googleCalendarId: null, linkMeet: null };
  }
}
