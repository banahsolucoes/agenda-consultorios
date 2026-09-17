# Auditoria de prontidão para onboarding multi-tenant (novas clínicas)

Data: 2026-09-17
Tipo: auditoria READ-ONLY (nenhum código, migration ou commit foi alterado)
Escopo: viabilidade de liberar cadastro self-service para 5 novas clínicas (mentoreadas), cada uma com sua própria conta Google Workspace.

Legenda: 🔴 BLOQUEADOR (impede onboarding seguro) · 🟡 RISCO (funciona mas com efeito colateral/exposição) · 🟢 OK

---

## 1. Rota de signup existente

**Arquivo**: `src/app/api/auth/signup/route.ts` (92 linhas)

`POST /api/auth/signup` tem dois caminhos, distinguidos pela presença de `clinicaId` no body:

- **Sem `clinicaId`** (o caminho que interessa para onboarding): cria uma `Clinica` nova (`nome` + `slug` gerado por `gerarSlug()`, slugify + sufixo aleatório de 6 chars) e o usuário chamador vira o primeiro `ADMIN` dela. Campos exigidos: `email`, `senha`, `nome` (do usuário) e `clinicaNome`. Não exige login — é público.
- **Com `clinicaId`** (entrar em clínica já existente): exige `getUsuarioLogado()` ser `ADMIN` **da própria** `clinicaId` informada (checado manualmente, linha 45) antes de aceitar. Único caller real hoje: `src/app/painel/configuracoes/seguranca/page.tsx:83` (tela de "gestão de equipe", ADMIN convidando colega para a própria clínica).

### 🔴 BLOQUEADOR — sem transação: `Clinica.create` → Supabase `auth.signUp` → `Usuario.create` não são atômicos

Trecho (linhas 56-89):
```ts
const clinica = await prisma.clinica.create({ data: { nome: body.clinicaNome, slug: gerarSlug(body.clinicaNome) } });
clinicaIdFinal = clinica.id;
...
const { data, error } = await supabase.auth.signUp({ email, password: senha });
if (error || !data.user) { ... return 400 }         // clínica órfã já ficou gravada
if (data.user.identities && data.user.identities.length === 0) { ... return 409 } // idem
const usuario = await prisma.usuario.create({ data: { id: data.user.id, clinicaId: clinicaIdFinal, ... } }); // pode falhar (ex.: e-mail duplicado na tabela Usuario) e a clínica some sem admin
```
Se o Supabase `signUp` falhar (e-mail inválido, senha fraca, rate limit do Supabase, e-mail já existente) ou o `prisma.usuario.create` falhar por qualquer motivo depois que a `Clinica` já foi criada, fica uma `Clinica` **órfã, sem nenhum usuário**, e a resposta ao cliente é um erro — o usuário tende a tentar de novo, gerando outra clínica órfã a cada tentativa (o slug é sempre único via sufixo aleatório, então nunca colide). Nada limpa isso depois. Para um fluxo self-service de 5 clínicas simultâneas isso é sério: erros de digitação de senha/e-mail (bem comuns em cadastro público) vão sujar a tabela `Clinica` com tenants fantasmas.

**Recomendação**: envolver a criação da `Clinica` e do `Usuario` numa transação lógica que só persiste a `Clinica` depois que o Supabase confirmou a criação da conta (ou, alternativamente, fazer o `signUp` no Supabase primeiro e só então criar `Clinica`+`Usuario` — nesta ordem, uma falha no `Usuario.create` ainda deixa a `Clinica` órfã, então o ideal é criar `Usuario` e `Clinica` na mesma `prisma.$transaction`, com o `signUp` do Supabase acontecendo antes de qualquer escrita local).

### 🔴 BLOQUEADOR — não existe página de UI para este fluxo

Busquei todos os usos de `/api/auth/signup` no código (`Grep "auth/signup" src/`): o único caller é `painel/configuracoes/seguranca/page.tsx` (chama com `clinicaId`, fluxo "convidar colega para minha clínica já existente" — exige estar logado como ADMIN). **Não existe nenhuma tela pública que chame o signup com `clinicaNome`** (criação de clínica nova). `src/app/onboarding/` só tem uma subrota `retorno/page.tsx` (ver §5/§9 abaixo — é sobre o retorno do OAuth Google, não cadastro). Não há `src/app/cadastro`, `src/app/signup` nem nada equivalente. **Hoje, criar uma clínica nova só é possível via chamada HTTP direta (curl/Postman) — não existe formulário para a mentoreada preencher.**

### 🟡 RISCO — validação fraca de input
Não há validação de formato de e-mail, força de senha, nem de tamanho/conteúdo de `clinicaNome`/`nome` além de "truthy". Toda validação de força de senha e de e-mail fica 100% a cargo do Supabase Auth (padrão do projeto, aceitável, mas confirmar as configurações de senha mínima no painel do Supabase antes de abrir ao público).

### 🟢 OK — proteção contra idempotência de e-mail duplicado
Trata corretamente o caso de e-mail já existente no Supabase Auth (`data.user.identities.length === 0` → 409), evitando criar um `Usuario` com id que não bate com `auth.users` (bug de login futuro).

---

## 2. Mecanismo de convite — não existe

Busca por `convite`/`invite`/`allowlist`/token de cadastro em todo `src/` (Grep case-insensitive): **nenhum resultado real** (os únicos hits foram falsos positivos no client Prisma gerado, sem relação).

### 🔴 BLOQUEADOR — `POST /api/auth/signup` está 100% aberto ao público, sem allowlist nem rate limit
- Não existe tabela/model de convite no `prisma/schema.prisma` (nenhum `Convite`, nenhum campo `emailAutorizado`/`tokenConvite` em `Clinica` ou `Usuario`).
- A rota não checa nenhuma lista de e-mails/domínios autorizados — qualquer pessoa que descubra o endpoint pode fazer `POST /api/auth/signup` com `{ email, senha, nome, clinicaNome }` e criar uma clínica nova + virar ADMIN dela, sem convite, sem aprovação, sem verificação de que é de fato uma das 5 mentoreadas.
- Não há rate limit aplicado especificamente a esta rota (`Grep` por `rateLimit`/`checkRateLimiteLocal` em `src/app/api/auth/` não retornou nada). O único rate limit do projeto é `src/lib/rateLimit.ts` (fallback do Vercel Firewall), não confirmado como aplicado aqui.
- `proxy.ts` (matcher `/api/:path*`) só faz `updateSession` do Supabase (refresh de cookie) — não é um gate de autorização.

