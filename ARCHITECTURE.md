# ARCHITECTURE.md — mapa do projeto

Índice de onde as coisas estão. Não é documentação de produto nem cópia do código — para o comportamento exato, leia o arquivo apontado.

## 1. Stack e deploy

- **Next.js 16.2.10** (App Router, Turbopack) — **atenção**: esta versão tem breaking changes vs. o Next.js "clássico"; `middleware.ts` foi renomeado para **`proxy.ts`** (raiz do repo, `export async function proxy()`, matcher `/api/:path*`, chama `updateSession` do Supabase). Ver `AGENTS.md`/`CLAUDE.md` — sempre checar `node_modules/next/dist/docs/` antes de usar API que pareça familiar.
- **React 19.2.4**, **TypeScript 5**, **Tailwind CSS 4**.
- **Prisma 7.8.0** (`@prisma/client`, `@prisma/adapter-pg`) — client gerado em `src/generated/prisma` (custom `output`, não o padrão `node_modules/.prisma`). Datasource declarado em `prisma/schema.prisma` sem `url` fixo; a URL real vem de `prisma.config.ts`.
- **Supabase**: Auth (login/sessão via `@supabase/ssr`, cookies), Storage (anexos de paciente, logo/fundo da clínica), Postgres gerenciado (pooler porta 6543 para runtime, conexão direta porta 5432 para migrations).
- **Deploy**: Vercel (`@vercel/speed-insights`, `@vercel/firewall` para rate limit; fallback local em `src/lib/rateLimit.ts`).
- Configs relevantes: `prisma.config.ts` (schema path, migrations path, seed, datasource = `DIRECT_URL`), `.env` (`DATABASE_URL` pooler 6543, `DIRECT_URL` direto 5432, chaves Supabase), `next.config.ts`, `proxy.ts`. Não há `.devcontainer/`.
- `scripts/*.mjs` — utilitários one-off rodados manualmente (normalização de CPF, verificação de colunas, criação de clínica/usuário de teste), sempre conectando via `DIRECT_URL`.

## 2. Convenções travadas

Confirmadas no código (não são preferência — quebrar isso é bug):

- **`clinicaId` sempre vem de `getUsuarioLogado()`** (`src/lib/auth.ts`), nunca do body/query da requisição. Verificado em todas as rotas de `src/app/api/**`. Única exceção controlada: `POST /api/auth/signup`, que aceita `clinicaId` no body só para o fluxo "entrar em clínica existente" e revalida contra o usuário logado (ADMIN + `clinicaId` batendo) antes de confiar nele.
- **Migrations só via `DIRECT_URL` (porta 5432)**, nunca pelo pooler (6543) — o pooler não segura o advisory lock que `prisma migrate` precisa. `prisma.config.ts` já força isso: `datasource.url = process.env["DIRECT_URL"]`.
- **`directUrl` nunca aparece em `prisma.config.ts`** — confirmado; o arquivo só declara `url`.
- **Google Calendar é espelho, o banco é fonte da verdade.** Todo write no Google (`src/lib/google.ts`) é "melhor esforço": chamado depois do `prisma.update`/`create` já commitado, envolto em `.catch()` ou `if (google) {...}`, e uma falha na integração nunca desfaz a mudança local. Isso é comentado explicitamente em quase toda rota que mexe em `Agendamento` (`sessoes/[id]`, `sessoes/lote`, `pacientes/[id]/adiar`, `pacientes/[id]/empurrar`, `pacotes`). Importante: mudança de **status** de sessão (Realizada/Não realizada/Agendada) hoje **não** sincroniza nada no Google — só cancelamento (deleta evento), mover/duração/tipo/confirmar (`sincronizarEventoGoogle`).
- **Fuso único: `America/Sao_Paulo`.** Nunca usar `Date.getHours()`/`getDay()` etc. direto — sempre passar por `componentesSP()`/`criarDataSP()` de `src/lib/timezone.ts`, porque o runtime roda em UTC na Vercel.
- **Migrations aplicadas fora do fluxo padrão quando há drift**: se `prisma migrate dev` falhar por drift (já aconteceu com uma coluna legada de `Paciente` — resolvido em 2026-07-24, ver §9), o padrão usado neste projeto é gerar o SQL via `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`, aplicar só a parte relevante via `prisma db execute --file`, e sincronizar com `prisma migrate resolve --applied`. Nunca `migrate reset` sem aprovação explícita (apaga dados).
- **`prisma/schema.prisma` nunca fica modificado e não commitado na `main`.** `vercel --prod` empacota o diretório de trabalho local, não só o que está commitado — um schema alterado sem commit sobe junto no deploy, gerando um Prisma Client em produção divergente do banco real (a Vercel roda `prisma generate` contra o arquivo que subiu, não contra o HEAD do git). Trabalho de schema em andamento sem migration aplicada sempre vai para um branch dedicado (ex.: `feat/wa-bridge`, ver §12.7), nunca fica solto na `main`.

## 3. Modelos de dados (`prisma/schema.prisma`)

| Model | Papel | Campos-chave |
|---|---|---|
| `Clinica` | Tenant raiz — tudo é escopado por `clinicaId` | `slug`, branding (`logo`, `fundoUrl`, cores), dados fiscais, tokens Google (`googleRefreshToken`/`googleAccessToken`/`googleEscopos`), templates de mensagem/e-mail, `sheetsPlanilhaId`/`sheetsAba` (import) |
| `Usuario` | Conta de acesso, id = id do usuário Supabase Auth | `clinicaId`, `email` (único), `papel` (`Papel` enum) |
| `Paciente` | Cliente da clínica | `clinicaId`, `cpf` (único por clínica), `statusGeral` (`ATIVO/CANCELADO/FINALIZADO`), `tipoSessaoId`, `pastaDriveUrl`, `anamnese` |
| `TipoSessao` | Tipo de atendimento configurável por clínica (substitui enum legado) | `nome`, `cor`, `duracaoPadraoMin`, `ehOnline`, `ehAtendimentoUnico`, `googleCalendarId` (2026-07-23 — fonte de verdade de qual calendário do Google esse tipo usa) |
| `HorarioTrabalho` | Expediente da clínica por dia da semana | `diaSemana`, `horaInicio`/`horaFim` |
| `Pacote` | "Atendimento" — um lote de sessões geradas juntas | `pacienteId`, `tipo` (`TipoPacote`), `totalSessoes`, `status` (`StatusPacote`) |
| `Agendamento` | Uma sessão individual | `pacoteId`, `pacienteId`, `numeroSessao`/`totalPacote`, `inicio`, `duracaoMin`, `status` (`StatusSessao`), `googleEventId`/`linkMeet`, `googleSyncStatus` (`StatusSincronizacaoGoogle`, 2026-07-21 — ver seção 9), `confirmada`, `arquivada` |
| `Anexo` | Arquivo anexado ao paciente (Supabase Storage) | `clinicaId`, `pacienteId`, `path` (`{clinicaId}/{pacienteId}/...`) |
| `Consentimento` | Termo aceito pelo paciente | `pacienteId`, `versaoTermo`, `finalidade` |
| `Tarefa` | Central de tarefas (renovação automática + manuais) | `clinicaId`, `tipo` (`RENOVACAO/CONTA`), `origem` (`SISTEMA/MANUAL`), `pacienteId?`, `status` (`PENDENTE/CONCLUIDA/ARQUIVADA`), `recorrencia` (`NENHUMA/MENSAL`) |
| `LogAuditoria` | Trilha de auditoria | `clinicaId`, `usuarioId?`, `acao` (string livre), `detalhe` |

Relações principais: `Clinica 1—N {Usuario, Paciente, TipoSessao, HorarioTrabalho, Anexo, Tarefa, LogAuditoria}`; `Paciente 1—N {Pacote, Agendamento, Consentimento, Anexo, Tarefa}`; `Pacote 1—N Agendamento`.

## 4. Mapa de rotas de API (`src/app/api/`)

Toda rota exige `getUsuarioLogado()` (401 se ausente) exceto onde marcado "público". `PERMISSÃO: NONE` = sem checagem de capacidade além de autenticação + escopo de clínica.

| Método | Caminho | Arquivo | O que faz | Permissão |
|---|---|---|---|---|
| POST | `/api/auth/login` | `auth/login/route.ts` | Login via Supabase | público |
| POST | `/api/auth/logout` | `auth/logout/route.ts` | Encerra sessão | público |
| POST | `/api/auth/signup` | `auth/signup/route.ts` | Cria clínica nova (vira ADMIN) ou entra em clínica existente (exige ADMIN + `clinicaId` batendo, checado manualmente) | público / manual |
| GET | `/api/auth/usuario` | `auth/usuario/route.ts` | Retorna papel do usuário logado | NONE |
| GET/PATCH | `/api/clinica` | `clinica/route.ts` | Lê/edita dados gerais da clínica | NONE / `editarConfiguracoes` |
| POST | `/api/clinica/branding` | `clinica/branding/route.ts` | Upload de logo/fundo | `gerirIdentidadeVisual` |
| GET/POST/DELETE | `/api/clinica/horarios` | `clinica/horarios/route.ts` | CRUD de faixas de expediente | NONE |
| GET/POST | `/api/clinica/tipos-sessao` | `clinica/tipos-sessao/route.ts` | Lista/cria tipo de atendimento | NONE |
| PATCH/DELETE | `/api/clinica/tipos-sessao/[id]` | `clinica/tipos-sessao/[id]/route.ts` | Edita/remove tipo de atendimento | NONE |
| GET/POST | `/api/clinicas` | `clinicas/route.ts` | Lê a própria clínica / cria clínica nova | NONE / `criarClinica` |
| GET | `/api/usuarios` | `usuarios/route.ts` | Lista usuários da clínica | `gerirUsuarios` |
| POST | `/api/usuario/senha` | `usuario/senha/route.ts` | Troca a própria senha | NONE (self-service) |
| GET | `/api/integracoes/google/status` | `integracoes/google/status/route.ts` | Estado da conexão Google | NONE |
| GET | `/api/integracoes/google/conectar` | `integracoes/google/conectar/route.ts` | Redireciona para consentimento OAuth | `gerirIntegracoes` |
| POST | `/api/integracoes/google/desconectar` | `integracoes/google/desconectar/route.ts` | Limpa tokens Google | `gerirIntegracoes` |
| GET | `/api/integracoes/google/callback` | `integracoes/google/callback/route.ts` | Troca code por tokens | `gerirIntegracoes` |
| GET/POST | `/api/pacientes` | `pacientes/route.ts` | Lista (com filtro de status) / cria paciente (cria pasta Drive best-effort) | NONE |
| GET/PATCH | `/api/pacientes/[id]` | `pacientes/[id]/route.ts` | Lê / edita cadastro (inclui troca manual de `statusGeral`, sincroniza `Tarefa RENOVACAO`) | NONE |
| DELETE | `/api/pacientes/[id]` | `pacientes/[id]/route.ts` | Exclui paciente e histórico | `excluirPaciente` |
| GET/POST | `/api/pacientes/[id]/anexos` | `pacientes/[id]/anexos/route.ts` | Lista / confirma upload de anexo | NONE |
| GET | `/api/pacientes/[id]/anexos/[anexoId]` | `pacientes/[id]/anexos/[anexoId]/route.ts` | URL assinada de download (60s) | NONE |
| POST | `/api/pacientes/[id]/anexos/upload-url` | `pacientes/[id]/anexos/upload-url/route.ts` | URL assinada de upload | NONE |
| POST | `/api/pacientes/[id]/compartilhar-pasta` | `pacientes/[id]/compartilhar-pasta/route.ts` | Compartilha pasta Drive + envia e-mail de boas-vindas | NONE |
| POST | `/api/pacientes/[id]/adiar` | `pacientes/[id]/adiar/route.ts` | Recua sessões 7 dias a partir de um corte (UI: "Trazer") | `operarAgenda` (2026-07-25) |
| POST | `/api/pacientes/[id]/empurrar` | `pacientes/[id]/empurrar/route.ts` | Empurra sessões futuras N semanas | `operarAgenda` (2026-07-25) |
| POST | `/api/pacientes/[id]/reverter-futuras` | `pacientes/[id]/reverter-futuras/route.ts` | Reverte sessões futuras mal marcadas (Realizada/Não realizada) para Agendada | NONE |
| POST | `/api/pacotes` | `pacotes/route.ts` | Cria pacote + sessões (Meet best-effort), reativa paciente na renovação | NONE |
| GET | `/api/agenda` | `agenda/route.ts` | Sessões da clínica num intervalo (visão calendário) | NONE |
| GET | `/api/agendamentos` | `agendamentos/route.ts` | Sessões de um paciente (`?pacienteId=`) | NONE |
| PATCH | `/api/sessoes/[id]` | `sessoes/[id]/route.ts` | Multi-uso: status, cancelar, mover (`ESTA`/`ESTA_E_FUTURAS`), duração, tipo, confirmar | `operarAgenda` só no branch de mover; resto NONE |
| GET | `/api/sessoes/[id]/irmas-futuras` | `sessoes/[id]/irmas-futuras/route.ts` | Conta sessões futuras elegíveis do pacote (suporte ao move em escopo) | NONE |
| POST | `/api/sessoes/lote` | `sessoes/lote/route.ts` | Aplica status (`REALIZADA/NAO_REALIZADA/CANCELADA`) em lote, pula inválidas | NONE |
| GET/POST | `/api/tarefas` | `tarefas/route.ts` | Lista tarefas (filtro status/tipo) / cria tarefa manual (`CONTA`) | NONE |
| PATCH/DELETE | `/api/tarefas/[id]` | `tarefas/[id]/route.ts` | Conclui/edita (trava `RENOVACAO`=403) / arquiva (soft, trava `RENOVACAO`=403) | NONE |
| GET | `/api/notificacoes` | `notificacoes/route.ts` | Pendências do sino: reagendadas + tarefas visíveis + `integracaoGoogleFalhou` (2026-07-24) | NONE |
| GET | `/api/importacao/preview` | `importacao/preview/route.ts` | Lê/dedupe planilha configurada (sem gravar) | NONE |
| POST | `/api/importacao/executar` | `importacao/executar/route.ts` | Cria pacientes a partir da planilha (só CPFs selecionados vêm do body) | NONE |
| GET | `/api/cron/verificar-google-noturno` | `cron/verificar-google-noturno/route.ts` | Checagem noturna de sync Google (2026-07-24) — protegida por `CRON_SECRET`, não usuário | `CRON_SECRET` |
| GET/POST | `/api/whatsapp/webhook` | `whatsapp/webhook/route.ts` | Verificação do webhook (GET) / recepção e persistência de mensagens (POST) — ver seção 10 | público, validado por `WHATSAPP_VERIFY_TOKEN`/assinatura HMAC |
| GET/POST | `/api/whatsapp/conversas` | `whatsapp/conversas/route.ts` | Lista conversas da clínica logada (GET, inbox) / inicia ou reaproveita conversa de um paciente selecionado (POST, `{pacienteId}`) — ver seção 10.9 | `atenderWhatsapp` |
| GET | `/api/whatsapp/conversas/[id]/mensagens` | `whatsapp/conversas/[id]/mensagens/route.ts` | Histórico completo de uma conversa | `atenderWhatsapp` |
| POST | `/api/whatsapp/conversas/[id]/enviar` | `whatsapp/conversas/[id]/enviar/route.ts` | Envio manual de mensagem livre pelo inbox | `atenderWhatsapp` |
| POST | `/api/whatsapp/conversas/[id]/template` | `whatsapp/conversas/[id]/template/route.ts` | Envia o template `confirmacao_agenda` pra iniciar contato quando a janela de 24h está fechada | `atenderWhatsapp` |
| GET | `/api/cron/whatsapp-lembretes` | `cron/whatsapp-lembretes/route.ts` | Uma execução diária cobrindo 2 critérios: template `confirmacao_agenda` (~48h antes, Meta) + link do Meet pra sessão de hoje (texto livre, dentro da janela de 24h) — fundidos numa rota só por limite de cron do plano Vercel (2026-07-24) — ver seção 10 | `CRON_SECRET` |

