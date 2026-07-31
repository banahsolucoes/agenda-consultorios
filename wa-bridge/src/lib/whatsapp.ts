import makeWASocket, {
  ConnectionState,
  DisconnectReason,
  WASocket,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import { config } from '../config';
import { logger } from './logger';
import { useSupabaseAuthState } from './supabaseAuthState';
import { sendWebhook } from './webhook';

interface BridgeStatus {
  connected: boolean;
  phone: string | null;
  lastSeen: string | null;
}

let sock: WASocket | null = null;
let currentQr: string | null = null;
const status: BridgeStatus = { connected: false, phone: null, lastSeen: null };
let loggedOut = false;

export function getStatus(): BridgeStatus {
  return { ...status };
}

export function getCurrentQr(): string | null {
  return currentQr;
}

export function getSocket(): WASocket | null {
  return sock;
}

export async function connectWhatsApp(): Promise<void> {
  if (loggedOut) {
    logger.warn('sessão desconectada (loggedOut) — conexão não será reiniciada automaticamente');
    return;
  }

  const { state, saveCreds } = await useSupabaseAuthState(config.sessionId);

  sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    logger: logger.child({ module: 'baileys' }) as any,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update: Partial<ConnectionState>) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      currentQr = qr;
    }

    if (connection === 'open') {
      currentQr = null;
      status.connected = true;
      status.phone = sock?.user?.id?.split(':')[0] ?? null;
      status.lastSeen = new Date().toISOString();
      logger.info('WhatsApp conectado');
    }

    if (connection === 'close') {
      status.connected = false;
      status.lastSeen = new Date().toISOString();

      const statusCode = (lastDisconnect?.error as Boom | undefined)?.output?.statusCode;
      const isLoggedOut = statusCode === DisconnectReason.loggedOut;

      if (isLoggedOut) {
        loggedOut = true;
        currentQr = null;
        logger.error('sessão deslogada (loggedOut) — necessário reescanear o QR');
        await sendWebhook({ type: 'session.disconnected', reason: 'loggedOut' });
        return;
      }

      logger.warn({ statusCode }, 'conexão encerrada, reconectando');
      await connectWhatsApp();
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify') return;

    for (const msg of messages) {
      if (msg.key.fromMe) continue;
      const body =
        msg.message?.conversation ?? msg.message?.extendedTextMessage?.text ?? '';
      if (!body) continue;

      await sendWebhook({
        type: 'message.received',
        from: msg.key.remoteJid ?? '',
        body,
        messageId: msg.key.id ?? '',
        receivedAt: new Date().toISOString(),
      });
    }
  });
}

export function isLoggedOut(): boolean {
  return loggedOut;
}