Para o cenário descrito ("link de convite" para 5 mentoreadas), **hoje não existe o conceito de link de convite no sistema** — a única coisa que se aproxima é enviar a URL do formulário (que nem existe, ver item 1) e confiar que só as 5 pessoas certas vão usá-la. Isso é inaceitável para lançamento: qualquer terceiro que obtenha a URL pode criar uma clínica.

**Recomendação mínima antes de liberar**: implementar pelo menos um dos dois:
1. Token de convite de uso único (`Clinica` criada previamente pelo admin do sistema, com um token, e o signup só aceita `clinicaId`/token pré-existente em vez de criar `Clinica` livremente); ou
2. Allowlist de e-mails (tabela ou variável de ambiente) checada em `POST /api/auth/signup` antes de criar a `Clinica`.
Também adicionar rate limit dedicado a esta rota (é a superfície de abuso mais barata do sistema: criação de tenant é uma operação "cara").

---

## 3. Valores hardcoded específicos da clínica "pamela-rachid"

Busca (`Grep -i "pamela|Pâmela|FonoElite"`) em todo `src/` (excluindo client Prisma gerado):

### 🔴 BLOQUEADOR — `src/app/api/whatsapp/webhook/route.ts:54-60` — TODO webhook do WhatsApp Business é roteado para a clínica `pamela-rachid`, sempre
```ts
// Resolve a clínica dona do número que recebeu a mensagem. Hoje o produto
// atende uma única clínica de verdade em produção (Fono Pâmela Rachid,
// slug "pamela-rachid") e não há campo de mapeamento phone_number_id →
// Clinica no schema; quando existir mais de uma clínica conectada ao
// WhatsApp, trocar isso por um lookup real usando value.metadata.phone_number_id.
async function resolverClinicaId(): Promise<string | null> {
  const clinica = await prisma.clinica.findFirst({
    where: { slug: "pamela-rachid" },
    select: { id: true },
  });
  return clinica?.id ?? null;
}
```
O próprio comentário no código já documenta o problema. Isso é usado por `POST /api/whatsapp/webhook` (recepção de toda mensagem de WhatsApp) — **se qualquer segunda clínica conectar um número de WhatsApp Business, todas as mensagens recebidas por ela vão parar na caixa de entrada (`ConversaWhatsapp`) da clínica `pamela-rachid`**, e nenhuma mensagem chega à clínica real dona do número. Ver também item 6.

### 🔴 BLOQUEADOR — `src/lib/google.ts:38-49` — `CALENDAR_MENTORIA_ID` é uma constante fixa (um único Google Calendar para todas as reuniões de mentoria, de qualquer clínica)
```ts
// Valor fixo porque hoje só existe uma clínica ativa (Fono Pâmela Rachid).
export const CALENDAR_MENTORIA_ID =
  "c_8c7a8a487847433ebcac52b67b3be7fdc90ddf1717dfed23c9014c82d6ce5111@group.calendar.google.com";
...
return tipoSessaoGoogleCalendarId === CALENDAR_MENTORIA_ID ? tipoSessaoGoogleCalendarId : CALENDAR_MENTORIA_ID;
```
Toda reunião avulsa de mentorado (`POST /api/agendamentos/mentoria`, ver item 5) é gravada nesse calendário Google fixo — que pertence à conta Google da Pâmela, não à conta da clínica que criou a reunião. Isso já está documentado como dívida datada em `ARCHITECTURE.md` §9 ("quando houver uma 2ª clínica, precisa virar campo por-clínica"). **Mitigado, na prática, pelo fato de `mentoriaAtivada` nascer `false` por padrão** (ver item 5) — mas é um blocker real se alguma mentoreada também usar o módulo de Mentoria do sistema (o que é plausível, já que "mentoreada" sugere que a Pâmela é mentora delas).

### 🟡 RISCO — `formatarTituloMentorado()` (`src/lib/blocoAgenda.ts:15-17`) gera título fixo com o nome da Pâmela
```ts
return `FonoElite (Pâmela & ${nomeMentorado})`;
```
Usado no título do evento do Google Calendar de toda reunião de mentoria (qualquer clínica). Mesmo raciocínio do item anterior: só afeta clínicas com `mentoriaAtivada=true`, mas se acontecer, o texto sai errado (nome da marca/mentora fixos, não da clínica real).

### 🟡 RISCO — `AgendaCalendario.tsx:1131` rótulo de card de agenda com "(FonoElite)" fixo
```ts
? `${nomeDaSessao(sessao).split(" ")[0]} (FonoElite)${sessao.confirmada ? " ✅" : ""}`
```
Mesmo escopo: só aparece para sessões de mentoria (`alunoId` presente).

### 🟢 OK — módulo de comissões de mentoria (`liquidoPamela`/`liquidoPamelaNoMes`)
`src/app/api/mentoria/dashboard/resumo/route.ts`, `src/app/api/mentoria/contratos/[id]/comissoes/route.ts`, `src/app/mentoria/**`: os nomes de variável (`liquidoPamela`) são só nomenclatura de código (representam "o valor líquido que fica para a mentora dona da clínica principal, depois de pagar comissão"), calculados dinamicamente a partir dos dados da clínica logada — **não são hardcoded de dado**, são nomes de variável mal escolhidos (deveriam ser genéricos, ex. `liquidoMentora`) mas não vazam nem quebram para outra clínica. Não bloqueador, mas vale renomear por clareza caso o módulo de Mentoria seja usado por outra clínica mentora.

