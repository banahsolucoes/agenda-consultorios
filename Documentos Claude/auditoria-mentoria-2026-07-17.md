# Auditoria de performance e boas práticas — Módulo Mentoria

Data: 2026-07-17. Etapa somente leitura/diagnóstico — nenhum código foi alterado nesta etapa.

Base de entendimento: `ARCHITECTURE.md` (não tem seção própria sobre a Mentoria — o mapa de rotas/telas ali documentado cobre só o consultório) e a seção "12. Módulo Mentoria" de `Documentos Claude/especificacao-agenda-consultorios.md` (visão geral, modelo de dados, regras de negócio, o que já foi construído).

---

## 1. Mapa de arquivos do módulo

### Páginas (`src/app/mentoria/**`, todas `"use client"`)
| Arquivo | Papel |
|---|---|
| `layout.tsx` | Guarda de navegação (espelho de UX) — bloqueia render dos filhos até confirmar papel + `mentoriaAtivada` |
| `dashboard/page.tsx` | Cards globais/mensais, lista "Parcelas do mês", visão por aluno, comissões a pagar |
| `alunos/page.tsx` | Lista de alunos (grid ordenável, filtro, import, exclusão) |
| `alunos/[id]/page.tsx` | Detalhe/edição de aluno + tabela de contratos |
| `alunos/novo/page.tsx` | Cadastro de aluno |
| `contratos/page.tsx` | Lista de contratos (grid ordenável, filtro Ativos/Todos) |
| `contratos/[id]/page.tsx` | Detalhe/edição de contrato, parcelas, comissionamento, distrato, exclusão, navegação prev/next |
| `contratos/novo/page.tsx` | Criação de contrato + parcelas + comissionamento |
| `comissionados/page.tsx` | Lista de comissionados |
| `comissionados/[id]/page.tsx` | Extrato do comissionado |
| `_components/InputMoedaBR.tsx`, `_components/ModalBaixaParcela.tsx` | Componentes de apoio (form/modal) |

### Rotas de API (`src/app/api/mentoria/**`)
| Rota | Método(s) |
|---|---|
| `alunos/route.ts` | GET (lista), POST (cria) |
| `alunos/[id]/route.ts` | GET, PATCH, DELETE |
| `contratos/route.ts` | GET (lista), POST (cria contrato+parcelas+comissões) |
| `contratos/[id]/route.ts` | GET, PATCH, DELETE |
| `contratos/[id]/comissoes/route.ts` | GET, POST |
| `contratos/[id]/distrato/route.ts` | POST |
| `contratos/[id]/parcelas/route.ts` | PUT |
| `comissoes/[id]/route.ts` | PATCH, DELETE |
| `comissionados/route.ts` | GET, POST |
| `comissionados/[id]/route.ts` | PATCH |
| `comissionados/[id]/extrato/route.ts` | GET |
| `parcelas/[id]/route.ts`, `.../baixa/route.ts`, `.../estorno/route.ts` | GET/PATCH, POST, POST |
| `dashboard/resumo/route.ts`, `.../mensal/route.ts`, `.../geral/route.ts`, `.../alunos/route.ts`, `.../comissoes/route.ts` | GET |
| `importacao/preview/route.ts`, `importacao/executar/route.ts` | GET, POST |

### Schema (`prisma/schema.prisma`)
`MentoriaAluno`, `MentoriaContrato`, `MentoriaParcela`, `Comissionado`, `MentoriaComissao` — campos e índices detalhados na seção 3 abaixo.

### Libs
- `src/lib/mentoria.ts` — guarda de acesso (`exigirAcessoMentoria`), validações, cálculos financeiros puros e as 5 funções de agregação do dashboard.
- `src/lib/mentoria/format.ts` — formatação monetária BRL.
- `src/lib/importacaoMentoria.ts` — leitura/dedupe da planilha de importação de alunos (Google Sheets).

### Geração de contrato (docxtemplater)
**Não encontrada.** Não há dependência `docxtemplater`/`pizzip` no `package.json`, nem pasta `templates/`, nem rota/lib com esse propósito no projeto. O item 3(f) do pedido ("verificar se o template é lido do disco/storage a cada requisição sem cache, e se a geração é síncrona") não se aplica — essa funcionalidade ainda não foi implementada nesta base de código.

