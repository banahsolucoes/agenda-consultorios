# Agenda para Consultórios — Especificação Técnica

> Documento vivo. Baseado no protótipo validado da Dra. Pâmela Rachid (HTML + Google Apps Script + Notion + Google Calendar). O protótipo é a **fonte da verdade das regras de negócio**: tudo aqui foi testado em produção real.

---

## 1. Visão do produto

SaaS multi-tenant de agendamento para clínicas de saúde (começando por fonoaudiologia). Cada clínica gerencia pacientes, pacotes de sessões, geração automática de agenda recorrente, e confirmação de sessões — com espelhamento opcional no Google Calendar.

O protótipo atende **uma** clínica (Pâmela). O SaaS atende **muitas**, isoladas entre si.

---

## 2. Por que reconstruir (lições do protótipo)

Cada dor do protótipo vira um requisito de arquitetura:

| Dor no protótipo | Causa | Requisito no SaaS |
|---|---|---|
| Sessões sumindo em operações | `query` do Notion parava em 100 registros | Banco SQL real, sem limite de paginação |
| Ações não executavam | Cache do WP Rocket servia resposta velha | Backend próprio, controle total de cache |
| Notion e Calendar discordando | Três sistemas guardando a mesma info | **Fonte única da verdade** (o banco) |
| Token exposto no código | Segredo em texto plano no Apps Script | Variáveis de ambiente / secrets |
| Editar no Calendar quebrava o painel | Sincronização só ia num sentido | Regra clara de origem; Calendar como espelho |
| Lentidão | API do Notion + proxy WordPress | Postgres indexado, uma stack só |

---

## 3. Stack proposta (tudo com plano gratuito para começar)

| Camada | Tecnologia | Hospedagem grátis |
|---|---|---|
| Frontend + Backend | Next.js (full-stack) **ou** NestJS + Next.js | Vercel |
| Banco de dados | PostgreSQL + Prisma (ORM) | Supabase ou Neon |
| Autenticação | NextAuth / Supabase Auth | incluído |
| Armazenamento (futuro) | Cloudflare R2 | free tier |
| Integração agenda | Google Calendar API | grátis |
| CI/CD | GitHub Actions | grátis |

**Observação honesta sobre custo:** os planos gratuitos aguentam a Pâmela e as primeiras clínicas. Ao escalar (dezenas de clínicas pagantes), surgem custos — mas nesse ponto há receita para cobri-los. "Grátis para começar" é real; "grátis para sempre" não.

**Nota de arquitetura:** o protótipo NestJS + Next.js + Postgres + Prisma que já foi iniciado é a base. Não se começa do zero.

---

## 4. Modelo de dados (tabelas)

Nomes de domínio em português (decisão do projeto); termos de framework em inglês.

### Clinica (tenant)
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid (PK) | |
| nome | text | |
| slug | text (único) | subdomínio/URL |
| criadoEm | timestamp | |

### Usuario
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid (PK) | |
| clinicaId | uuid (FK) | isolamento multi-tenant |
| nome | text | |
| email | text (único) | login |
| senhaHash | text | nunca em texto plano |
| papel | enum | PROFISSIONAL, OPERADOR, ADMIN |

*(A "Daiane" é um Usuario com papel OPERADOR; a "Pâmela" é PROFISSIONAL.)*

### Paciente
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid (PK) | |
| clinicaId | uuid (FK) | |
| nome | text | busca normalizada (sem acento/caixa) |
| telefone | text | |
| email | text | opcional |
| diaPreferido | enum | SEGUNDA..QUINTA (configurável por clínica) |
| horarioFixo | time | ex: 15:00 |
| tipoSessao | enum | ONLINE, PRESENCIAL, AVAL_ONLINE, AVAL_PRESENCIAL |
| statusGeral | enum | ATIVO, CANCELADO, FINALIZADO |
| criadoEm | timestamp | |

**Cores por tipo de sessão:** cada tipo tem uma cor (usada no calendário visual), configurável por clínica. Hoje no protótipo: verde, roxo, amarelo e uma quarta (valores exatos a definir). Guardar numa tabela/enum `TipoSessao { codigo, rotulo, cor }`.

**Auditoria de PII/over-fetch — 2026-07-18 (encerrada)**. Relatório completo em `Documentos Claude/auditoria-pii-pacientes-2026-07-18.md`. Corrigido: `GET /api/pacientes` enxugado para `{ id, nome, telefone, statusGeral }` — exigiu refactor de `painel/page.tsx` (`abrirModalEdicao`, `abrirPainelPaciente`, `abrirAnamnese`, `recarregarPacienteSelecionado`, `abrirNotificacaoPaciente`) para buscar `GET /api/pacientes/[id]` sob demanda em vez de reaproveitar o objeto da listagem, já que anamnese/CPF/RG eram lidos diretamente dele. `GET /api/importacao/preview` enxugado para `{ nome, cpf, status }` por linha. `GET /api/pacientes/[id]` com `select` explícito, `clinicaId` removido da resposta, `finalizadoEm` removido por não ser usado no front. Decisão de produto registrada separadamente: OPERADOR mantém acesso idêntico a PROFISSIONAL/ADMIN sobre dado clínico. Pendente, fora de escopo: achado 3 (rotas de escrita buscando `Paciente` inteiro só para checar `clinicaId`/nome em log) — over-fetch de banco que nunca vaza ao cliente, baixa prioridade.

