// Outbox de sincronização com o Google (Calendar/Drive) — Tarefa "hardening
// da integração Google", ETAPA 3. Tira a chamada Google do caminho síncrono
// da requisição do usuário: o dado local já foi gravado antes de enfileirar
// (enfileirar nunca lança), e este worker processa a fila com retry/backoff,
// sempre relendo o registro de origem do banco no momento do processamento —
// o payload guarda só IDs de referência, nunca token, credencial ou dado
// clínico. GMAIL_ENVIAR não é implementado aqui — ver nota antes do switch.
import { Prisma } from "@/generated/prisma";
import type { SincronizacaoTipo, SincronizacaoStatus } from "@/generated/prisma";
import { after } from "next/server";
import { prisma } from "@/lib/prisma";
import {
  obterCalendarDaClinica,
  obterDriveDaClinica,
  criarEventoGoogleMeet,
  sincronizarEventoGoogle,
  removerEventoGoogle,
  criarPastaPacienteDrive,
  resolverCalendarIdMentorado,
  extrairErroGoogle,
  eventoGoogleAusenteOuCancelado,
} from "@/lib/google";
import { formatarTituloAgendamento, formatarTituloMentorado } from "@/lib/blocoAgenda";

// Backoff por número de tentativas já feitas (1ª falha usa o índice 0, 1min;
// 5ª falha usa o índice 4, 6h). Na 6ª falha (tentativas > 5) o item vira
// FALHA definitivo em vez de reagendar — ver nota em registrarFalhaItem.
const BACKOFF_MINUTOS = [1, 5, 30, 120, 360];
const MAX_TENTATIVAS = 5;
const TRAVADO_APOS_MS = 15 * 60_000;

// Lote do disparo imediato pós-enfileiramento — bem menor que o
// LIMITE_POR_EXECUCAO=25 do cron (cron/sincronizacao/route.ts), porque este
// roda dentro de after() depois de uma rota que já fez seu próprio trabalho
// (gravar o agendamento) e não tem orçamento de tempo dedicado só a isso.
const LOTE_IMEDIATO = 5;

type LinhaFila = {
  id: string;
  clinicaId: string;
  tipo: SincronizacaoTipo;
  payload: Prisma.JsonValue;
  status: SincronizacaoStatus;
  tentativas: number;
  proximaTentativaEm: Date;
  ultimoErro: string | null;
  createdAt: Date;
  updatedAt: Date;
};

// Cria o registro PENDENTE. Nunca lança: enfileirar é chamado no meio de
// rotas que já gravaram o dado principal no banco — uma falha aqui (ex.:
// banco fora do ar por um instante) não pode derrubar a resposta ao
// usuário. Pior caso: a sincronização daquele evento nunca acontece e só
// aparece como divergência na checagem noturna (verificar-google-noturno).
export async function enfileirar(
  clinicaId: string,
  tipo: SincronizacaoTipo,
  payload: Prisma.InputJsonValue
): Promise<void> {
  try {
    await prisma.sincronizacaoPendente.create({ data: { clinicaId, tipo, payload } });
  } catch (err) {
    console.error(`[sincronizacao] Falha ao enfileirar ${tipo} (clínica ${clinicaId}):`, err);
    return;
  }

  dispararProcessamentoImediato();
}