---

## 2. Achados de performance

### F1 — `src/app/mentoria/layout.tsx` — waterfall bloqueante na entrada do módulo
**Impacto: ALTO** · **Esforço: médio**

O layout que envolve **todas** as páginas da Mentoria bloqueia a renderização de qualquer filho até resolver `Promise.all([fetch("/api/auth/usuario"), fetch("/api/clinica")])` (linhas 20-47). Só depois disso `liberado` vira `true` e a página real (com seus próprios `useEffect`/fetches) começa a montar. Resultado: **toda** primeira entrada no módulo (deep-link, reload, ou clique vindo do switcher Consultório→Mentoria) paga dois round-trips **sequenciais** — o do guard, depois o(s) da página — em vez de um único round-trip paralelo.

Agrava-se porque `GET /api/clinica` (chamado pelo guard só para ler o boolean `mentoriaAtivada`) devolve o objeto inteiro da clínica via `SELECT_CLINICA` — mais de 20 colunas, incluindo corpo de templates de e-mail/mensagem (`emailBoasVindasCorpo`, `templateConfirmacao`, `templateMeet`) — um payload bem maior do que o necessário só para checar 1 flag.

O comentário do próprio arquivo já deixa claro que é "só espelho de UX" (a segurança real está em `exigirAcessoMentoria`, em cada rota) — ou seja, dá para relaxar o bloqueio sem abrir brecha de segurança.

**Recomendação**: (a) não bloquear a renderização da página nesse gate — renderizar otimisticamente e redirecionar só se a checagem falhar; ou (b) mover a checagem para dentro de uma query já feita pela própria página (ex.: a primeira chamada a qualquer `/api/mentoria/**` já 403 se `mentoriaAtivada=false`, então o guard client-side poderia reagir a esse 403 em vez de pré-checar). Qualquer uma remove o segundo round-trip sequencial.

### F2 — `GET /api/mentoria/alunos` — over-fetch de PII sensível
**Impacto: ALTO** · **Esforço: baixo**

`src/app/api/mentoria/alunos/route.ts` (linhas 36-47) usa `include` sem `select` no nível de `MentoriaAluno`. Isso traz **todas** as colunas do aluno — CPF, RG, endereço completo, CEP, telefone, e-mail, observações, dados de submissão (`aceiteTermosTexto`, `submitter` etc.) — para a listagem, que hoje só renderiza nome, data de nascimento e o resumo do contrato ativo (`src/app/mentoria/alunos/page.tsx`). É simultaneamente (1) payload maior do que precisa e (2) dado sensível de aluno trafegando ao browser sem necessidade de tela.

**Recomendação**: trocar o `findMany` para `select` explícito (`id`, `nomeCompleto`, `dataNascimento`, mais o bloco de `contratos` já filtrado que existe hoje), removendo CPF/RG/endereço/contato/observações da resposta da lista.

### F3 — `GET /api/mentoria/contratos/[id]` — mesmo padrão, aluno completo
**Impacto: médio-alto** · **Esforço: baixo**

`src/app/api/mentoria/contratos/[id]/route.ts` (linha 24) usa `include: { aluno: true, ... }`. A tela de detalhe do contrato (`src/app/mentoria/contratos/[id]/page.tsx`) só usa `contrato.aluno.id` e `contrato.aluno.nomeCompleto` (confirmado por grep — únicos dois acessos a `.aluno.` no arquivo). O restante do registro do aluno (CPF, endereço etc.) viaja à toa em toda visita ao contrato.

**Recomendação**: trocar `aluno: true` por `aluno: { select: { id: true, nomeCompleto: true } }`.

### F4 — Dashboard: `await` sequencial que poderia ser `Promise.all`
**Impacto: médio** · **Esforço: baixo**