### 🟢 OK — não encontrado
- Nenhum e-mail hardcoded específico da Pâmela nas rotas de produção (`src/app/api/**`, `src/lib/**`).
- Nenhum ID de clínica (UUID) hardcoded em `src/` fora do já listado.
- `WHATSAPP_TELEFONE_NOTIFICACAO_HUMANO` é variável de ambiente (não hardcoded no código), mas é **um único número de telefone global para todas as clínicas** — ver observação no item 6 (RISCO, não BLOQUEADOR, pois é config de ambiente, não valor cravado no código; mas funcionalmente equivalente para efeitos de isolamento entre clínicas).
- Scripts em `scripts/*.mjs` têm referências pontuais a dados da Pâmela (backfills, resync), mas são utilitários one-off documentados como "rodados manualmente" (`ARCHITECTURE.md` §1) — não rodam em produção automaticamente, fora do escopo do onboarding.

### 🟡 RISCO — defaults de schema (`prisma/schema.prisma`) com texto assinado "Fono Pâmela Rachid" viram o valor inicial de TODA clínica nova
`prisma/schema.prisma:74-75`:
```prisma
emailBoasVindasAssunto String @default("Acesso a Gravações com a Fono Pâmela Rachid")
emailBoasVindasCorpo   String @default("Olá {nome}, tudo bem?\n\n...\n\nAtenciosamente\nFono Pâmela Rachid")
```
Como são `@default` no Prisma (não um seed condicional), **toda `Clinica` nova** — inclusive as criadas por `POST /api/auth/signup` — nasce com o e-mail de boas-vindas ao paciente assinado "Fono Pâmela Rachid", a menos que o ADMIN da clínica nova entre em Configurações → Mensagens e edite manualmente antes do primeiro envio (`compartilhar-pasta/route.ts`, que dispara esse e-mail, é síncrono — ver ARCHITECTURE.md §4). Risco de uma mentoreada mandar e-mail de boas-vindas assinado com o nome da Pâmela para o próprio paciente dela. `templateConfirmacao`/`templateMeet` (mesmo arquivo) não têm esse problema — são genéricos.

**Recomendação**: mudar o `@default` para um texto genérico (ex. `"Olá {nome}, ..."` sem assinatura, ou assinatura `"{clinica}"` se houver placeholder) e, no fluxo de signup/primeiro acesso, orientar/forçar a clínica nova a revisar Configurações → Mensagens antes de usar o compartilhamento de pasta.

---

## 4. Configuração dos calendários Google por clínica

**Modelo de dados** (`prisma/schema.prisma`):
- `Clinica.googleRefreshToken`/`googleAccessToken`/`googleTokenExpiry`/`googleConectado`/`googleEscopos` — token OAuth **salvo por clínica** (linha 47-62), não por usuário. Correto para o cenário de 5 clínicas independentes.
- `Clinica.googleCalendarId` (`String? @default("primary")`) — calendário-fallback da clínica.
- `TipoSessao.googleCalendarId` (`String?`, schema linha ~136) — calendário específico por tipo de atendimento daquela clínica (presencial vs. online, por exemplo).
- `Agendamento.googleCalendarId` — grava o calendário real usado na criação do evento (trava o update/delete no mesmo calendário depois, exigência da API do Google).
- Cadeia de resolução (usada em `sessoes/[id]/route.ts`, `sincronizacao.ts`, `cron/verificar-google-noturno`): `sessao.googleCalendarId ?? tipoSessao?.googleCalendarId ?? clinica.googleCalendarId ?? "primary"` — o fallback final `"primary"` é o calendário padrão **da própria conta Google conectada por aquela clínica**, não um valor cravado global. Isso está corretamente isolado por clínica.

**Fluxo OAuth** (`src/app/api/integracoes/google/{conectar,callback,desconectar,status}/route.ts`, lib `src/lib/google.ts`):
- Usa um único par `GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`/`GOOGLE_REDIRECT_URI` (variáveis de ambiente) — isso é o esperado/normal: é o app OAuth registrado no Google Cloud que **qualquer** clínica usa para autorizar a própria conta Google Workspace (o consentimento final é sempre para a conta que a clínica escolher na tela do Google, não para uma conta fixa).
- `GET /conectar` (linha 14-28): usa `getUsuarioLogado()` para saber a clínica, gera `state = usuario.id` (+ `:popup` opcional) — anti-CSRF.
- `GET /callback` (linha 39-105): valida `state` contra o usuário logado, troca `code` por tokens, e grava com `prisma.clinica.update({ where: { id: usuario.clinicaId }, ... })` — **sempre a clínica do usuário logado que iniciou o fluxo**, nunca um id vindo do body/query. 🟢 Isolamento correto: uma segunda clínica que conectar sua própria conta Google grava tokens só na própria linha de `Clinica`, sem tocar nos tokens da Pâmela.

### 🔴 BLOQUEADOR — não existe UI/API para uma clínica escolher/configurar `googleCalendarId` (nem no nível `Clinica`, nem por `TipoSessao`)
Busquei `PATCH /api/clinica` (`CAMPOS_EDITAVEIS`, `src/app/api/clinica/route.ts:14-43`) e `PATCH /api/clinica/tipos-sessao/[id]` — **`googleCalendarId` não está na lista de campos editáveis em nenhum dos dois**. `Grep` por `googleCalendarId` em `src/app/painel/**` só encontra um `type` de leitura em `configuracoes/integracoes/page.tsx:16` (exibição), nenhum campo de formulário para gravar.

Isso confirma o que `ARCHITECTURE.md` §9 já registra: os calendários da Pâmela (`"primary"` para tipos online, calendário "Sessões Presenciais" para tipos presenciais) foram **configurados manualmente via seed/SQL direto**, não pela interface. **Para uma clínica nova, isso significa que, mesmo depois de conectar a própria conta Google, ela não tem como escolher "usar o calendário X para presencial e Y para online" pela UI — tudo cai no fallback `"primary"` da conta dela**, a menos que alguém rode um script manual no banco para configurar `TipoSessao.googleCalendarId`, como foi feito para a Pâmela.

