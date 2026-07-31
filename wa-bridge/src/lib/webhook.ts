import { config } from '../config';
import { logger } from './logger';
import { signPayload } from './hmac';

type WebhookEvent =
  | { type: 'message.sent'; jobId: string; to: string; messageId: string; sentAt: string }
  | { type: 'message.failed'; jobId: string; to: string; error: string }
  | { type: 'message.received'; from: string; body: string; messageId: string; receivedAt: string }
  | { type: 'session.disconnected'; reason: string };

const MAX_ATTEMPTS = 3;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function sendWebhook(event: WebhookEvent): Promise<void> {
  const rawBody = JSON.stringify(event);
  const signature = signPayload(config.bridgeSharedSecret, rawBody);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const response = await fetch(config.appWebhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-signature': signature,
        },
        body: rawBody,
      });

      if (response.ok) {
        return;
      }

      logger.warn({ status: response.status, event: event.type, attempt }, 'webhook respondeu com erro');
    } catch (err) {
      logger.warn({ err, event: event.type, attempt }, 'falha ao enviar webhook');
    }

    if (attempt < MAX_ATTEMPTS) {
      await delay(2 ** attempt * 1000);
    }
  }

  logger.error({ event: event.type }, 'webhook falhou após todas as tentativas');
}
