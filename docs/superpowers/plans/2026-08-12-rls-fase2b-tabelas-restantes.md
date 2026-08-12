# RLS — Fase 2b (5 tabelas restantes) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fecha a leitura cross-loja/cross-usuário nas 5 tabelas restantes
sem `loja_id` direto: `lojas`, `profiles`, `permissoes`, `outbox`,
`arquivos_mortos`. Última fase da contenção de RLS iniciada na Fase 0.

**Architecture:** Duas migrations SQL, sem mudança de código TypeScript.
A Task 1 isola a peça mais arriscada (`profiles`, com uma function nova)
e a testa isoladamente ANTES de tocar qualquer outra tabela — lição
direta do incidente de recursão infinita da Fase 2a (ver
`AGENTS.md`, seção "Contenção de RLS (Fase 0 + Fase 2a) e incidente de
recursão infinita"). Ver spec completa: `docs/superpowers/specs/
2026-08-12-rls-fase2b-tabelas-restantes-design.md`.

**Tech Stack:** Postgres self-hosted no Contabo (Supabase), sem alteração
de código Next.js/TypeScript.

## Global Constraints

- Produção real, sem staging.
- Migration aplicada manualmente via SSH: `ssh -i
  ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec -i
  supabase-db psql -U supabase_admin -d postgres" < arquivo.sql`.
- Nenhuma mudança de código TypeScript nesta fase.
- **NUNCA usar subquery direta que referencia a própria tabela dentro de
  uma policy** — causou recursão infinita e derrubou o app inteiro na
  Fase 2a (documentado em `AGENTS.md`). Toda consulta a `loja_user`/
  `profiles` dentro de uma policy usa as functions `security definer` já
  existentes (`usuario_tem_acesso_loja(p_loja_id)`, `usuario_e_admin()`)
  ou a nova desta fase (`usuario_compartilha_loja(p_outro_user_id)`).
- **Task 2 só começa depois da Task 1 estar aplicada, validada em
  produção e confirmada limpa** — não aplicar as duas migrations em
  sequência sem validar a primeira isoladamente. Esta é a mesma lição do
  incidente: validar a peça de maior risco isoladamente antes de
  expandir pras outras tabelas.
- `outbox`/`arquivos_mortos` recebem RLS ligada SEM NENHUMA policy de
  `SELECT` — isso é bloqueio total intencional (nenhuma policy = zero
  acesso pra `anon`/`authenticated`, confirmado na Task 2), não um
  esquecimento.

---

## Task 1: Migration — `profiles` (function nova + policy), aplicar e validar isoladamente

**Files:**
- Create: `supabase/migrations/113_rls_fase2b_profiles.sql`

**Interfaces:**
- Consumes: `usuario_e_admin()` (function já existente, criada na
  migration 112).
- Produces: `usuario_compartilha_loja(p_outro_user_id uuid) returns
  boolean` — nova function `security definer`, disponível pra qualquer
  policy futura que precise saber se o usuário logado compartilha
  alguma loja com outro usuário. A Task 2 não a usa, mas fica registrada
  aqui pra qualquer plano futuro.

**O SQL completo**:

```sql
-- Fase 2b (2026-08-12) -- ver docs/superpowers/specs/
-- 2026-08-12-rls-fase2b-tabelas-restantes-design.md. Só profiles nesta
-- migration -- é a peça de maior risco desta fase (nova function,
-- policy mais complexa que o padrão já usado), testada isoladamente
-- antes de tocar as outras 4 tabelas (lição do incidente de recursão da
-- Fase 2a, ver AGENTS.md). Não referencia profiles dentro da própria
-- policy -- só loja_user (via join), evitando o mesmo padrão recursivo.

create or replace function usuario_compartilha_loja(p_outro_user_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from loja_user lu1
    join loja_user lu2 on lu1.loja_id = lu2.loja_id
    where lu1.user_id = auth.uid() and lu2.user_id = p_outro_user_id
  );
$$;

revoke all on function usuario_compartilha_loja(uuid) from public;
grant execute on function usuario_compartilha_loja(uuid) to anon, authenticated;

alter table profiles enable row level security;
create policy profiles_select_por_acesso on profiles for select using (
  id = auth.uid()
  or usuario_e_admin()
  or usuario_compartilha_loja(id)
);
```

- [ ] **Step 1: Escrever o arquivo**

Crie `supabase/migrations/113_rls_fase2b_profiles.sql` com o SQL acima,
exatamente como está.

- [ ] **Step 2: Aplicar em produção via SSH**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec -i supabase-db psql -U supabase_admin -d postgres" < supabase/migrations/113_rls_fase2b_profiles.sql
```

Esperado: `CREATE FUNCTION`, `REVOKE`, `GRANT`, `ALTER TABLE`, `CREATE
POLICY`, sem nenhum erro. Se qualquer linha der erro, pare e reporte —
não continue pra validação nem pra Task 2.

- [ ] **Step 3: Validar ISOLADAMENTE — 4 casos reais, todos com UUIDs já confirmados hoje**

Use o padrão de simulação de JWT já usado nas fases anteriores:
```sql
set role authenticated;
set request.jwt.claims = '{"sub": "<uuid>"}';
select ...;
reset role;
```

**Caso A — usuário comum vendo colega da MESMA loja (deve ver)**:
`Gerson Mendes` (UUID `626393b3-6e27-4d45-a382-8ec36c37043b`, perfil
`Usuario`, vinculado à loja 3) consultando o profile de `Ramon teste`
(UUID `87c81c7e-6c30-43bc-b5b9-fae112915fdf`, também vinculado à loja
3):

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec supabase-db psql -U supabase_admin -d postgres -c \"
set role authenticated;
set request.jwt.claims = '{\\\"sub\\\": \\\"626393b3-6e27-4d45-a382-8ec36c37043b\\\"}';
select id, name from profiles where id = '87c81c7e-6c30-43bc-b5b9-fae112915fdf';
reset role;
\""
```

Esperado: retorna 1 linha (`Ramon teste`).

**Caso B — usuário comum vendo alguém de OUTRA loja, sem vínculo comum
(NÃO deve ver)**: o mesmo `Gerson Mendes` (loja 3) consultando `Carlos
Marinho` (UUID `ca2a33ff-dd17-4c7a-bc1e-ecdc4650aff1`, vinculado só à
loja 2 — sem vínculo comum com Gerson):

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec supabase-db psql -U supabase_admin -d postgres -c \"
set role authenticated;
set request.jwt.claims = '{\\\"sub\\\": \\\"626393b3-6e27-4d45-a382-8ec36c37043b\\\"}';
select id, name from profiles where id = 'ca2a33ff-dd17-4c7a-bc1e-ecdc4650aff1';
reset role;
\""
```

Esperado: **0 linhas** (vazio, sem erro). Se retornar a linha do Carlos,
a policy está permissiva demais — pare e reporte, não prossiga pra Task
2.

**Caso C — AdminLoja vendo a lista de usuários da própria loja (deve ver
todos os vinculados)**: `Joao Henrique da Silva Santos` (UUID
`04a26215-9840-4328-a57d-c3be1be47849`, perfil `AdminLoja`, vinculado à
loja 6) consultando o profile de `Andre Do` (UUID
`a07a6e89-db74-4497-8a6c-a3092f2c078a`, também vinculado à loja 6):

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec supabase-db psql -U supabase_admin -d postgres -c \"
set role authenticated;
set request.jwt.claims = '{\\\"sub\\\": \\\"04a26215-9840-4328-a57d-c3be1be47849\\\"}';
select id, name from profiles where id = 'a07a6e89-db74-4497-8a6c-a3092f2c078a';
reset role;
\""
```

Esperado: retorna 1 linha (`Andre Do`) — confirma que `AdminLoja`
(não coberto por `usuario_e_admin()`) consegue ver a equipe da própria
loja via `usuario_compartilha_loja`.

**Caso D — super_admin sem vínculo vendo TODOS os profiles**: `Claude
QA` (UUID `0c4e94fe-93be-4914-84b1-263efdbbb7f2`, `is_super_admin=true`,
zero vínculos em `loja_user`):

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec supabase-db psql -U supabase_admin -d postgres -c \"
set role authenticated;
set request.jwt.claims = '{\\\"sub\\\": \\\"0c4e94fe-93be-4914-84b1-263efdbbb7f2\\\"}';
select count(*) from profiles;
reset role;
\""
```

Esperado: um número maior que zero, cobrindo TODOS os profiles
cadastrados (compare com `select count(*) from profiles;` rodado sem
`SET ROLE`, como `supabase_admin` — os dois números devem bater).

- [ ] **Step 4: Confirmar HTTP 200 do app** (sanity check rápido, não
depende de código novo, mas confirma que nada mais quebrou):

```bash
curl -s -o /dev/null -w "HTTP %{http_code}\n" https://app-estoque.norteparanegocios.com.br/login
```

Esperado: `HTTP 200`. Se vier diferente, pare e investigue antes de
prosseguir — pode ser sinal de que algo mais quebrou.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/113_rls_fase2b_profiles.sql
git commit -m "fix: RLS em profiles (Fase 2b) — id próprio, admin, ou loja em comum"
```

**Só prossiga pra Task 2 depois que os 4 casos do Step 3 confirmarem
exatamente os resultados esperados.**

---

## Task 2: Migration — `lojas`, `permissoes`, `outbox`, `arquivos_mortos`

**Files:**
- Create: `supabase/migrations/114_rls_fase2b_restantes.sql`

**Interfaces:**
- Consumes: `usuario_tem_acesso_loja(p_loja_id)`, `usuario_e_admin()`
  (ambas já existentes desde a Fase 2a).

**Pré-requisito**: Task 1 completa, aplicada, validada (os 4 casos
passaram) e commitada.

**O SQL completo**:

```sql
-- Fase 2b (2026-08-12), parte 2 -- ver docs/superpowers/specs/
-- 2026-08-12-rls-fase2b-tabelas-restantes-design.md. Aplicada só depois
-- de profiles (migration 113) validada isoladamente em produção.

alter table lojas enable row level security;
create policy lojas_select_por_loja on lojas for select using (
  usuario_tem_acesso_loja(id) or usuario_e_admin()
);

alter table permissoes enable row level security;
create policy permissoes_select_auth on permissoes for select using (
  role() = 'authenticated'
);

-- outbox e arquivos_mortos: RLS ligada, ZERO policy de SELECT --
-- bloqueio total intencional pra anon/authenticated. service_role
-- continua com acesso total (roles administrativas não são afetadas
-- por RLS).
alter table outbox enable row level security;
alter table arquivos_mortos enable row level security;
```

- [ ] **Step 1: Escrever o arquivo**

Crie `supabase/migrations/114_rls_fase2b_restantes.sql` com o SQL acima.

- [ ] **Step 2: Aplicar em produção via SSH**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec -i supabase-db psql -U supabase_admin -d postgres" < supabase/migrations/114_rls_fase2b_restantes.sql
```

Esperado: `ALTER TABLE`/`CREATE POLICY` (2 pares) + 2 `ALTER TABLE`
isolados, sem erro.

- [ ] **Step 3: Validar `lojas`** — usuário com 1 vínculo (Joao Henrique,
UUID `04a26215-9840-4328-a57d-c3be1be47849`, loja 6) vê só a própria
loja:

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec supabase-db psql -U supabase_admin -d postgres -c \"
set role authenticated;
set request.jwt.claims = '{\\\"sub\\\": \\\"04a26215-9840-4328-a57d-c3be1be47849\\\"}';
select id, nome_fantasia from lojas;
reset role;
\""
```

Esperado: só 1 linha, `id = 6`.

- [ ] **Step 4: Validar `permissoes`** — qualquer `authenticated` continua
vendo o catálogo inteiro:

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec supabase-db psql -U supabase_admin -d postgres -c \"
set role authenticated;
set request.jwt.claims = '{\\\"sub\\\": \\\"04a26215-9840-4328-a57d-c3be1be47849\\\"}';
select count(*) from permissoes;
reset role;
\""
```

Esperado: mesmo número de `select count(*) from permissoes;` rodado sem
`SET ROLE` (nenhuma linha a menos).

- [ ] **Step 5: Validar bloqueio total de `outbox`/`arquivos_mortos`**
(mesmo padrão de `SET ROLE` simples usado na Fase 0, sem JWT — RLS sem
policy nega tudo independente de quem está logado):

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec supabase-db psql -U supabase_admin -d postgres -c \"set role authenticated; select count(*) from outbox;\""
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec supabase-db psql -U supabase_admin -d postgres -c \"set role authenticated; select count(*) from arquivos_mortos;\""
```

Esperado: as duas devem falhar com `permission denied for table
outbox`/`arquivos_mortos`.

- [ ] **Step 6: Confirmar que `service_role` continua com acesso total
às 2 tabelas bloqueadas** (não deve ser afetado por RLS):

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec supabase-db psql -U supabase_admin -d postgres -c \"set role service_role; select count(*) from outbox;\""
```

Esperado: retorna um número (sem erro).

- [ ] **Step 7: Confirmar HTTP 200 do app**:

```bash
curl -s -o /dev/null -w "HTTP %{http_code}\n" https://app-estoque.norteparanegocios.com.br/login
```

Esperado: `HTTP 200`.

- [ ] **Step 8: Relatório final**

Resuma no relatório o resultado de cada step. Documente explicitamente
que os fluxos reais via navegador (tela `/usuario` — gestão de equipe —
e uma tela de transferência/inventário mostrando "quem fez") **não foram
testados nesta task** — sem acesso a navegador nesta sessão — e que o
controller deve oferecer ao usuário confirmar manualmente, dado que
foram exatamente os casos que motivaram a cláusula extra de `profiles`
na Task 1.

- [ ] **Step 9: Commit**

```bash
git add supabase/migrations/114_rls_fase2b_restantes.sql
git commit -m "fix: RLS em lojas/permissoes/outbox/arquivos_mortos (Fase 2b, conclui a contenção de RLS)"
```

---

## Execução

Ambas as tasks neste único repo, mesma sessão — oferecer execução via
`superpowers:subagent-driven-development`. **Dado o incidente da Fase
2a, o controller deve fazer TODOS os passos de aplicação/validação via
SSH diretamente (não delegar a subagente)** — mesmo padrão já usado nas
fases anteriores desta sessão, mas reforçado aqui: a Task 1 é
particularmente sensível (function nova, policy mais complexa) e merece
validação humana/controller cuidadosa antes de prosseguir.