**Conteúdo da anamnese importada — 2026-08-04**: o texto gravado em `Paciente.anamnese` na importação (`src/lib/importacao.ts`) agora começa com os 13 campos cadastrais da planilha (`Nome Completo`, `Data de Nascimento`, `Estado Civil`, `Nacionalidade`, `Seu Instagram`, `E-mail`, `Endereço Completo`, `CEP`, `Profissão`, `Telefone (WhatsApp)`, `Seu RG`, `Seu CPF`, `Quem indicou?`), na ordem em que aparecem na planilha — antes esses campos só viravam coluna própria do `Paciente`, nunca apareciam no texto que a profissional lê. Em seguida vêm as perguntas de saúde/anamnese propriamente ditas, também na ordem da planilha, e por fim o separador `--- OBSERVAÇÕES ---` (inalterado — continua sendo onde a clínica escreve manualmente depois). Metadados de submissão do forms.app (`Submitter`, `Submission Date`, `Submission ID`, `Idade`, e qualquer coluna futura que comece com "submission") nunca entram no texto. Escopo da mudança foi só a montagem do texto — a gravação em `POST /api/importacao/executar` continua persistindo só `nome`/`telefone`/`email`/`cpf`/`logradouro`/`cep`/`quemIndicou` como campo próprio do `Paciente` (os outros cadastrais citados acima só existem dentro do texto da anamnese, não em coluna própria). Dedupe por CPF e "anamnese só grava na criação" continuam intactos. Detalhe técnico completo em `ARCHITECTURE.md` §9.

**Reprocessamento retroativo da anamnese — 2026-08-04, CONCLUÍDO**: a lógica de montagem do texto virou função exportada `montarAnamnese()` (refactor puro, sem mudança de comportamento — validado por comparação byte-a-byte contra a planilha real). `scripts/reprocessar-anamnese.ts` reaplica essa montagem retroativamente nos pacientes já importados antes da mudança acima, casando planilha↔paciente **somente por CPF**. Duas fases (`--fase=vazios|preenchidos`), sempre em dry-run por padrão (`--executar` obrigatório pra gravar, com backup automático antes de qualquer escrita). Nunca toca paciente sem CPF, CPF sem linha correspondente na planilha, ou CPF com mais de uma linha (repreenchimento — resolução manual). Na fase `preenchidos`, preserva byte a byte tudo a partir de `"--- OBSERVAÇÕES ---"` (com verificação em código antes de cada gravação); registro sem essa marca (formato antigo) não é tocado.

Execução real autorizada e concluída contra `pamela-rachid`: fase `vazios` gravou **4** pacientes, fase `preenchidos` (rodada em seguida, mesma sessão) gravou **8** — os 4 originalmente preenchidos mais os 4 que a fase `vazios` acabara de preencher (esses também bateram nos critérios de `preenchidos` na leitura fresca do banco, reprocessamento em cascata, verificado depois como um `UPDATE` sem efeito: texto idêntico antes/depois). Verificado byte a byte nos 8 que o bloco a partir de `--- OBSERVAÇÕES ---` não mudou — nenhuma observação clínica foi alterada ou perdida. Depois disso o script recebeu um ajuste (`semMudanca`) que torna essa sobreposição impossível numa reexecução: um registro só é elegível na fase `preenchidos` se houver de fato algo a mudar; dry-run pós-ajuste confirmou 0 elegíveis nas duas fases.

**Blindagem de PII em código, regra permanente**: toda saída de amostra/diff que um script de manutenção imprime deve passar por uma função `redigir()` definida em código (rótulos cadastrais conhecidos + regex de segurança pra CPF/telefone/e-mail em qualquer posição do texto) — nunca depender de instrução do operador pra lembrar de redigir. Motivado por um incidente real: uma execução anterior deste mesmo script imprimiu PII real sem redigir, por instrução pontual, não por bug de código. Detalhe técnico completo em `ARCHITECTURE.md` §9.

**Duplicidade na importação — 2026-08-04, decisão tomada**: diagnóstico (`scripts/_diagnostico-cpf-vazio.mjs`, read-only) mostrou que dos 61 pacientes da Pâmela, 49 estão sem CPF; comparando nome normalizado contra a planilha, **14 batem** por nome (candidatos reais a duplicata numa reimportação) e **35 não batem** (provavelmente cadastros anteriores ao forms.app, nunca tiveram CPF). A exposição real ao risco é só os 14, não os 49. **Decisão**: em vez de criar uma regra nova de complemento/anexação de anamnese (over-engineering pro tamanho real do problema), o caminho é **backfill de CPF** nesses 14 a partir do match por nome (com revisão manual antes de gravar) — depois disso, o dedupe por CPF que já existe passa a cobrir esses pacientes normalmente, sem precisar de lógica nova. Backfill em si ainda não executado, pendente de autorização.

