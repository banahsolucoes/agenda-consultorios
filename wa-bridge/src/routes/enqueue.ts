import { Router } from 'express';
import { config } from '../config';
import { verifySignature } from '../lib/hmac';
import { logger } from '../lib/logger';
import { enqueue, isDailyCapReached, isProcessed, EnqueuePayload } from '../lib/queue';

export const enqueueRouter = Router();

function isValidPayload(body: any): body is EnqueuePayload {
  return (
    typeof body === 'object' &&
    body !== null &&
    typeof body.jobId === 'string' &&
    typeof body.to === 'string' &&
    Array.isArray(body.variants) &&
    body.variants.length > 0 &&
    body.variants.every((v: unknown) => typeof v === 'string') &&
    typeof body.meta === 'object'
  );
}

enqueueRouter.post('/enqueue', (req, res) => {
  const signature = req.header('x-signature');
  const timestampHeader = req.header('x-timestamp');
  const rawBody = (req as any).rawBody as string;

  if (!timestampHeader) {
    res.status(401).json({ error: 'x-timestamp ausente' });
    return;
  }

  const timestamp = Number(timestampHeader);
  if (!Number.isFinite(timestamp)) {
    res.status(401).json({ error: 'x-timestamp inválido' });
    return;
  }

  if (Date.now() - timestamp > config.replayWindowMs) {
    res.status(401).json({ error: 'timestamp expirado (possível replay)' });
    return;
  }

  const signedContent = `${timestampHeader}.${rawBody}`;
  if (!verifySignature(config.bridgeSharedSecret, signedContent, signature)) {
    res.status(401).json({ error: 'assinatura inválida' });
    return;
  }

  if (!isValidPayload(req.body)) {
    res.status(400).json({ error: 'payload inválido' });
    return;
  }

  const payload = req.body as EnqueuePayload;

  if (isProcessed(payload.jobId)) {
    res.status(200).json({ status: 'already_processed' });
    return;
  }

  if (isDailyCapReached()) {
    logger.warn({ jobId: payload.jobId }, 'cap diário de envios atingido — rejeitando novo job');
    res.status(429).json({ error: 'cap diário de envios atingido' });
    return;
  }

  enqueue(payload);
  res.status(200).json({ status: 'queued' });
});
