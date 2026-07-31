import { createClient } from '@supabase/supabase-js';
import {
  AuthenticationCreds,
  AuthenticationState,
  BufferJSON,
  initAuthCreds,
  proto,
  SignalDataTypeMap,
} from '@whiskeysockets/baileys';
import { config } from '../config';
import { logger } from './logger';

const TABLE = 'wa_bridge_session';

const supabase = createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
  auth: { persistSession: false },
});

function rowId(sessionId: string, key: string): string {
  return `${sessionId}:${key}`;
}

async function readData<T>(sessionId: string, key: string): Promise<T | null> {
  const { data, error } = await supabase
    .from(TABLE)
    .select('value')
    .eq('session_id', sessionId)
    .eq('key', key)
    .maybeSingle();

  if (error) {
    logger.error({ err: error, key }, 'falha ao ler wa_bridge_session');
    return null;
  }
  if (!data) return null;

  return JSON.parse(JSON.stringify(data.value), BufferJSON.reviver) as T;
}

async function writeData(sessionId: string, key: string, value: unknown): Promise<void> {
  const serialized = JSON.parse(JSON.stringify(value, BufferJSON.replacer));
  const { error } = await supabase.from(TABLE).upsert(
    {
      id: rowId(sessionId, key),
      session_id: sessionId,
      key,
      value: serialized,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'session_id,key' },
  );
  if (error) {
    logger.error({ err: error, key }, 'falha ao gravar wa_bridge_session');
  }
}

async function removeData(sessionId: string, key: string): Promise<void> {
  const { error } = await supabase.from(TABLE).delete().eq('session_id', sessionId).eq('key', key);
  if (error) {
    logger.error({ err: error, key }, 'falha ao remover wa_bridge_session');
  }
}

/**
 * Equivalente ao useMultiFileAuthState do Baileys, mas persistindo cada chave
 * como uma linha na tabela Supabase `wa_bridge_session` em vez de arquivos locais.
 */
export async function useSupabaseAuthState(sessionId: string): Promise<{
  state: AuthenticationState;
  saveCreds: () => Promise<void>;
  clearState: () => Promise<void>;
}> {
  const creds: AuthenticationCreds = (await readData<AuthenticationCreds>(sessionId, 'creds')) || initAuthCreds();

  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => {
          const data: { [id: string]: SignalDataTypeMap[typeof type] } = {};
          await Promise.all(
            ids.map(async (id) => {
              let value = await readData<any>(sessionId, `${type}-${id}`);
              if (type === 'app-state-sync-key' && value) {
                value = proto.Message.AppStateSyncKeyData.fromObject(value);
              }
              if (value) {
                data[id] = value;
              }
            }),
          );
          return data;
        },
        set: async (data) => {
          const tasks: Promise<void>[] = [];
          for (const category in data) {
            for (const id in data[category as keyof typeof data]) {
              const value = (data as any)[category][id];
              const key = `${category}-${id}`;
              tasks.push(value ? writeData(sessionId, key, value) : removeData(sessionId, key));
            }
          }
          await Promise.all(tasks);
        },
      },
    },
    saveCreds: async () => {
      await writeData(sessionId, 'creds', creds);
    },
    clearState: async () => {
      const { error } = await supabase.from(TABLE).delete().eq('session_id', sessionId);
      if (error) {
        logger.error({ err: error }, 'falha ao limpar sessão wa_bridge_session');
      }
    },
  };
}