### Pacote
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid (PK) | |
| pacienteId | uuid (FK) | |
| tipo | enum | AVULSA, MENSAL, BIMESTRAL, TRIMESTRAL, PERSONALIZADO |
| totalSessoes | int | Avulsa=1, Mensal=4, Bimestral=8, Trimestral=12, Personalizado=livre |
| dataInicial | date | |
| status | enum | ATIVO, CANCELADO, FINALIZADO |

### Agendamento (Sessão)
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid (PK) | |
| pacoteId | uuid (FK) | |
| pacienteId | uuid (FK) | desnormalizado p/ consulta rápida |
| numeroSessao | int | 1..N |
| totalPacote | int | |
| inicio | timestamp | fonte da verdade do horário |
| duracaoMin | int | default 45 |
| status | enum | AGENDADA, REAGENDADA, REALIZADA, NAO_REALIZADA, CANCELADA |
| googleEventId | text | vínculo com o Calendar |
| googleCalendarId | text | qual calendário |
| linkMeet | text | |

**Rótulo exibido/título do evento (2026-07-30):** não é um campo persistido — é calculado por `formatarTituloAgendamento()` (`src/lib/blocoAgenda.ts`), ponto único de formatação. Regra: se `tipoSessao.ehAtendimentoUnico === true` (tipo de atendimento único, configurável por clínica — ex.: "Avaliação online"/"Avaliação presencial") e o tipo tem `nome` resolvido, o rótulo é `{paciente} - {nome do tipo}`, sem numeração. Caso contrário (sessão normal, ou tipo de atendimento único sem nome resolvido), mantém `{paciente} (numeroSessao/totalPacote)`. Não existe enum fixo de "avaliação" no schema — o critério é o booleano `TipoSessao.ehAtendimentoUnico`, não o texto do nome.

### LogAuditoria
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid (PK) | |
| clinicaId | uuid (FK) | |
| usuarioId | uuid (FK) | quem fez |
| acao | text | Criação, Empurrar, Adiar, Editar, Status... |
| detalhe | text | |
| criadoEm | timestamp | |

---

## 5. Regras de negócio (validadas no protótipo)

### 5.1 Pacotes
- **Fixos:** Avulsa (1), Mensal (4), Bimestral (8), Trimestral (12).
- **Personalizado:** número livre de sessões.
- Ao cadastrar, o sistema gera N sessões **semanais** a partir da data inicial, sempre no `diaPreferido` e `horarioFixo`.

### 5.2 Status da sessão
`AGENDADA → REAGENDADA → REALIZADA / NAO_REALIZADA / CANCELADA`
- **STATUS_CONSUMIDOS** = REALIZADA, NAO_REALIZADA. Sessões consumidas nunca são movidas por operações em lote.

### 5.3 Empurrar (mover para frente)
- Move apenas sessões com **início ≥ agora** (passadas nunca se movem — regra por **data**, não por status).
- Parâmetro: **quantas semanas** (0 a 10).
- Opcional: **mudar dia da semana e horário** (Sim/Não).
  - Sim → reposiciona no novo dia/horário e atualiza `diaPreferido`/`horarioFixo` do paciente.
  - Semanas=0 + Sim → só muda dia/horário, sem avançar semana.
  - Semanas=0 + Não → nada.
- **Validação tudo-ou-nada:** se qualquer sessão cairia antes de hoje, **bloqueia toda a operação** (nada é movido).

### 5.4 Adiar (mover para trás)
- Seleciona-se uma **sessão de corte**; ela e **todas as seguintes** (por número) voltam 7 dias.
- Sessões anteriores ao corte não são tocadas.
- Duplicação de datas é aceitável (repõe-se depois).

### 5.5 Editar sessão pontual
- Novo dia + novo horário para **uma** sessão.
- **Trava:** o novo dia deve cair na **mesma semana** (segunda a domingo) da sessão original — evita duas sessões na mesma semana ou invasão de outra.
- Horário dentro da agenda (08:00–19:30).
- Validação no backend (não confiar só no front).

### 5.6 Finalização automática + lembrete de renovação
- Quando todas as sessões de um pacote estão consumidas (nenhuma pendente), o paciente vira **FINALIZADO** automaticamente.
- Ao finalizar, o sistema **gera um lembrete no sino** (área de pendências do painel) para o operador **ofertar renovação** ao cliente. O lembrete some quando o operador o resolve (renovou ou dispensou).

### 5.7 Cancelamento / Reset
- Cancelar paciente: remove sessões futuras e marca CANCELADO.

### 5.8 Confirmação e link do Meet (mensagens copiar-colar)
- Botão **copiar** a mensagem pronta (assinada "Daiane") para o operador colar no WhatsApp. Sem abrir instância, sem link automático.
- **Mensagem de confirmação** (véspera): texto padrão parametrizável por clínica (nome do assistente, horário-limite).
- **Mensagem com link do Meet** (dia da sessão): botão que copia um texto **contendo o link do Meet** da sessão, para o operador enviar ao cliente. Desde 2026-07-21, o texto inclui o horário da sessão (`{hora}`), ex.: "Segue o link da sua sessão de hoje às 14:30h."
- *(Envio automático de mensagens — WhatsApp oficial/conversas — fica para a v2, ver seção 11.)*

