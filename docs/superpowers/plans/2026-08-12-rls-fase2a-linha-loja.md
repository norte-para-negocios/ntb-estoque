# RLS de linha (Fase 2a) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fechar o vazamento de leitura cross-loja — 34 tabelas hoje
deixam qualquer `authenticated` ler linhas de TODAS as lojas via
PostgREST, não só a própria. Aplica RLS de linha (filtro por
`loja_user`/Admin) nas 29 com `loja_id` direto, e corrige o mesmo bug nas
14 tabelas que já tinham RLS mas sem considerar Admin/super_admin.

**Architecture:** Uma única migration SQL, sem mudança de código
TypeScript. Duas partes: corrige as 14 policies existentes via `ALTER
POLICY` (troca só a expressão `USING`, sem `DROP`), e liga RLS + cria a
mesma policy nas 29 tabelas restantes. Ver spec completa:
`docs/superpowers/specs/2026-08-12-rls-fase2a-linha-loja-design.md`.

**Tech Stack:** Postgres self-hosted no Contabo (Supabase), sem alteração
de código Next.js/TypeScript nesta fase.

## Global Constraints

- Produção real, sem staging.
- Migration aplicada manualmente via SSH: `ssh -i
  ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec -i
  supabase-db psql -U supabase_admin -d postgres" < arquivo.sql`.
- **Nunca editar uma migration já aplicada** (109, 110) — esta é sempre
  uma migration NOVA (`111_rls_fase2a_linha_loja.sql`).
- **Nenhuma mudança de código TypeScript nesta fase** — é só SQL
  (RLS/policy). Nenhuma task deste plano toca arquivo `.ts`/`.tsx`.
- `cargo_permissao`/`cargos` são intencionalmente diferentes (catálogo
  global sem `loja_id`, policy hoje é `role() = 'authenticated'` sem
  filtro de linha) — **não devem ganhar a policy de `loja_id` por
  engano**, ficam como estão.
- Depois de aplicar, as 43 tabelas (14 corrigidas + 29 novas) devem
  responder de forma idêntica ao mesmo teste de JWT simulado — nenhuma
  assimetria entre "as antigas" e "as novas".
- Todas as 14 policies existentes já seguem a convenção de nome
  `<tabela>_select_por_loja` (confirmado hoje via SSH,
  `select tablename, policyname from pg_policies`) — as 29 novas usam a
  mesma convenção.

---

## Task 1: Migration — corrige as 14 policies + liga RLS nas 29 novas

**Files:**
- Create: `supabase/migrations/111_rls_fase2a_linha_loja.sql`

**Interfaces:**
- Consumes: nenhuma (SQL puro).
- Produces: nenhuma interface de código — a Task 2 depende do arquivo
  criado aqui já aplicado em produção.

**A policy padrão** (idêntica nas 43 tabelas ao final):

```sql
exists (
  select 1 from loja_user lu
  where lu.loja_id = <tabela>.loja_id and lu.user_id = auth.uid()
)
or exists (
  select 1 from profiles pr
  where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true)
)
```

**Parte A — corrige as 14 policies já existentes.** Usa `ALTER POLICY
... USING (...)`, que troca só a expressão da policy já existente, sem
precisar `DROP`/`CREATE` (não há janela onde a tabela fica sem policy
nenhuma). Os 14 nomes de policy já confirmados hoje via SSH — use
EXATAMENTE estes nomes, não invente:

```sql
-- Fase 2a (2026-08-12) -- ver docs/superpowers/specs/
-- 2026-08-12-rls-fase2a-linha-loja-design.md. Corrige um bug
-- pré-existente: a policy de SELECT destas 14 tabelas checava só
-- loja_user, sem considerar Admin global/super_admin -- contas com
-- perfil='Admin' ou is_super_admin=true e ZERO vínculos em loja_user
-- (ex: Claude QA) já ficavam sem acesso, silenciosamente (RLS nega sem
-- erro). ALTER POLICY troca só a expressão USING, sem janela sem policy.

alter policy etiqueta_config_select_por_loja on etiqueta_config using (
  exists (select 1 from loja_user lu where lu.loja_id = etiqueta_config.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter policy faturamento_import_meta_select_por_loja on faturamento_import_meta using (
  exists (select 1 from loja_user lu where lu.loja_id = faturamento_import_meta.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter policy faturamento_importado_select_por_loja on faturamento_importado using (
  exists (select 1 from loja_user lu where lu.loja_id = faturamento_importado.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter policy impressao_etiquetas_select_por_loja on impressao_etiquetas using (
  exists (select 1 from loja_user lu where lu.loja_id = impressao_etiquetas.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter policy margem_import_meta_select_por_loja on margem_import_meta using (
  exists (select 1 from loja_user lu where lu.loja_id = margem_import_meta.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter policy margem_importada_select_por_loja on margem_importada using (
  exists (select 1 from loja_user lu where lu.loja_id = margem_importada.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter policy margem_snapshot_diario_select_por_loja on margem_snapshot_diario using (
  exists (select 1 from loja_user lu where lu.loja_id = margem_snapshot_diario.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter policy movimentacao_import_meta_select_por_loja on movimentacao_import_meta using (
  exists (select 1 from loja_user lu where lu.loja_id = movimentacao_import_meta.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter policy movimentacao_importada_select_por_loja on movimentacao_importada using (
  exists (select 1 from loja_user lu where lu.loja_id = movimentacao_importada.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter policy movimentacao_operacao_select_por_loja on movimentacao_operacao using (
  exists (select 1 from loja_user lu where lu.loja_id = movimentacao_operacao.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter policy movimentacao_operacao_meta_select_por_loja on movimentacao_operacao_meta using (
  exists (select 1 from loja_user lu where lu.loja_id = movimentacao_operacao_meta.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter policy op_qtde_planejada_select_por_loja on op_qtde_planejada using (
  exists (select 1 from loja_user lu where lu.loja_id = op_qtde_planejada.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);
```

Isso são só 12 `ALTER POLICY` — confira contando: `etiqueta_config`,
`faturamento_import_meta`, `faturamento_importado`,
`impressao_etiquetas`, `margem_import_meta`, `margem_importada`,
`margem_snapshot_diario`, `movimentacao_import_meta`,
`movimentacao_importada`, `movimentacao_operacao`,
`movimentacao_operacao_meta`, `op_qtde_planejada` — **12, não 14**. As
outras 2 das "14 com RLS" são `cargo_permissao`/`cargos`, que usam um
padrão DIFERENTE de propósito (`role() = 'authenticated'`, catálogo
global sem `loja_id`) — **não entram nesta Parte A, não devem ser
tocadas**.

**Parte B — liga RLS + cria a policy nestas 29 tabelas** (todas com
`loja_id` direto confirmado):

