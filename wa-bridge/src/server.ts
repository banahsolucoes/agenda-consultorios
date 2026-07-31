import express from 'express';
import { config } from './config';
import { logger } from './lib/logger';
import { connectWhatsApp } from './lib/whatsapp';
import { resumeQueue } from './lib/queue';
import { qrRouter } from './routes/qr';
import { statusRouter } from './routes/status';
import { enqueueRouter } from './routes/enqueue';

const app = express();

app.use(
  express.json({
    verify: (req, _res, buf) => {
      (req as any).rawBody = buf.toString('utf8');
    },
  }),
);

app.use(qrRouter);
app.use(statusRouter);
app.use(enqueueRouter);

app.get('/health', (_req, res) => {
  res.json({ ok: true });
});

async function main(): Promise<void> {
  await connectWhatsApp();

  // Reavalia periodicamente a fila (janela horária, cap diário e reconexão
  // podem liberar o processamento sem que um novo /enqueue seja chamado).
  setInterval(resumeQueue, 60_000);

  app.listen(config.port, () => {
    logger.info({ port: config.port, sessionId: config.sessionId }, 'wa-bridge iniciado');
  });
}

main().catch((err) => {
  logger.error({ err }, 'falha ao iniciar wa-bridge');
  process.exit(1);
});