**Dívida conhecida**: a maioria das rotas de escrita (criar/editar paciente, mudar status de sessão, criar atendimento, importar, tarefas) não tem nenhum gate de capacidade além de "estar logado" — qualquer papel (OPERADOR incluso) pode executar. Só `excluirPaciente` (delete de paciente), `gerirUsuarios`, `gerirIntegracoes`, `gerirIdentidadeVisual`, `editarConfiguracoes`, `criarClinica` e o branch de mover sessão (`operarAgenda`) são checados via `pode()`. Isso é intencional em parte (operação do dia a dia liberada pra todo mundo) mas não está auditado — tratar como TODO.

## 5. Telas / componentes principais

### `src/app/painel/page.tsx` (client component, ~3200 linhas — tela principal)
- Lista de pacientes: busca/filtro por aba (Ativos/Finalizados/Cancelados/Todos), import de planilha (preview + seleção de CPFs).
- Abas de navegação: **Pacientes / Agenda / Tarefas** (a última navega para `/tarefas`).
- Painel lateral do paciente selecionado: dados, `MenuStatus` de status geral, sessões do pacote, seleção múltipla + ações em lote.
- Modais: criar atendimento/pacote (`abrirModalPacote`), editar sessão (`abrirModalEditar`), empurrar (`abrirModalEmpurrar`), trazer/adiar (`abrirModalTrazer`), cancelar sessão/lote (`abrirModalCancelar(Lote)`), reverter sessões futuras (`modalReverterFuturas`), tarefa manual (`abrirModalTarefa`), excluir paciente (`abrirModalExcluir`), compartilhar pasta (`abrirCompartilharPasta`).
- Sino de notificações (`sinoAberto`, ~linha 1487) — busca `/api/notificacoes`, link "Ver todas" → `/tarefas`.

### `src/app/painel/AgendaCalendario.tsx` (client component — visão calendário)
- Toolbar: navegação de período + modo Semana/Dia.
- Grid: `DiaColuna` (coluna por dia, cabeçalho fixo, marcadores de hora, layout de sobreposição) renderiza `BlocoSessao` por sessão.
- **Card de sessão**: componente `BlocoSessao` (~linha 761); root JSX do card em ~linhas 892–972.
- **Cálculo de altura do bloco** (~linhas 798–803): `top = ((minutos - inicioMin) / ROW_MIN) * rowPx`; `altura = Math.max(46, (duracaoMin / ROW_MIN) * rowPx - 2)`, onde `ROW_MIN = 30` e `rowPx` é recalculado dinamicamente por `recalcularRowPx()` (~linha 335) para caber a janela de expediente na tela, entre `ROW_PX_MIN=34` e `ROW_PX_MAX=52` (padrão inicial `ROW_PX_PADRAO=36`) — não é um pixel fixo.
- Drag-and-drop via `dnd-kit` (`DndContext`/`useDraggable`/`useDroppable`) para mover sessão; resize por pointer handler manual (não dnd-kit) na borda inferior do card.
- **Linha do horário atual**: componente `LinhaHorarioAtual` (2026-07-21, ajustado no mesmo dia para atravessar a semana toda) — irmã das `DiaColuna`, não filha: renderizada dentro de um wrapper dedicado (`<div className="relative flex flex-1">`, ~linha 612) que envolve só as colunas de dia (não o gutter de horários), criado especificamente para isso porque o `<div className="flex">` (~linha 595) que já existia não tinha `position: relative` — optou-se por um wrapper novo e escopado em vez de adicionar `relative` no container maior (evita risco de afetar `minWidth`/sticky do gutter). Só renderiza quando algum dia exibido é hoje (`semanaTemHoje = dias.some(...)`, não mais por coluna individual). Estado próprio (`useState` + `setInterval` de 60s) isolado do resto do grid. Reaproveita `janela`/`rowPx`/`ROW_MIN`, somando `ALTURA_CABECALHO_DIA` (40px) ao `top` — necessário porque agora o container-pai inclui a altura do cabeçalho sticky de dia/data, que antes ficava fora do container em que a linha vivia. Linha fina (`border-t`), esmaecida (`border-gold/30`), `pointer-events-none`, `inset-x-0` (100% da largura das colunas), sem label. Fica visualmente abaixo dos cards de sessão sem z-index: por estar em DOM/tree order antes de todas as `DiaColuna` (e seus `BlocoSessao`, também `position: absolute` com `z-index: auto`), a ordem de pintura do CSS (mesmo "stacking bucket" z-index:auto, ordenado por tree order) garante que os cards pintam por cima.
- `EscopoMoveModal` — pergunta "só esta" vs. "esta e futuras" ao mover sessão de pacote com irmãs futuras.
- **Lock de mutação durante drag-and-drop (2026-07-24)**: `movendoSessao` (boolean) trava o grid do início de `handleDragEnd` até a mutação resolver por completo — cobre a checagem de irmãs futuras, o tempo em que `EscopoMoveModal` fica aberto esperando escolha (o lock **não** destrava enquanto o modal está aberto) e o `PATCH` em si (incluindo o `carregarSessoes()` interno de `moverSessao`). `travarMovimento()`/`destravarMovimento()` (helpers locais) gerenciam o estado + um `setTimeout` de 25s como rede de segurança (força destravar com `console.warn` se algum caminho não previsto não liberar). Visual: `pointer-events-none` + `opacity-50` só na `div` do `boxRef` (o container que o `DndContext` já envolve) — como `DndContext` nunca envolveu a árvore toda (só o grid, não o toolbar nem os modais), os modais (`EscopoMoveModal`, `SessaoDetalheModal`, `AnamneseModal`) continuam 100% clicáveis por cima do esmaecido sem precisar de escopo extra. Badge "Salvando alteração..." renderizado como irmão do `boxRef` (fora da `div` esmaecida, mesma opacidade normal). Cobre os dois modos (`semana`/`dia`) igualmente — são a mesma árvore de componentes, não duplicada por view. Cancelar no modal (`onCancelar`) só destrava — não há update otimista prévio nesse caminho (`ESTA_E_FUTURAS` só aplica estado local depois do servidor confirmar), então não há posição a reverter; o `dnd-kit` já reseta o `transform` do card sozinho assim que o drag termina, independente da aplicação.
- `SessaoDetalheModal` — modal de detalhe ao clicar no card: status, confirmar, editar data/hora/tipo/duração, cancelar com motivo, copiar mensagens.
- Handlers-chave: `carregarSessoes` (GET `/api/agenda`), `moverSessao`/`redimensionarSessao` (PATCH `/api/sessoes/[id]` otimista), `handleDragEnd` (drop → valida → move), `handleResizePointerDown` (resize manual).
- **Largura do container do painel**: `header`/`main` de `painel/page.tsx` (~linhas 1517/1658) usam `max-w-[1360px]` (2026-07-18, era `max-w-5xl`/1024px; passou por `max-w-[1600px]` no mesmo dia, reduzido depois por ficar sem margem lateral visível em desktop) — limite deliberado para não esticar demais em monitores ultrawide, mas amplo o bastante pra Agenda em modo Semana. O grid de dias em si é Flexbox, não CSS Grid: container `flex` (~linha 590) com `minWidth: 1100` no modo Semana (era 880) e cada `DiaColuna` é `flex-1 min-w-[150px]` (~linha 724, era 120px) — confirmados visualmente confortáveis dentro do container de 1360px, sem necessidade de reduzir mais. Abaixo de ~1100px de largura útil, o wrapper com `overflow-auto` (~linha 589, inalterado) assume como fallback — a Agenda rola horizontalmente dentro do próprio card em vez de comprimir as colunas ou vazar overflow pro resto da página.

### `src/app/painel/configuracoes/*/page.tsx`
- `dados-gerais` — cadastro/fiscal da clínica.
- `atendimento` — expediente, tipos de atendimento, config de duração/confirmação/resize (campos de clínica desabilitados para OPERADOR).
- `identidade` — logo, fundo, cores.
- `integracoes` — status Google, pasta raiz Drive, config de import (Sheets id/aba); o gatilho de import em si fica na tela de pacientes.
- `mensagens` — templates de e-mail de boas-vindas e mensagens de copiar-colar.
- `seguranca` — troca da própria senha (todos) + gestão de equipe (só ADMIN).
- `layout.tsx` — casca com menu lateral, filtra itens visíveis por capacidade (espelho de UX; a segurança de verdade é em cada rota).

### `src/app/tarefas/page.tsx`
Página de gestão de tarefas: filtros status (Pendentes/Concluídas/Todas) e tipo (Renovação/Conta/Todos), formulário de tarefa manual, ações condicionadas ao tipo (`CONTA`: editar/concluir/excluir; `RENOVACAO`: só "Dispensar").

### Componentes de apoio do painel
- `AnexosPaciente.tsx` — upload/lista de anexos (modo edição).
- `AnamneseEditor.tsx` / `AnamneseModal.tsx` — textarea de anamnese reutilizável + modal leve de acesso rápido.
- `DatePickerSP.tsx` — seletor de data por clique, fixo no fuso de São Paulo.

### `src/components/TarefaForm.tsx` (2026-07-25)
Modal de criar/editar tarefa (tipo `CONTA`) — extraído de duas implementações quase idênticas duplicadas em `painel/page.tsx` (só criação, campo "Nova tarefa" no sino) e `tarefas/page.tsx` (criação e edição). Componente não-controlado: recebe `valoresIniciais` só pra inicializar o estado interno uma vez — quem chama força reset trocando a `key` do componente (`tarefas/page.tsx` usa `key={tarefaEditando?.id ?? "novo"}`) ao trocar de tarefa/nova tarefa, nunca via re-render normal. Isso importa: um `useEffect` ouvindo `valoresIniciais` foi cogitado e descartado durante a extração — como esse objeto é recriado a cada render do pai, resetaria o formulário (apagando o que o usuário já tinha digitado) em qualquer re-render, incluindo o próprio `salvando=true` no envio. A diferença real entre os dois usos (editar existe ou não, textos de título/botão, POST vs. PATCH, o que fazer depois de salvar) fica com quem chama, via props — nenhum comportamento foi perdido na unificação.

## 6. Libs de apoio (`src/lib/`)

| Arquivo | Função pública principal |
|---|---|
| `auth.ts` | `getUsuarioLogado()` — usuário da sessão Supabase + linha `Usuario` correspondente |
| `permissoes.ts` | `pode(papel, capacidade)` / `exigirPermissao()` — mapa papel→capacidade |
| `auditoria.ts` | `registrarLog()` — grava `LogAuditoria`, melhor esforço (nunca derruba a operação principal) |
| `prisma.ts` | Client Prisma singleton, adapter `PrismaPg` sobre `DATABASE_URL` (pooler) |
| `timezone.ts` | `componentesSP()`/`criarDataSP()`/formatação — único jeito correto de lidar com data/hora (fuso SP) |
| `google.ts` | Integração Google completa: OAuth, Calendar (`obterCalendarDaClinica`, `criarEventoGoogleMeet` — recebe `comMeet: boolean` desde 2026-07-21, cria evento sem `conferenceData` quando `false`, para sessão presencial —, `sincronizarEventoGoogle`), Drive (`criarPastaPacienteDrive`, `compartilharPastaComEmail`), Gmail (`enviarEmailBoasVindas`), Sheets é lido por `importacao.ts` |
| `validacaoSessao.ts` | `validarStatusSessao()`/`dataEhFutura()` — trava central: sessão futura não pode ser Realizada/Não realizada |
| `conflitoSemana.ts` | `existeConflitoDeSemana()` — impede 2 sessões do mesmo paciente na mesma semana SP |
| `loteSessoes.ts` | Helpers da ação em lote: elegibilidade, validação de status, texto de log agregado |
| `finalizacao.ts` | `verificarFinalizacao()` — finaliza pacote+paciente quando todas as sessões são consumidas, sincroniza `Tarefa RENOVACAO` |
| `tarefas.ts` | `sincronizarTarefaRenovacao()` — cria/conclui `Tarefa RENOVACAO` nos 3 pontos que mudam `Paciente.statusGeral` |
| `labels.ts` | Tradução de enums do banco (MAIÚSCULO) para rótulos amigáveis pt-BR |
| `blocoAgenda.ts` | `textoLinhaBlocoAgenda()` — label do card de sessão no calendário; `formatarTituloAgendamento()` (2026-07-30) — ponto único de formatação do título "{paciente} (N/T)" usado no evento do Google Calendar e nas rotas de sessão, veja seção 9 |
| `templatesMensagem.ts` | Templates padrão + `renderizarTemplateMensagem()` (placeholders de confirmação/Meet, inclui `{hora}` no Meet desde 2026-07-21) |
| `emailBoasVindas.ts` | Renderiza assunto/corpo do e-mail de boas-vindas (texto → HTML) |
| `nomes.ts` | `primeiroUltimoNome()` — nome curto para títulos de evento Google |
| `validacao.ts` | Parsing/validação de link de pasta do Google Drive |
| `anexos.ts` | Constantes/paths de upload de anexo (bucket, mime, tamanho máx.) |
| `importacao.ts` | `lerEDeduplicarPlanilha()` — lê Google Sheets, dedupe por CPF (só leitura) |
| `rateLimit.ts` | `checkRateLimiteLocal()` — rate limit em memória, fallback do Vercel Firewall |
| `fundo.ts` | Tradução de ajuste de fundo (cover/contain/...) para CSS |

