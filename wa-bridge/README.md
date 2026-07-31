# wa-bridge

Serviço isolado (fora do app Next.js) que faz a ponte entre o app e o WhatsApp usando
[Baileys](https://github.com/WhiskeySockets/Baileys), uma biblioteca **não-oficial** que
se conecta como um cliente WhatsApp Web comum.

> ⚠️ **Este canal opera fora dos Termos de Uso do WhatsApp.** Use apenas com um número
> secundário e descartável, nunca com o número principal da clínica ou de um profissional.
> Veja a seção "wa-bridge (canal não-oficial)" em `ARCHITECTURE.md` para o racional completo.

## Stack

- Node.js 20 + TypeScript
- `@whiskeysockets/baileys` (protocolo WhatsApp Web)
- `express` (HTTP)
- `@supabase/supabase-js` (persistência do auth state da sessão)
- `pino` (log estruturado)

## Configuração

1. Copie `.env.example` para `.env` e preencha os valores (nunca commitar `.env`):

```
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
BRIDGE_SHARED_SECRET=
BRIDGE_ADMIN_SECRET=
APP_WEBHOOK_URL=
BRIDGE_SESSION_ID=default
PORT=3333
```

2. Crie a tabela no Supabase (SQL puro — **não** é gerenciada pelo Prisma/schema do app):

```sql
create table if not exists wa_bridge_session (
  id text primary key,
  session_id text not null,
  key text not null,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

create unique index if not exists wa_bridge_session_session_key_idx
  on wa_bridge_session (session_id, key);
```

3. Instale as dependências e rode em desenvolvimento:

```bash
npm install
npm run dev
```

Ou via Docker:

```bash
docker build -t wa-bridge .
docker run --env-file .env -p 3333:3333 wa-bridge
```

## Primeira conexão (ler o QR)

1. Suba o serviço com um `BRIDGE_SESSION_ID` novo (ou vazio de sessão anterior na tabela).
2. Chame `GET /qr` com o header `x-bridge-secret: <BRIDGE_ADMIN_SECRET>`:

```bash
curl -H "x-bridge-secret: $BRIDGE_ADMIN_SECRET" http://localhost:3333/qr -o qr.png
```

3. Abra `qr.png` e escaneie com o WhatsApp do **número secundário descartável**
   (Aparelhos conectados → Conectar um aparelho).
4. Enquanto não conectado, o endpoint retorna a imagem do QR (ele é renovado
   periodicamente pelo próprio Baileys). Após conectar, `GET /qr` passa a
   retornar `204 No Content`.
5. Confirme com `GET /status` (mesmo header):

```bash
curl -H "x-bridge-secret: $BRIDGE_ADMIN_SECRET" http://localhost:3333/status
# { "connected": true, "phone": "55119...", "lastSeen": "2026-07-31T..." }
```

## Rotacionar a sessão (trocar de número ou reconectar do zero)

1. Pare o serviço.
2. Apague as linhas da sessão no Supabase:

```sql
delete from wa_bridge_session where session_id = '<BRIDGE_SESSION_ID>';
```

   (Isso também acontece automaticamente quando o WhatsApp desloga a sessão —
   evento `DisconnectReason.loggedOut` — o serviço não reconecta sozinho e
   dispara o webhook `session.disconnected`.)
3. Suba o serviço novamente e repita o fluxo de leitura do QR acima.
4. Para rodar múltiplas sessões (ex: números diferentes por consultório), use
   valores diferentes de `BRIDGE_SESSION_ID` em instâncias separadas do serviço —
   cada uma tem suas próprias linhas na tabela `wa_bridge_session`.

## Endpoints

### `GET /qr`
Header: `x-bridge-secret`. Retorna PNG do QR atual, `204` se já conectado, `202` se o QR
ainda não foi gerado.

### `GET /status`
Header: `x-bridge-secret`. Retorna `{ connected, phone, lastSeen }`.

### `POST /enqueue`
Headers: `x-signature` (HMAC-SHA256 de `` `${x-timestamp}.${rawBody}` `` com
`BRIDGE_SHARED_SECRET`), `x-timestamp` (epoch ms).

Body:
```json
{ "jobId": "string", "to": "+5511999999999", "variants": ["texto A", "texto B"], "meta": {} }
```

Regras:
- Requisição rejeitada com `401` se a assinatura não bater ou o timestamp tiver mais de 5 min.
- Rejeitada com `429` se o cap diário de 15 envios já foi atingido.
- `jobId` repetido retorna `200 { "status": "already_processed" }` sem reenviar.
- Processamento é estritamente serial, com delay aleatório de 25s a 60s entre envios,
  uma variante sorteada de `variants` no momento do envio, e só dentro da janela
  08:00–19:00 (seg–sex, `America/Sao_Paulo`). Fora da janela ou com a sessão
  desconectada, o job permanece na fila e é retomado automaticamente.

### Webhooks (`POST` assinado para `APP_WEBHOOK_URL`)
Mesmo esquema HMAC (`x-signature` = HMAC-SHA256 do corpo bruto com `BRIDGE_SHARED_SECRET`),
com até 3 tentativas em backoff exponencial:

- `message.sent` `{ jobId, to, messageId, sentAt }`
- `message.failed` `{ jobId, to, error }`
- `message.received` `{ from, body, messageId, receivedAt }`
- `session.disconnected` `{ reason }`