```sql
alter table audit_log enable row level security;
create policy audit_log_select_por_loja on audit_log for select using (
  exists (select 1 from loja_user lu where lu.loja_id = audit_log.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter table categorias_contabeis enable row level security;
create policy categorias_contabeis_select_por_loja on categorias_contabeis for select using (
  exists (select 1 from loja_user lu where lu.loja_id = categorias_contabeis.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter table clientes enable row level security;
create policy clientes_select_por_loja on clientes for select using (
  exists (select 1 from loja_user lu where lu.loja_id = clientes.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter table contas_correntes enable row level security;
create policy contas_correntes_select_por_loja on contas_correntes for select using (
  exists (select 1 from loja_user lu where lu.loja_id = contas_correntes.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter table contas_pagar enable row level security;
create policy contas_pagar_select_por_loja on contas_pagar for select using (
  exists (select 1 from loja_user lu where lu.loja_id = contas_pagar.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter table contas_receber enable row level security;
create policy contas_receber_select_por_loja on contas_receber for select using (
  exists (select 1 from loja_user lu where lu.loja_id = contas_receber.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter table convites enable row level security;
create policy convites_select_por_loja on convites for select using (
  exists (select 1 from loja_user lu where lu.loja_id = convites.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter table familias enable row level security;
create policy familias_select_por_loja on familias for select using (
  exists (select 1 from loja_user lu where lu.loja_id = familias.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter table fornecedores enable row level security;
create policy fornecedores_select_por_loja on fornecedores for select using (
  exists (select 1 from loja_user lu where lu.loja_id = fornecedores.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter table integration_attempts enable row level security;
create policy integration_attempts_select_por_loja on integration_attempts for select using (
  exists (select 1 from loja_user lu where lu.loja_id = integration_attempts.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter table inventario_items enable row level security;
create policy inventario_items_select_por_loja on inventario_items for select using (
  exists (select 1 from loja_user lu where lu.loja_id = inventario_items.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter table inventarios enable row level security;
create policy inventarios_select_por_loja on inventarios for select using (
  exists (select 1 from loja_user lu where lu.loja_id = inventarios.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter table local_estoque_user enable row level security;
create policy local_estoque_user_select_por_loja on local_estoque_user for select using (
  exists (select 1 from loja_user lu where lu.loja_id = local_estoque_user.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter table local_estoques enable row level security;
create policy local_estoques_select_por_loja on local_estoques for select using (
  exists (select 1 from loja_user lu where lu.loja_id = local_estoques.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter table loja_user enable row level security;
create policy loja_user_select_por_loja on loja_user for select using (
  exists (select 1 from loja_user lu where lu.loja_id = loja_user.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter table movimentos enable row level security;
create policy movimentos_select_por_loja on movimentos for select using (
  exists (select 1 from loja_user lu where lu.loja_id = movimentos.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter table movimentos_historico enable row level security;
create policy movimentos_historico_select_por_loja on movimentos_historico for select using (
  exists (select 1 from loja_user lu where lu.loja_id = movimentos_historico.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter table nota_fiscal_items enable row level security;
create policy nota_fiscal_items_select_por_loja on nota_fiscal_items for select using (
  exists (select 1 from loja_user lu where lu.loja_id = nota_fiscal_items.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter table notas_fiscais enable row level security;
create policy notas_fiscais_select_por_loja on notas_fiscais for select using (
  exists (select 1 from loja_user lu where lu.loja_id = notas_fiscais.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter table ordens_producao enable row level security;
create policy ordens_producao_select_por_loja on ordens_producao for select using (
  exists (select 1 from loja_user lu where lu.loja_id = ordens_producao.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter table ordens_producao_teste enable row level security;
create policy ordens_producao_teste_select_por_loja on ordens_producao_teste for select using (
  exists (select 1 from loja_user lu where lu.loja_id = ordens_producao_teste.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter table permissao_user enable row level security;
create policy permissao_user_select_por_loja on permissao_user for select using (
  exists (select 1 from loja_user lu where lu.loja_id = permissao_user.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter table posicao_estoques enable row level security;
create policy posicao_estoques_select_por_loja on posicao_estoques for select using (
  exists (select 1 from loja_user lu where lu.loja_id = posicao_estoques.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter table previsao_venda enable row level security;
create policy previsao_venda_select_por_loja on previsao_venda for select using (
  exists (select 1 from loja_user lu where lu.loja_id = previsao_venda.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter table produto_preco_recente enable row level security;
create policy produto_preco_recente_select_por_loja on produto_preco_recente for select using (
  exists (select 1 from loja_user lu where lu.loja_id = produto_preco_recente.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter table produto_substituicoes enable row level security;
create policy produto_substituicoes_select_por_loja on produto_substituicoes for select using (
  exists (select 1 from loja_user lu where lu.loja_id = produto_substituicoes.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter table produtos enable row level security;
create policy produtos_select_por_loja on produtos for select using (
  exists (select 1 from loja_user lu where lu.loja_id = produtos.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter table transferencias enable row level security;
create policy transferencias_select_por_loja on transferencias for select using (
  exists (select 1 from loja_user lu where lu.loja_id = transferencias.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);

alter table webhooks enable row level security;
create policy webhooks_select_por_loja on webhooks for select using (
  exists (select 1 from loja_user lu where lu.loja_id = webhooks.loja_id and lu.user_id = auth.uid())
  or exists (select 1 from profiles pr where pr.id = auth.uid() and (pr.perfil = 'Admin' or pr.is_super_admin = true))
);
```

Conte as tabelas da Parte B antes de considerar terminado: devem ser
exatamente 29 `alter table ... enable row level security;` + 29 `create
policy`.

**Nota sobre `loja_user`**: repare que a própria tabela `loja_user`
aparece na Parte B com uma policy que faz `EXISTS (select 1 from
loja_user lu where ...)` — é uma self-reference (a tabela consulta a si
mesma dentro da própria policy). Isso é um padrão válido e comum em RLS
do Postgres/Supabase (não causa recursão infinita — o Postgres resolve a
subquery internamente sem reaplicar a policy em loop), mas SE ao aplicar
a migration aparecer qualquer erro de recursão, pare e reporte — não
tente contornar sozinho.