## 7. Permissões (`src/lib/permissoes.ts`)

Papéis: `ADMIN` (tudo) ⊃ `PROFISSIONAL` (tudo de OPERADOR + `excluirPaciente`, `editarConfiguracoes`, `gerirIdentidadeVisual`, `gerirIntegracoes`) ⊃ `OPERADOR` (`gerirPacientes`, `operarAgenda`, `gerirTiposAtendimento`). Só `ADMIN` tem `gerirUsuarios`, `criarClinica`, `verLog`, `gerirBilling`.

Capacidades hoje sem nenhuma rota checando (`verLog`, `gerirBilling`) ou checadas só na UI (menu de configurações), não no backend — reconferir se alguma tela nova depender delas.

**Rotas sem gate de capacidade** (dívida, ver seção 4): CRUD de paciente (exceto delete), toda mudança de status/cancelar sessão fora do branch de mover, criar pacote, tarefas, anexos, import. `PATCH /api/clinica`, `POST /api/clinica/branding`, `GET /api/usuarios`, integrações Google, `DELETE /api/pacientes/[id]` e — desde 2026-07-25 — `POST /api/pacientes/[id]/adiar`/`empurrar` (`operarAgenda`, mesma capacidade do branch de mover em `sessoes/[id]`) são os pontos com `pode()`. **Achado ao aplicar o gate**: `operarAgenda` já é `true` pros 3 papéis (ADMIN, PROFISSIONAL, OPERADOR) em `capacidadesPorPapel` — então o gate aqui é defesa em profundidade (documenta a intenção, barra requisição sem sessão válida chamando a capacidade errada por engano no futuro), não uma restrição de papel nova: nenhum usuário real perde acesso a Trazer/Empurrar por causa disso.

**Auditoria de PII/over-fetch — 2026-07-18 (encerrada)**. Relatório completo em `Documentos Claude/auditoria-pii-pacientes-2026-07-18.md`. Corrigido: `GET /api/pacientes` enxugado para `{ id, nome, telefone, statusGeral }` — exigiu refactor de `painel/page.tsx` (`abrirModalEdicao`, `abrirPainelPaciente`, `abrirAnamnese`, `recarregarPacienteSelecionado`, `abrirNotificacaoPaciente`) para buscar `GET /api/pacientes/[id]` sob demanda em vez de reaproveitar o objeto da listagem, já que anamnese/CPF/RG eram lidos diretamente dele. `GET /api/importacao/preview` enxugado para `{ nome, cpf, status }` por linha. `GET /api/pacientes/[id]` com `select` explícito, `clinicaId` removido da resposta, `finalizadoEm` removido por não ser usado no front. Decisão de produto registrada separadamente: OPERADOR mantém acesso idêntico a PROFISSIONAL/ADMIN sobre dado clínico. Pendente, fora de escopo: achado 3 (rotas de escrita buscando `Paciente` inteiro só para checar `clinicaId`/nome em log) — over-fetch de banco que nunca vaza ao cliente, baixa prioridade.

## 8. Integrações externas

| Integração | Lib | Ponto de entrada |
|---|---|---|
| Google Calendar/Meet | `src/lib/google.ts` | `obterClinicaECalendar`, `criarEventoGoogleMeet`, `sincronizarEventoGoogle` (retorna `Promise<boolean>` desde 2026-07-23, não `void`) — chamados a partir de `sessoes/[id]`, `sessoes/lote`, `pacotes`, `pacientes/[id]/adiar`, `pacientes/[id]/empurrar` (essas duas últimas também gravam `googleSyncStatus` e criam evento faltante desde 2026-07-23) |
| Google Drive | `src/lib/google.ts` | `criarPastaPacienteDrive` (no `POST /api/pacientes`), `compartilharPastaComEmail` (`POST /api/pacientes/[id]/compartilhar-pasta`) |
| Gmail | `src/lib/google.ts` | `enviarEmailBoasVindas`, chamado junto do compartilhamento de pasta |
| Google Sheets (import de pacientes) | `src/lib/importacao.ts` | `lerEDeduplicarPlanilha`, usado por `GET /api/importacao/preview` e `POST /api/importacao/executar`; config (planilha/aba) fica em `Clinica.sheetsPlanilhaId`/`sheetsAba`, editável em `/painel/configuracoes/integracoes` |
| OAuth Google (conexão da clínica) | `src/lib/google.ts` | `gerarUrlConsentimentoGoogle`/`trocarCodePorTokensGoogle`, fluxo completo em `/api/integracoes/google/{conectar,callback,desconectar,status}`. Callback (2026-07-24) reseta `googleTokenValido=true`/`googleUltimaFalhaEm=null` ao reconectar com sucesso. |
| Detecção de token revogado (2026-07-24) | `src/lib/google.ts` | `ehErroTokenRevogado(err)` — `true` quando `err.response?.data?.error === "invalid_grant"` (confirmado por teste controlado, mesmo shape num refresh direto ou numa chamada de API que dispara refresh). `marcarFalhaTokenSeRevogado(clinicaId, err)` grava `Clinica.googleTokenValido=false`/`googleUltimaFalhaEm=now()` — chamado nos 6 catches de `google.ts` (Drive, Gmail, Calendar) e na checagem noturna. **Diferente de `googleConectado`**, que só muda por ação manual (conectar/desconectar) — `googleTokenValido` é a saúde real, populada só por detecção de erro. |
| Supabase Auth | `src/lib/supabase/server.ts`, `src/lib/auth.ts` | Sessão via cookies (`@supabase/ssr`), `proxy.ts` refresca a sessão em toda rota `/api/*` |
| Supabase Storage | `src/lib/anexos.ts` + rotas `pacientes/[id]/anexos/*` | Anexos de paciente; branding (logo/fundo) sobe direto em `clinica/branding/route.ts` |

## 9. Pontos de atenção / dívidas