// Reduz a latência entre "usuário mudou o horário" e "Google atualizado":
// sem isso, a mudança só chega ao Google quando o cron externo rodar (até
// 10min de atraso — ver .github/workflows/sincronizacao.yml). Dispara um
// lote pequeno (LOTE_IMEDIATO) via after() (next/server), que mantém a
// invocação serverless viva depois da resposta HTTP já ter sido enviada ao
// usuário — nenhum await aqui, então nunca bloqueia a resposta da rota que
// chamou enfileirar(). O cron de 10min continua existindo como rede de
// segurança: qualquer coisa que este disparo não pegar (function reciclada
// antes do after() terminar, erro transiente, disparo fora de request scope)
// fica na fila do mesmo jeito e é varrida por ele depois.
//
// after() lança se chamado fora de um request scope (rota HTTP/Server
// Function/Proxy) — acontece quando enfileirar() roda a partir de um script
// standalone (scripts/_*.mjs) ou quando o próprio worker se auto-chama fora
// de uma rota. Sem problema: é só um atalho de latência que não se aplica
// nesse contexto, por isso o try/catch aqui nunca deixa esse erro escapar
// para enfileirar() — que é o que a rota HTTP realmente depende de não
// lançar (o registro já está gravado na fila de qualquer forma).
function dispararProcessamentoImediato(): void {
  try {
    after(async () => {
      try {
        await processarPendentes(LOTE_IMEDIATO);
      } catch (err) {
        console.error("[sincronizacao] Falha no processamento imediato (after):", err);
      }
    });
  } catch (err) {
    console.error("[sincronizacao] Não foi possível agendar processamento imediato (after fora de request scope?):", err);
  }
}

// Cancelamento de sessão: enfileira CALENDAR_REMOVER e, na MESMA transação,
// supersede (marca CONCLUIDO com ultimoErro explicativo, nunca deleta a
// linha) qualquer CALENDAR_CRIAR/CALENDAR_ATUALIZAR ainda PENDENTE para o
// mesmo agendamento. Sem isso: cancela a sessão -> um CRIAR que já estava na
// fila (de uma edição anterior, por exemplo) roda depois e recria o evento
// no Google — a sessão fica cancelada no banco mas "viva" no Calendar
// (evento fantasma). Chamado incondicionalmente (mesmo sem googleEventId —
// pode haver só um CRIAR pendente, sem evento ainda criado) — o worker
// resolve um REMOVER sem googleEventId como CONCLUIDO sem chamar o Google
// (ver processarCalendarRemover), então enfileirar aqui é sempre seguro,
// nunca gera uma chamada desnecessária. Nunca lança: mesmo princípio de
// enfileirar() — cancelamento já commitado no banco não pode ser bloqueado
// por isto.
export async function enfileirarRemocaoDeAgendamento(clinicaId: string, agendamentoId: string): Promise<void> {
  try {
    await prisma.$transaction([
      prisma.sincronizacaoPendente.updateMany({
        where: {
          clinicaId,
          status: "PENDENTE",
          tipo: { in: ["CALENDAR_CRIAR", "CALENDAR_ATUALIZAR"] },
          payload: { path: ["agendamentoId"], equals: agendamentoId },
        },
        data: { status: "CONCLUIDO", ultimoErro: "superseded por cancelamento" },
      }),
      prisma.sincronizacaoPendente.create({
        data: { clinicaId, tipo: "CALENDAR_REMOVER", payload: { agendamentoId } },
      }),
    ]);
  } catch (err) {
    console.error(
      `[sincronizacao] Falha ao enfileirar remoção (com supersede) do agendamento ${agendamentoId} (clínica ${clinicaId}):`,
      err
    );
  }
}

// Claim atômico via UPDATE ... RETURNING com subquery FOR UPDATE SKIP LOCKED
// — abordagem escolhida (ao invés de updateMany + select separado) porque o
// Prisma Client não expõe "RETURNING" em updateMany; um select seguido de
// update teria uma janela onde dois crons concorrentes leem as mesmas linhas
// PENDENTE antes de qualquer um marcar PROCESSANDO. Com FOR UPDATE SKIP
// LOCKED, se dois processos rodarem a mesma query ao mesmo tempo, cada linha
// só pode ser reivindicada por um deles — o outro pula para a próxima linha
// livre em vez de bloquear ou duplicar o claim. Tudo em uma única
// instrução SQL, então a transição PENDENTE -> PROCESSANDO e a leitura das
// linhas reivindicadas são atômicas.
export async function reivindicarLote(limite: number): Promise<LinhaFila[]> {
  return prisma.$queryRaw<LinhaFila[]>(Prisma.sql`
    UPDATE "SincronizacaoPendente"
    SET status = 'PROCESSANDO'::"SincronizacaoStatus", "updatedAt" = now()
    WHERE id IN (
      SELECT id
      FROM "SincronizacaoPendente"
      WHERE status = 'PENDENTE'::"SincronizacaoStatus" AND "proximaTentativaEm" <= now()
      ORDER BY "proximaTentativaEm" ASC
      LIMIT ${limite}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, "clinicaId", tipo, payload, status, tentativas, "proximaTentativaEm", "ultimoErro", "createdAt", "updatedAt"
  `);
}