**Impacto prático**: funciona (a clínica nova consegue conectar e sincronizar eventos), mas com uma limitação de produto não documentada para o cliente final — se a mentoreada tiver mais de um calendário Google que queira usar (ex.: separar presencial/online, ou dividir por profissional), não há como configurar isso sozinha; precisa de uma intervenção manual da equipe técnica a cada clínica nova.

**Recomendação**: adicionar `googleCalendarId` (clínica) e `TipoSessao.googleCalendarId` aos campos editáveis + UI em Configurações → Integrações/Atendimento antes de escalar para múltiplas clínicas, ou pelo menos documentar/automatizar o passo manual de seed por clínica nova.

---

## 5. Isolamento do módulo Mentoria (`mentoriaAtivada`)

### 🟢 OK — flag nasce desligada por padrão
`prisma/schema.prisma:102`: `mentoriaAtivada Boolean @default(false)`. Toda `Clinica` nova (incluindo via `POST /api/auth/signup`, que não passa esse campo no `create`) nasce com o módulo **desligado**.

### 🟢 OK — gate centralizado e aplicado em todas as 21 rotas de `/api/mentoria/**`
`src/lib/mentoria.ts:13-27` (`exigirAcessoMentoria`) checa `papel ∈ {ADMIN, PROFISSIONAL}` **e** `Clinica.mentoriaAtivada === true`, buscando a clínica do próprio `usuario.clinicaId` (nunca aceita clinicaId de fora). Confirmei por grep que as 21 rotas em `src/app/api/mentoria/**/route.ts` chamam `exigirAcessoMentoria` (2-4 ocorrências cada, incluindo import). Nenhuma rota do módulo ficou de fora.

### 🟢 OK — queries de negócio do módulo sempre escopadas por `clinicaId`
Todas as agregações em `src/lib/mentoria.ts` (`calcularAgregadosMensais`, `calcularImpostoNoMes`, `calcularComissaoNoMes`, `calcularComissaoPendenteNoMes`, `calcularInadimplenciaAtual`) recebem `clinicaId` como parâmetro obrigatório e o usam em todo `where` do Prisma — sem query global sem filtro.

### 🟢 OK — UI: guard de navegação + menu condicional
- `src/app/api/mentoria/acesso/route.ts` — endpoint enxuto (reaproveita `exigirAcessoMentoria`) consumido por `src/app/mentoria/layout.tsx` como guard de navegação (o comentário do arquivo confirma o uso).
- `src/app/painel/page.tsx:1522` e `AgendaCalendario.tsx:837` só mostram a opção "reunião avulsa de mentoria" quando `clinica?.mentoriaAtivada === true && papel ∈ {PROFISSIONAL, ADMIN}` — espelho de UX, mas a segurança real está no backend (item acima), então mesmo se o menu vazasse visualmente numa clínica desativada, a rota rejeitaria com 403.

### 🟡 RISCO (já registrado no item 3) — `CALENDAR_MENTORIA_ID` fixo
Se uma mentoreada **ativar** o módulo Mentoria (plausível — o próprio enunciado da tarefa as chama de "mentoreadas"), toda reunião de mentoria dela cairia no calendário Google fixo da Pâmela (`src/lib/google.ts:38-39`), não no calendário da própria clínica. Ou seja: **o isolamento de acesso/dados está correto, mas o único ponto de integração externa do módulo (Google Calendar) não está isolado por clínica.** Ver item 3 para o trecho de código e recomendação.

**Conclusão do item 5**: módulo isolado corretamente em rotas/menus/queries; único furo é a integração Google Calendar fixa (`CALENDAR_MENTORIA_ID`), que só importa se alguma mentoreada ativar o módulo.

---

## 6. WhatsApp (webhook Meta Cloud API + wa-bridge não-oficial)

**Não existe model `CanalWhatsApp`** no schema — o mais próximo é `ConversaWhatsapp`/`MensagemWhatsapp` (`prisma/schema.prisma:337-366`), ambos corretamente escopados por `clinicaId` (`@@index([clinicaId])`, `@@index([clinicaId, telefone])`) e sem nenhum campo de configuração de canal por clínica (nem `phoneNumberId`, nem `accessToken`, nem `wabaId`).

### 🔴 BLOQUEADOR — toda a integração com o Meta WhatsApp Cloud API é single-tenant, não só o webhook
Já documentado como hardcode isolado no item 3 (`resolverClinicaId()` sempre retorna a clínica `pamela-rachid`), mas o problema é mais profundo: **o envio de mensagens também usa credenciais globais**, não por clínica:
- `src/lib/whatsapp/enviarMensagem.ts:23-26` e `src/lib/whatsapp/enviarTemplate.ts:38-42`: ambos recebem `clinicaId` como parâmetro, mas **ignoram esse valor** para resolver credenciais — sempre usam `process.env.WHATSAPP_PHONE_NUMBER_ID`/`process.env.WHATSAPP_ACCESS_TOKEN` (variáveis de ambiente globais do deploy, um único número/conta Meta para o sistema inteiro).
- `GET/POST /api/whatsapp/webhook` (`route.ts:17,24`): `WHATSAPP_VERIFY_TOKEN`/`WHATSAPP_APP_SECRET` também são globais — só um webhook da Meta pode apontar pra este endpoint.
- `WHATSAPP_IA_ATIVA` (`webhook/route.ts:128`) é um kill switch global da IA — liga/desliga para **todas** as clínicas de uma vez, não por clínica.

