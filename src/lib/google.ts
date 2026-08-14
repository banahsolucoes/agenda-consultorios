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
  "https://www.googleapis.com/auth/spreadsheets.readonly",
];

// Calendário Google dedicado a reuniões de mentoria (2026-08-06) — toda
// reunião de mentorado (Agendamento.alunoId presente) sincroniza aqui,
// NUNCA no calendário clínico (nem TipoSessao.googleCalendarId de outro
// tipo, nem Clinica.googleCalendarId, nem "primary" são fallback válido
// pra mentorado — ver resolverCalendarIdMentorado abaixo).
// Valor fixo porque hoje só existe uma clínica ativa (Fono Pâmela Rachid).
// DÍVIDA (2026-08-06): quando houver uma 2ª clínica, isso precisa virar
// um campo por-clínica (ex.: Clinica.googleCalendarIdMentoria) — ver
// ARCHITECTURE.md §9. Não implementado agora por decisão explícita (fora
// de escopo deste bloco, sem migração).
export const CALENDAR_MENTORIA_ID =
  "c_8c7a8a487847433ebcac52b67b3be7fdc90ddf1717dfed23c9014c82d6ce5111@group.calendar.google.com";

// Calendário de destino de uma reunião de mentorado — sempre
// CALENDAR_MENTORIA_ID. Só existe uma forma de o resultado bater com o
// googleCalendarId de um TipoSessao: o próprio tipo já apontar pra esse
// mesmo calendário (coincide, não é fallback). Chamar em todo ponto de
// sync (criar/editar/mover/cancelar/status) que uma sessão com alunoId
// possa atravessar — nunca deixar cair na cadeia clínica
// (tipoSessao.googleCalendarId / clinica.googleCalendarId / "primary").
export function resolverCalendarIdMentorado(tipoSessaoGoogleCalendarId?: string | null): string {
  return tipoSessaoGoogleCalendarId === CALENDAR_MENTORIA_ID ? tipoSessaoGoogleCalendarId : CALENDAR_MENTORIA_ID;
}

// Detecta se um erro de chamada à API do Google é especificamente token
// revogado/expirado de verdade (não um erro transitório de rede/quota) —
// confirmado por teste controlado: err.response.data.error === "invalid_grant"
// nesse formato tanto num refresh direto quanto numa chamada de API que
// dispara refresh internamente (googleapis/gaxios).
export function ehErroTokenRevogado(err: unknown): boolean {
  const data = (err as { response?: { data?: { error?: string } } })?.response?.data;
  return data?.error === "invalid_grant";
}

// Persiste a "saúde real" da conexão quando o erro é invalid_grant — separado
// de `googleConectado`, que só muda por ação manual do usuário (conectar/
// desconectar). Chamado nos 6 catches que fazem chamada de API — melhor
// esforço, nunca lança (se o próprio update falhar, só loga). Exportado
// porque a checagem noturna (GET /api/cron/verificar-google-noturno) chama
// a API por fora dessas 6 funções (events.list) e precisa da mesma lógica.
export async function marcarFalhaTokenSeRevogado(clinicaId: string, err: unknown): Promise<void> {
  if (!ehErroTokenRevogado(err)) return;
  await prisma.clinica
    .update({
      where: { id: clinicaId },
      data: { googleTokenValido: false, googleUltimaFalhaEm: new Date() },
    })
    .catch((updateErr) => console.error("Falha ao marcar googleTokenValido=false:", updateErr));
}

// Janela de "recente" pro popup/banner reagirem a uma falha do outbox de
// sincronização (googleUltimoErro/googleUltimoErroEm) mesmo quando o token
// em si continua válido (erro transitório, quota, escopo insuficiente etc.
// — não só invalid_grant). 2h cobre várias tentativas de backoff do outbox
// (1min/5min/30min/2h/6h) sem deixar o alerta aceso por muito tempo depois
// que o problema já foi resolvido — marcarConcluido() em sincronizacao.ts
// limpa o campo assim que qualquer sincronização daquela clínica funciona
// de novo, então na prática o alerta some antes disso na maioria dos casos.
const JANELA_ERRO_RECENTE_MS = 2 * 60 * 60 * 1000;

