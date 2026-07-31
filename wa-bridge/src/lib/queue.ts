import { config } from '../config';
import { logger } from './logger';
import { isWithinBusinessWindow, currentDateKeyInTz } from './schedule';
import { sendWebhook } from './webhook';
import { getSocket, getStatus } from './whatsapp';

export interface EnqueuePayload {
  jobId: string;
  to: string;
  variants: string[];
  meta: Record<string, unknown>;
}

interface QueuedJob extends EnqueuePayload {
  enqueuedAt: number;
}

const queue: QueuedJob[] = [];
const processedJobIds = new Set<string>();

let dailyCount = 0;
let dailyCountDateKey = currentDateKeyInTz();

let processing = false;

function resetDailyCounterIfNeeded(): void {
  const todayKey = currentDateKeyInTz();
  if (todayKey !== dailyCountDateKey) {
    dailyCountDateKey = todayKey;
    dailyCount = 0;
  }
}

export function isProcessed(jobId: string): boolean {
  return processedJobIds.has(jobId);
}

export function isDailyCapReached(): boolean {
  resetDailyCounterIfNeeded();
  return dailyCount >= config.dailyCap;
}

export function enqueue(job: EnqueuePayload): void {
  queue.push({ ...job, enqueuedAt: Date.now() });
  logger.info({ jobId: job.jobId, queueLength: queue.length }, 'job enfileirado');
  void processQueue();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelayMs(): number {
  return Math.floor(Math.random() * (config.maxDelayMs - config.minDelayMs + 1)) + config.minDelayMs;
}

function pickVariant(variants: string[]): string {
  return variants[Math.floor(Math.random() * variants.length)];
}

async function processQueue(): Promise<void> {
  if (processing) return;
  processing = true;

  try {
    while (queue.length > 0) {
      resetDailyCounterIfNeeded();

      if (!isWithinBusinessWindow()) {
        logger.info('fora da janela horária (08:00-19:00, seg-sex, America/Sao_Paulo) — aguardando');
        break;
      }

      if (!getStatus().connected) {
        logger.warn('WhatsApp desconectado — aguardando reconexão para processar fila');
        break;
      }

      if (dailyCount >= config.dailyCap) {
        logger.warn({ dailyCap: config.dailyCap }, 'cap diário atingido — mantendo restante na fila');
        break;
      }

      const job = queue.shift();
      if (!job) break;

      if (processedJobIds.has(job.jobId)) {
        continue;
      }

      await sendJob(job);
      processedJobIds.add(job.jobId);
      dailyCount += 1;

      if (queue.length > 0) {
        await delay(randomDelayMs());
      }
    }
  } finally {
    processing = false;
  }
}

async function sendJob(job: QueuedJob): Promise<void> {
  const socket = getSocket();
  const text = pickVariant(job.variants);
  const jid = job.to.replace(/[^0-9]/g, '') + '@s.whatsapp.net';

  try {
    if (!socket) {
      throw new Error('socket WhatsApp indisponível');
    }
    const result = await socket.sendMessage(jid, { text });
    await sendWebhook({
      type: 'message.sent',
      jobId: job.jobId,
      to: job.to,
      messageId: result?.key.id ?? '',
      sentAt: new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err, jobId: job.jobId }, 'falha ao enviar mensagem');
    await sendWebhook({
      type: 'message.failed',
      jobId: job.jobId,
      to: job.to,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Retoma o processamento da fila (ex: após reconexão ou virada de janela horária). */
export function resumeQueue(): void {
  void processQueue();
}