// Itens presos em PROCESSANDO há mais de 15min (worker morreu no meio,
// função serverless matada por timeout, deploy no meio do processamento)
// voltam a PENDENTE para serem reivindicados de novo. Chamado no início de
// processarPendentes — uma corrida entre dois "recuperarTravados"
// concorrentes é inofensiva (o segundo updateMany não acha mais nada a
// recuperar).
export async function recuperarTravados(): Promise<number> {
  const limite = new Date(Date.now() - TRAVADO_APOS_MS);
  const resultado = await prisma.sincronizacaoPendente.updateMany({
    where: { status: "PROCESSANDO", updatedAt: { lt: limite } },
    data: { status: "PENDENTE" },
  });
  return resultado.count;
}

const LIMITE_ULTIMO_ERRO = 500;

// "HTTP {código}: {mensagem}" a partir do erro real do Google (via
// extrairErroGoogle, google.ts) — mensagem detalhada, não um "falhou"
// genérico, truncada em 500 caracteres pra caber no campo do banco.
function detalharErro(err: unknown): string {
  const { codigo, mensagem } = extrairErroGoogle(err);
  return `HTTP ${codigo}: ${mensagem}`.slice(0, LIMITE_ULTIMO_ERRO);
}

// Melhor esforço, nunca lança — mesmo padrão de marcarFalhaTokenSeRevogado
// em google.ts, mas aqui para QUALQUER tipo de erro (não só invalid_grant).
async function registrarErroNaClinica(clinicaId: string, mensagem: string): Promise<void> {
  await prisma.clinica
    .update({
      where: { id: clinicaId },
      data: { googleUltimoErro: mensagem, googleUltimoErroEm: new Date() },
    })
    .catch((err) => console.error(`[sincronizacao] Falha ao gravar googleUltimoErro na clínica ${clinicaId}:`, err));
}

// Marca o item concluído e limpa o alerta de erro da clínica — sem isso,
// googleUltimoErro/googleUltimoErroEm só são setados (nunca limpos), então o
// banner do painel continuaria "aceso" pela janela inteira de recência
// (ver notificacoes/route.ts) mesmo depois do problema já ter sido resolvido
// por um sucesso posterior. Melhor esforço, nunca lança.
async function marcarConcluido(item: LinhaFila): Promise<void> {
  await prisma.sincronizacaoPendente.update({
    where: { id: item.id },
    data: { status: "CONCLUIDO", ultimoErro: null },
  });
  await prisma.clinica
    .update({ where: { id: item.clinicaId }, data: { googleUltimoErro: null, googleUltimoErroEm: null } })
    .catch((err) => console.error(`[sincronizacao] Falha ao limpar googleUltimoErro da clínica ${item.clinicaId}:`, err));
}

// O Google Calendar não tem campo nativo de "status da sessão" — o mínimo
// aceitável (Bloco 5, 2026-07-25, herdado de sessoes/[id]/route.ts) é
// refletir no título do evento: ✅ quando confirmada, e um sufixo para os
// status que são desvio do "normal" (AGENDADA não leva sufixo). Movido para
// cá (era local à rota) porque agora é o worker, não a rota, quem monta o
// título — ele relê status/confirmada já atualizados no banco, então o
// resultado é idêntico ao que a rota calculava síncrono antes.
const SUFIXO_STATUS: Partial<Record<string, string>> = {
  REALIZADA: " — Realizada",
  NAO_REALIZADA: " — Não realizada",
  REAGENDADA: " — Reagendada",
};