**Conclusão**: não é só "o webhook roteia errado" — **o produto hoje só suporta UM número de WhatsApp Business (Meta Cloud API) no total**, compartilhado por todas as clínicas. Para as 5 mentoreadas terem WhatsApp funcional e isolado (cada uma com seu próprio número/conta Meta), seria necessário: (1) mover `phoneNumberId`/`accessToken`/`verifyToken`/`appSecret` para colunas em `Clinica` (ou tabela de canal dedicada), (2) resolver a clínica no webhook por `value.metadata.phone_number_id` (o próprio comentário do código já aponta esse caminho) em vez do slug fixo, e (3) trocar as chamadas de envio para ler as credenciais da clínica do agendamento/conversa, não do `process.env`. Isso é trabalho de desenvolvimento real, não configuração — **tratar como pré-requisito caso as mentoreadas precisem de WhatsApp oficial (Meta) isolado**; se elas não usarem WhatsApp no início, não bloqueia o onboarding em si (ver "clínica sem WhatsApp" abaixo).

### `wa-bridge/` (canal não-oficial, Baileys) — serviço separado, não é o mesmo canal
`wa-bridge/README.md`: serviço **fora do app Next.js**, roda como processo isolado, usa uma biblioteca não-oficial (Baileys) que emula um WhatsApp Web comum — o próprio README avisa que "opera fora dos Termos de Uso do WhatsApp" e recomenda número secundário/descartável. Suporta múltiplas sessões (`BRIDGE_SESSION_ID` diferente por instância = "números diferentes por consultório"), mas **cada sessão é uma instância de processo separada**, sem relação automática com `Clinica.id` no schema principal — a integração de volta ao app (`APP_WEBHOOK_URL`) não foi encontrada no código do app principal (`Grep` por `wa-bridge`/`message.received` em `src/` não retornou nada). Isso indica que o wa-bridge está em estágio de infraestrutura própria/experimental, **não conectado ao fluxo de conversas do app principal hoje** (consistente com a nota do `ARCHITECTURE.md` §2 sobre trabalho de schema do `wa-bridge` ficar num branch dedicado, `feat/wa-bridge`, fora da `main`). Não é um caminho pronto para uma mentoreada usar agora.

### 🟢 OK — clínica nova sem WhatsApp configurado não quebra nada
- `cron/whatsapp-lembretes/route.ts` processa `Agendamento` de **todas** as clínicas numa única query (`prisma.agendamento.findMany` sem filtro de clínica — correto para um cron global), com `try/catch` por item (linhas 60-86) — uma falha de envio (ex.: paciente sem telefone, API do Meta fora do ar) vira uma entrada em `falhas[]` e não interrompe o loop nem afeta outras clínicas.
- Uma clínica nova sem nenhuma `ConversaWhatsapp`/mensagem simplesmente não aparece nos resultados — não há `.find()`/index fixo assumindo pelo menos uma conversa existente.
- `GET /api/whatsapp/conversas` (protegida por `atenderWhatsapp`) filtra por `clinicaId` do usuário logado — clínica sem conversas só vê uma lista vazia, não erro.
- Como toda mensagem hoje é roteada para `pamela-rachid` (bloqueador acima), na prática **nenhuma clínica nova jamais vai receber uma mensagem de WhatsApp mesmo que configure um número**, então o "não quebra nada" é decorrência direta do bloqueador, não de um design robusto multi-tenant testado.

---

## 7. Cron de fila (`SincronizacaoPendente`) e cron de auditoria noturna

### 🟢 OK — worker do outbox (`src/lib/sincronizacao.ts`, `GET /api/cron/sincronizacao`) é multi-tenant e resiliente por item
- `reivindicarLote()` (linhas 150-164): claim atômico via `UPDATE ... FOR UPDATE SKIP LOCKED` sobre a tabela inteira (todas as clínicas misturadas na fila, ordenado por `proximaTentativaEm`) — desenhado para concorrência seja de vários crons ou vários itens de clínicas diferentes ao mesmo tempo.
- `processarPendentes()` (linhas 474-498): itera item a item com `try/catch` individual (linha 486-494) — uma falha vira `registrarFalhaItem(item, err)` (grava `ultimoErro`/agenda backoff só naquele item) e o loop **continua** para os próximos itens, de qualquer clínica.
- Cada item processado relê o `Agendamento`/`Clinica` do banco no momento do processamento e resolve o client do Google via `obterCalendarDaClinica`/`obterDriveDaClinica` a partir do `clinicaId` do próprio item — token sempre o daquela clínica, nunca compartilhado.
- Erro de uma clínica (ex.: token revogado) só grava `Clinica.googleUltimoErro` **daquela** clínica (`registrarErroNaClinica`, linha 193-200) — não afeta o processamento de itens de outras clínicas na mesma execução.

### 🟢 OK — cron noturno (`GET /api/cron/verificar-google-noturno`) também é resiliente por clínica
- Itera `prisma.clinica.findMany()` (linha 46, todas as clínicas) num `for` sequencial.
- `obterCalendarDaClinica(clinica).catch(() => null)` (linha 78) — falha ao obter o client Google de uma clínica não lança, só pula a parte de checagem via API para aquela clínica (a Parte 1, baseada só no banco, roda de qualquer forma).
- A chamada `calendar.events.list` por calendário tem `try/catch` própria (linhas 106-121) com `continue` em caso de erro — uma clínica com Google desconectado/token inválido não impede a checagem das demais clínicas no mesmo loop.
- Drena a fila do outbox no início (linha 38, `processarPendentes(25)`) como rede de segurança contra falso-positivo de "drift" quando o cron externo de 10min está atrasado.

**Conclusão do item 7**: ambos os crons já foram desenhados pensando em múltiplas clínicas simultâneas, com isolamento de erro por item/por clínica — nenhum bloqueador encontrado aqui. Único ponto de atenção operacional (não é bug, é infraestrutura): `cron/sincronizacao` depende de um cron **externo** à Vercel (a cada 10min, plano Hobby só permite cron diário nativo) — confirmar que esse cron externo está de fato configurado e rodando antes de liberar clínicas novas, já que sem ele a sincronização de todas as clínicas (não só as novas) fica só no melhor esforço do disparo imediato via `after()`.

---

## 8. Storage (bucket `anexos-pacientes`) — não encontrei R2 no projeto