### 5.9 Notificações (sino)
- Sessões em status REAGENDADA aparecem como pendências, sinalizando que precisam de ajuste.

### 5.10 Busca de paciente
- Insensível a maiúsculas/minúsculas **e acentos** (normalização NFD).

---

## 6. Visão de calendário no painel (substitui o Google Calendar para a operação)

Decisão de arquitetura definida: a operadora (Daiane) trabalha **dentro do painel**, numa visão de calendário visual, e **não mais no Google Calendar**. Isso resolve de raiz o problema de sincronização — ela edita direto na fonte única (o banco).

- **Visão de calendário** (dia/semana) mostrando as sessões como blocos, coloridos por **tipo de sessão** (ver §4).
- **Arrastar** uma sessão move seu horário/dia — gravando direto no banco, respeitando as travas de negócio (agenda 08:00–19:30; regras de mesma semana quando aplicável). Desde 2026-07-24, o grid fica esmaecido e trancado (sem clique) do momento do drop até a mutação terminar de verdade — inclusive durante o tempo em que o modal "esta ou esta e as futuras" está aberto — pra evitar arrastar uma segunda sessão enquanto a primeira ainda está sendo salva.
- É **somente a agenda visual** — o link do Meet é tratado à parte (botão de copiar mensagem), não embutido no calendário.
- Quando o dia de hoje está entre os dias exibidos (visão semana ou dia), uma linha fina e esmaecida atravessa **todas as colunas visíveis** indicando o horário atual (atualizada a cada 60s), só como referência visual — sem label, sem interferir no drag-and-drop. Se a visão exibida não inclui hoje (ex.: semana seg-sex num sábado), a linha não aparece.
- O Google Calendar continua recebendo o **espelho** (escrita a partir do banco), para quem quiser ver no Google. Mas a **edição oficial** passa a ser no painel. O espelho vale para **qualquer tipo de sessão** (presencial ou online) quando a clínica está conectada — até 2026-07-21 havia um bug em que sessão presencial nunca era espelhada (só online gerava evento), corrigido nessa data. Cada `Agendamento` grava um `googleSyncStatus` (sincronizado/falhou/não aplicável) para dar visibilidade de quando o espelho realmente aconteceu. Desde 2026-07-23, mover sessões via "Trazer" (`/adiar`) e "Empurrar" também atualiza o evento no Google (ou cria, se a sessão nunca teve um) e grava esse status — antes, a sincronização já acontecia mas uma falha silenciosa podia deixar o evento com a data antiga sem nenhum registro do ocorrido.
- **Calendário por tipo de atendimento (2026-07-23)**: cada `TipoSessao` pode ter seu próprio calendário do Google (`googleCalendarId`) — antes disso, presencial e online sempre caíam no mesmo calendário único da clínica (`Clinica.googleCalendarId`, sempre `"primary"`, nunca configurável por nenhuma tela), mesmo depois do conserto de 2026-07-21 garantir que o evento fosse criado. Quando o tipo tem calendário configurado, ele é usado; senão cai no calendário único da clínica, como antes.
- **Alerta de conexão perdida + checagem noturna (2026-07-24)**: um incidente real de token do Google revogado/expirado (`invalid_grant`) motivou dois mecanismos novos, complementares ao que já existia. Primeiro, a saúde real da conexão (`Clinica.googleTokenValido`) passa a ser detectada de verdade — antes, `googleConectado` só refletia se alguém clicou em conectar/desconectar, nunca se o token realmente ainda funcionava. Quando cai, um **banner persistente** aparece no painel ("Conexão com Google Agenda perdida — reconecte em Configurações → Integrações"), visível em qualquer aba, não só um aviso que some em 4 segundos. Segundo, uma **checagem noturna automática** (uma vez por dia, de madrugada) compara o banco contra o Google de verdade e sinaliza (sem corrigir sozinha) sessões futuras cujo evento sumiu ou está com horário diferente do que o painel mostra — o mesmo tipo de problema que já apareceu manualmente nos casos do Jadir/Maura/Fábio, agora detectado sem precisar de auditoria manual.

**Consequência boa:** como a edição volta a ter uma única porta (o painel → banco), não há mais necessidade de sincronização bidirecional. A checagem noturna de 2026-07-24 **não é** o job de sincronização bidirecional do protótipo antigo que este parágrafo descartava — ela só lê e reporta, nunca escreve data/hora de volta no banco a partir do Google; o banco continua sendo a única fonte da verdade.

*(O envio de mensagens e a integração de anamnese/forms externos ficam para a v2 — ver §11.)*

**Ajuste de layout — 2026-07-18**: o container do painel (`header`/`main` de `painel/page.tsx`) passou de `max-w-5xl` (1024px) para `max-w-[1600px]` e, após ajuste fino no mesmo dia (o valor de 1600px ficou largo demais, sem margem lateral visível em desktop), foi reduzido para `max-w-[1360px]` — valor final. O grid de dias da visão Semana (Flexbox, não CSS Grid) acompanhou o espaço extra: `minWidth` do container de colunas subiu de 880 para 1100, e a largura mínima de cada coluna (`DiaColuna`) subiu de 120px para 150px (esses dois valores não precisaram mudar no ajuste fino — o teste visual em 1360px mostrou colunas confortáveis, sem espremer). Abaixo de ~1100px de largura útil, a Agenda passa a rolar horizontalmente dentro do próprio card (`overflow-auto`, inalterado) em vez de comprimir as colunas.