- **Feature nova (2026-07-30) — rótulo de sessão de atendimento único (ex.: avaliação) não é mais numerado**: até então, todo `Agendamento` mostrava "{paciente} (N/T)" (ou variações locais: "Sessão N/T", "{primeiro nome} N/T") mesmo quando `totalPacote = 1` era uma avaliação, não uma sessão avulsa comum — não havia distinção visual entre as duas. Não existe enum fixo de "avaliação": o discriminador é `TipoSessao.ehAtendimentoUnico` (booleano configurável por clínica, `nome` livre em texto — ex.: "Avaliação online"). Corrigido: `formatarTituloAgendamento()` em `src/lib/blocoAgenda.ts` é o ponto único de formatação — quando `tipoSessao.ehAtendimentoUnico === true` e o tipo tem `nome` resolvido, o rótulo vira `{paciente} - {nome do tipo}` em vez de `{paciente} (N/T)`; caso contrário (ou se o nome não vier resolvido, pra nunca gerar título terminando em traço), mantém o formato numerado de sempre. Usado nos 6 pontos que montam o `summary` do evento Google (`pacotes`, `pacientes/[id]/empurrar`, `pacientes/[id]/adiar`, `sessoes/[id]` ×3, `sessoes/lote`) e replicado (com a mesma regra, mas convenção de nome/prefixo própria de cada tela) em `textoLinhaBlocoAgenda` (bloco da grade) e nos rótulos de `painel/page.tsx` (lista de sessões do paciente, sino de notificações, modais de editar/cancelar/trazer sessão). Em `PATCH /api/sessoes/[id]` (branch `body.tipoSessaoId`), o título passou a ser recomputado a partir do **novo** tipo (`novoTipo`), não do tipo antigo da sessão — mudança de comportamento deliberada: antes o comentário dizia que o título "independe do tipo" (só nome/numeração não mudavam), mas agora o rótulo de atendimento único depende do tipo em si, então trocar de/para um tipo `ehAtendimentoUnico` precisa refletir na mesma chamada. **Fora de escopo, não alterado**: o título do modal de detalhe da sessão em `AgendaCalendario.tsx` (linha com "Sessão N/T — {tipo.nome}") e o aviso de "esta sessão faz parte de um pacote com N sessões seguintes" continuam com o formato antigo — não fazem parte do rótulo de criação/sincronização com o Google e não estavam no escopo pedido.
- **Sem gate de permissão na maioria das rotas de escrita** (ver seções 4 e 7) — dívida conhecida, não corrigir sem pedido explícito.
- **Corrigido em 2026-07-25 — mudança de status de sessão agora sincroniza com o Google Calendar**: até então, só cancelamento mexia no evento (deleta); mudar pra Realizada/Não realizada/Reagendada nunca refletia nada no Google — divergência real entre banco (fonte da verdade) e espelho. O Calendar não tem campo nativo de "status", então o mínimo aceitável (mesmo critério já usado pro ✅ de confirmação) é refletir no **título** do evento: `PATCH /api/sessoes/[id]` (branch `body.status`) e `POST /api/sessoes/lote` (status != `CANCELADA`, já que cancelamento em lote já deletava o evento) agora chamam `sincronizarEventoGoogle` com o título recomposto (`{nome} ({num}/{total}){✅ se confirmada}{sufixo do status}` — `AGENDADA` não ganha sufixo, é o estado "normal"; `REALIZADA`/`NAO_REALIZADA`/`REAGENDADA` ganham `" — Realizada"` etc.) e gravam `googleSyncStatus: SINCRONIZADO/FALHOU` conforme o resultado — melhor esforço, igual todo o resto: falha na integração nunca desfaz a mudança de status já commitada no banco. **Dívida que continua**: os outros branches de `PATCH /api/sessoes/[id]` (mover, duração, tipo, confirmar) sincronizam mas ainda não gravam `googleSyncStatus` — fora do escopo deste bloco, que era só mudança de status.
- **Bug corrigido em 2026-07-21 — gate de sincronização em `POST /api/pacotes` usava `tipoSessaoEhOnline`, não "clínica conectada"**: sessão presencial nunca chamava a API do Google, mesmo com a clínica conectada (auditoria encontrou 2 pacotes reais, 24 sessões, 100% sem evento). Corrigido: o gate agora é só "clínica tem Google conectado"; dentro do branch, `criarEventoGoogleMeet(..., comMeet)` recebe `comMeet = tipoSessaoEhOnline` (Meet só pra sessão online, evento simples pra presencial). Campo novo `Agendamento.googleSyncStatus` (`StatusSincronizacaoGoogle`: `NAO_APLICAVEL`/`PENDENTE`/`SINCRONIZADO`/`FALHOU`) grava o resultado da tentativa feita na criação — backfillado para os dados existentes via `scripts/backfill-google-sync-status.mjs` (556 SINCRONIZADO, 24 FALHOU — os 2 pacotes do bug —, 12 NAO_APLICAVEL). **Escopo da correção original (2026-07-21) foi só a criação** (`POST /api/pacotes`) — `PATCH /api/sessoes/[id]` e as variantes de empurrar/adiar/cancelar ficaram sem popular `googleSyncStatus`. Pendente, aguardando decisão do usuário: criar retroativamente os eventos reais no Google para as 24 sessões órfãs do Fábio Godoy (as da Maura já foram corrigidas manualmente — ver script de move de calendário abaixo).
- **Bug corrigido em 2026-07-23 — `pacientes/[id]/adiar` e `pacientes/[id]/empurrar` sincronizavam com o Google, mas a falha era só logada, nunca registrada**: `sincronizarEventoGoogle` retornava `Promise<void>` (engolia erro internamente), então as duas rotas não tinham como saber se a chamada deu certo. Auditoria encontrou o paciente Jadir Silva com 7 sessões (`AGENDADA`, futuras) cuja data no banco estava certa (um `empurrar` de 1 semana tinha sido aplicado com sucesso), mas o evento no Google ficou 7 dias atrasado — a falha de sync daquele `empurrar` nunca apareceu em lugar nenhum. Corrigido: `sincronizarEventoGoogle` agora retorna `Promise<boolean>` (sucesso/falha, nunca lança); `adiar`/`empurrar` gravam `googleSyncStatus: SINCRONIZADO`/`FALHOU` conforme o resultado, e — mesmo gate de `POST /api/pacotes` — criam o evento (`criarEventoGoogleMeet`, `comMeet = tipoSessao.ehOnline`) quando a sessão movida nunca teve `googleEventId` em vez de simplesmente pular a integração. Resync pontual do Jadir feito via `scripts/resync-jadir-sessoes-futuras.mjs` (7/7 sincronizados, banco nunca alterado a partir do Google — só o inverso).
- **Bug corrigido em 2026-07-23 — presencial e online sempre caíram no mesmo calendário do Google, desde sempre**: `Clinica.googleCalendarId` é um único campo (default `"primary"`) e nunca houve mapeamento tipo→calendário — os 4 pontos de criação/atualização de evento (`pacotes/route.ts`, `sessoes/[id]/route.ts`, `adiar/route.ts`, `empurrar/route.ts`) sempre usaram só esse campo único, então sessão presencial e online iam parar no mesmo lugar (o calendário "primary"/padrão da conta conectada), mesmo depois do fix de 2026-07-21 (que corrigiu *se* o evento era criado, não *em qual calendário*). Corrigido: campo novo `TipoSessao.googleCalendarId` (nullable) — quando configurado, é a fonte de verdade de qual calendário aquele tipo de atendimento usa; os 4 pontos passaram a resolver `sessao.googleCalendarId ?? tipoSessao.googleCalendarId ?? clinica.googleCalendarId ?? "primary"` (a linha já existente no evento sempre vence, o tipo é o próximo critério, a clínica é só o último fallback). Seed feito pra Fono Pâmela Rachid: tipos online → `"primary"`, tipos presenciais → o calendário "Sessões Presenciais" real da conta (`c_4d0c121a...@group.calendar.google.com`). Esse campo é o que o job noturno do Bloco B (auditoria de sincronização, ainda não implementado) vai consultar pra saber quais calendários checar por clínica — não infere mais pela distribuição histórica de `Agendamento.googleCalendarId`, que é só um efeito colateral de correções manuais pontuais, não uma configuração real.
- **Achado colateral da reconciliação de 2026-07-23 — pacote duplicado da Maura Marques Oliveira Diana**: a paciente tinha 2 `Pacote` TRIMESTRAL ativos simultâneos cobrindo as mesmas 12 datas semanais (`a6fdcbbd-...`, cancelado, e `13987428-...`, agendado), ambos referenciando os mesmos 12 `googleEventId` reais — um resquício de dois pontos de criação (um manual no Google, outro via app) apontando pro mesmo compromisso físico. Resolvido a favor do pacote agendado (`13987428`); o cancelado ficou como histórico. Não investigado a fundo *por que* a duplicação aconteceu — provável duplo cadastro por engano durante a janela em que o pacote original não mostrava nenhum evento de Google (efeito do bug do gate original).
- **RESOLVIDO em 2026-07-24 — drift de migration em `Paciente.dataCadastroForms`/`Paciente.horarioFixo`**: commit `3bae546`, migration `20260725000000_resolve_drift_pacientes_horariofixo_datacadastroforms`. Schema e banco consistentes (`dataCadastroForms`: `timestamp` nullable; `horarioFixo`: `text` nullable) — reverificado via `information_schema` em 2026-08-04. **Não é mais bloqueio ativo para `migrate dev`** — se `migrate dev` falhar hoje, a causa é outra (ver §12 sobre o schema não commitado de `wa-bridge`, causa real do último bloqueio).
- **`GET /api/clinica`** contém um bloco de log de auditoria que parece copiado do `PATCH` (refaz uma query extra sem necessidade, já que GET não altera nada) — não é bug funcional, mas desperdício de uma query em toda leitura.
- **`mapearCorParaGoogleColorId`** vive dentro de `google.ts`, mas o arquivo de teste correspondente se chama `mapearCorGoogle.test.ts` — nome do teste não bate com o nome do arquivo fonte; não há `src/lib/mapearCorGoogle.ts`.
- **Feature nova (2026-08-04) — anamnese importada passa a incluir os dados cadastrais e bloqueia metadados do forms.app**: até então, `lerEDeduplicarPlanilha()` (`src/lib/importacao.ts`) excluía do texto da anamnese qualquer coluna que batesse no `MAPA` (nome, telefone, RG, data de nascimento etc.) — essas 13 colunas cadastrais só viravam campo próprio do `Paciente`, nunca apareciam no texto que a profissional lê. Ao mesmo tempo, colunas de metadado de submissão do forms.app (`Submitter`, `Submission Date`, `Submission ID`, `Idade`) não batiam em nenhum filtro existente (só havia `REGEX_COLUNA_ACEITE`, pra coluna de aceite/consentimento) e acabavam entrando no texto como linhas normais de pergunta — confirmado contra o cabeçalho real da planilha da Pâmela (54 colunas, aba "Anamnese"). Corrigido: o `forEach` de colunas (dentro de `lerEDeduplicarPlanilha`) agora, quando a coluna bate no `MAPA`, continua gravando `dados[campo]` **e também** empurra a linha pra `linhasAnamnese` (única exceção: `dataCadastroForms`, que continua de fora — é metadado de submissão, não dado que a clínica queira ver no texto). Um novo bloqueio (`COLUNAS_METADADOS_FORMS` + `REGEX_COLUNA_SUBMISSION = /^submission/`, aplicado sobre o cabeçalho já normalizado) filtra `Submitter`/`Submission Date`/`Submission ID`/`Idade` e qualquer coluna futura que comece com "submission". O rótulo de cada linha agora passa por `.trim().replace(/:$/, "")` antes de concatenar (`${rotulo}: ${valor}`) — vários cabeçalhos reais têm espaço sobrando no fim (ex.: `"Usa Voz demasiadamente "`) e alguns já terminam em `:` (ex.: `"Classificação Vocal:"`), o que gerava `"::"` sem o strip. Resultado: o texto da anamnese agora começa com as 13 linhas cadastrais na ordem da planilha (`Nome Completo` primeiro), seguidas das perguntas de saúde, terminando na última pergunta antes do `SEPARADOR_OBSERVACOES` (inalterado) — sem nenhum metadado do forms.app. **Escopo desta mudança foi só a montagem do texto** (`src/lib/importacao.ts`) — `POST /api/importacao/executar` não foi tocado: continua gravando só `nome`/`telefone`/`email`/`cpf`/`logradouro`/`cep`/`quemIndicou` como campos próprios do `Paciente` (confirmado por leitura: `rg`, `dataNascimento`, `estadoCivil`, `nacionalidade`, `profissao`, `instagram` são lidos pelo `MAPA` mas nunca persistidos em coluna própria — só passam a aparecer no texto da anamnese com esta mudança). Dedupe por CPF e a regra "anamnese só grava na criação, nunca sobrescreve" continuam intactos. Validado antes do commit chamando `lerEDeduplicarPlanilha()` direto (mesma função usada por `GET /api/importacao/preview`) contra a planilha real da Pâmela.
- **Feature nova (2026-08-04) — `montarAnamnese()` extraída + script de reprocessamento retroativo (`scripts/reprocessar-anamnese.ts`)**: a lógica de montagem do texto (antes embutida no `forEach` de `lerEDeduplicarPlanilha`) virou função exportada `montarAnamnese(cabecalhoOriginal, cabecalhoNormalizado, linha): string` em `src/lib/importacao.ts` — refactor puro, comportamento idêntico (validado por comparação byte-a-byte do output antes/depois contra a planilha real). `lerEDeduplicarPlanilha` passou a só extrair os campos cadastrais (`dados[campo] = valor`) e chamar `montarAnamnese` pro texto — único ponto de formatação, sem duplicação.
  - **`scripts/reprocessar-anamnese.ts`** — reprocessa retroativamente pacientes já importados antes do Bloco A (anamnese sem cadastrais / com metadados do forms.app). Reaproveita `lerEDeduplicarPlanilha()` (nunca reimplementa leitura de planilha nem OAuth) — o `.anamnese` de cada `RegistroPlanilha` já vem montado por `montarAnamnese()`. Casamento planilha↔paciente é **somente por CPF** (`soDigitos`), nunca por nome. Leitura/escrita dos pacientes via `pg.Client` direto em `DIRECT_URL` (porta 5432, nunca o pooler) — mesmo padrão dos demais scripts de backfill.
  - **Argumentos**: `--clinica=<slug>` (obrigatório), `--fase=vazios|preenchidos` (obrigatório), `--executar` (ausente por padrão = dry-run, nenhuma escrita).
  - **Regras de segurança, nunca tocadas**: paciente sem CPF; CPF sem linha correspondente na planilha; CPF com mais de uma linha na planilha (repreenchimento — resolução manual). Todas contadas e listadas no relatório, em qualquer fase.
  - **Fase `vazios`** (anamnese `NULL`/vazia): grava o texto novo (`montarAnamnese`) direto — criação de conteúdo.
  - **Fase `preenchidos`** (anamnese já tem texto): localiza a primeira ocorrência de `"--- OBSERVAÇÕES ---"`. Sem a marca → não toca, lista o id (formato antigo, tratamento manual — achado da auditoria: ~3 registros nessa condição na Pâmela, mas nenhum chega a essa checagem porque já são filtrados antes por não terem CPF/match — ver dry-run abaixo). Com a marca → preserva tudo a partir dela **byte a byte** (a marca inclusive) e substitui só o trecho anterior pela nova montagem; antes de cada UPDATE, recompara em código o trecho preservado contra o original e aborta o registro (sem gravar) se divergir.
  - **Backup obrigatório antes de qualquer escrita** (só quando `--executar`): `scripts/_backup-anamnese-<clinica>-<timestamp>.json` com `{ id, anamnese }` do estado atual de cada registro que será alterado — padrão adicionado ao `.gitignore` (`scripts/_backup-anamnese-*.json`), nunca commitado (dado clínico).
  - **Dry-run rodado nas 4 combinações antes do commit** (clínica × fase): `clinica-teste` falha nas duas fases com erro esperado (planilha não configurada — estado já conhecido). `pamela-rachid`: 61 pacientes totais, 49 sem CPF, 4 sem linha correspondente na planilha, 0 com múltiplas linhas, 4 elegíveis pra `vazios` e 4 elegíveis pra `preenchidos` (0 sem separador — os ~3 registros do formato antigo sem marca não têm CPF batendo na planilha, então já saem via `semCpf`/`semMatch` antes de chegar nessa checagem). Nenhuma escrita foi feita — `--executar` fica pendente de autorização explícita.
  - **Execução autorizada e CONCLUÍDA (2026-08-04)**: `--fase=vazios --clinica=pamela-rachid --executar` gravou **4** pacientes; `--fase=preenchidos --clinica=pamela-rachid --executar`, rodada logo em seguida na mesma sessão, gravou **8** (os 4 originalmente preenchidos + os 4 que o passo anterior acabara de preencher, que na leitura fresca do banco também bateram nos critérios da fase `preenchidos` — reprocessamento em cascata, não um bug de escrita). Verificado byte a byte, nos 8, que o trecho a partir de `--- OBSERVAÇÕES ---` ficou idêntico entre o backup (estado antes do UPDATE) e o valor final no banco — nenhuma observação da clínica foi alterada ou perdida; para os 4 duplicados, o texto inteiro (não só abaixo do separador) ficou byte-idêntico, confirmando que foi um `UPDATE` sem efeito (regravou o mesmo valor).
  - **Blindagem de PII em código (2026-08-04)**: toda saída de amostra/diff do script passa por `redigir()` — 2 camadas: (1) linhas cujo rótulo normalizado bate em `nome completo`/`seu cpf`/`seu rg`/`telefone (whatsapp)`/`telefone`/`e-mail`/`endereço completo`/`cep`/`seu instagram`/`data de nascimento` viram `[REDIGIDO]` por inteiro; (2) por segurança adicional, qualquer sequência que pareça CPF/telefone (10-11 dígitos, com ou sem pontuação) ou e-mail é redigida em qualquer posição do texto, mesmo fora de um rótulo mapeado — cobre resposta livre onde o paciente pode ter digitado o próprio contato. Motivado por um incidente real: uma execução anterior deste mesmo script imprimiu amostra sem essa blindagem (por instrução do operador, não por bug de código) e PII real ficou visível numa saída de terminal/transcript. **Regra permanente registrada aqui**: todo script novo que leia e imprima campo de paciente deve implementar essa redação **em código**, nunca depender de instrução pontual do operador pra lembrar de redigir — mesmo padrão replicado em `scripts/_diagnostico-cpf-vazio.mjs`.
  - **Ajuste de fase (2026-08-04)** pra tornar reexecução inofensiva: na fase `preenchidos`, um registro só entra em `elegiveis` se houver algo abaixo do separador a preservar de diferente **ou** o trecho acima do separador ainda não bater com o que `montarAnamnese()` produziria agora — se o conteúdo abaixo do separador já está vazio e o de cima já é idêntico ao que seria gerado, é um no-op garantido e o registro cai no bucket `semMudanca` (contado no relatório, nunca gravado). Valida o cenário observado: rodar `vazios` e depois `preenchidos` na mesma sessão não reprocessa os mesmos registros de novo. Validado em dry-run pós-ajuste: `--fase=preenchidos --clinica=pamela-rachid` e `--fase=vazios --clinica=pamela-rachid` retornaram **0 elegíveis** nos dois (esperado — tudo já reprocessado).