### 🟢 OK — nota preliminar: não existe integração com Cloudflare R2 neste código
Busquei `R2_`, `S3Client`, `cloudflare` em `src/` e `wa-bridge/src/` (case-insensitive) — nenhum resultado real (só falsos positivos em código minificado do client Prisma gerado). O projeto usa **apenas Supabase Storage** (`ARCHITECTURE.md` §1 confirma: "Storage (anexos de paciente, logo/fundo da clínica)"). Se há um plano de usar R2 em outro lugar (ex.: mídia do WhatsApp), não está implementado no branch atual — ajustar a pergunta/expectativa se R2 for relevante para outro serviço fora deste repositório.

### 🟢 OK — caminho sempre prefixado por `clinicaId`
`src/lib/anexos.ts:10-13`:
```ts
export function caminhoAnexo(clinicaId: string, pacienteId: string, nomeArquivo: string) {
  const nomeSanitizado = nomeArquivo.trim().replace(/[^a-zA-Z0-9._-]/g, "_");
  return `${clinicaId}/${pacienteId}/${crypto.randomUUID()}-${nomeSanitizado}`;
}
```
Todo anexo é gravado em `{clinicaId}/{pacienteId}/{uuid}-{nome}` no bucket privado `anexos-pacientes` (`BUCKET_ANEXOS`).

### 🟢 OK — acesso ao Storage sempre passa por checagem de posse antes de gerar URL assinada
- `POST /api/pacientes/[id]/anexos/upload-url` (`route.ts:16-19`): confirma `paciente.clinicaId === usuario.clinicaId` antes de gerar a signed upload URL.
- `GET /api/pacientes/[id]/anexos/[anexoId]` (`route.ts:18-21`): confirma `anexo.clinicaId === usuario.clinicaId && anexo.pacienteId === pacienteId` antes de gerar a signed download URL (validade curta, 60s).
- Ambos usam `createAdminClient()` (`src/lib/supabase/admin.ts`) — client **service role**, que ignora Row Level Security do Storage de propósito; o comentário do próprio arquivo documenta a decisão: **o isolamento entre clínicas depende inteiramente da checagem em código acima** (`getUsuarioLogado()` + comparação de `clinicaId`), não de uma policy de bucket no Supabase. Não encontrei nenhuma `CREATE POLICY`/RLS de Storage nas migrations (esperado — RLS de Storage é configurado no painel do Supabase, fora do Prisma, não auditável por este repositório).

**Avaliação**: para o cenário de 5 clínicas novas, o isolamento funciona **desde que o código das rotas continue sendo o único caminho de acesso** — não há uma segunda camada de defesa (RLS) no bucket em si. Isso é uma prática aceitável (é o padrão do projeto inteiro: autorização em código, não em RLS do Postgres/Storage), mas significa que qualquer rota nova que gere signed URLs para `anexos-pacientes` **precisa repetir manualmente** a checagem de `clinicaId` — não há rede de segurança automática se alguém esquecer. Não é um bloqueador (nenhuma rota hoje esquece a checagem), mas é um ponto de atenção para revisão de código futuro, registrado como 🟡 RISCO de processo, não de estado atual.

---

## 9. Queries Prisma sem filtro por `clinicaId` em tabelas multi-tenant

**Metodologia**: `Grep` de toda chamada `prisma.<model>.<findUnique|findFirst|findMany|update|updateMany|delete|deleteMany|count|aggregate>(` dentro de `src/app/api/**` para os models multi-tenant (`Paciente`, `Agendamento`, `Pacote`, `Tarefa`, `Anexo`, `TipoSessao`, `HorarioTrabalho`, `LogAuditoria`, `ConversaWhatsapp`, `MensagemWhatsapp`, `MentoriaAluno/Contrato/Parcela/Comissao`, `FormularioAnamnese`, `EnvioFormulario`, `Consentimento`) — **cerca de 140 ocorrências** — e inspeção manual de uma amostra ampla (todas as rotas com `findUnique({ where: { id } })` "solto", que é o padrão de maior risco, mais rotas públicas). Não é uma varredura de 100% das ~140 ocorrências linha a linha (fora do orçamento desta auditoria), mas cobre todos os padrões estruturalmente diferentes encontrados no código.

### 🟢 OK — padrão dominante e consistente: `findUnique({ where: { id } })` sempre seguido de checagem manual de `clinicaId`
O projeto **não usa** `findUnique({ where: { id, clinicaId } })` (não daria, `clinicaId` não é campo único) — em vez disso, todo lugar que busca um recurso por id sozinho faz a checagem logo em seguida, no padrão:
```ts
const recurso = await prisma.modelo.findUnique({ where: { id } });
if (!recurso || recurso.clinicaId !== usuario.clinicaId) {
  return NextResponse.json({ erro: "não encontrado" }, { status: 404 });
}
```
Confirmado neste padrão, por amostragem manual, em: `clinica/horarios/route.ts` (DELETE), `clinica/tipos-sessao/[id]/route.ts`, `pacotes/route.ts` (tipoSessao), `agendamentos/mentoria/route.ts` (aluno + tipoSessao), `mentoria/parcelas/[id]/route.ts`, `anamneses/[id]/route.ts`, `pacientes/[id]/anexos/[anexoId]/route.ts`, `pacientes/[id]/anexos/upload-url/route.ts`, entre outras. Todos os models de mentoria (`MentoriaAluno`, `MentoriaContrato`, `MentoriaParcela`, `MentoriaComissao`) têm `clinicaId` próprio no schema (não só via relação), o que torna essa checagem possível/direta em toda rota aninhada.

### 🟢 OK — rota pública de formulário de anamnese (`GET/POST /api/f/[clinicaSlug]/[formularioSlug]`) deriva `clinicaId` só do slug da URL
`src/app/api/f/[clinicaSlug]/[formularioSlug]/route.ts:79-90`: comentário explícito confirma a decisão — "`clinicaId`/`formularioId` são derivados EXCLUSIVAMENTE dos slugs da URL — qualquer `clinicaId`/`formularioId`/`pacienteId` no body é ignorado (nem lido)". Também tem rate limit por IP, honeypot, limite de payload e resposta genérica indistinguível (não vaza se a clínica/formulário existe) — bom nível de cuidado para um endpoint sem autenticação.

