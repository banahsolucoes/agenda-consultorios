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
- **Mensagem com link do Meet** (dia da sessão): botão que copia um texto **contendo o link do Meet** da sessão, para o operador enviar ao cliente. Texto a definir.
- *(Envio automático de mensagens — WhatsApp oficial/conversas — fica para a v2, ver seção 11.)*

### 5.9 Notificações (sino)
- Sessões em status REAGENDADA aparecem como pendências, sinalizando que precisam de ajuste.

### 5.10 Busca de paciente
- Insensível a maiúsculas/minúsculas **e acentos** (normalização NFD).

---

## 6. Visão de calendário no painel (substitui o Google Calendar para a operação)

Decisão de arquitetura definida: a operadora (Daiane) trabalha **dentro do painel**, numa visão de calendário visual, e **não mais no Google Calendar**. Isso resolve de raiz o problema de sincronização — ela edita direto na fonte única (o banco).

- **Visão de calendário** (dia/semana) mostrando as sessões como blocos, coloridos por **tipo de sessão** (ver §4).
- **Arrastar** uma sessão move seu horário/dia — gravando direto no banco, respeitando as travas de negócio (agenda 08:00–19:30; regras de mesma semana quando aplicável).
- É **somente a agenda visual** — o link do Meet é tratado à parte (botão de copiar mensagem), não embutido no calendário.
- O Google Calendar continua recebendo o **espelho** (escrita a partir do banco), para quem quiser ver no Google. Mas a **edição oficial** passa a ser no painel.

**Consequência boa:** como a edição volta a ter uma única porta (o painel → banco), não há mais necessidade de sincronização bidirecional nem de job noturno. O problema que nos consumiu no protótipo deixa de existir.

*(O envio de mensagens e a integração de anamnese/forms externos ficam para a v2 — ver §11.)*

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
| **Envio automático de mensagens** | Disparar confirmação/link do Meet sozinho (não copiar-colar) | WhatsApp API oficial (pago) ou e-mail; fluxo de conversação |
| **Integração forms.app** | Puxar cadastro do paciente do formulário externo | Webhook/API do forms.app (a validar; plano B: importação CSV) |
| **Formulário de cadastro próprio** | Substituir forms.app por formulário do sistema | — |
| **Módulo de anamnese** | Cliente que agenda avaliação recebe link de anamnese; preenche; dados ficam vinculados ao paciente; a profissional vê na tela ao clicar no nome | Formulário próprio + tela de visualização |
| **App/visão mobile dedicada** | Operação pelo celular | — |
| **White-label** | Cada clínica escolhe cores, logo, fundo, tema — o sistema veste a marca do cliente | Campos de tema na Clínica (já previstos abaixo) + camada de theming no front |
| **Relatórios e financeiro** | Faturamento por pacote, taxa de comparecimento, etc. | — |

**Sequência sugerida da v2:** (1) módulo de anamnese — maior valor percebido pela profissional; (2) formulário de cadastro próprio; (3) envio automático de mensagens; (4) integrações externas.