- **CONCLUÍDO (2026-08-04) — diagnóstico de duplicidade na importação, decisão tomada**: dos 61 pacientes da Pâmela, 49 estão sem CPF; comparando nome normalizado (minúsculo, sem acento, sem espaço duplo) contra a coluna `Nome Completo` da planilha (`scripts/_diagnostico-cpf-vazio.mjs`, read-only), **14 batem** (provavelmente vieram do forms.app mas o CPF não foi salvo/migrado) e **35 não batem** (provavelmente cadastros anteriores ao formulário, nunca tiveram CPF pra começo de conversa). A exposição real ao risco de duplicata em reimportação é só os 14 — não os 49. **Decisão registrada**: em vez de criar uma regra nova de "complementar"/"anexar" (over-engineering pro tamanho real do problema), o caminho recomendado é **backfill de CPF** nesses 14 a partir do match por nome com a planilha (revisão manual antes de gravar, mesmo padrão de segurança dos scripts de backfill já existentes) — depois disso, o dedupe por CPF que já existe em `lerEDeduplicarPlanilha()`/`POST /api/importacao/executar` passa a cobrir esses casos normalmente, sem precisar de nenhuma lógica nova de update/anexação. Nenhuma escrita foi feita — o backfill de CPF em si fica como próximo passo, pendente de autorização explícita.
- **Feature nova (2026-07-24) — alerta de desconexão Google + checagem noturna de sincronização**, motivada pelo incidente de token `invalid_grant` transitório encontrado em auditoria:
  - `Clinica.googleTokenValido` (Boolean, default `true`) e `googleUltimaFalhaEm` (DateTime?) — saúde real da conexão, distinta de `googleConectado` (só ação manual). Marcada `false` por `marcarFalhaTokenSeRevogado()` nos 6 catches de `google.ts` que fazem chamada de API (Drive `verificarPastaDriveAcessivel`/`criarPastaPacienteDrive`/`compartilharPastaComEmail`, Gmail `enviarEmailBoasVindas`, Calendar `criarEventoGoogleMeet`/`sincronizarEventoGoogle`) e na checagem noturna; resetada para `true` (+ `googleUltimaFalhaEm: null`) só no callback OAuth (`/api/integracoes/google/callback`) quando a clínica reconecta com sucesso.
  - `GET /api/notificacoes` ganhou `integracaoGoogleFalhou: boolean` (`clinica.googleConectado && !clinica.googleTokenValido`) — extensão aditiva, não quebra `reagendadas`/`tarefas` existentes. `painel/page.tsx` soma isso em `totalPendencias` (badge do sino) e renderiza um **banner persistente** logo abaixo do `<header>` (não o toast de 4s de `AgendaCalendario`) quando `true` — visível em toda aba, não só dentro do dropdown do sino.
  - `GET /api/cron/verificar-google-noturno` — protegida por header `Authorization: Bearer <CRON_SECRET>` (env var, só local em `.env`; **precisa ser configurada manualmente nas env vars do projeto na Vercel** — não é sincronizada automaticamente). Nível 1: lista `Agendamento` futuro (`AGENDADA`/`REAGENDADA`) com `googleSyncStatus != SINCRONIZADO` por clínica (sinal já conhecido pelo banco, sem chamar o Google). Nível 2, só para clínicas com `googleConectado`: agrupa os agendamentos futuros **dentro da mesma janela de 60 dias que será consultada** (bug corrigido durante a validação — sem esse limite, todo agendamento além de 60 dias aparecia como "evento ausente", falso positivo) por `tipoSessao.googleCalendarId ?? clinica.googleCalendarId ?? "primary"`, faz **uma chamada `events.list` por calendário** (nunca por evento) e compara contra os `googleEventId` locais — evento ausente ou com horário divergente vira log de drift + `googleSyncStatus: FALHOU` (não corrige nada — reportar é o objetivo; correção é bloco separado, como fizemos com Maura/Fábio/Jadir). `invalid_grant` capturado nessa checagem também aciona `marcarFalhaTokenSeRevogado`. Agendada via `vercel.json` (`0 6 * * *` = 03:00 BRT) — plano Hobby suporta cron diário (limite é "no máximo 1x/dia", com imprecisão de até ±59min no horário de disparo; confirmado na documentação da Vercel, não precisou de upgrade pra Pro).
  - Validado com simulação read-only contra o banco real antes de commitar: Nível 1 encontrou 10 agendamentos sem `SINCRONIZADO` na Clínica Teste (não conectada, esperado); Nível 2 encontrou 12 drifts reais de horário na Fono Pâmela Rachid (mesmo padrão do caso Jadir) depois de corrigido o bug da janela.
  - **Primeira prova de valor em produção (2026-07-23/24)**: rodada manual em `https://banahdigital.vercel.app/api/cron/verificar-google-noturno` bateu 1:1 com a simulação (10/0/12). Os 12 drifts eram 6 sessões de Guilherme Messias + 6 de Felipe Pezzoni, todas com o Google exatamente 7 dias atrasado em relação ao banco (mesmo padrão do Jadir — `empurrar` que não sincronizou por falha silenciosa, antes da correção de causa raiz) — nenhuma tinha evento apagado, e o `calendarId` (`primary`) já estava certo. Corrigidas via `events.patch` pontual (não recriado, `googleEventId` preservado), 12/12 com sucesso, confirmado por leitura pós-patch.

## 10. Módulo Atendimento WhatsApp

### 10.1 Visão geral

Recepção e persistência de mensagens via WhatsApp Cloud API (Meta), app "atendimentobanah". Escopo atual: só o webhook de entrada (recebe e grava); envio/resposta automática fica para depois. Não pensado para multi-clínica ainda — hoje resolve sempre a primeira `Clinica` do banco (ver dívida abaixo), mas o schema já é multi-tenant (`clinicaId` em ambas as tabelas).

### 10.2 Modelo de dados (`prisma/schema.prisma`)

| Model | Papel | Campos-chave |
|---|---|---|
| `ConversaWhatsapp` | Uma conversa por (clínica, telefone) | `clinicaId`, `pacienteId?` (match por telefone, best-effort), `telefone`, `janelaAbertaAte` (24h desde a última mensagem do paciente — janela de mensagem livre da Meta), `estado` (`aberta`/`aguardando_humano`/`fechada`) |
| `MensagemWhatsapp` | Uma mensagem dentro de uma conversa | `conversaId`, `direcao` (`entrada`/`saida`), `texto`, `tipo` (tipo bruto da Meta: `text`/`button`/`interactive`/...), `wamid` (único — idempotência de retry do webhook), `respondidaPorIa` |

Migration `20260724110000_add_whatsapp_conversas_mensagens` aplicada manualmente via `prisma db execute` + `migrate resolve --applied` (não por `migrate dev`) por causa do drift pré-existente descrito na seção 2 — mesmo padrão já usado antes neste projeto.

### 10.3 Fluxo do webhook (`GET/POST /api/whatsapp/webhook`)

- **GET**: verificação do webhook pela Meta — compara `hub.verify_token` com `WHATSAPP_VERIFY_TOKEN`, responde `hub.challenge` em texto puro (200) ou 403.
- **POST**: valida a assinatura `X-Hub-Signature-256` (HMAC SHA256 do corpo bruto, `WHATSAPP_APP_SECRET`) antes de tocar no payload — assinatura inválida responde 401 sem processar. Com assinatura válida, extrai `entry[0].changes[0].value`:
  - `messages`: para cada mensagem, busca/cria `ConversaWhatsapp` por `(clinicaId, telefone)`, tenta casar `pacienteId` pelo campo `telefone` do `Paciente` (best-effort, sem bloquear o fluxo se não achar), grava `MensagemWhatsapp` com `direcao: "entrada"` — pulando duplicata se o `wamid` já existir (idempotência de retry da Meta).
  - `statuses` (status de entrega): só logado, nunca persistido.
  - Qualquer erro de processamento é logado internamente; a rota sempre responde 200 no final para não disparar retry por timeout da Meta.
- **Bug corrigido em 2026-07-24 — `resolverClinicaId()` associava conversas à clínica errada**: a versão original usava `prisma.clinica.findFirst()` **sem `orderBy`** — sem ordem explícita, o Postgres/Prisma não garante qual linha volta primeiro, e na prática estava retornando "Clínica Teste" em vez de "Fono Pâmela Rachid" (a única clínica real em produção — todos os `Usuario` e `Paciente` reais pertencem a ela). Sintoma reportado pelo usuário: a tela `/whatsapp` (inbox, §10.9) mostrava "Nenhuma conversa ainda" mesmo depois de mensagens reais chegarem — confirmado via query direta que as 2 `ConversaWhatsapp` existentes tinham `clinicaId` da Clínica Teste, então `GET /api/whatsapp/conversas` (que filtra pelo `clinicaId` do usuário logado, sempre Fono Pâmela Rachid) nunca as retornava. Não era falha do webhook nem da Meta — as mensagens foram recebidas e persistidas normalmente, só na clínica errada. Corrigido: `resolverClinicaId()` agora filtra explicitamente por `slug: "pamela-rachid"` — determinístico, em vez de depender de ordem incidental de linhas no banco. **Correção retroativa aplicada** via `scripts/corrigir-clinicaid-conversas-whatsapp.mjs`: as 2 conversas existentes foram movidas pra `clinicaId` certo, e `pacienteId` foi reencontrado nas duas (agora que a clínica bate, o match por telefone de `buscarPacientePorTelefone()` funcionou). **Dívida que continua**: não há campo que mapeie `phone_number_id` da Meta para uma `Clinica` específica — quando houver mais de uma clínica real com WhatsApp conectado, o hardcode por slug precisa virar um lookup real usando `value.metadata.phone_number_id` do payload.
- **Bug corrigido em 2026-07-24 — match de `pacienteId` comparava telefone sem normalizar**: `processarMensagensEntrada` comparava o telefone bruto que a Meta manda (`value.messages[0].from`, sempre dígitos com DDI, ex. `5511919395401`) direto contra `Paciente.telefone` sem normalizar — e `Paciente.telefone` está salvo em formatos inconsistentes (às vezes sem DDI, ex. `11919395401`, ver §10.5). Resultado: o match quase nunca batia, `ConversaWhatsapp.pacienteId` ficava `null`, e por consequência a IA de resposta (§10.6, que exige `pacienteId` pra rodar) nunca chegava a processar essas mensagens — confirmado em teste real: paciente "Pamela Rachid (Teste)" mandou "confirmado" duas vezes e nenhuma sessão foi marcada como confirmada. Não era risco de confirmar/notificar o paciente errado — era falso negativo (a IA simplesmente não rodava), nunca falso positivo. Corrigido: `buscarPacientePorTelefone()` busca os pacientes da clínica com telefone preenchido e compara em memória a versão normalizada (`normalizarTelefoneE164()`, já existia em `enviarTemplate.ts`) de cada um contra o telefone normalizado vindo da Meta — sem mudança de schema (não há índice único em `Paciente.telefone` pra fazer isso via `WHERE`, e normalizar o dado na origem/cadastro é mudança maior, fora de escopo). **Conversas já criadas com `pacienteId: null` por causa desse bug não foram corrigidas retroativamente** — a correção vale só para conversas novas a partir de agora; se precisar, é um `UPDATE` pontual como os já feitos em `scripts/corrigir-telefone-aarao.mjs`.
- Envio de mensagem (saída) implementado — ver §10.5-10.7. Fechamento automático da janela de 24h (a `ConversaWhatsapp.estado` virar `"fechada"`) ainda não implementado.

### 10.4 Variáveis de ambiente

`WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET` — chaves em `.env.example` (sem valores), `.env` real segue fora do controle de versão. Configuradas também em produção via `vercel env add ... production` (não sincronizadas automaticamente do `.env` — mesmo padrão do `CRON_SECRET`).

### 10.5 Envio de saída — lembrete de confirmação (2026-07-24)

Primeiro envio de saída implementado: lembrete automático do template utility `confirmacao_agenda` (aprovado pela Meta, `{{1}}=nome`, `{{2}}=data`, `{{3}}=hora`, botões Confirmar/Cancelar/Reagendar), disparado ~48h antes da sessão para quem ainda não confirmou. Responder aos botões do template (webhook `type: "button"`/`"interactive"`) já é recebido e persistido pelo webhook de entrada (§10.3), mas **não aciona nenhuma ação automática ainda** (não confirma a sessão sozinho) — isso é trabalho futuro.

- **Campo de controle**: `Agendamento.lembreteWhatsappEnviadoEm` (`DateTime?`, nullable) — `null` até o envio dar certo; marca a hora do envio, nunca é resetado automaticamente (reenviar exigiria zerar manualmente).
- **`src/lib/whatsapp/enviarTemplate.ts`**: `normalizarTelefoneE164()` — `Paciente.telefone` está salvo em formato inconsistente hoje (com/sem DDI, com/sem máscara; auditoria de 2026-07-24 encontrou 40/57 pacientes ativos já com DDI, 12/57 sem DDI, 2/57 com erro de digitação corrigidos manualmente — ver `scripts/corrigir-telefone-aarao.mjs`). A normalização só acontece em memória, na hora de montar o payload — nunca reescreve `Paciente.telefone`: dígitos com 10-11 caracteres levam prefixo `55` (assume Brasil); 12-13 dígitos (qualquer DDI) são usados como estão; qualquer outra contagem é tratada como inválido e o envio é pulado (sem tentar adivinhar). `enviarConfirmacaoAgenda({ clinicaId, pacienteId, telefone, nome, data, hora })` — assinatura em formato de objeto (não posicional) porque precisa de `clinicaId`/`pacienteId` para achar/criar a `ConversaWhatsapp` certa, respeitando o isolamento multi-tenant. Nunca lança: qualquer falha (telefone inválido, erro HTTP da Meta, erro de rede, erro ao persistir a mensagem depois de enviada com sucesso) volta como `{ sucesso: false, erro }`, logado internamente — quem chama decide o que fazer, sem derrubar o restante de um lote.
- **`GET /api/cron/whatsapp-lembretes`**: mesmo padrão de proteção do cron de Google (`Authorization: Bearer <CRON_SECRET>`). **Só roda 1x/dia** (`0 12 * * *` = 09:00 BRT) — o plano Vercel em uso (Hobby) não permite cron mais frequente que diário (mesma restrição já documentada para o cron de Google, seção 9). Isso força a janela de busca a ser larga (24h-72h de antecedência, centrada nas 48h-alvo) em vez de estreita: a largura de 48h da janela cobre a distância de 24h entre execuções sem deixar buraco, e `lembreteWhatsappEnviadoEm` evita reenvio duplicado nas execuções seguintes em que o mesmo agendamento ainda cair dentro da janela. Filtra `status != CANCELADA`, `confirmada = false`, `lembreteWhatsappEnviadoEm = null`, paciente com telefone preenchido; responde um resumo (`avaliados`/`enviados`/`falharam`/`falhas[]`) — cada falha (telefone inválido, erro da Meta, etc.) é isolada e não impede os demais envios do lote.
- **Pendências conhecidas**: (1) mesma dívida do webhook de entrada — sem mapeamento `phone_number_id` → `Clinica`, hoje `enviarConfirmacaoAgenda` recebe `clinicaId` de quem chama (o cron, via `paciente.clinicaId`), então isso já é multi-tenant-safe no envio, mas a leitura (webhook) ainda não é; (2) telefone fora do padrão E.164 é só pulado e logado, nunca corrigido automaticamente — 2 registros com erro de digitação já foram corrigidos manualmente em 2026-07-24 após confirmação do usuário, mas isso é um problema recorrente de qualidade de dado de cadastro, não coberto por validação no formulário ainda.
- **Achado (2026-07-24) — limite de cron do plano Vercel Hobby**: além do já documentado "1x/dia por cron" (seção 9), o plano Hobby também limita o **total de cron jobs por projeto a 2**. O projeto já tinha 2 (`verificar-google-noturno`, `whatsapp-lembretes`); em vez de um 3º cron dedicado pra mensagem do dia, a lógica foi fundida dentro de `whatsapp-lembretes` — mesma execução diária, dois critérios independentes rodados em paralelo (`Promise.all`), resumo separado por critério na resposta (`lembretes48h`/`mensagensDoDia`).

### 10.6 IA de confirmação/reagendamento (2026-07-24)

Primeiro uso de IA (Anthropic API, `claude-haiku-4-5`) no atendimento: interpreta a resposta do paciente a um lembrete/mensagem e decide entre 3 caminhos. Escopo só para paciente já confirmado/existente — funil de lead novo fica pra depois.