function construirTitulo(agendamento: {
  aluno: { nomeCompleto: string } | null;
  paciente: { nome: string } | null;
  numeroSessao: number | null;
  totalPacote: number | null;
  tipoSessao: { nome: string; ehAtendimentoUnico: boolean } | null;
  confirmada: boolean;
  status: string;
}): string {
  const base = agendamento.aluno
    ? formatarTituloMentorado(agendamento.aluno.nomeCompleto)
    : formatarTituloAgendamento({
        nomePaciente: agendamento.paciente?.nome ?? "",
        tipoSessaoNome: agendamento.tipoSessao?.nome,
        ehAtendimentoUnico: agendamento.tipoSessao?.ehAtendimentoUnico ?? false,
        numeroSessao: agendamento.numeroSessao ?? 0,
        totalPacote: agendamento.totalPacote ?? 0,
      });
  return `${base}${agendamento.confirmada ? " ✅" : ""}${SUFIXO_STATUS[agendamento.status] ?? ""}`;
}

// Interpretação adotada para "backoff 1min/5min/30min/2h/6h ... após 5
// tentativas -> FALHA": os 5 valores de backoff são todos usados (1ª a 5ª
// falha cada uma agenda o próximo retry com o valor correspondente); só a
// 6ª falha (tentativas > 5) marca FALHA definitivo em vez de reagendar de
// novo. Sinalizado no relatório desta etapa — se a intenção era parar de
// tentar já na 5ª falha (usando só os 4 primeiros valores de backoff), é só
// avisar que ajusto.
async function registrarFalhaItem(item: LinhaFila, erro: unknown): Promise<void> {
  const mensagem = detalharErro(erro);
  console.error(`[sincronizacao] Falha ao processar item ${item.id} (${item.tipo}, clínica ${item.clinicaId}):`, erro);

  const tentativas = item.tentativas + 1;
  const dados: Prisma.SincronizacaoPendenteUpdateInput =
    tentativas > MAX_TENTATIVAS
      ? { status: "FALHA", tentativas, ultimoErro: mensagem }
      : {
          status: "PENDENTE",
          tentativas,
          ultimoErro: mensagem,
          proximaTentativaEm: new Date(Date.now() + BACKOFF_MINUTOS[tentativas - 1] * 60_000),
        };

  await prisma.sincronizacaoPendente
    .update({ where: { id: item.id }, data: dados })
    .catch((err) => console.error(`[sincronizacao] Falha ao gravar estado de falha do item ${item.id}:`, err));

  await registrarErroNaClinica(item.clinicaId, mensagem);
}

// --- Handlers por tipo -----------------------------------------------
// Cada handler relê o registro de origem do banco (nunca confia em nada
// além de IDs vindos do payload) e checa idempotência antes de chamar o
// Google: se o efeito já está persistido (googleEventId, pastaDriveUrl),
// não chama a API de novo — só confirma CONCLUIDO. Um handler que retorna
// normalmente é sucesso (inclusive quando não havia nada a fazer); lançar é
// a única forma de sinalizar falha para processarItem.

