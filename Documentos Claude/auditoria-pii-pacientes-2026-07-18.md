# Auditoria de over-fetch de PII/dados sensíveis — Módulo Consultório (Pacientes)

Data: 2026-07-18. Etapa somente leitura/diagnóstico — nenhum código foi alterado nesta etapa.

Base de entendimento: seção "4. Mapa de rotas de API" e "7. Permissões" do `ARCHITECTURE.md`, `src/lib/permissoes.ts`, e a seção "Paciente" (linhas 71-85) de `Documentos Claude/especificacao-agenda-consultorios.md`.

---

## 1. Modelo de permissões esperado vs. o que existe hoje

`src/lib/permissoes.ts` não tem **nenhuma** capacidade de granularidade por campo. Existe uma única capacidade guarda-chuva, `gerirPacientes`, e ela é `true` para os três papéis (`ADMIN`, `PROFISSIONAL`, `OPERADOR`) — ver `capacidadesPorPapel` (linhas 34-77). Não há distinção entre "dado agendável" (nome, telefone, dia/horário preferido, tipo de sessão) e "dado de saúde/sensível" (`anamnese`, `cpf`, `rg`, endereço completo).

A especificação original (`especificacao-agenda-consultorios.md`, linhas 71-85) também não previa esses campos sensíveis no modelo `Paciente` — o `anamnese` é citado só como funcionalidade de **v2** ("Módulo de anamnese", linha 267), com a nota explícita de que "a profissional vê na tela ao clicar no nome". `cpf`, `rg` e o bloco de endereço foram adicionados ao schema (`prisma/schema.prisma:140-185`) sem que a especificação ou `permissoes.ts` tenham sido atualizados para tratá-los como uma classe de dado à parte.

**Conclusão estrutural**: não existe hoje, nem no código nem na especificação, um conceito de "OPERADOR vê menos campos que PROFISSIONAL". Qualquer achado de "exposição por papel" abaixo é, portanto, uma lacuna de design confirmada — não a violação de uma regra já desenhada e não implementada. Ver seção 3 para o porquê isso importa mesmo assim (dado de saúde, ambiente multi-tenant).

Confirmado por agente de exploração do frontend: o único `pode(papel, ...)` que toca paciente em `src/app/painel/page.tsx` é `podeExcluirPaciente = pode(papel, "excluirPaciente")` (linha 440), que só controla o botão/ação de excluir — nenhum campo (cpf, rg, endereço, `anamnese`) é condicionalmente escondido por papel em nenhum lugar do front (`page.tsx`, `AnamneseModal.tsx`, `AnamneseEditor.tsx`, `AnexosPaciente.tsx`).

---

## 2. Mapa de endpoints × consumidores × campos

### 2.1 Endpoints que retornam `Paciente` (ou embutem via `include`)

| Endpoint | Query no Prisma | Consumidor(es) | Campos efetivamente usados |
|---|---|---|---|
| `GET /api/pacientes` | `findMany` sem `select` — **linha completa** (`pacientes/route.ts:26-29`) | Lista de pacientes em `painel/page.tsx` (`pacientesFiltrados.map`, linhas 1772-1813) | `nome`, `telefone`, `statusGeral`, `id` |
| `GET /api/pacientes/[id]` | `findUnique` sem `select` — **linha completa** (`pacientes/[id]/route.ts:49`) | Painel lateral / form de edição em `painel/page.tsx` (form seedado L748-770, campos L1846-1968, painel somente-leitura L2014-2193/2726-2816) + `AnamneseModal.tsx`/`AnamneseEditor.tsx` (anamnese) + `AnexosPaciente.tsx` | Todos os campos cadastrais + `anamnese` (ver tabela 2.2) |
| `GET /api/importacao/preview` | `lerEDeduplicarPlanilha` retorna registro completo da planilha por linha, incluindo `anamnese` montada das respostas do formulário, `cpf`, `rg`, endereço, `dataNascimento`, `estadoCivil`, `nacionalidade`, `profissao`, `instagram`, `quemIndicou`, `email`, `telefone` — **para toda linha, inclusive as já marcadas "existente"** (`src/lib/importacao.ts:119-147`) | Modal de importação em `painel/page.tsx` (tabela L3129-3184) | Só `r.nome` (L3174) e `r.cpf` (L3140/3160/3171/3176) |
| `GET /api/agenda` | `include: { paciente: { select: { id, nome } } }` (`agenda/route.ts:37`) | `AgendaCalendario.tsx` (card de sessão) | `id`, `nome` — **já correto** |
| `GET /api/notificacoes` | `include: { paciente: { select: { id, nome } } }` (`notificacoes/route.ts:16`) | Sino de notificações em `painel/page.tsx` | `id`, `nome` — **já correto** |
| `GET /api/agendamentos?pacienteId=` | `findUnique` no paciente só para validar `clinicaId`, sem retornar o paciente na resposta (`agendamentos/route.ts:14-17`) | — | Paciente não sai na resposta; achado de performance apenas (seção 3.4) |