// Fonte única de verdade de "a conexão Google desta clínica está com
// problema real" — usada tanto pelo banner/contagem de `GET /api/notificacoes`
// quanto pelo popup global de reconexão (`GET
// /api/integracoes/google/reconexao-status`). Clínica nunca conectada não
// conta como problema (não há nada pra reconectar de verdade — é estado
// inicial, não uma queda).
export function googlePrecisaReconectar(
  clinica: Pick<Clinica, "googleConectado" | "googleTokenValido" | "googleUltimoErroEm">
): boolean {
  const erroRecente =
    clinica.googleUltimoErroEm !== null &&
    Date.now() - clinica.googleUltimoErroEm.getTime() < JANELA_ERRO_RECENTE_MS;
  return Boolean(clinica.googleConectado && (!clinica.googleTokenValido || erroRecente));
}

// Opção comum às funções de chamada Google deste módulo: por padrão elas são
// tolerantes a falha (retornam um sentinel null/false, nunca lançam) — é o
// que os call sites síncronos existentes esperam e continuam recebendo sem
// passar nada aqui. propagarErro:true inverte isso (usado pelo outbox e por
// compartilhar-pasta/route.ts): a função ainda loga e chama
// marcarFalhaTokenSeRevogado como sempre, mas relança o erro original em vez
// de engolir — só assim o chamador consegue o código HTTP/mensagem reais do
// Google (ver extrairErroGoogle) em vez de um "falhou" genérico.
type OpcoesChamadaGoogle = { propagarErro?: boolean };

// Extrai código HTTP + mensagem de um erro de chamada à API do Google, nos
// dois formatos que a lib emite: erro de token (err.response.data.error é
// string, ex.: "invalid_grant") e erro de API REST comum (err.response.data
// .error é objeto, ex.: { code, message, errors }). Usado pelo outbox
// (sincronizacao.ts) e por qualquer chamador síncrono que opte por
// propagarErro:true, para persistir o motivo real da falha em vez de um
// "falhou" genérico.
export function extrairErroGoogle(err: unknown): { codigo: string; mensagem: string } {
  const resp = (
    err as {
      response?: {
        status?: number;
        data?: { error?: string | { message?: string }; error_description?: string };
      };
      code?: number | string;
    }
  ).response;
  const data = resp?.data;

  let mensagem: string;
  if (typeof data?.error === "string") {
    mensagem = data.error_description ? `${data.error}: ${data.error_description}` : data.error;
  } else if (data?.error && typeof data.error === "object" && typeof data.error.message === "string") {
    mensagem = data.error.message;
  } else if (err instanceof Error) {
    mensagem = err.message;
  } else {
    mensagem = String(err);
  }

  const codigoBruto = resp?.status ?? (err as { code?: number | string })?.code;
  const codigo = codigoBruto !== undefined ? String(codigoBruto) : "??";

  return { codigo, mensagem };
}

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

// Busca a clínica pelo id e já resolve o client do Calendar numa única
// chamada — ponto único usado por toda operação que precisa sincronizar ou
// remover eventos de sessões no Google. Retorna null se a clínica não
// existir ou não tiver a integração conectada; nunca lança.
export async function obterClinicaECalendar(
  clinicaId: string
): Promise<{ clinica: Clinica; calendar: calendar_v3.Calendar } | null> {
  const clinica = await prisma.clinica.findUnique({ where: { id: clinicaId } });
  if (!clinica) return null;
  const calendar = await obterCalendarDaClinica(clinica).catch(() => null);
  if (!calendar) return null;
  return { clinica, calendar };
}

// Cliente pronto do Google Drive para a clínica, ou null se ela não tiver a
// integração conectada — mesmo padrão do obterCalendarDaClinica.
export async function obterDriveDaClinica(clinica: Clinica): Promise<drive_v3.Drive | null> {
  const auth = await obterClienteGoogleDaClinica(clinica);
  if (!auth) return null;
  return google.drive({ version: "v3", auth });
}

// Confirma que um ID de pasta do Drive existe, é mesmo uma pasta e não está
// na lixeira, usando a conta conectada da clínica — usado antes de salvar a
// pasta-mãe em Configurações, pra pegar erro de digitação/pasta errada na
// hora, em vez de só quando a criação automática de pastas falhar depois.
export async function verificarPastaDriveAcessivel(
  drive: drive_v3.Drive,
  pastaId: string,
  clinicaId: string
): Promise<boolean> {
  try {
    const { data } = await drive.files.get({ fileId: pastaId, fields: "id, mimeType, trashed" });
    return data.mimeType === "application/vnd.google-apps.folder" && !data.trashed;
  } catch (err) {
    console.error("Falha ao verificar pasta do Drive:", err);
    await marcarFalhaTokenSeRevogado(clinicaId, err);
    return false;
  }
}

