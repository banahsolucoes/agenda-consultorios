function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Variável de ambiente obrigatória ausente: ${name}`);
  }
  return value;
}

export const config = {
  supabaseUrl: required('SUPABASE_URL'),
  supabaseServiceRoleKey: required('SUPABASE_SERVICE_ROLE_KEY'),
  bridgeSharedSecret: required('BRIDGE_SHARED_SECRET'),
  bridgeAdminSecret: required('BRIDGE_ADMIN_SECRET'),
  appWebhookUrl: required('APP_WEBHOOK_URL'),
  sessionId: process.env.BRIDGE_SESSION_ID || 'default',
  port: Number(process.env.PORT) || 3333,
  timezone: 'America/Sao_Paulo',
  dailyCap: 15,
  minDelayMs: 25_000,
  maxDelayMs: 60_000,
  replayWindowMs: 5 * 60 * 1000,
  workHours: { start: 8, end: 19 },
};