- **`src/lib/ia/responderWhatsapp.ts`** — `responderMensagemWhatsapp()`, chamada pelo webhook de entrada via `after()` (`next/server`, roda depois da resposta 200 já ter sido enviada — não bloqueia o webhook). Usa `client.messages.create` com `tools: [consultar_status_agendamento]` (schema vazio, `pacienteId` vem sempre do contexto do servidor, nunca do modelo — evita a IA consultar agendamento de outro paciente) + `output_config.format` (`json_schema`) forçando a saída em `{ intencao: "CONFIRMAR"|"REAGENDAR"|"OUTRO", resposta: string|null }`. Loop manual de até 3 rodadas pra dar tempo da IA chamar a ferramenta antes de decidir — nunca lança, qualquer falha (API, parsing) é logada e a função simplesmente não age (mensagem já persistida pelo webhook continua íntegra).
  - `CONFIRMAR` → marca `confirmada=true` no próximo `Agendamento` futuro do paciente (`AGENDADA`/`REAGENDADA`, `inicio >= agora`).
  - `REAGENDAR` (cobre cancelar/desmarcar/trocar) → `ConversaWhatsapp.estado = "aguardando_humano"`, não mexe no `Agendamento`. Enquanto nesse estado, o webhook **para de chamar a IA** pra essa conversa (trava em `processarMensagensEntrada`) — só volta a responder automaticamente se alguém (fora do escopo deste bloco) resetar o estado.
  - `OUTRO` → IA escreve a resposta (tom Daiane, nunca inventa data/hora/status — só cita o que veio da ferramenta), enviada via `enviarMensagemLivre` só se a `janelaAbertaAte` da conversa ainda estiver aberta; gravada como `MensagemWhatsapp` (`direcao: "saida"`, `tipo: "livre"`, `respondidaPorIa: true`).
- **`src/lib/whatsapp/enviarMensagem.ts`** — `enviarMensagemLivre()`, mensagem de texto simples (`type: "text"`) pela API da Meta, reaproveita `normalizarTelefoneE164` de `enviarTemplate.ts`. Só funciona dentro da janela de 24h — fora dela a Meta rejeita (só template aprovado funciona fora da janela).
- **Variável de ambiente nova**: `ANTHROPIC_API_KEY`.

### 10.7 Mensagem automática do dia da sessão (2026-07-24)

Segundo critério da mesma rota `GET /api/cron/whatsapp-lembretes` (função `enviarMensagensDoDia`, rodada em paralelo com o critério de lembrete de 48h via `Promise.all` — ver dívida de cron acima) — reaproveita `Clinica.templateMeet` + `renderizarTemplateMensagem`/`saudacaoAtual` (`src/lib/templatesMensagem.ts`, o mesmo template do botão de copiar-colar "link do Meet" já existente) e o campo `Agendamento.linkMeet` (já populado por `criarEventoGoogleMeet` na criação/edição da sessão — não é um campo novo). Busca `Agendamento` com `inicio` no dia de hoje (fuso SP), `status != CANCELADA`, `linkMeet` preenchido — envia independente de `confirmada`, funciona como novo contato pra quem ainda não confirmou. Nenhuma lógica de cancelamento automático.

- **Limitação real, documentada e aceita pelo usuário**: mensagem de texto livre só é aceita pela Meta dentro da janela de 24h da conversa (paciente precisa ter escrito recentemente) — diferente do lembrete de 48h, que usa um template aprovado (`confirmacao_agenda`) e por isso funciona fora da janela. Não existe ainda um template aprovado equivalente pro link do Meet. Quem está fora da janela aparece no resumo do cron (`falhas`) com o motivo — a rotina não tenta contornar isso nem envia de outra forma.
- **Idempotência sem campo novo no schema**: usa `MensagemWhatsapp.tipo = "meet_dia"` como marcador — antes de enviar, checa se já existe uma mensagem desse tipo na conversa criada hoje; se sim, pula (evita duplicata em reexecução manual do cron no mesmo dia).

### 10.8 Kill switch da IA + notificação de handoff (2026-07-24)

**Kill switch**: `WHATSAPP_IA_ATIVA` — `"false"` desliga a resposta automática por IA sem reverter código; qualquer outro valor (ou a env var ausente) mantém ativa. Checada em `src/app/api/whatsapp/webhook/route.ts` (`podeResponderPorIa`), antes de agendar `responderMensagemWhatsapp` via `after()`. A mensagem recebida continua sendo gravada normalmente (webhook de entrada não depende disso) — só para de gerar resposta automática e custo de IA.

**Como desligar rápido em produção**: mudar `WHATSAPP_IA_ATIVA` para `false` nas env vars do projeto na Vercel (`vercel env add WHATSAPP_IA_ATIVA production` sobrescrevendo, ou pelo painel) e **rodar um novo deploy** (`vercel --prod`) — env var alterada só no painel não afeta funções já publicadas, precisa de redeploy pra valer. Não precisa reverter nenhum commit.

**Notificação de handoff pra Daiane**: quando a IA decide `REAGENDAR` (`ConversaWhatsapp.estado` vira `"aguardando_humano"`), dispara uma mensagem de texto livre pro número configurado em `WHATSAPP_TELEFONE_NOTIFICACAO_HUMANO` (E.164, mesma normalização de `enviarTemplate.ts`), com nome do paciente, telefone e a mensagem que gerou o handoff. Implementado em `notificarHandoffHumano()` (`src/lib/ia/responderWhatsapp.ts`), nunca lança — falha de envio (ex.: `WHATSAPP_TELEFONE_NOTIFICACAO_HUMANO` não configurado, ou janela de 24h fechada com a Daiane) é só logada, não derruba o fluxo principal.

- **Idempotência da notificação**: a transição de estado usa `updateMany({ where: { id, estado: { not: "aguardando_humano" } } })` — só notifica quando essa chamada foi quem de fato mudou o estado (`count > 0`), nunca a cada mensagem nova enquanto a conversa já está `aguardando_humano`. Evita notificação duplicada em retry/mensagens repetidas do paciente.

### 10.9 Inbox de atendimento (2026-07-24)

Tela manual (`src/app/whatsapp/page.tsx`, `"use client"`) pra responder pacientes direto pelo painel, sem depender só da IA — reaproveita `ConversaWhatsapp`/`MensagemWhatsapp` já existentes, nenhuma tabela nova. Link "WhatsApp" na barra de navegação do painel (`src/app/painel/page.tsx`, ao lado de "Agenda"/"Pacientes"/"Tarefas").

- **Layout**: lista de conversas à esquerda (nome do paciente quando vinculado, senão o telefone; preview da última mensagem; badge de `estado`), chat da conversa selecionada à direita (histórico + campo de envio). Sem WebSocket — **polling a cada 15s** (`setInterval`) tanto na lista de conversas quanto no histórico da conversa aberta.
- **`GET /api/whatsapp/conversas`**: lista as conversas da clínica logada (`clinicaId` de `getUsuarioLogado()`, nunca do request), com a última `MensagemWhatsapp` de cada uma pra preview.
- **`GET /api/whatsapp/conversas/[id]/mensagens`**: histórico cronológico completo. Valida posse (`conversa.clinicaId === usuario.clinicaId`) antes de responder — 404 se não bater, nunca vaza conversa de outra clínica.
- **`POST /api/whatsapp/conversas/[id]/enviar`**: envia texto livre via `enviarMensagemLivre` (mesma função do envio automático), grava `MensagemWhatsapp` (`direcao: "saida"`, `tipo: "livre"`, `respondidaPorIa: false`), atualiza `ultimaMensagemEm`, e reseta `estado` de `"aguardando_humano"` pra `"aberta"` — envio manual de um humano já *é* o atendimento acontecendo, não faz sentido continuar marcado como esperando alguém. Mesma limitação de sempre: só funciona dentro da janela de 24h — fora dela, retorna 409 com mensagem clara em vez de tentar e falhar sem explicação (o front usa `janelaAbertaAte` da conversa pra já desabilitar o campo preventivamente, mostrando o aviso antes mesmo de tentar enviar).
- **Permissão**: capacidade nova `atenderWhatsapp` em `src/lib/permissoes.ts`, **liberada para os 3 papéis** (ADMIN, PROFISSIONAL, OPERADOR) — o bloco de instrução pedia só PROFISSIONAL e OPERADOR, mas incluí ADMIN também porque em todo o resto do sistema ADMIN é superset de PROFISSIONAL (nunca tem menos capacidade); restringir só essa tela pareceria inconsistente com o padrão do resto do app. Reversível com uma linha se a intenção fosse mesmo excluir ADMIN.

### 10.10 Iniciar conversa a partir de um paciente (2026-07-24)

Botão "+ Nova conversa" no inbox (§10.9) abre um modal de busca de paciente — reaproveita o mesmo padrão de busca por nome insensível a acento/caixa já usado em `painel/page.tsx` (função `normalizar()`, duplicada localmente em `whatsapp/page.tsx`; não havia componente compartilhado de busca de paciente pra extrair) sobre `GET /api/pacientes?filtro=ativos` (já existente).

- **`POST /api/whatsapp/conversas` (`{pacienteId}`)**: busca `ConversaWhatsapp` existente por `(clinicaId, pacienteId)` — se achar, devolve ela (200), **nunca duplica**. Se não achar, normaliza `Paciente.telefone` com `normalizarTelefoneE164()` (400 claro se o paciente não tiver telefone ou estiver fora do padrão) e cria uma conversa nova (`janelaAbertaAte: null`, `estado: "aberta"`).
- **Primeira mensagem — janela aberta**: se `janelaAbertaAte` já estiver no futuro (paciente escreveu recentemente por outro motivo, mesmo a conversa sendo nova no sistema), o campo de texto livre já funciona normal via `POST .../enviar` (§10.9) — nada de especial acontece na tela.
- **Primeira mensagem — janela fechada**: o rodapé do chat troca o campo de texto livre (que a Meta rejeitaria) por um botão "Enviar template de confirmação". Só aparece quando a conversa está **sem nenhuma mensagem ainda** (`mensagens.length === 0`) — se a janela fechou numa conversa já existente com histórico, continua mostrando só o aviso de janela fechada (§10.9), sem oferecer template ali (esse botão é especificamente pra *iniciar* contato).
  - **`POST /api/whatsapp/conversas/[id]/template`**: busca o próximo `Agendamento` futuro do paciente (`AGENDADA`/`REAGENDADA`, `inicio >= agora`) e reaproveita `enviarConfirmacaoAgenda()` (mesma função do cron de lembrete de 48h, §10.5) pra preencher `{{nome}}`/`{{data}}`/`{{hora}}` e enviar o template `confirmacao_agenda`. Sem agendamento futuro → 422 com mensagem clara ("não é possível iniciar contato sem um template genérico aprovado") — criar um template novo pra esse caso genérico fica fora de escopo.

### 10.11 Camada `WhatsAppProvider` (refactor sem mudança de comportamento, 2026-07-31)

Introduzido um ponto único de indireção entre os 4 call sites de envio (cron de lembrete 48h, cron de mensagem do dia, `POST /api/whatsapp/conversas/[id]/enviar`, `POST /api/whatsapp/conversas/[id]/template`, e a IA — resposta livre + notificação de handoff, em `src/lib/ia/responderWhatsapp.ts`) e a implementação concreta de envio. **Puramente estrutural**: nenhum payload, destinatário, texto ou janela mudou — `npm run build` validado antes do commit.

- **`src/lib/whatsapp/telefone.ts`** — `normalizarTelefoneE164()` foi extraída de `enviarTemplate.ts` (mesma lógica, sem re-export de compatibilidade) para não deixar a lib neutra de telefone acoplada ao arquivo de envio de template. Todos os importadores (`enviarMensagem.ts`, webhook, cron, `GET/POST /api/whatsapp/conversas`) foram atualizados para importar direto daqui.
- **`src/lib/whatsapp/provider/types.ts`** — `interface WhatsAppProvider` com `enviarTemplate(params)`/`enviarMensagemLivre(telefone, texto)` (mesmas assinaturas de parâmetro que `enviarConfirmacaoAgenda`/`enviarMensagemLivre` já expunham) e as flags `readonly suportaTemplate`/`suportaJanela24h`. Retorno normalizado em `ResultadoEnvio = { ok: true; externalId: string } | { ok: false; erro: string }` (substitui o shape antigo `{ sucesso, wamid?, erro? }` só na borda do provider — `wamid`/`erro` internos das funções concretas não mudaram).
- **`src/lib/whatsapp/provider/cloudApi.ts`** — `cloudApiProvider`, implementação que só delega para `enviarConfirmacaoAgenda()`/`enviarMensagemLivre()` já existentes (nenhuma lógica de envio reescrita) e traduz o resultado pro formato `ResultadoEnvio`. `suportaTemplate = true`, `suportaJanela24h = true` (Cloud API oficial da Meta suporta os dois).
- **`src/lib/whatsapp/provider/index.ts`** — `getProvider()`, ponto único de indireção. **Nesta fase, sempre retorna `cloudApiProvider`** — não existe seleção dinâmica por clínica ainda; é só o ponto de extensão preparado para receber uma segunda implementação (ex.: o canal não-oficial `wa-bridge`, ver §12) no futuro.
- Call sites trocaram a chamada direta (`enviarConfirmacaoAgenda(...)`/`enviarMensagemLivre(...)`) por `getProvider().enviarTemplate(...)`/`getProvider().enviarMensagemLivre(...)`, com o ajuste mecânico de nome de campo no resultado (`resultado.sucesso` → `resultado.ok`, `resultado.wamid` → `resultado.externalId`) — nenhuma outra alteração de lógica nesses 4 arquivos.

## 11. Módulo Mentoria

### 10.1 Visão geral

Controle financeiro dos mentorados da Pâmela — um serviço à parte do consultório (não é atendimento clínico), dentro do mesmo app. Ativado por flag `mentoriaAtivada` na `Clinica`. Não é pensado para multi-tenant — é uma extensão específica dessa clínica, não um recurso genérico do SaaS. Acesso restrito aos papéis **PROFISSIONAL** e **ADMIN** (`OPERADOR` não entra).

Navegação em dois níveis: um **switcher de workspace** no header (Consultório / Mentoria, `src/app/_components/ContextoSwitcher.tsx`) e, dentro de cada contexto, uma fileira de abas secundária. O contexto ativo é sempre **derivado do `pathname`** (`usePathname()`), sem estado global — reload e deep-link mantêm o contexto certo. Abas secundárias da Mentoria: Dashboard | Alunos | Contratos | Comissionados.