// Cria a pasta de um paciente dentro da pasta-mãe configurada pela clínica.
// Tolerante a falha: qualquer erro (pasta-mãe inválida, permissão, rede)
// devolve tudo null — o cadastro do paciente nunca deve travar por causa
// disso, a pasta pode ser criada/vinculada manualmente depois.
export async function criarPastaPacienteDrive(
  drive: drive_v3.Drive,
  pastaRaizDriveId: string,
  nomePaciente: string,
  clinicaId: string,
  opcoes: OpcoesChamadaGoogle = {}
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
    await marcarFalhaTokenSeRevogado(clinicaId, err);
    if (opcoes.propagarErro) throw err;
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
  email: string,
  clinicaId: string,
  opcoes: OpcoesChamadaGoogle = {}
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
    await marcarFalhaTokenSeRevogado(clinicaId, err);
    if (opcoes.propagarErro) throw err;
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
  corpoHtml: string,
  clinicaId: string,
  opcoes: OpcoesChamadaGoogle = {}
): Promise<{ enviado: boolean }> {
  try {
    await gmail.users.messages.send({
      userId: "me",
      requestBody: { raw: montarMensagemGmailRaw(para, assunto, corpoHtml) },
    });
    return { enviado: true };
  } catch (err) {
    console.error("Falha ao enviar e-mail de boas-vindas via Gmail:", err);
    await marcarFalhaTokenSeRevogado(clinicaId, err);
    if (opcoes.propagarErro) throw err;
    return { enviado: false };
  }
}

// Paleta fixa de cores de evento do Google Calendar (colors.event da API
// v3 — os colorId 1–11 são os únicos aceitos, cada um com um hex fixo do
// lado do Google). Cada tipo de sessão tem uma cor livre (hex) cadastrada
// pela clínica; aqui mapeamos para o colorId mais próximo por distância
// euclidiana em RGB — best-effort, nunca impede a sincronização do evento.
const PALETA_CORES_GOOGLE: Record<string, string> = {
  "1": "a4bdfc", "2": "7ae7bf", "3": "dbadff", "4": "ff887c", "5": "fbd75b",
  "6": "ffb878", "7": "46d6db", "8": "e1e1e1", "9": "5484ed", "10": "51b749", "11": "dc2127",
};

function hexParaRgb(hex: string): [number, number, number] | null {
  const limpo = hex.replace("#", "").trim();
  if (!/^[0-9a-fA-F]{6}$/.test(limpo)) return null;
  return [parseInt(limpo.slice(0, 2), 16), parseInt(limpo.slice(2, 4), 16), parseInt(limpo.slice(4, 6), 16)];
}

// Cor (hex) de um TipoSessao -> colorId do Google Calendar mais próximo.
// Retorna undefined se a cor não estiver definida ou for inválida — nesse
// caso o evento simplesmente não leva colorId (cor padrão do calendário).
export function mapearCorParaGoogleColorId(corHex: string | null | undefined): string | undefined {
  if (!corHex) return undefined;
  const alvo = hexParaRgb(corHex);
  if (!alvo) return undefined;

  let melhorId: string | undefined;
  let menorDistancia = Infinity;
  for (const [colorId, hex] of Object.entries(PALETA_CORES_GOOGLE)) {
    const rgb = hexParaRgb(hex)!;
    const distancia = (rgb[0] - alvo[0]) ** 2 + (rgb[1] - alvo[1]) ** 2 + (rgb[2] - alvo[2]) ** 2;
    if (distancia < menorDistancia) {
      menorDistancia = distancia;
      melhorId = colorId;
    }
  }
  return melhorId;
}