---

## 7. Endpoints / casos de uso (mapa)

| Caso de uso | Método | Origem no protótipo |
|---|---|---|
| Cadastrar paciente + gerar sessões | POST /pacientes | `cadastrar` / `gerarSessoes` |
| Listar pacientes (busca) | GET /pacientes?q= | `clientes` |
| Sessões de um paciente | GET /pacientes/:id/sessoes | `sessoesCliente` |
| Agenda do dia | GET /agenda?data= | `agenda` |
| Empurrar sessões | POST /pacientes/:id/empurrar | `empurrarCliente` |
| Adiar sessões | POST /pacientes/:id/adiar | `adiantarCliente` |
| Editar sessão pontual | PATCH /sessoes/:id | `editarSessao` |
| Marcar status | PATCH /sessoes/:id/status | `marcarStatusSessao` |
| Cancelar paciente | POST /pacientes/:id/cancelar | `cancelarCliente` |

Todo endpoint é **isolado por clínica** (o tenant vem do usuário autenticado, nunca do parâmetro).

---

## 8. Segurança e LGPD

- Senhas em hash (bcrypt/argon2).
- Segredos em variáveis de ambiente, nunca no código.
- Isolamento multi-tenant validado em toda query (clinicaId do usuário logado).
- Dados de pacientes são sensíveis: consentimento, direito de exclusão, logs de acesso.
- Backup automático do Postgres (Supabase/Neon já oferecem).

---

## 9. Cronograma até o go-live

**Premissas honestas:** desenvolvedor iniciante em evolução, trabalhando em tempo parcial, com a stack já parcialmente iniciada. As estimativas são em **semanas de calendário** (não de trabalho contínuo) e assumem ~8–12h/semana. Ranges refletem a incerteza real.

| Fase | Entrega | Estimativa |
|---|---|---|
| **0 — Fundação** | Scaffold, banco conectado, Prisma schema, migrations, seed, auth multi-tenant básica | 1–2 semanas *(parte já feita)* |
| **1 — Núcleo** | CRUD paciente, pacotes, geração automática de sessões semanais | 2–3 semanas |
| **2 — Operações** | Empurrar (com semanas + mudança dia/hora + tudo-ou-nada), adiar, editar pontual, status, finalização automática | 3–4 semanas |
| **3 — Google Calendar** | Criação/atualização de eventos, múltiplos calendários, decisão de sincronização | 2–3 semanas |
| **4 — Painel (UI) + Calendário visual** | Porta do HTML para React/Next: busca, agenda do dia, sessões do paciente, modais, botão copiar mensagem (confirmação **e link do Meet**), sino com lembrete de renovação. **+ Visão de calendário arrastável** (dia/semana, cores por tipo) que substitui o Google Calendar para a operação | 5–7 semanas |
| **5 — Multi-tenant + LGPD** | Isolamento por clínica revisado, cadastro de clínica, papéis, auditoria | 2 semanas |
| **6 — Migração Pâmela + testes** | Importar dados reais, rodar em paralelo, validar contra o protótipo, corrigir | 2–3 semanas |
| **7 — Go-live Pâmela** | Pâmela usando o SaaS como cliente #1 em produção | marco |
| **8 — Beta outras clínicas** | Onboarding de 2–3 clínicas piloto, ajustes de produto | contínuo |

### Resumo temporal

- **MVP utilizável (Pâmela) : ~17 a 24 semanas** (≈ 4,5 a 6 meses em tempo parcial).
- O aumento em relação à estimativa inicial vem do **calendário visual arrastável** (Fase 4), que é o único item "pesado" que entrou no MVP — e vale a pena, porque elimina a sincronização.
- **Go-live real (Fase 7):** fim desse período, após rodar em paralelo com o sistema atual.
- **O sistema atual continua no ar** durante toda a construção — zero risco para a operação da Pâmela.

### Marcos de validação (não pular)

1. Fim da Fase 2 → as regras de negócio batem 1:1 com o protótipo (mesmo teste, mesmo resultado).
2. Fim da Fase 4 → um humano consegue operar o dia inteiro só pelo painel novo.
3. Fase 6 → duas semanas rodando em paralelo sem divergência antes de desligar o antigo.

---

## 10. Princípio que guia tudo

> Uma fonte da verdade (o banco). O painel é como se edita — inclusive o calendário visual. O Google Calendar espelha. Nunca três sistemas discordando.

Foi a ausência disso que gerou quase todas as dores do protótipo. O SaaS nasce com isso resolvido.

---

## 11. Roadmap pós-MVP (v2 e além)

Registrado para não se perder. Nada disso entra no MVP — mas o modelo de dados e a arquitetura já nascem preparados para receber.