### 🔴 Confirmado — a única query real sem filtro de `clinicaId` (já registrada nos itens 3 e 6) é o roteamento do webhook do WhatsApp
`src/app/api/whatsapp/webhook/route.ts:54-60` (`resolverClinicaId()`) — não filtra pela requisição de forma alguma; **ignora completamente** qual clínica/número recebeu a mensagem e sempre resolve para a clínica de slug fixo `"pamela-rachid"`. Tecnicamente não é "query sem filtro nenhum" (ela filtra por `slug`), mas é funcionalmente equivalente ao problema que a pergunta busca: **toda mensagem de WhatsApp de qualquer clínica cai sempre na mesma clínica**, porque não há noção de "qual clínica esta requisição pertence" derivada da requisição em si (webhook da Meta não carrega `clinicaId`, e não há mapeamento `phone_number_id → Clinica`). Ver item 6 para detalhe e recomendação.

### 🟢 OK — `assinatura/webhook/route.ts:47` é uma busca legítima, não um "hardcode de primeira clínica"
`prisma.clinica.findFirst({ where: { OR: [{ mpPreapprovalId: dataId }, { id: preapproval.external_reference ?? "" }] } })` — busca pela clínica **dona daquele preapproval específico do Mercado Pago** (webhook de pagamento, análogo ao WhatsApp mas corretamente implementado: usa um identificador vindo do payload do provedor externo para achar a clínica certa, não assume uma fixa).

### Não encontrado: fallback do tipo "primeira clínica do banco" em código de produção
Não encontrei nenhum `findFirst()` sem `where` (ou com `where` vazio) em `src/app/api/**`/`src/lib/**` fora dos dois casos acima (webhook WhatsApp — hardcoded por slug; webhook Mercado Pago — filtro legítimo por preapproval). O comentário em `whatsapp/webhook/route.ts:45-53` documenta que um bug anterior (`findFirst()` sem `orderBy`, corrigido em 2026-07-24) já causou esse tipo de problema uma vez (retornava "Clínica Teste" em vez da clínica certa) — o padrão de risco é conhecido pela equipe, só não foi generalizado para suportar múltiplas clínicas reais ainda.

**Conclusão do item 9**: não há uma "epidemia" de queries sem tenant — o padrão de checagem manual pós-`findUnique` é aplicado de forma consistente em todo o código amostrado. O único ponto real de vazamento estrutural entre clínicas é o roteamento do webhook do WhatsApp (item 6), que é ao mesmo tempo o achado mais crítico desta auditoria.

---

## 10. O que uma clínica recém-criada precisa ter no banco para funcionar

**Nota de modelo de dados**: não existe `model Profissional` nem `model Sala` no `prisma/schema.prisma` — "profissional" no sistema é simplesmente um `Usuario` com `papel: PROFISSIONAL`, e não há conceito de salas físicas. Reformulando a pergunta para os models que de fato existem: `TipoSessao` (tipo de atendimento) e `HorarioTrabalho` (expediente) são as duas tabelas de configuração-base por clínica.

### 🔴 BLOQUEADOR — `TipoSessao` vazio impede a clínica de cadastrar o primeiro paciente
`prisma/seed.mjs` (raiz de `prisma/`) é **hardcoded só para a clínica "Fono Pâmela Rachid"** (`CLINICA = { nome: "Fono Pâmela Rachid", slug: "pamela-rachid" }`, linhas 18-21) — faz `upsert` por esse slug fixo e povoa 4 `TipoSessao` + 4 dias de `HorarioTrabalho` só para ela. **Não roda automaticamente para clínica nova nenhuma** (não é chamado por `POST /api/auth/signup`, e mesmo se rodasse manualmente via `npx prisma db seed`, criaria/atualizaria apenas a clínica da Pâmela, por causa do slug fixo).

Sem isso, uma clínica nova criada via signup nasce **sem nenhum `TipoSessao`**. Consequência concreta: `POST /api/pacientes` (`src/app/api/pacientes/route.ts:66,73-75`) exige `tipoSessaoId` como campo obrigatório (`obrigatorios = ["nome", "diaPreferido", "horarioFixo", "tipoSessaoId"]`) e rejeita com 400 se o id não corresponder a um `TipoSessao` da própria clínica. **A clínica nova não consegue cadastrar nenhum paciente até que alguém crie manualmente pelo menos um `TipoSessao`** — e não há nenhum onboarding/wizard guiando esse passo; o formulário de paciente simplesmente mostraria um seletor de tipo de atendimento vazio, sem explicação.

**Mitigação parcial existente**: `POST/GET /api/clinica/tipos-sessao` (tela `painel/configuracoes/atendimento`) permite ao próprio ADMIN da clínica nova criar tipos de atendimento pela UI, sem depender de intervenção técnica — **então não é um bloqueio permanente**, mas é um passo manual obrigatório e não documentado/guiado antes do primeiro uso real do sistema.

### 🟢 OK — `HorarioTrabalho` vazio tem fallback seguro (grade padrão 08:00–19:30)
`src/app/api/sessoes/[id]/route.ts:170-182` (comentário explícito): "se a clínica já configurou horários, um dia sem faixa cadastrada está fechado; só cai na grade padrão 08:00–19:30 quando a clínica ainda não configurou horário nenhum" — `dentroDoExpediente()` trata lista vazia como "sem restrição / usa o padrão", não como "tudo fechado". Uma clínica nova sem `HorarioTrabalho` configurado **não fica bloqueada** de criar/mover sessões — só não tem a validação fina de expediente até configurar.