async function processarCalendarCriar(item: LinhaFila): Promise<void> {
  const { agendamentoId } = item.payload as { agendamentoId: string };
  const agendamento = await prisma.agendamento.findUnique({
    where: { id: agendamentoId },
    include: { paciente: true, aluno: true, tipoSessao: true },
  });
  if (!agendamento) return; // sessão não existe mais — nada a fazer
  if (agendamento.googleEventId) return; // idempotência: já sincronizado

  const clinica = await prisma.clinica.findUnique({ where: { id: item.clinicaId } });
  if (!clinica) throw new Error("clínica não encontrada");
  const calendar = await obterCalendarDaClinica(clinica);
  if (!calendar) throw new Error("Google não conectado para a clínica");

  const titulo = construirTitulo(agendamento);

  const googleCalendarId = agendamento.aluno
    ? resolverCalendarIdMentorado(agendamento.tipoSessao?.googleCalendarId)
    : agendamento.tipoSessao?.googleCalendarId ?? clinica.googleCalendarId ?? "primary";

  const comMeet = agendamento.tipoSessao?.ehOnline ?? false;

  const resultado = await criarEventoGoogleMeet(
    calendar,
    googleCalendarId,
    { titulo, inicio: agendamento.inicio, duracaoMin: agendamento.duracaoMin },
    comMeet,
    item.clinicaId,
    { propagarErro: true }
  );
  if (!resultado.googleEventId) throw new Error("Google não retornou googleEventId ao criar o evento no Calendar");

  await prisma.agendamento.update({
    where: { id: agendamento.id },
    data: {
      googleEventId: resultado.googleEventId,
      googleCalendarId: resultado.googleCalendarId,
      linkMeet: resultado.linkMeet,
      googleSyncStatus: "SINCRONIZADO",
    },
  });
}

async function processarCalendarAtualizar(item: LinhaFila): Promise<void> {
  const { agendamentoId } = item.payload as { agendamentoId: string };
  const agendamento = await prisma.agendamento.findUnique({
    where: { id: agendamentoId },
    include: { paciente: true, aluno: true, tipoSessao: true },
  });
  if (!agendamento || !agendamento.googleEventId || !agendamento.googleCalendarId) return; // nada a atualizar

  const clinica = await prisma.clinica.findUnique({ where: { id: item.clinicaId } });
  if (!clinica) throw new Error("clínica não encontrada");
  const calendar = await obterCalendarDaClinica(clinica);
  if (!calendar) throw new Error("Google não conectado para a clínica");

  const titulo = construirTitulo(agendamento);

  try {
    await sincronizarEventoGoogle(
      calendar,
      agendamento.googleCalendarId,
      agendamento.googleEventId,
      { inicio: agendamento.inicio, duracaoMin: agendamento.duracaoMin, titulo },
      item.clinicaId,
      { propagarErro: true }
    );
  } catch (err) {
    // Caso Robson Aparecido (2026-08-17): evento apagado manualmente no
    // Google vira "cancelled" (tombstone) — PATCH nele nunca funciona, então
    // insistir com retry/backoff só adia o inevitável até FALHA definitivo.
    // Em vez disso, auto-cura: limpa a referência local e enfileira
    // CALENDAR_CRIAR pra recriar o evento do zero, no calendário certo do
    // tipo de sessão (processarCalendarCriar já resolve isso sozinho).
    if (await eventoGoogleAusenteOuCancelado(calendar, agendamento.googleCalendarId, agendamento.googleEventId)) {
      await prisma.agendamento.update({
        where: { id: agendamento.id },
        data: { googleEventId: null, googleCalendarId: null, linkMeet: null, googleSyncStatus: "PENDENTE" },
      });
      await enfileirar(item.clinicaId, "CALENDAR_CRIAR", { agendamentoId: agendamento.id });
      return; // item atual: sucesso — a recriação é um novo item, não um retry deste
    }
    throw err; // erro real (rede, token, permissão) — segue o fluxo normal de falha/retry
  }

  await prisma.agendamento.update({ where: { id: agendamento.id }, data: { googleSyncStatus: "SINCRONIZADO" } });
}

async function processarCalendarRemover(item: LinhaFila): Promise<void> {
  const { agendamentoId } = item.payload as { agendamentoId: string };
  const agendamento = await prisma.agendamento.findUnique({ where: { id: agendamentoId } });
  if (!agendamento || !agendamento.googleEventId || !agendamento.googleCalendarId) return; // já removido/nada a remover

  const clinica = await prisma.clinica.findUnique({ where: { id: item.clinicaId } });
  if (!clinica) throw new Error("clínica não encontrada");
  const calendar = await obterCalendarDaClinica(clinica);
  if (!calendar) throw new Error("Google não conectado para a clínica");

  await removerEventoGoogle(calendar, agendamento.googleCalendarId, agendamento.googleEventId, item.clinicaId, {
    propagarErro: true,
  });

  await prisma.agendamento.update({
    where: { id: agendamento.id },
    data: { googleEventId: null, googleCalendarId: null, linkMeet: null },
  });
}