Em `src/app/api/mentoria/dashboard/resumo/route.ts` (linhas 30-55):
```
const {...} = await calcularAgregadosMensais(...)   // bloco 1 — resolve antes de continuar
const [...] = await Promise.all([...5 queries...])   // bloco 2 — só começa depois do bloco 1
```
Nenhuma das 5 queries do segundo bloco depende do resultado do primeiro — dá pra rodar tudo num único `Promise.all` (inclusive as 3 queries internas de `calcularAgregadosMensais`, se ela for inlined ou aceitar receber os resultados por parâmetro). Isso é a rota que alimenta o topo do Dashboard — a tela mais carregada do módulo.

O mesmo padrão aparece em `src/app/api/mentoria/dashboard/mensal/route.ts` (linhas 27-31): `await calcularAgregadosMensais(...)` seguido de `await prisma.mentoriaParcela.findMany(...)` — também independentes entre si, também serializados sem necessidade.

**Recomendação**: achatar os dois blocos num único `Promise.all` em cada rota.

### F5 — Agregações financeiras do dashboard somadas em JS
**Impacto: médio (cresce com o volume)** · **Esforço: médio-alto**

As 5 funções de `src/lib/mentoria.ts` que sustentam o dashboard (`calcularAgregadosMensais`, `calcularImpostoNoMes`, `calcularComissaoNoMes`, `calcularComissaoPendenteNoMes`, `calcularInadimplenciaAtual`) todas buscam as linhas de `MentoriaParcela`/`MentoriaComissao` no período via `findMany` (com `select` correto, sem over-fetch de coluna) e somam em JavaScript com `.reduce()`, em vez de agregação no banco (`aggregate`/`groupBy`).

Hoje isso não deve doer (uma clínica, volume de parcelas ainda pequeno), mas é exatamente o padrão que não escala — quanto mais meses de histórico acumulados, mais linhas trafegam do Postgres para o Node a cada abertura do dashboard.

Nem todas são conversão trivial: `calcularAgregadosMensais` e `calcularInadimplenciaAtual` são somas diretas de uma coluna (`prisma.mentoriaParcela.aggregate({ _sum: { valorBruto: true }, where })` resolveria sem SQL bruto). Já `calcularImpostoNoMes`, `calcularComissaoNoMes` e `calcularComissaoPendenteNoMes` fazem uma multiplicação por linha antes de somar (`valorLiquido * (1 - taxaImpostoPct) * percentual`) — isso não dá pra expressar com `aggregate` do Prisma; exigiria `$queryRaw` com uma expressão SQL equivalente.

**Recomendação**: separar em dois grupos — converter primeiro as somas diretas (baixo esforço, ganho imediato), avaliar SQL bruto para as multiplicativas só se o volume real justificar (o esforço/risco de manter uma query SQL manual ao lado da lógica em Prisma é maior).

### F6 — `GET /api/mentoria/dashboard/alunos` — `include: { parcelas: true }` completo
**Impacto: baixo-médio** · **Esforço: baixo**

`src/app/api/mentoria/dashboard/alunos/route.ts` (linha 16) traz todas as colunas de `MentoriaParcela` de cada contrato ativo, quando só `numero`, `dataPagamento`, `estornoEm`, `valorLiquido`, `valorBruto` são usados no cálculo de `parcelaAtual`/`recebidoAcumulado`/`saldoAReceber`.

**Recomendação**: trocar `parcelas: true` por `parcelas: { select: { numero: true, dataPagamento: true, estornoEm: true, valorLiquido: true, valorBruto: true } }`.

### F7 — `GET /api/mentoria/dashboard/geral` — soma em JS ao lado de `count()` correto
**Impacto: baixo** · **Esforço: baixo**

O mesmo arquivo (linhas 22-37) já usa `prisma.mentoriaContrato.count({ where: {...} })` corretamente para `contratosAtivos`, mas os outros dois números (`totalAReceberGeral`, `fechadosNoMesValor`) ainda buscam as linhas via `findMany` e somam com `.reduce()` — poderiam ser `prisma.mentoriaParcela.aggregate({ _sum: { valorBruto: true }, where })` e `prisma.mentoriaContrato.aggregate({ _sum: { valorTotal: true }, where })` respectivamente. É o exemplo mais direto de "meio caminho andado" no arquivo — o padrão certo já existe ao lado do errado.