### 🟢 OK — demais tabelas (`Paciente`, `Pacote`, `Agendamento`, `Anexo`, `Tarefa`, `LogAuditoria`, `SincronizacaoPendente`, `ConversaWhatsapp`) nascem vazias sem problema
Nenhuma rota assume implicitamente que essas tabelas têm pelo menos uma linha para a clínica — todas as listagens (`GET /api/pacientes`, `GET /api/agenda`, `GET /api/tarefas`, `GET /api/notificacoes`, `GET /api/whatsapp/conversas` etc.) usam `findMany`/`aggregate` com `where: { clinicaId }`, que retornam array/soma vazios normalmente (nenhum `[0]`/`.reduce` sem valor inicial encontrado nas rotas auditadas nos itens anteriores).

### 🟡 RISCO — branding/config de clínica (logo, cores, templates) fica com os defaults do schema até a clínica editar
Ver item 3: `emailBoasVindasAssunto`/`emailBoasVindasCorpo` nascem com o texto assinado "Fono Pâmela Rachid" (`@default` do Prisma) — não quebra nada tecnicamente, mas é um problema de produto se a clínica nova usar compartilhamento de pasta antes de revisar Configurações → Mensagens.

**Checklist mínimo antes de uma clínica nova operar (hoje, manual)**:
1. Criar pelo menos 1 `TipoSessao` (Configurações → Atendimento) — **obrigatório**, sem isso não cadastra paciente.
2. Revisar/editar `emailBoasVindasAssunto`/`emailBoasVindasCorpo` (Configurações → Mensagens) antes de usar "compartilhar pasta" — recomendado.
3. Configurar `HorarioTrabalho` (Configurações → Atendimento) — recomendado, não bloqueante (fallback 08:00–19:30).
4. Conectar Google (Configurações → Integrações) — recomendado, sem isso os eventos simplesmente não sincronizam (outbox aceita, mas a checagem "clínica conectada" faz o worker pular a chamada real).
5. Se for usar mentoria: `Clinica.mentoriaAtivada` precisa ser ativado manualmente no banco (não há toggle na UI encontrado — não investigado a fundo, fora do escopo, mas vale checar antes de qualquer mentoreada tentar usar o módulo).

---

## Resumo — o que precisa ser feito antes de liberar a primeira mentoreada

Ordenado por prioridade (bloqueadores primeiro):

1. **🔴 Fechar o cadastro público** (item 2) — hoje `POST /api/auth/signup` está 100% aberto, sem convite/allowlist/rate limit. Qualquer pessoa que descubra a URL pode criar uma clínica. Implementar token de convite de uso único ou allowlist de e-mail antes de divulgar qualquer link.
2. **🔴 Corrigir o roteamento do WhatsApp** (itens 3 e 6) — `resolverClinicaId()` no webhook está fixo em `slug: "pamela-rachid"`, e as credenciais de envio (`WHATSAPP_PHONE_NUMBER_ID`/`WHATSAPP_ACCESS_TOKEN`) são globais, não por clínica. Se qualquer mentoreada for usar WhatsApp oficial (Meta), é necessário: campo de canal por clínica no schema, resolução do webhook por `phone_number_id`, e credenciais por clínica nas rotas de envio. Se nenhuma mentoreada for usar WhatsApp inicialmente, pode ser adiado — mas documentar isso explicitamente como limitação conhecida.
3. **🔴 Construir a tela de cadastro de clínica nova** (item 1) — não existe hoje nenhuma UI pública que chame `POST /api/auth/signup` com `clinicaNome`. Sem isso, não há "link de convite" possível — a mentoreada não tem como se cadastrar sozinha.
4. **🔴 Envolver a criação de `Clinica`+`Usuario` numa transação seletiva** (item 1) — evitar clínicas órfãs quando o `signUp` do Supabase ou o `Usuario.create` falharem depois da `Clinica` já ter sido criada. Erros de digitação em cadastro público vão ser comuns.
5. **🔴 Automatizar o seed mínimo por clínica nova** (item 10) — pelo menos `TipoSessao` (obrigatório para cadastrar o primeiro paciente); idealmente também `HorarioTrabalho` e uma revisão guiada de `emailBoasVindasAssunto`/`Corpo` (item 3/4) para não herdar o texto assinado "Fono Pâmela Rachid". Hoje isso depende 100% de intervenção manual pós-cadastro.
6. **🟡 Adicionar UI para configurar `googleCalendarId` por clínica/tipo de atendimento** (item 4) — hoje só é possível via script/SQL manual; sem isso, toda clínica nova cai no fallback `"primary"` da própria conta Google, sem poder separar calendários por tipo de atendimento.
7. **🟡 Corrigir/generalizar `CALENDAR_MENTORIA_ID`** (itens 3 e 5) — só relevante se alguma mentoreada ativar o módulo Mentoria; hoje toda reunião de mentoria de qualquer clínica cairia no calendário fixo da Pâmela.
8. **🟡 Mudar os defaults de `emailBoasVindasAssunto`/`emailBoasVindasCorpo` no schema** (item 3/4) para texto genérico, sem assinatura "Fono Pâmela Rachid" — ou garantir que o onboarding force a revisão antes do primeiro uso de "compartilhar pasta".
9. **Confirmar que o cron externo de sincronização (10 em 10 min) está de fato configurado e monitorado** (item 7) — não é um bug, mas é um pré-requisito operacional que já afeta a Pâmela hoje e vai escalar com mais clínicas gerando mais itens na fila.
10. **Decidir e documentar o fluxo de billing/assinatura** (achado colateral do item 10) — existe um módulo de assinatura via Mercado Pago (`Clinica.statusAssinatura`, `POST /api/assinatura/webhook`) não investigado a fundo nesta auditoria (fora do escopo original) — confirmar se cada mentoreada precisa de uma assinatura própria configurada antes de operar, ou se o acesso delas é gratuito/diferenciado.

**Pontos já validados como seguros (não bloqueiam)**: isolamento de token OAuth Google por clínica (item 4), isolamento do módulo Mentoria em rotas/menus/queries (item 5), resiliência multi-clínica dos crons de fila e auditoria noturna (item 7), prefixo de caminho por `clinicaId` no Storage de anexos (item 8), e ausência de queries Prisma sistemicamente sem filtro de tenant fora do caso do WhatsApp (item 9).

---

*Fim do relatório.*