### 2.2 Campos do `Paciente` × onde são usados no frontend (confirmado por leitura de código, não suposição)

| Campo | Lista de pacientes | Detalhe/edição | Preview de importação |
|---|---|---|---|
| `nome` | Sim | Sim | Sim |
| `telefone` | Sim | Sim | Não |
| `statusGeral` | Sim (MenuStatus) | Sim | Não (preview tem campo `status` próprio, não relacionado) |
| `email` | Não | Sim | Não |
| `cpf` | Não | Sim | Sim (só para exibir/selecionar) |
| `rg` | Não | Sim | Não |
| `logradouro`/`numero`/`complemento`/`bairro`/`cidade`/`estado`/`cep` | Não | Sim | Não |
| `quemIndicou` | Não | Sim | Não |
| `dataNascimento` | Não | Sim | Não |
| `estadoCivil` | Não | Sim | Não |
| `nacionalidade` | Não | Sim | Não |
| `profissao` | Não | Sim | Não |
| `instagram` | Não | Sim | Não |
| `pastaDriveUrl` | Não | Sim | Não |
| `anamnese` | **Não** | Sim (`AnamneseEditor`/`AnamneseModal`) | **Não** |
| `origemCadastro` | Não | Sim | Não |
| `diaPreferido` / `horarioFixo` | Não | Sim | Não |
| `tipoSessaoId` | Não | Sim | Não |
| `clinicaId` | Não | **Não** (nunca lido no front) | Não |
| `finalizadoEm` | Não | **Não** (só o `statusGeral === "FINALIZADO"` gate; o timestamp em si nunca é lido) | Não |

### 2.3 Endpoints de escrita que buscam o `Paciente` inteiro só para checar `clinicaId`/pegar `.nome` (nunca devolvido ao cliente)

Padrão repetido em: `pacientes/[id]/adiar`, `pacientes/[id]/empurrar`, `pacientes/[id]/reverter-futuras`, `pacientes/[id]/anexos` (GET e POST), `pacientes/[id]/compartilhar-pasta`, `sessoes/[id]` (PATCH, `include: { paciente: true }`), `sessoes/[id]/irmas-futuras` (`include: { paciente: true }`), `sessoes/lote` (`include: { paciente: true }`), `pacotes` (POST, `include: { tipoSessao: true }` no paciente completo). Em todos esses casos o objeto `paciente` **não é serializado na resposta** — é over-fetch de banco (payload interno maior, sem necessidade), não exposição de PII ao cliente.

---

## 3. Achados de over-fetch de PERFORMANCE

### F1 — `GET /api/pacientes` (listagem) traz todos os ~25 campos do paciente para renderizar só 4
**Impacto: ALTO** · **Esforço: baixo**

`pacientes/route.ts:26-29` não usa `select`. A lista renderiza só `nome`, `telefone`, `statusGeral` e `id` (`painel/page.tsx:1772-1813`). Isso significa que **toda** clínica com N pacientes ativos paga, a cada carregamento do painel (e a cada troca de filtro Ativos/Finalizados/Cancelados/Todos), o tráfego de CPF, RG, endereço completo, e-mail, data de nascimento, estado civil, nacionalidade, profissão, Instagram, URL da pasta do Drive e o texto inteiro da anamnese de **todos** os pacientes listados — para exibir 4 campos.

