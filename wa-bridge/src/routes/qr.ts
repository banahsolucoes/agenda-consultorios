import { Router } from 'express';
import QRCode from 'qrcode';
import { config } from '../config';
import { getCurrentQr, getStatus } from '../lib/whatsapp';

export const qrRouter = Router();

qrRouter.get('/qr', async (req, res) => {
  if (req.header('x-bridge-secret') !== config.bridgeAdminSecret) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  if (getStatus().connected) {
    res.status(204).end();
    return;
  }

  const qr = getCurrentQr();
  if (!qr) {
    res.status(202).json({ message: 'QR ainda não disponível, tente novamente em instantes' });
    return;
  }

  const png = await QRCode.toBuffer(qr, { type: 'png', width: 320 });
  res.setHeader('Content-Type', 'image/png');
  res.send(png);
});