- [ ] **Step 1: Confirmar os 12 nomes de policy da Parte A via SSH**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec supabase-db psql -U supabase_admin -d postgres -c \"select tablename, policyname from pg_policies where schemaname='public' order by tablename\""
```

Compare contra os 12 nomes usados no SQL acima. Se algum nome divergir
(ex: schema mudou entre a escrita deste plano e a execução), corrija o
SQL antes de prosseguir — não aplique um `ALTER POLICY` com nome errado
(vai falhar com "policy does not exist", então o erro seria visível, mas
é melhor confirmar antes).

- [ ] **Step 2: Escrever o arquivo completo**

Crie `supabase/migrations/111_rls_fase2a_linha_loja.sql` com a Parte A
(12 `ALTER POLICY`) seguida da Parte B (29 pares `ALTER TABLE` + `CREATE
POLICY`), exatamente como os blocos SQL acima, colados em sequência num
arquivo só, com um comentário de cabeçalho explicando o propósito (pode
reusar o texto do comentário já dado acima na Parte A).

- [ ] **Step 3: Aplicar em produção via SSH**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec -i supabase-db psql -U supabase_admin -d postgres" < supabase/migrations/111_rls_fase2a_linha_loja.sql
```

Esperado: uma sequência de `ALTER POLICY` (12 vezes), seguida de pares
`ALTER TABLE`/`CREATE POLICY` (29 vezes cada), sem nenhum erro. Se
qualquer linha der erro, pare e reporte — não continue aplicando o resto
manualmente sem entender a causa.

- [ ] **Step 4: Confirmar que as 43 tabelas têm RLS ligada e exatamente 1 policy de SELECT cada**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec supabase-db psql -U supabase_admin -d postgres -c \"
select c.relname as tabela, c.relrowsecurity as rls_ligada, count(p.policyname) as num_policies
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
left join pg_policies p on p.tablename = c.relname and p.schemaname = 'public'
where n.nspname='public' and c.relkind='r'
  and c.relname not in ('lojas', 'profiles', 'permissoes', 'outbox', 'arquivos_mortos', 'cargo_permissao', 'cargos')
group by c.relname, c.relrowsecurity
order by rls_ligada, tabela;
\""
```

Esperado: todas as 43 linhas retornadas com `rls_ligada = t` e
`num_policies = 1`. Se alguma vier com `rls_ligada = f` ou
`num_policies != 1`, a migration não terminou de aplicar corretamente —
pare e reporte antes de prosseguir pra Task 2.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/111_rls_fase2a_linha_loja.sql
git commit -m "fix: RLS de linha nas 29 tabelas restantes + corrige bug de Admin nas 14 já existentes"
```

---

## Task 2: Validação em produção — 3 casos reais de JWT simulado

**Files:**
- Nenhum arquivo novo/modificado — task de validação pura.

**Interfaces:**
- Consumes: a migration aplicada e confirmada na Task 1.

**Contexto**: RLS baseada em `auth.uid()` não pode ser simulada com `SET
ROLE anon` simples (usado na Fase 0 pra testar grants) — precisa simular
o JWT real de uma sessão:

```sql
set role authenticated;
set request.jwt.claims = '{"sub": "<uuid-do-usuario>"}';
select ...;
reset role;
```

**3 usuários reais já confirmados hoje, use estes UUIDs exatos** (não
busque outros, não invente):

1. **Usuário com vínculo, deve ver só a própria loja**: `Joao Henrique da
   Silva Santos` (perfil `AdminLoja`, UUID
   `04a26215-9840-4328-a57d-c3be1be47849`), vinculado só à loja `6` (via
   `loja_user`). Não existe hoje em produção nenhum AdminLoja com 2+
   lojas vinculadas — este é o único caso real disponível pra "vê só as
   próprias lojas", cobrindo tanto usuário comum quanto AdminLoja (ambos
   caem na mesma cláusula `EXISTS (loja_user)` da policy).
2. **Super_admin SEM vínculo em `loja_user`, deve ver TUDO (valida a
   correção do bug)**: `Claude QA` (UUID
   `0c4e94fe-93be-4914-84b1-263efdbbb7f2`, `is_super_admin=true`, zero
   linhas em `loja_user`).
3. **Super_admin COM vínculo em todas as 6 lojas, deve continuar vendo
   TUDO (confirma que não houve regressão pra quem já funcionava)**:
   `Joaquim Salles` (UUID `e8f8c434-348e-42e7-9831-04e318aa8f33`).