// Cria o evento no Google Calendar — com Meet automático quando `comMeet` é
// true (sessão online), ou um evento simples sem conferenceData quando false
// (sessão presencial: só marca o horário no Calendar). Retorna os campos
// prontos para gravar no Agendamento — ou tudo null se a chamada falhar,
// para nunca impedir a criação/edição da sessão local.
export async function criarEventoGoogleMeet(
  calendar: calendar_v3.Calendar,
  googleCalendarId: string,
  dados: { titulo: string; inicio: Date; duracaoMin: number; cor?: string | null },
  comMeet: boolean,
  clinicaId: string,
  opcoes: OpcoesChamadaGoogle = {}
): Promise<{ googleEventId: string | null; googleCalendarId: string | null; linkMeet: string | null }> {
  try {
    const fim = new Date(dados.inicio.getTime() + dados.duracaoMin * 60_000);
    const colorId = mapearCorParaGoogleColorId(dados.cor);
    const { data: evento } = await calendar.events.insert({
      calendarId: googleCalendarId,
      ...(comMeet ? { conferenceDataVersion: 1 } : {}),
      requestBody: {
        summary: dados.titulo,
        start: { dateTime: dados.inicio.toISOString(), timeZone: TIMEZONE },
        end: { dateTime: fim.toISOString(), timeZone: TIMEZONE },
        ...(colorId ? { colorId } : {}),
        ...(comMeet
          ? {
              conferenceData: {
                createRequest: {
                  requestId: crypto.randomUUID(),
                  conferenceSolutionKey: { type: "hangoutsMeet" },
                },
              },
            }
          : {}),
      },
    });

    return {
      googleEventId: evento.id ?? null,
      googleCalendarId,
      linkMeet: evento.hangoutLink ?? null,
    };
  } catch (err) {
    console.error("Falha ao criar evento no Google Calendar:", err);
    await marcarFalhaTokenSeRevogado(clinicaId, err);
    if (opcoes.propagarErro) throw err;
    return { googleEventId: null, googleCalendarId: null, linkMeet: null };
  }
}

// Ponto único que sincroniza o evento já existente de uma sessão de volta
// pro Google Calendar — data/hora (a partir de início + duração), e
// opcionalmente título e cor (colorId). Usado por toda operação que move,
// empurra, adia ou muda a duração/tipo/confirmação de uma sessão que já tem
// googleEventId. Melhor esforço: qualquer falha só é logada, nunca
// interrompe a operação local que já foi persistida — mas o caller ainda
// recebe se deu certo (para gravar googleSyncStatus), daí retornar boolean
// em vez de void.
export async function sincronizarEventoGoogle(
  calendar: calendar_v3.Calendar,
  googleCalendarId: string,
  eventId: string,
  dados: { inicio: Date; duracaoMin: number; titulo?: string; cor?: string | null },
  clinicaId: string,
  opcoes: OpcoesChamadaGoogle = {}
): Promise<boolean> {
  try {
    const fim = new Date(dados.inicio.getTime() + dados.duracaoMin * 60_000);
    const colorId = mapearCorParaGoogleColorId(dados.cor);
    await calendar.events.patch({
      calendarId: googleCalendarId,
      eventId,
      requestBody: {
        start: { dateTime: dados.inicio.toISOString(), timeZone: TIMEZONE },
        end: { dateTime: fim.toISOString(), timeZone: TIMEZONE },
        ...(dados.titulo ? { summary: dados.titulo } : {}),
        ...(colorId ? { colorId } : {}),
      },
    });
    return true;
  } catch (err) {
    console.error("Falha ao atualizar evento no Google Calendar:", err);
    await marcarFalhaTokenSeRevogado(clinicaId, err);
    if (opcoes.propagarErro) throw err;
    return false;
  }
}

// Remove o evento de uma sessão do Google Calendar. Um evento já ausente
// (404/410 — apagado manualmente, ou remoção reprocessada pelo outbox após
// falha registrada mas efetivada do lado do Google) conta como sucesso: o
// resultado desejado (evento não existe mais) já está garantido. Melhor
// esforço, mesmo padrão das demais funções deste módulo — nunca lança.
export async function removerEventoGoogle(
  calendar: calendar_v3.Calendar,
  googleCalendarId: string,
  eventId: string,
  clinicaId: string,
  opcoes: OpcoesChamadaGoogle = {}
): Promise<boolean> {
  try {
    await calendar.events.delete({ calendarId: googleCalendarId, eventId });
    return true;
  } catch (err) {
    const status = (err as { code?: number; response?: { status?: number } })?.response?.status ?? (err as { code?: number })?.code;
    if (status === 404 || status === 410) return true;
    console.error("Falha ao remover evento no Google Calendar:", err);
    await marcarFalhaTokenSeRevogado(clinicaId, err);
    if (opcoes.propagarErro) throw err;
    return false;
  }
}