**Recomendação**: `select: { id: true, nome: true, telefone: true, statusGeral: true }` (mais qualquer campo que o `MenuStatus`/badge de status realmente precise, ex. `finalizadoEm` se vier a ser usado — hoje não é).

### F2 — `GET /api/importacao/preview` traz anamnese completa de respostas de formulário, para toda linha, quando a tela só usa nome/CPF
**Impacto: ALTO** (payload) · **Esforço: baixo-médio**

`src/lib/importacao.ts:119-147` monta `anamnese` concatenando **todas as perguntas não mapeadas da planilha** (potencialmente extenso) para cada linha, inclusive linhas já marcadas `"existente"` (que nunca serão importadas). A tela de preview (`painel/page.tsx:3129-3184`) só renderiza `nome` e `cpf` para a seleção de quem importar.

**Recomendação**: (a) parar de montar `anamnese`/demais campos cadastrais no preview — devolver só `{ nome, cpf, status }` por linha; (b) só montar o payload completo (incluindo `anamnese`) dentro de `POST /api/importacao/executar`, no momento em que o registro efetivamente vai ser gravado (hoje ele já faz isso corretamente ali). Isso também resolve parte do achado de exposição da seção 4.

### F3 — `GET /api/pacientes/[id]` sem `select`
**Impacto: médio** · **Esforço: baixo**

Diferente da listagem, aqui a maioria dos campos **é** usada (form de edição inteiro). Mas `clinicaId` e `finalizadoEm` nunca são lidos no frontend (confirmado por grep nos 4 arquivos consumidores) — dois campos sem uso real, incluindo um identificador de tenant que não precisa sair no payload.

**Recomendação**: excluir `clinicaId` do `select` (é só usado hoje no backend, comparado contra `usuario.clinicaId` — não precisa voltar ao cliente); avaliar se `finalizadoEm` deveria voltar caso um uso futuro (ex. exibir data de finalização) apareça — hoje é bytes ociosos.

### F4 — Padrão repetido: buscar `Paciente` inteiro só para validar `clinicaId` + pegar `.nome` em ~9 rotas de escrita
**Impacto: médio (soma pequena por chamada, mas repetido em quase toda ação de sessão/paciente)** · **Esforço: médio**

Ver lista completa na seção 2.3. Nenhum desses casos vaza dado ao cliente (o `paciente` não é serializado na resposta), mas todos pagam o custo de trazer ~25 colunas (incluindo o `anamnese` em texto longo) do Postgres só para ler 2 campos.

**Recomendação**: criar um helper único, ex. `verificarPacienteDaClinica(id, clinicaId)` em `src/lib/pacientes.ts` (novo arquivo), com `select: { id: true, nome: true, clinicaId: true }`, e substituir os `prisma.paciente.findUnique({ where: { id } })`/`include: { paciente: true }` desses 9 pontos por ele. Não é urgente isoladamente, mas é o mesmo padrão em todas as rotas de mutação de sessão/paciente — vale corrigir de uma vez.

---

## 4. Achados de exposição indevida (PERMISSÃO) — separado, mais crítico

**Nota de enquadramento**: como descrito na seção 1, hoje **não existe** uma regra de "papel X não deveria ver campo Y" no design do sistema — `OPERADOR`, `PROFISSIONAL` e `ADMIN` têm a mesma capacidade `gerirPacientes`, sem distinção de campo, tanto no código quanto na especificação original. Os itens abaixo não são "código não seguindo o spec" — são a lacuna em si, sinalizada porque envolve dado de saúde (`anamnese`) e PII de identificação (`cpf`, `rg`) num sistema multi-tenant, e merece decisão explícita de produto, não só correção de bug.

### P1 — `OPERADOR` tem acesso de leitura/escrita irrestrito a `anamnese` (dado de saúde) via `GET/PATCH /api/pacientes/[id]`
**Impacto: CRÍTICO (dado de saúde sem controle de acesso)** · **Esforço: depende da decisão de produto**