### F8 — `exigirAcessoMentoria` — 1 query extra em toda chamada do módulo
**Impacto: baixo isolado, mas multiplicado** · **Esforço: médio (depende de política de cache)**

`src/lib/mentoria.ts` (linhas 13-27): toda rota de `/api/mentoria/**` já paga a query de `getUsuarioLogado()` e, em seguida, faz **outra** ida ao banco (`prisma.clinica.findUnique({ select: { mentoriaAtivada: true } })`) só para confirmar a flag. Isoladamente é barato, mas como cada tela do módulo dispara várias chamadas paralelas (o Dashboard, por exemplo, faz 5), o custo se repete 5x por carregamento de página.

**Recomendação**: candidato a `unstable_cache` (chave por `clinicaId`, TTL curto ou invalidação manual no `PATCH /api/clinica` quando `mentoriaAtivada` mudar). Não é mudança mecânica — exige decidir a política de invalidação, por isso o esforço é "médio" apesar do achado ser pequeno.

### F9 — Padrão de múltiplos `useState<T|null>` com fetch independente
**Impacto: baixo** · **Esforço: não recomendo mexer isoladamente**

O pedido presumia que esse padrão já tinha sido corrigido no painel principal. **Não encontrei essa correção**: `src/app/painel/page.tsx` (linhas 695-701) usa exatamente o mesmo padrão — `carregarPapel()`, `carregarClinica()`, `carregarTiposSessao()`, `carregarNotificacoes()`, `carregarGoogleStatus()` chamadas sem `await` dentro do mesmo `useEffect`, cada uma com seu próprio par de `useState`. Isso não é um waterfall (as chamadas disparam em paralelo, já que uma função `async` não aguardada não bloqueia a próxima linha), mas gera um re-render por resposta em vez de um único lote.

O mesmo padrão aparece em `src/app/mentoria/dashboard/page.tsx` (linhas 139-152, 5 pares de estado) e em `src/app/mentoria/contratos/[id]/page.tsx` (3 fetches independentes em `useEffect`s separados). Como é um padrão sistêmico do app inteiro — não uma regressão introduzida pela Mentoria — não recomendo corrigir isoladamente aqui; se vale a pena mexer, é uma decisão de arquitetura para o app todo (ver item (d) abaixo).

### F10 — Sem paginação em `GET /api/mentoria/alunos` / `GET /api/mentoria/contratos`
**Impacto: baixo hoje, sem teto** · **Esforço: baixo quando decidido**

As duas listagens trazem todos os registros do tenant de uma vez, sem `take`/`skip`/cursor. Inofensivo na escala atual (uma clínica, dezenas/poucas centenas de alunos e contratos ao longo do tempo), mas não tem limite — vale um item de backlog preventivo, não uma correção urgente.

---

## 3. Achados de boas práticas / manutenibilidade

### B1 — Guarda de papéis duplicada entre client e server
`PAPEIS_MENTORIA` está hardcoded duas vezes com o mesmo valor: `src/lib/mentoria.ts` (server, fonte da verdade) e `src/app/mentoria/layout.tsx` (client, espelho de UX). Ambas comentadas como intencionais, mas qualquer mudança de papéis liberados para o módulo precisa lembrar de editar os dois lugares.

### B2 — `GET /api/clinica` com log de auditoria supérfluo (dívida já documentada)
Já registrado em `ARCHITECTURE.md` (linha 177): o `GET` refaz uma query extra de log que parece copiada do `PATCH`, sem necessidade num endpoint de leitura. Não é um problema da Mentoria, mas o guard do módulo (F1) chama exatamente essa rota — corrigir isso beneficiaria o app inteiro, e de quebra reduz um pouco o custo do gate da Mentoria.

### B3 — `src/lib/mentoria.ts` concentra responsabilidades variadas
Guarda de acesso, validação de regra de negócio (`validarSomaLiquido`), cálculo financeiro puro (`calcularBaseComissionavel`, `calcularValorComissaoVinculo` etc.) e as 5 funções de agregação com I/O de banco convivem no mesmo arquivo (~330 linhas). Ainda coeso e bem comentado hoje; se crescer mais, vale separar "cálculo puro" (sem I/O, fácil de testar) de "agregação" (com Prisma).