| Recurso | O que é | Depende de |
|---|---|---|
| **Envio automático de mensagens** | Disparar confirmação/link do Meet sozinho (não copiar-colar) | WhatsApp API oficial (pago) ou e-mail; fluxo de conversação — **recepção já iniciada, ver §11.1** |
| **Integração forms.app** | Puxar cadastro do paciente do formulário externo | Webhook/API do forms.app (a validar; plano B: importação CSV) |
| **Formulário de cadastro próprio** | Substituir forms.app por formulário do sistema | — |
| **Módulo de anamnese** | Cliente que agenda avaliação recebe link de anamnese; preenche; dados ficam vinculados ao paciente; a profissional vê na tela ao clicar no nome | Formulário próprio + tela de visualização |
| **App/visão mobile dedicada** | Operação pelo celular | — |
| **White-label** | Cada clínica escolhe cores, logo, fundo, tema — o sistema veste a marca do cliente | Campos de tema na Clínica (já previstos abaixo) + camada de theming no front |
| **Relatórios e financeiro** | Faturamento por pacote, taxa de comparecimento, etc. | — |

**Sequência sugerida da v2:** (1) módulo de anamnese — maior valor percebido pela profissional; (2) formulário de cadastro próprio; (3) envio automático de mensagens; (4) integrações externas.

### 11.1 Atendimento WhatsApp — recepção (implementado)

Conta Meta Business "atendimentobanah" configurada, número de produção verificado, template utility `confirmacao_agenda` submetido. Implementado até aqui: só a **recepção** — webhook que recebe mensagens do WhatsApp Cloud API e grava no banco (`ConversaWhatsapp`/`MensagemWhatsapp`, ver `ARCHITECTURE.md` §10). Envio automático de mensagem e resposta por IA continuam como trabalho futuro, não fazem parte deste recorte.

- **Modelo de dados**: `ConversaWhatsapp` (uma por `clinicaId`+`telefone`, com `janelaAbertaAte` — a janela de 24h da Meta em que a clínica pode responder livremente sem template) e `MensagemWhatsapp` (uma por mensagem, `wamid` único garante idempotência em retry do webhook).
- **Fluxo**: `GET /api/whatsapp/webhook` responde à verificação da Meta; `POST /api/whatsapp/webhook` valida a assinatura HMAC do corpo antes de processar, grava mensagens de entrada (`messages`), só loga status de entrega (`statuses`), e sempre responde 200 rápido (erro interno é logado, nunca propagado pra Meta re-tentar).
- **Limite atual**: como o produto hoje atende só uma clínica de verdade, o webhook associa toda mensagem à primeira `Clinica` do banco — falta o mapeamento `phone_number_id` → `Clinica` para suportar múltiplas clínicas com WhatsApp conectado.

### 11.2 Atendimento WhatsApp — lembrete de confirmação (implementado)

Primeiro envio automático de saída: lembrete do template aprovado `confirmacao_agenda` (nome, data, hora, botões Confirmar/Cancelar/Reagendar), disparado ~48h antes da sessão para agendamentos ainda não confirmados (`Agendamento.confirmada = false`). Detalhe técnico completo em `ARCHITECTURE.md` §10.5.

- Roda 1x/dia (limite do plano Vercel atual) às 09:00 BRT, buscando sessões entre 24h e 72h de antecedência — cobre a marca de 48h mesmo só rodando uma vez ao dia.
- `Agendamento.lembreteWhatsappEnviadoEm` marca o envio, evitando duplicata.
- Responder aos botões do template (Confirmar/Cancelar/Reagendar) já chega no webhook de entrada, mas ainda **não confirma a sessão automaticamente** — fica para uma etapa futura ligar a resposta do botão à ação real no `Agendamento`.
- Telefone do paciente segue sem validação no cadastro; o envio normaliza em memória (assume Brasil quando faltam os 2 dígitos do DDI) e pula, sem travar o lote, quem estiver fora do formato esperado.

### 11.3 Atendimento WhatsApp — IA de confirmação/reagendamento + mensagem do dia (implementado)

Escopo: só paciente já confirmado/existente — funil de lead novo (venda) fica para depois. Detalhe técnico completo em `ARCHITECTURE.md` §10.6-10.7.

- **IA (Claude Haiku)** interpreta a resposta do paciente a um lembrete: confirma a sessão sozinha quando o paciente confirma; se o paciente pede para reagendar/cancelar, não decide sozinha — só sinaliza que precisa de atendimento humano (a Daiane/Pâmela reagenda manualmente pelo sistema, como já faz hoje); qualquer outra dúvida (endereço, horário etc.) a IA responde no tom da Daiane, sempre baseada em dados reais do agendamento, nunca inventados.
- **Mensagem automática do dia**: reaproveita o mesmo texto de copiar-colar do link do Meet que já existia (configurável por clínica), agora enviado automaticamente pra quem tem sessão no dia. Limitação real: só funciona pra quem tem conversa "aberta" no WhatsApp (mensagem recente) — sem um template aprovado específico pra isso, não dá pra alcançar quem não escreveu recentemente; ficou registrado como pendência.