### 10.2 Modelo de dados (`prisma/schema.prisma`)

| Model | Papel | Campos-chave |
|---|---|---|
| `MentoriaAluno` | Mentorado — dados cadastrais completos | `clinicaId`, `nomeCompleto`, `cpf`/`rg` (dedupe único por `(clinicaId, cpf)`), `email`/`telefone`, `enderecoCompleto`/`cep`/`cidadeUf`, `dataNascimento`, metadados de submissão (`aceiteTermos`, `submitter`, `submissionData`, `submissionId` — únicos por `(clinicaId, submissionId)`, preparados para import via planilha) |
| `MentoriaContrato` | Um contrato de mentoria — 1 aluno pode ter vários ao longo do tempo | `alunoId`, `pacote` (produto), `valorTotal`, `taxaImpostoPct` (default `0.06`), `assinaturaContrato` (data efetiva do contrato — distinta de `dataPagamento` da parcela), `duracaoMeses`, `totalParcelas`, `status` (`StatusContrato`: `ATIVO`/`CONCLUIDO`/`CANCELADO`), `canceladoEm`/`motivoCancelamento` (só no distrato) |
| `MentoriaParcela` | Uma parcela do contrato | `contratoId`, `numero`, `valorBruto` (inclui taxa de cartão), `valorLiquido?` (preenchido só na baixa), `vencimento`, `dataPagamento?`/`formaPagamento?` (`FormaPagamento`: PIX/CARTAO/BOLETO/DINHEIRO/TRANSFERENCIA), `estornoEm?`/`valorEstornado?` |
| `Comissionado` | Pessoa que recebe comissão (vendedor/closer/produtor) | `clinicaId`, `nome`, `papelPadrao?` (`PapelComissao`), `ativo`, `percentualComissao?` (fração fixa, ex. `0.20`), `formaRecebimento` (`FormaRecebimentoComissao`: `ADIANTADO`/`POR_PARCELA`, default `POR_PARCELA`) |
| `MentoriaComissao` | Vínculo comissionado ↔ contrato (N por contrato — várias pessoas podem comissionar a mesma venda) | `contratoId`, `comissionadoId`, `papel` (`PapelComissao`: SELLER/CLOSER/PRODUTOR), `percentual`/`formaRecebimento` (**copiados e travados** do `Comissionado` no momento do vínculo — mudança posterior no cadastro não afeta vínculos já criados), `status` (`StatusComissao`: PENDENTE/PAGO/ESTORNADO) |

Relações: `MentoriaAluno 1—N MentoriaContrato`; `MentoriaContrato 1—N {MentoriaParcela, MentoriaComissao}`; `Comissionado 1—N MentoriaComissao`.

Índices: `clinicaId` em todos os 5 models; `MentoriaContrato(alunoId)`; `MentoriaParcela(contratoId)`, `(clinicaId, vencimento)`, `(clinicaId, dataPagamento)`; `MentoriaComissao(contratoId)`, `(comissionadoId)`.

Status e valores financeiros são **sempre derivados, nunca persistidos**:
- Status da parcela: `ESTORNADA` se `estornoEm`; `PAGA` se `dataPagamento`; `CANCELADA` se o contrato está `CANCELADO`; senão `ABERTA` (`derivarStatusParcela`, `src/lib/mentoria.ts`).
- Término do contrato: calculado como `assinaturaContrato + duracaoMeses` (`calcularTerminoContrato`), nunca uma coluna.
- Valor de comissão: sempre recalculado a partir de `valorTotal`/`taxaImpostoPct`/`percentual`, nunca gravado numa coluna própria.

### 10.3 Regras de negócio centrais

- **Comissão é derivada, nunca persistida.** Base comissionável = `valorTotal × (1 − taxaImpostoPct)`; o imposto do contrato é sempre descontado **antes** de aplicar o percentual do comissionado. Duas formas de recebimento mudam o cálculo: `ADIANTADO` — `base × percentual`, devida na data de assinatura do contrato, independe de quais parcelas já foram pagas; `POR_PARCELA` — por parcela paga, `valorLiquido × (1 − taxaImpostoPct) × percentual`. Parcela estornada ou contrato `CANCELADO` zeram a comissão daquela parcela/vínculo.
- **Regra de 1 contrato ATIVO por aluno.** Um aluno pode ter vários contratos ao longo do tempo, mas no máximo um `ATIVO` por vez. Prorrogação/renovação **encerra** o contrato ativo atual (status → `CONCLUIDO` — nunca `CANCELADO`, que tem semântica própria de distrato) e cria um **novo** contrato `ATIVO`, na mesma transação. Histórico nunca é apagado.
- **"Recebido" vs "a receber" têm bases de agregação diferentes**, refletido no dashboard mensal: recebido agrega por `dataPagamento` real, em valor líquido; a receber (e inadimplência) agrega por `vencimento`, em valor bruto.
- **Exclusão de contrato**: bloqueada (409) se o contrato ainda `ATIVO` tiver parcela paga ou comissão já registrada — o caminho correto nesse caso é o distrato, não a exclusão física. Contrato já `CANCELADO` sempre permite exclusão, em cascata completa (parcelas + comissões).
- **Distrato** (não-destrutivo): cancela o contrato, estorna as parcelas já pagas (opcional, a pedido) e estorna **automaticamente** todas as comissões vinculadas ainda não estornadas — tudo numa transação atômica.
- Parcela só é editável (valor/vencimento) com o contrato `ATIVO`; parcela paga/estornada nunca pode ter valor ou vencimento alterado, mesmo com o contrato ativo — só o número pode ser realinhado.
- Parcelas não são geradas por divisão simples do valor total: o fluxo de criação de contrato suporta entrada + parcelas recorrentes de valor diferente (a entrada, quando houver, sempre vira a parcela 1, ancorada na data de assinatura do contrato). Validação de gravação: soma de `valorLiquido` das parcelas tem que bater com `valorTotal` do contrato (tolerância de arredondamento de ±R$0,01); `valorBruto` fica livre dessa checagem — a diferença bruto×líquido é a taxa de cartão, esperada.
- Máscara monetária do módulo: formato contábil brasileiro (`R$ x.xxx,xx`).
- **Geração de contrato em DOCX**: **não implementada** nesta base de código — não há dependência `docxtemplater`/`pizzip`, template ou rota para isso. Se/quando for construída, a regra combinada já é clara: comissão nunca deve aparecer no contrato do aluno.

### 10.4 Rotas de API (`src/app/api/mentoria/`)

Toda rota exige o guard comum `exigirAcessoMentoria` (`src/lib/mentoria.ts`): 403 se o papel do usuário não é PROFISSIONAL/ADMIN; 403 se `Clinica.mentoriaAtivada != true`. Além disso, todo recurso buscado por id valida posse (`registro.clinicaId === usuario.clinicaId`) e responde 404 se não bater — nunca vaza recurso de outra clínica.

| Método | Caminho | O que faz |
|---|---|---|
| GET/POST | `/api/mentoria/alunos` | Lista alunos (com contrato ativo resumido) / cadastra aluno |
| GET/PATCH/DELETE | `/api/mentoria/alunos/[id]` | Lê (com contratos) / edita / exclui aluno |
| GET/POST | `/api/mentoria/contratos` | Lista TODOS os contratos do tenant (com aluno e parcelas em aberto) / cria contrato + parcelas + comissões (transação única) |
| GET/PATCH/DELETE | `/api/mentoria/contratos/[id]` | Lê contrato+parcelas+comissões / edita cabeçalho (só ATIVO) / exclui (regra de 10.3) |
| GET/POST | `/api/mentoria/contratos/[id]/comissoes` | Lista comissões do contrato com valor calculado / vincula comissionado |
| POST | `/api/mentoria/contratos/[id]/distrato` | Cancela contrato + estorna parcelas pagas (opcional) + estorna comissões, atômico |
| PUT | `/api/mentoria/contratos/[id]/parcelas` | Recria/edita o conjunto de parcelas em lote (só ATIVO) |
| PATCH/DELETE | `/api/mentoria/comissoes/[id]` | Troca status PENDENTE↔PAGO / remove vínculo (só se PENDENTE) |
| GET/POST | `/api/mentoria/comissionados` | Lista / cadastra comissionado |
| PATCH | `/api/mentoria/comissionados/[id]` | Edita cadastro do comissionado |
| GET | `/api/mentoria/comissionados/[id]/extrato` | Extrato do comissionado: a receber + previsto, por contrato/parcela, com resumo mensal |
| GET/PATCH | `/api/mentoria/parcelas/[id]` | Lê / edita parcela |
| POST | `/api/mentoria/parcelas/[id]/baixa` | Registra pagamento de parcela aberta |
| POST | `/api/mentoria/parcelas/[id]/estorno` | Reverte a baixa (preserva histórico — não apaga `dataPagamento`) |
| GET | `/api/mentoria/dashboard/{resumo,mensal,geral,alunos,comissoes}` | Agregados do dashboard (cards globais/mensais, lista "Parcelas do mês", visão por aluno, comissões a pagar) |
| GET/POST | `/api/mentoria/importacao/{preview,executar}` | Lê/dedupe planilha do Google Sheets configurada / importa alunos selecionados |

Frontend correspondente em `src/app/mentoria/` (todas `"use client"`): `dashboard/`, `alunos/` (lista, `[id]`, `novo`), `contratos/` (lista, `[id]` com navegação prev/next, `novo`), `comissionados/` (lista, `[id]` = extrato), `layout.tsx` (guard de navegação — espelho de UX, redireciona pro painel se papel/flag não liberarem; a segurança real está em cada rota de API).

### 10.5 Libs de apoio

| Arquivo | Função pública principal |
|---|---|
| `src/lib/mentoria.ts` | `exigirAcessoMentoria()`, validações (`validarSomaLiquido`), cálculos financeiros derivados (`calcularBaseComissionavel`, `calcularValorComissaoVinculo`, `calcularTerminoContrato`, `derivarStatusParcela`), agregações do dashboard |
| `src/lib/mentoria/format.ts` | Formatação monetária BRL do módulo |
| `src/lib/importacaoMentoria.ts` | Leitura/dedupe da planilha do Google Sheets de alunos (mesmo padrão de `src/lib/importacao.ts` do consultório) |

### 10.6 Performance

Diagnóstico sempre antes de otimizar — nunca alterar query/schema "no escuro". Focos recorrentes ao revisar este módulo: waterfalls evitáveis com `Promise.all`, N+1 de Prisma (resolver com `include`/`select` agregado, nunca loop de queries), fetch client-side pós-mount que poderia vir do server, over-fetching de coluna (`include` completo quando só alguns campos são usados — atenção redobrada aqui porque `MentoriaAluno` carrega CPF/RG/endereço, dado sensível que não deve trafegar para telas que não o exibem). Mudança estrutural (schema, índice novo) sempre para-e-reporta antes de executar. Levantamento detalhado datado em `Documentos Claude/auditoria-mentoria-2026-07-17.md`.

**Auditoria de performance — 2026-07-17 (encerrada).** Relatório completo em `Documentos Claude/auditoria-mentoria-2026-07-17.md`. Corrigido: waterfall de `layout.tsx` (endpoint `/api/mentoria/acesso` com select mínimo, substitui 2 fetches sequenciais por 1); padrão `useState(null)` sem fail-safe em `dashboard/page.tsx` (unificado com skeleton único e timeout de 4s, mesmo padrão do painel do Consultório); agregações financeiras convertidas de `findMany`+`reduce` para `prisma.aggregate` em `resumo`/`mensal`/`geral`; over-fetch de PII removido de `GET /api/mentoria/alunos` e `GET /api/mentoria/contratos/[id]` (`include` trocado por `select`, campos mortos removidos). Avaliado e adiado por escolha: índices e paginação — volume atual (dezenas de alunos, centenas de parcelas) não justifica; retomar se o volume crescer ou houver lentidão real reportada. Cálculo linha-a-linha de impostos/comissão pendente mantido como está — funciona bem no volume atual, exigiria `$queryRaw` pra virar aggregate.

### 10.7 Convenções herdadas do Consultório

Mesmas regras da seção 2 se aplicam integralmente: `clinicaId` sempre de `getUsuarioLogado()`, nunca do corpo da requisição; migrations só via `DIRECT_URL` (porta 5432); `directUrl` nunca em `prisma.config.ts`; edição incremental, nunca recriação de arquivo. Operações do módulo são não-destrutivas por padrão (distrato/exclusão preservam histórico salvo os casos explícitos de 10.3); toda mutação relevante grava `LogAuditoria` via `registrarLog()`.

## 12. wa-bridge (canal não-oficial)

