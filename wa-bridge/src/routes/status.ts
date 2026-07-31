import { Router } from 'express';
import { config } from '../config';
import { getStatus } from '../lib/whatsapp';

export const statusRouter = Router();

statusRouter.get('/status', (req, res) => {
  if (req.header('x-bridge-secret') !== config.bridgeAdminSecret) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }

  res.json(getStatus());
});