- [ ] **Step 1: Confirmar que o usuário da loja 6 vê SÓ a loja 6 em `produtos`**

`produtos` tem dado real em múltiplas lojas (confirmado hoje: loja 6 =
2330 linhas, loja 3 = 2541, loja 5 = 2885 — números úteis pra comparar).

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec supabase-db psql -U supabase_admin -d postgres -c \"
set role authenticated;
set request.jwt.claims = '{\\\"sub\\\": \\\"04a26215-9840-4328-a57d-c3be1be47849\\\"}';
select loja_id, count(*) from produtos group by loja_id;
reset role;
\""
```

Esperado: só uma linha, `loja_id = 6`, `count = 2330` (ou o número atual
se tiver mudado desde a escrita deste plano — o importante é ser SÓ a
loja 6, nenhuma outra). Se vier mais de uma `loja_id`, ou vier vazio, a
policy está errada — pare e reporte.

- [ ] **Step 2: Confirmar que o Claude QA (super_admin sem vínculo) vê TODAS as lojas em `produtos`**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec supabase-db psql -U supabase_admin -d postgres -c \"
set role authenticated;
set request.jwt.claims = '{\\\"sub\\\": \\\"0c4e94fe-93be-4914-84b1-263efdbbb7f2\\\"}';
select loja_id, count(*) from produtos group by loja_id order by loja_id;
reset role;
\""
```

Esperado: TODAS as lojas ativas aparecem (mais de uma linha, cobrindo
pelo menos as lojas 2, 3, 4, 5, 6, 7 — confirme contra `select id from
lojas where ativo`). Isso é a prova direta de que o bug do Claude QA foi
corrigido — antes desta migration, essa mesma consulta retornaria vazio.

- [ ] **Step 3: Confirmar que o Joaquim (super_admin com vínculo total) continua vendo TUDO (sem regressão)**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec supabase-db psql -U supabase_admin -d postgres -c \"
set role authenticated;
set request.jwt.claims = '{\\\"sub\\\": \\\"e8f8c434-348e-42e7-9831-04e318aa8f33\\\"}';
select loja_id, count(*) from produtos group by loja_id order by loja_id;
reset role;
\""
```

Esperado: mesmo resultado do Step 2 (todas as lojas), confirmando que
quem já tinha acesso total continua tendo.

- [ ] **Step 4: Repetir o Step 1 (usuário com 1 loja) numa segunda tabela pra confirmar que a policy não é específica de `produtos`**

Escolha `movimentos` (uma das 29 novas, diferente de `produtos`):

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec supabase-db psql -U supabase_admin -d postgres -c \"
set role authenticated;
set request.jwt.claims = '{\\\"sub\\\": \\\"04a26215-9840-4328-a57d-c3be1be47849\\\"}';
select distinct loja_id from movimentos;
reset role;
\""
```

Esperado: só `loja_id = 6` (ou vazio, se essa loja não tiver
movimentos — nesse caso, é um resultado válido de "zero linhas", não um
erro; o importante é NÃO aparecer nenhuma outra `loja_id`).

- [ ] **Step 5: Repetir o Step 1 numa das 12 tabelas corrigidas na Parte A (confirma que a correção do bug funcionou igual nas antigas)**

Escolha `margem_snapshot_diario`:

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec supabase-db psql -U supabase_admin -d postgres -c \"
set role authenticated;
set request.jwt.claims = '{\\\"sub\\\": \\\"0c4e94fe-93be-4914-84b1-263efdbbb7f2\\\"}';
select count(*) from margem_snapshot_diario;
reset role;
\""
```

Esperado: um número maior que zero (Claude QA vendo dado de todas as
lojas nessa tabela que JÁ tinha RLS antes desta migration — antes da
correção, esse `count` retornaria 0).

- [ ] **Step 6: Relatório final**

Resuma no relatório: resultado de cada step (passou/falhou com os
números reais retornados). Documente explicitamente que os fluxos reais
via navegador (login como operador de uma loja específica, conferir
telas/relatórios normais) **não foram testados nesta task** — sem acesso
a navegador nesta sessão — e que o controller deve oferecer ao usuário
confirmar manualmente antes de considerar a Fase 2a 100% validada em uso
real (mesma ressalva já usada na Fase 0).

---

## Execução

Ambas as tasks neste único repo, mesma sessão — oferecer execução via
`superpowers:subagent-driven-development`.