### B4 — Nenhum teste automatizado para os cálculos financeiros
As funções puras de `src/lib/mentoria.ts` (base comissionável, comissão por forma de recebimento, arredondamento) concentram regra de negócio financeira sensível e não têm teste — o projeto já tem pelo menos um arquivo de teste (`mapearCorGoogle.test.ts`, citado no `ARCHITECTURE.md`), então há precedente de infraestrutura de teste no repo. São ótimas candidatas por serem puras (sem mock de banco necessário).

### B5 — Tabs/switcher de contexto duplicados em 4 páginas
`Dashboard | Alunos | Contratos | Comissionados` e o `ContextoSwitcher` estão copiados nos 4 arquivos de topo do módulo (decisão consciente de sessões anteriores, para não introduzir componente novo fora do pedido). Funciona, mas qualquer 5ª aba futura exige editar os 4 arquivos.

### B6 — Índice composto ausente em `MentoriaContrato(clinicaId, status)`
Cobertura de índice hoje: `MentoriaAluno` (`clinicaId`, únicos por cpf/submissionId), `MentoriaContrato` (`clinicaId`, `alunoId` separados), `MentoriaParcela` (`clinicaId`, `contratoId`, `(clinicaId, vencimento)`, `(clinicaId, dataPagamento)`), `Comissionado`/`MentoriaComissao` (`clinicaId`, mais `contratoId`/`comissionadoId`). Não achei índice composto `(clinicaId, status)` em `MentoriaContrato`, usado em várias queries (contrato ativo do aluno, contagem de contratos ativos, filtro "Ativos" da lista de contratos). Hoje provavelmente irrelevante pelo volume baixo; **mudança de schema — não implementar sem decisão explícita**, só registrando como candidato caso o volume cresça.

---

## 4. Ordem sugerida de implementação (fundação → detalhe)

1. **F2 + F3** — trocar `include` por `select` explícito nas duas rotas que vazam PII (`alunos` lista, `contratos/[id]`). Mudança pontual, sem risco, e é a "fundação de dados" de tudo que vem depois.
2. **F1** — resolver o waterfall do `mentoria/layout.tsx`. Maior impacto percebido pelo usuário (é literalmente o primeiro round-trip de qualquer visita ao módulo) e mexe na fundação de navegação de todas as telas.
3. **F4** — achatar os `await` sequenciais em `Promise.all` nas rotas `dashboard/resumo` e `dashboard/mensal`. Ganho direto na tela mais pesada do módulo, mudança mecânica.
4. **F6 + F7** — aplicar `select` em `dashboard/alunos` e trocar `findMany`+`reduce` por `aggregate` nos dois números de `dashboard/geral` que ainda não seguem o padrão que o próprio arquivo já usa para `contratosAtivos`. Mesma vizinhança de código do item 3, mesmo nível de risco baixo.
5. **F8** — decidir e aplicar cache (`unstable_cache` ou equivalente) para o gate `mentoriaAtivada` em `exigirAcessoMentoria`. Vem depois dos itens mecânicos porque exige decisão de política de invalidação.
6. **F5** — migrar as agregações financeiras de JS para banco: primeiro as somas diretas (`aggregate` simples), depois avaliar SQL bruto para as multiplicativas só se o volume real justificar o esforço extra de manter uma query fora do Prisma.
7. **F10 + B6** — paginação nas listagens e índice composto em `MentoriaContrato`, como itens preventivos — revisar quando o volume de alunos/contratos crescer, não antes.
8. **B1–B5** — boas práticas de manutenibilidade, sem urgência de performance: endereçar conforme a agenda de refactor permitir.

Fora de ordem, por não serem "correção pontual e segura": **F9** (padrão de múltiplos `useState`/fetch independente) e a conversão de Client para Server Components (critério (d) do pedido — não encontrei nenhum componente do módulo hoje marcado `"use client"` sem necessidade real de interatividade; o problema, se existir, é arquitetural — o app inteiro é client-rendered — e mexer nisso é decisão de arquitetura, não uma correção local da Mentoria).