**Refactor 2026-07-31 (sem mudança de comportamento)**: os pontos de envio (cron 48h, cron do dia, inbox, IA/handoff) passaram a chamar uma interface `WhatsAppProvider` via `getProvider()` (`src/lib/whatsapp/provider/`) em vez das funções concretas diretamente — preparação para permitir mais de uma implementação de canal no futuro (ver §11.4). Nesta fase `getProvider()` sempre retorna a implementação Cloud API; nenhum comportamento observável mudou. Detalhe técnico em `ARCHITECTURE.md` §10.11.

### 11.4 wa-bridge — canal não-oficial (serviço isolado)

**⚠️ Canal fora dos Termos de Uso do WhatsApp — destinado a número secundário e descartável,
nunca ao número principal da clínica nem ao mesmo número da Cloud API oficial do §11.1-11.3.**
Serviço à parte (`/wa-bridge`, fora do app Next.js, deploy próprio) que se conecta ao WhatsApp
como um cliente WhatsApp Web comum via [Baileys](https://github.com/WhiskeySockets/Baileys) —
biblioteca não-oficial, sem aprovação da Meta. Detalhe técnico completo em `ARCHITECTURE.md`
§12; instruções de operação (subir o serviço, ler o QR na primeira conexão, rotacionar sessão)
em `wa-bridge/README.md`.

- **Por quê**: canal alternativo/experimental para casos que a Cloud API oficial não cobre,
  aceitando conscientemente o risco de banimento do número secundário em troca de não depender
  de template aprovado pela Meta.
- **Fila de envio**: estritamente serial, delay aleatório de 25-60s entre mensagens, cap de 15
  envios/dia, só processa dentro do expediente (08:00-19:00, seg-sex, `America/Sao_Paulo`) —
  desenhado para reduzir o risco de o número ser sinalizado como spam.
- **Persistência da sessão**: tabela própria no Supabase (`wa_bridge_session`, SQL documentado
  no README — **não é uma migration do Prisma**, o schema do app não é tocado por esse serviço).
- **Reconexão**: automática, exceto quando a sessão é deslogada no aparelho — nesse caso o
  serviço para e avisa o app via webhook (`session.disconnected`) para reconexão manual.

**Modelagem multi-canal — PAUSADA (2026-08-04)**: existe um trabalho modelado (não implementado, não migrado) pra suportar múltiplos canais de WhatsApp por clínica — Cloud API oficial e `wa-bridge` selecionáveis por clínica, com uma tabela `CanalWhatsApp` nova. Isolado em branch (`feat/wa-bridge`, commit `5bae2cb`) e removido da `main` — a `main` não tem nenhum código nem coluna de banco dessa feature hoje. Detalhe técnico completo (conteúdo da modelagem, armadilha de nomenclatura pra quem retomar) em `ARCHITECTURE.md` §12.7.

---

## 12. Módulo Mentoria

### 12.1 Visão geral

Módulo de controle financeiro das mentorias da Pâmela — um serviço à parte do consultório (não é atendimento clínico, é o negócio de mentoria dela). Exclusivo da clínica `pamela-rachid`, ligado/desligado por uma flag (`mentoriaAtivada`) na `Clinica`. Não é pensado para ser multi-clínica — é uma extensão específica para essa clínica, não um recurso genérico do SaaS.

Acesso restrito aos papéis **PROFISSIONAL** e **ADMIN** (papel OPERADOR não entra). Toda rota do módulo exige os dois pré-requisitos: papel liberado **e** `mentoriaAtivada = true` na clínica do usuário logado.

### 12.2 Modelo de dados

#### MentoriaAluno
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid (PK) | |
| clinicaId | uuid (FK) | |
| nomeCompleto, cpf, rg | text | |
| estadoCivil, profissao, nacionalidade | text | opcionais |
| enderecoCompleto, cep, cidadeUf | text | |
| dataNascimento | date | |
| contato (telefone/e-mail) | text | |
| aceiteTermos, aceiteTermosTexto | boolean / text | |
| submitter, submissionData, submissionId | text / timestamp | metadados de submissão — preparação para integração futura via planilha (mesmo padrão do forms.app usado no consultório) |

Dedupe por `(clinicaId, cpf)` e por `(clinicaId, submissionId)`.

#### MentoriaContrato
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid (PK) | |
| alunoId | uuid (FK) | um aluno pode ter vários contratos |
| pacote | text | |
| valorTotal | decimal | |
| taxaImpostoPct | decimal | default 0.06 |
| assinaturaContrato | date | |
| totalParcelas | int | |
| status | enum `StatusContrato` | ATIVO, CONCLUIDO, CANCELADO |
| canceladoEm, motivoCancelamento | timestamp / text | preenchidos só no distrato |

#### MentoriaParcela
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid (PK) | |
| contratoId | uuid (FK) | |
| numero | int | |
| valorBruto, valorLiquido | decimal | líquido = bruto menos taxa de cartão, informado na baixa |
| vencimento | date | |
| dataPagamento, formaPagamento | timestamp / enum `FormaPagamento` | preenchidos na baixa |
| estornoEm, valorEstornado | timestamp / decimal | preenchidos no estorno |

Status **derivado** (nunca uma coluna): ESTORNADA / PAGA / CANCELADA / ABERTA, nessa ordem de prioridade.

#### Comissionado
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid (PK) | |
| clinicaId | uuid (FK) | |
| nome, contato | text | |
| percentualComissao | decimal | fração fixa da pessoa (ex.: 0.20 = 20%) — vale para todos os contratos dela |
| formaRecebimento | enum `FormaRecebimentoComissao` | ADIANTADO, POR_PARCELA — default POR_PARCELA |
| ativo | boolean | |

#### MentoriaComissao
| Campo | Tipo | Notas |
|---|---|---|
| id | uuid (PK) | |
| contratoId, comissionadoId | uuid (FK) | vínculo comissionado ↔ contrato |
| papel | enum `PapelComissao` | SELLER, CLOSER, PRODUTOR |
| percentual, formaRecebimento | decimal / enum | **copiados e travados** do `Comissionado` no momento do vínculo — mudanças posteriores no cadastro do comissionado não afetam vínculos já criados |
| status | enum `StatusComissao` | PENDENTE, PAGO, ESTORNADO |

### 12.3 Regras de negócio

- `clinicaId` sempre vem de `getUsuarioLogado()` — nunca do corpo da requisição.
- Status e valores financeiros são **derivados**, não persistidos: o status da parcela vem de `dataPagamento`/`estornoEm`/status do contrato; o valor de comissão é sempre recalculado, nunca gravado numa coluna.
- **Base comissionável** = `valorTotal * (1 - taxaImpostoPct)`. O imposto do contrato é **sempre** descontado **antes** de aplicar o percentual do comissionado — vale tanto para a comissão sobre o contrato inteiro quanto para a comissão por parcela.
- **Comissão ADIANTADO:** `base * percentual`, devida na data de assinatura do contrato, independe de quais parcelas já foram pagas.
- **Comissão POR_PARCELA:** por parcela paga, `valorLiquido * (1 - taxaImpostoPct) * percentual`. Parcela estornada ou contrato cancelado zera a comissão daquela parcela.
- Percentual e forma de recebimento do comissionado são atributos fixos da pessoa, copiados e travados em cada vínculo — contratos antigos não mudam se o cadastro do comissionado for editado depois.
- Operações são não-destrutivas: o **distrato** cancela o contrato, estorna as parcelas já pagas e estorna automaticamente todas as comissões vinculadas, tudo numa transação atômica. A **exclusão** de contrato só é permitida quando ele já está CANCELADO (cascata completa) ou quando está ATIVO mas sem nenhum pagamento/comissão registrada.
- Máscara monetária padrão do módulo: formato contábil brasileiro (`R$ x.xxx,xx`), negativos entre parênteses em vez de sinal de menos.

### 12.4 O que já foi construído

- Cadastro de aluno, contrato e grid de parcelas editável, com a entrada (quando houver) sempre virando a parcela 1, ancorada na data de assinatura do contrato.
- Edição e exclusão de contrato (com as travas de 12.3).
- Baixa e estorno de parcela, inclusive baixa direto na lista "Parcelas do mês" do dashboard, sem precisar abrir o contrato.
- Distrato (cancelamento com reversão em cascata).
- Dashboard: cards globais (contratos ativos, total a receber da carteira), cards mensais (recebido líquido, a receber, inadimplência, comissões a pagar, impostos no mês, líquido Pâmela), lista "Parcelas do mês", visão por aluno, comissões a pagar por comissionado.
- Cadastro de comissionado com percentual fixo e forma de recebimento.
- Extrato do comissionado: o que já tem a receber (por contrato ou por parcela paga) e o que está previsto (parcelas ainda em aberto), com resumo por mês.
- Comissão gerada por parcela exibida tanto no grid de parcelas do contrato quanto na lista "Parcelas do mês" do dashboard.

### 12.5 Pendências conhecidas

- Integração de importação de aluno via planilha (mesmo padrão usado hoje com o forms.app no consultório) ainda não implementada — os campos de metadados de submissão em `MentoriaAluno` já estão preparados para receber isso.
- Ajustes finos no cadastro de comissionados seguem em andamento.

**Auditoria de performance — 2026-07-17 (encerrada).** Relatório completo em `Documentos Claude/auditoria-mentoria-2026-07-17.md`. Corrigido: waterfall de `layout.tsx` (endpoint `/api/mentoria/acesso` com select mínimo, substitui 2 fetches sequenciais por 1); padrão `useState(null)` sem fail-safe em `dashboard/page.tsx` (unificado com skeleton único e timeout de 4s, mesmo padrão do painel do Consultório); agregações financeiras convertidas de `findMany`+`reduce` para `prisma.aggregate` em `resumo`/`mensal`/`geral`; over-fetch de PII removido de `GET /api/mentoria/alunos` e `GET /api/mentoria/contratos/[id]` (`include` trocado por `select`, campos mortos removidos). Avaliado e adiado por escolha: índices e paginação — volume atual (dezenas de alunos, centenas de parcelas) não justifica; retomar se o volume crescer ou houver lentidão real reportada. Cálculo linha-a-linha de impostos/comissão pendente mantido como está — funciona bem no volume atual, exigiria `$queryRaw` pra virar aggregate.