async function processarDriveCriarPasta(item: LinhaFila): Promise<void> {
  const { pacienteId } = item.payload as { pacienteId: string };
  const paciente = await prisma.paciente.findUnique({ where: { id: pacienteId } });
  if (!paciente) return; // paciente não existe mais
  if (paciente.pastaDriveUrl) return; // idempotência: pasta já criada (ou informada manualmente)

  const clinica = await prisma.clinica.findUnique({ where: { id: item.clinicaId } });
  if (!clinica) throw new Error("clínica não encontrada");
  if (!clinica.pastaRaizDriveId) throw new Error("clínica sem pasta-mãe do Drive configurada");
  const drive = await obterDriveDaClinica(clinica);
  if (!drive) throw new Error("Google não conectado para a clínica");

  const pasta = await criarPastaPacienteDrive(drive, clinica.pastaRaizDriveId, paciente.nome, item.clinicaId, {
    propagarErro: true,
  });
  if (!pasta.pastaDriveUrl) throw new Error("Google não retornou a pasta criada no Drive");

  await prisma.paciente.update({ where: { id: paciente.id }, data: { pastaDriveUrl: pasta.pastaDriveUrl } });
}

// GMAIL_ENVIAR permanece no enum sem handler aqui — mesma situação de
// CALENDAR_REMOVER antes de ter um call site (nenhuma rota gera esse tipo
// hoje), mas por decisão de produto, não só falta de call site: o envio do
// e-mail de boas-vindas em compartilhar-pasta/route.ts é uma ação deliberada
// do operador, feita com ele olhando a tela de confirmação (assunto/corpo
// editáveis) — não um evento de sistema para enfileirar e esquecer. Retry é
// humano (o operador vê a falha e tenta de novo) e um e-mail duplicado por
// reprocessamento automático é pior, do ponto de vista do paciente, do que
// uma falha visível que o operador resolve na hora. Ver ETAPA 3b, item 3:
// a rota continua síncrona, mas agora propaga o erro real em vez de
// engolir silenciosamente.
async function processarItem(item: LinhaFila): Promise<void> {
  switch (item.tipo) {
    case "CALENDAR_CRIAR":
      await processarCalendarCriar(item);
      return;
    case "CALENDAR_ATUALIZAR":
      await processarCalendarAtualizar(item);
      return;
    case "CALENDAR_REMOVER":
      await processarCalendarRemover(item);
      return;
    case "DRIVE_CRIAR_PASTA":
      await processarDriveCriarPasta(item);
      return;
    default:
      throw new Error(`tipo de sincronização "${item.tipo}" não tem implementação no worker`);
  }
}

// Ponto de entrada do worker (chamado pelo cron). Recupera itens travados,
// reivindica um lote atomicamente e processa um a um — falha em um item
// nunca impede o processamento dos demais do lote.
export async function processarPendentes(
  limite: number
): Promise<{ recuperados: number; processados: number; concluidos: number; falhas: number }> {
  const recuperados = await recuperarTravados();
  if (recuperados > 0) {
    console.log(`[sincronizacao] ${recuperados} item(ns) travado(s) em PROCESSANDO devolvido(s) a PENDENTE`);
  }

  const itens = await reivindicarLote(limite);
  let concluidos = 0;
  let falhas = 0;

  for (const item of itens) {
    try {
      await processarItem(item);
      await marcarConcluido(item);
      concluidos++;
    } catch (err) {
      falhas++;
      await registrarFalhaItem(item, err);
    }
  }

  return { recuperados, processados: itens.length, concluidos, falhas };
}