**⚠️ Este módulo opera fora dos Termos de Uso do WhatsApp.** Diferente do §10 (Atendimento
WhatsApp, que usa a Cloud API oficial da Meta com número comercial verificado), o `wa-bridge`
se conecta ao WhatsApp **como um cliente WhatsApp Web comum**, via
[Baileys](https://github.com/WhiskeySockets/Baileys) — biblioteca não-oficial que reimplementa
o protocolo do WhatsApp Web. A Meta proíbe automação por esse caminho e pode banir o número a
qualquer momento, sem aviso. **Destinado exclusivamente a um número secundário e descartável**
— nunca ao número principal da clínica ou de um profissional, e nunca ao mesmo número usado
pela Cloud API oficial do §10. É um serviço isolado, não faz parte do app Next.js e não deve
ser confundido com o canal oficial.

### 12.1 Por que existe

Serve como canal alternativo/experimental de envio (ex.: mensagens que a Cloud API oficial não
cobre, ou testes antes de formalizar um fluxo via template aprovado) — decisão consciente de
aceitar o risco de banimento do número secundário em troca de não depender de template
aprovado pela Meta para esse uso específico.

### 12.2 Localização e stack

`/wa-bridge` (raiz do repo, `package.json` próprio, TypeScript compilado via `tsc`, não faz
parte do build/deploy do Next.js). Node.js 20, `@whiskeysockets/baileys`, `express`,
`@supabase/supabase-js` (só para persistir o estado de sessão do Baileys — tabela própria,
não gerenciada pelo Prisma), `pino`, `qrcode`. Deploy via `Dockerfile` (multi-stage,
`node:20-alpine`) em infraestrutura separada da Vercel (processo de longa duração com socket
persistente — incompatível com functions serverless). Detalhes operacionais completos (setup,
leitura do QR na primeira conexão, rotação de sessão, SQL da tabela) em `wa-bridge/README.md`.

### 12.3 Auth state

`useSupabaseAuthState(sessionId)` (`wa-bridge/src/lib/supabaseAuthState.ts`) reimplementa a
assinatura de `useMultiFileAuthState` do próprio Baileys, mas grava cada chave de credencial
(creds, chaves de sessão do protocolo Signal, app-state sync keys) como uma linha na tabela
Supabase `wa_bridge_session` (`id`, `session_id`, `key`, `value jsonb`, `updated_at`, índice
único em `(session_id, key)`) em vez de arquivos locais — permite rodar o serviço em qualquer
host sem disco persistente e reconectar sem re-escanear o QR entre deploys.

### 12.4 Endpoints

- `GET /qr` — protegido por header `x-bridge-secret`; retorna PNG do QR atual, `204` se já
  conectado, `202` se o QR ainda não foi gerado.
- `GET /status` — mesmo header; `{ connected, phone, lastSeen }`.
- `POST /enqueue` — autenticado por HMAC-SHA256 (`x-signature` sobre `${x-timestamp}.${body}`,
  segredo `BRIDGE_SHARED_SECRET`) com anti-replay (`x-timestamp` rejeitado se >5min no passado).
  Payload `{ jobId, to, variants[], meta }` — sorteia uma variante no momento do envio.
  Processamento **estritamente serial**, delay aleatório de 25-60s entre mensagens, cap de 15
  envios/dia (contador em memória, reset à meia-noite `America/Sao_Paulo`), só processa dentro
  da janela 08:00-19:00 seg-sex (`America/Sao_Paulo`) — fora disso o job fica na fila. Idempotente
  por `jobId` (reenvio do mesmo `jobId` retorna 200 sem reprocessar).
- Webhooks assinados (mesmo esquema HMAC, sem timestamp) para `APP_WEBHOOK_URL`, com retry em
  backoff exponencial (3 tentativas): `message.sent`, `message.failed`, `message.received`,
  `session.disconnected`.

### 12.5 Reconexão e logout

Reconecta automaticamente em qualquer `connection.close`, **exceto** quando o motivo é
`DisconnectReason.loggedOut` (sessão deslogada no aparelho) — nesse caso para de tentar
reconectar, limpa o QR em memória e dispara `session.disconnected` para o app decidir o que
fazer (ex.: alertar a Daiane para reconectar manualmente via `GET /qr`).

### 12.6 Env vars

`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `BRIDGE_SHARED_SECRET`, `BRIDGE_ADMIN_SECRET`,
`APP_WEBHOOK_URL`, `BRIDGE_SESSION_ID`, `PORT` — só em `wa-bridge/.env` (fora do controle de
versão) e nas env vars do host de deploy; `.env.example` documenta as chaves sem valores.

### 12.7 Feature PAUSADA (2026-08-04) — modelagem multi-canal no app Next.js

Trabalho de suportar múltiplos canais de WhatsApp por clínica (Cloud API oficial + `wa-bridge`
não-oficial, com seleção de canal) foi modelado no `prisma/schema.prisma` do app, mas **nunca
migrado nem aplicado no banco de produção**. Isolado do trabalho ativo e movido pra fora da
`main`:

- **Branch**: `feat/wa-bridge`, commit `5bae2cb` (mensagem: *"wip(whatsapp): modelagem
  multi-canal (CanalWhatsApp, ProviderWhatsApp) — sem migration aplicada"*). Contém **só** o
  diff de `prisma/schema.prisma` — nenhum código do app (rotas, libs) foi escrito contra esse
  schema ainda.
- **Conteúdo da modelagem**: `model CanalWhatsApp` (novo — um número/sessão de WhatsApp
  configurado por clínica), `enum ProviderWhatsApp { CLOUD_API, BRIDGE }`, coluna `canalId`
  nullable em `ConversaWhatsapp` e em `MensagemWhatsapp`, coluna `externalId` nullable em
  `MensagemWhatsapp`.
- **Estado na `main`**: confirmado por grep (2026-08-04) que nenhum arquivo em `src/` ou
  `scripts/` referencia `CanalWhatsApp`, `ProviderWhatsApp` ou a coluna `canalId` — a `main`
  está limpa da feature, `prisma generate` na `main` produz um client sem esses objetos, e
  `prisma migrate status` confirma "Database schema is up to date!".
- **Armadilha de nomenclatura para quem retomar**: o campo TypeScript `ResultadoEnvio.externalId`
  (`src/lib/whatsapp/provider/types.ts`, parte da camada `WhatsAppProvider` já em produção,
  ver §10.11) hoje é escrito na coluna **`wamid`** já existente de `MensagemWhatsapp`
  (`wamid: resultado.externalId || null` nos 4 call sites de envio) — é só o nome de um campo
  de retorno em memória, sem relação com coluna de banco. O branch `feat/wa-bridge` introduz
  uma coluna **`externalId`** de verdade em `MensagemWhatsapp`, com significado diferente (id
  da mensagem no provider de origem, pensada pra substituir `wamid` como identificador neutro
  de canal). **Antes de escrever qualquer query contra a coluna `externalId` ao retomar essa
  feature, resolver essa colisão de nome** — hoje são dois conceitos com o mesmo nome em
  camadas diferentes (variável TS vs. coluna de banco), fácil de confundir.

**Regra operacional permanente**: `prisma/schema.prisma` não pode ficar modificado e não
commitado na `main`. `vercel --prod` empacota o diretório de trabalho local, não só o que está
commitado — um schema alterado sem commit sobe junto no deploy, gerando um Prisma Client em
produção divergente do banco real. Trabalho de schema em andamento (sem migration aplicada)
sempre vai para um branch dedicado, nunca fica solto na `main`.

## 13. Módulo Formulário de anamnese

**Fase 1 — modelo de dados + seed (EM CONSTRUÇÃO, 2026-08-04)**: substitui o fluxo atual
(forms.app → Google Sheets → `POST /api/importacao/executar`) por um formulário próprio,
editável pela clínica. Esta fase entrega **só** modelo de dados e seed — nenhuma rota pública,
nenhuma UI, nada servido; não impacta o plano da Vercel.

### 13.1 Modelo de dados (`prisma/schema.prisma`)

| Model | Papel | Campos-chave |
|---|---|---|
| `FormularioAnamnese` | Um formulário por clínica+slug (`@@unique([clinicaId, slug])`) | `titulo`, `descricao?`, `textoConsentimento` (`@db.Text`), `ativo` |
| `PerguntaFormulario` | Uma linha por pergunta, ordenável | `ordem`, `rotulo`, `descricao?` (texto de ajuda editável), `tipo` (`TipoPergunta`), `obrigatoria`, `opcoes String[]`, `campoPaciente?`, `ativa` |
| `EnvioFormulario` | Um envio (submissão) do formulário | `pacienteId?` (opcional — ver preservação abaixo), `status` (`StatusEnvio`), `consentimentoAceito`, `textoConsentimentoSnapshot` (`@db.Text`), `consentimentoEm`, `ipOrigem?`, `userAgent?`, `observacaoProcessamento?` |
| `RespostaFormulario` | Uma resposta por pergunta dentro de um envio | `rotuloSnapshot` (`@db.Text`), `valor` (`@db.Text`), `envioId` (`onDelete: Cascade`), `perguntaId` |

Enums novos: `TipoPergunta` (`TEXTO_CURTO`/`TEXTO_LONGO`/`SIM_NAO`/`MULTIPLA_ESCOLHA`/`DATA`/`EMAIL`/`TELEFONE`/`CPF`/`CEP`), `StatusEnvio` (`PENDENTE`/`PROCESSADO`/`IGNORADO`/`ERRO`).

**Decisões travadas** (não alterar sem revisitar este parágrafo):
- **Pergunta é linha, não coluna** — editar o formulário (rótulo, tipo, opções, ordem) na futura tela de configuração (F3) nunca gera migration nem `ALTER TABLE`. É um `UPDATE`/`INSERT`/reordenação de `PerguntaFormulario`.
- **`rotuloSnapshot` e `textoConsentimentoSnapshot` são obrigatórios (`NOT NULL`)** — registro clínico e consentimento não podem mudar retroativamente quando a clínica editar o formulário depois. Mesmo espírito do `googleSyncStatus`/backup de anamnese: o que já foi respondido/aceito fica congelado no momento do envio.
- **Pergunta nunca é deletada** — só desativada via `ativa = false`. A FK `RespostaFormulario.perguntaId` existe justamente para impedir `DELETE` de uma pergunta já respondida (não há `onDelete: Cascade` nessa relação, ao contrário de `envioId`).
- **`EnvioFormulario` é preservado sempre**, mesmo que o paciente não seja criado (`pacienteId` nullable) — nenhum dado enviado por um paciente pode ser descartado, mesmo em caso de erro de processamento (CPF inválido, etc.); o registro fica com `status: ERRO`/`IGNORADO` e `observacaoProcessamento` explicando o motivo, nunca é apagado.
- **Perguntas com `campoPaciente` preenchido são estruturais** — as 13 colunas cadastrais (nome, cpf, telefone, etc., mesmo mapa de `src/lib/importacao.ts`). A futura tela de edição (F3) não pode permitir remover essas perguntas nem trocar seu `tipo`, porque isso quebraria a gravação do cadastro do paciente.

### 13.2 Seed (`scripts/seed-formulario-pamela.ts`)

Cria/atualiza (upsert, idempotente) o `FormularioAnamnese` da clínica `pamela-rachid` (slug
`anamnese`) e as 50 `PerguntaFormulario` na ordem exata do cabeçalho real da planilha
(`Clinica.sheetsPlanilhaId`, lido via Google Sheets API — nunca digitado de memória). 13
perguntas cadastrais recebem `campoPaciente` (mesmo `MAPA` de `src/lib/importacao.ts`, mas
reimplementado localmente no script — não exportado de lá); 31 perguntas clínicas curtas viram
`SIM_NAO`; 6 perguntas de relato (a maioria terminada em `":"`, mais a pergunta sobre bebida
alcoólica — não termina em `":"` mas a resposta real observada é texto livre, decisão explícita
do operador) viram `TEXTO_LONGO`; 4 colunas de metadado do forms.app (`Submitter`, `Submission
Date`, `Submission ID`, `Idade`) são ignoradas. `obrigatoria = true` só em Nome Completo, CPF e
Telefone (WhatsApp).

### 13.3 Migration

`20260804175251_form_anamnese` — só `CREATE TYPE`/`CREATE TABLE`/`CREATE INDEX`/`ADD CONSTRAINT`
(nenhum `DROP`/`RENAME`/`ALTER TYPE` em objeto existente). Aplicada via `prisma db execute`
(`DIRECT_URL`, porta 5432) + `prisma migrate resolve --applied` — `prisma migrate dev` falhou
por drift de histórico pré-existente em duas migrations antigas (não relacionado a esta
mudança), mesmo padrão de fallback já documentado na seção 2.

### 13.4 Roadmap (3 fases)

- **F1 — modelo de dados + seed** (esta entrega): schema, migration, seed da Pâmela. Nenhuma
  rota pública, nenhuma UI.
- **F2 — rota pública de envio**: validação de payload, rate limit por IP, honeypot anti-bot,
  limite de tamanho de payload, resposta genérica que **nunca revela se um CPF já existe** no
  banco (evita enumeração), `clinicaId` derivado exclusivamente do slug da URL (nunca do body —
  mesma regra de isolamento multi-tenant da seção 2), consentimento bloqueante (não dá para
  enviar sem aceitar). Rota pública fica no domínio já em uso pelo sistema — sem DNS novo.
  **Bloqueada por**: upgrade do plano Vercel (ver 13.5).
- **F3 — tela de edição de perguntas**: criar/editar/reordenar/desativar `PerguntaFormulario`
  nas configurações da clínica, respeitando a trava de `campoPaciente` estrutural (13.1).

### 13.5 Pendência bloqueante — plano Vercel

O plano **Hobby** (atual) proíbe uso comercial nos Termos de Serviço da Vercel — precisa virar
**Pro** antes de publicar a rota pública do F2 (endpoint acessível por qualquer visitante,
diferente do resto do app, que já é uso comercial mas atrás de login). **Não bloqueia F1 nem
F3** (schema/seed e a tela de edição ficam atrás de autenticação, mesmo padrão do resto do
painel).

### 13.6 Decisão arquitetural — motivação

O formulário próprio **substituirá** forms.app → Google Sheets → importação manual (fluxo atual
descrito em `src/lib/importacao.ts` e na seção 4, `/api/importacao/*`). A importação por
planilha **permanece ativa até o F2 entrar em produção** — sem regressão no fluxo atual
enquanto o novo não está pronto. Motivação principal: **validação na origem**. No backfill de
anamnese da Pâmela (ver 13.7), **29% dos CPFs preenchidos manualmente no último lote eram
matematicamente inválidos** (7 de 24) — um formulário próprio pode validar o dígito verificador
no momento do envio, algo impossível de garantir numa planilha preenchida por fora do sistema.

### 13.7 Estado do backfill de anamnese (pamela-rachid, 2026-08-04)

61 pacientes no total, **18 com anamnese preenchida** (11 antes do backfill + 7 gravados no
lote seguro do Bloco E3 — CPF válido **e** nome idêntico após normalização). Pendente, **43
pacientes**:
- **22 sem CPF** — nunca entram automaticamente, precisam de CPF antes de qualquer match.
- **4 com CPF sem linha correspondente na planilha** — planilha e cadastro divergem, revisão
  manual.
- **17 aguardando conferência manual da Daiane**, listados em
  `scripts/_conferencia-cpf-pamela.csv` (gerado, não commitado — contém PII, ver `.gitignore`):
  7 com CPF matematicamente inválido, 10 com divergência de nome entre sistema e planilha
  (incluindo 2 — os antigos índices #9/#10 do Bloco E — com forte suspeita de CPF pertencer a
  um familiar, iniciais do nome completamente diferentes apesar do mesmo CPF).

**Regra aplicada, travada em código** (`scripts/reprocessar-anamnese.ts --somente-validados`):
só entram automaticamente em prontuário registros com CPF matematicamente válido **e** nome
idêntico (normalizado) entre sistema e planilha; qualquer outro caso exige aprovação humana
explícita antes de gravar.