A especificação (linha 267) descreve o módulo de anamnese como algo que "a profissional vê" — sugerindo que o dado de saúde é operacionalmente relevante para quem atende (`PROFISSIONAL`/`ADMIN`), não necessariamente para quem só agenda (`OPERADOR`, ex. a "Daiane" citada na spec como recepção/operação). Hoje, como `gerirPacientes = true` para os três papéis e não há checagem de capacidade em `GET`/`PATCH /api/pacientes/[id]` (nem em nenhuma outra rota de paciente, exceto `DELETE`), qualquer `OPERADOR` lê e edita a anamnese de qualquer paciente da clínica pelo mesmo formulário que edita telefone.

**Recomendação**: decisão de produto primeiro — se a intenção é restringir `anamnese` a `PROFISSIONAL`/`ADMIN`, seria necessário (a) uma capacidade nova em `permissoes.ts` (ex. `verDadosClinicos`), (b) gate no backend (`GET`/`PATCH /api/pacientes/[id]` devolvendo/aceitando `anamnese` só se `pode(papel, "verDadosClinicos")`), e (c) esconder o campo/editor no front para quem não tem a capacidade. Não implementar sem esse alinhamento — é mudança de comportamento visível para quem usa o sistema hoje.

### P2 — `cpf`/`rg`/endereço completo saem em qualquer leitura de paciente, para qualquer papel, incluindo dentro de um sistema com múltiplas clínicas (multi-tenant)
**Impacto: alto** · **Esforço: baixo, condicionado ao mesmo alinhamento de P1**

Mesma causa-raiz de P1: sem capacidade dedicada, `cpf`/`rg`/endereço trafegam para `OPERADOR` do mesmo jeito que para `ADMIN`. Isolamento **entre clínicas** está correto (`clinicaId` sempre checado contra `usuario.clinicaId` — confirmado em todas as rotas lidas nesta auditoria); o que falta é a segmentação **dentro** da mesma clínica, por papel.

**Recomendação**: se P1 for endereçado com uma capacidade de "dado clínico/sensível", a mesma capacidade pode cobrir CPF/RG/endereço, evitando criar uma segunda capacidade separada — mas essa é decisão de produto (talvez CPF/RG *devam* continuar visíveis a `OPERADOR` para fins administrativos, enquanto só `anamnese` é o dado que devia ser restrito). Registrar a pergunta explicitamente para quem decidir, não assumir a resposta aqui.

### P3 — Import (planilha) expõe anamnese ao navegador antes mesmo de o paciente existir no sistema, no preview
Já coberto como F2 (impacto de performance) — mas tem a mesma dimensão de exposição: as respostas de anamnese de candidatos a paciente (inclusive de quem **já existe** e não vai ser importado de novo) trafegam para o browser de quem estiver rodando o import, **independente do papel**. Se P1 for resolvido, o preview de importação precisa herdar a mesma regra (ou, mais simples: parar de mandar `anamnese` no preview de qualquer forma, já que ele não é usado lá — ver F2).

---

## 5. Ordem sugerida de correção

1. **F2** (preview de importação não vazar `anamnese`/campos não usados) — baixo esforço, resolve simultaneamente performance e uma via de exposição, sem exigir decisão de produto.
2. **F1** (`select` na listagem de pacientes) — baixo esforço, alto impacto, sem ambiguidade de produto.
3. **P1/P2** (decisão de produto sobre capacidade de dado clínico/sensível por papel) — precisa de alinhamento explícito antes de qualquer código; é o item que muda comportamento visível para OPERADOR hoje.
4. **F3** (`select` no detalhe do paciente, tirando `clinicaId`) — baixo esforço, pode ser feito junto do item 3 se a decisão de produto definir um novo formato de `select`.
5. **F4** (helper único para as ~9 rotas que buscam paciente inteiro só para `clinicaId`/`nome`) — esforço médio, não urgente isoladamente, mas vale consolidar numa única passada.

Nenhuma correção foi aplicada nesta etapa.
