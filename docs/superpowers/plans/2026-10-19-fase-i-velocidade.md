# Fase I — Velocidade (19/10/2026) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Medir de novo, achar a causa e entregar a correção (migration, código ou comando de servidor) de cada gasto grande do banco listado na Fase I, com antes × depois medido.

**Architecture:** Produção só é lida (`begin read only … rollback`, `set local role authenticated` + `request.jwt.claims` de usuário real da loja 5). Toda correção é provada numa cópia local (`ntb-teste-sql`, banco `fi` criado de `fb_base`) com volume sintético do tamanho de produção. Nada é aplicado em produção: o entregável é migration numerada (190+), código na branch e comandos prontos para o dono colar.

**Tech Stack:** Postgres 17 (Supabase self-hosted), PostgREST 14.12, Next (App Router, versão do repo), `node --test`, `tsc`.

**Spec:** `docs/superpowers/specs/2026-10-18-fase-i-velocidade-achados.md`

## Global Constraints

- Nunca: deploy, migration em produção, escrita em produção (banco, crontab, arquivos, containers), restart, chamada ao Omie, mexer em `/estoque/correcoes` ou `lib/correcoes/*`.
- Migrations a partir de **190** (187–189 reservadas). Índice novo em tabela grande = `create index concurrently`, arquivo sem transação.
- Migration que troca função do Supabase traz no topo a definição ORIGINAL completa para reverter.
- Testes SQL em `scripts/testes-sql/<nº>_*.sql`, rodados só no banco local `fi`.
- Antes de cada commit com código: `npx tsc --noEmit -p .` limpo e `node --test` dos testes tocados. TDD nas regras puras (módulo puro sem `@/`).
- Commits terminam com as linhas `Co-Authored-By`/`Claude-Session` do pedido.
- Tudo em PT-BR; nenhum segredo nos entregáveis.

## Achados do reconhecimento (19/10, 04:37–04:46 UTC) que mudam o plano

1. **A "recarga do esquema" não é a recarga.** As 34.938 execuções de 2 s do `WITH base_types AS` são de **um único `queryid`, no banco `ntb_vendas`, como `anon`**: é a consulta de funções da especificação OpenAPI que o PostgREST monta a cada `GET/HEAD /rest/v1/` — o ping de conectividade dos apps do Norte Vendas (`lib/offline/network.ts` e `pingRapido` em `lib/supabaseClient.ts` do Vendas). A recarga de esquema de verdade (outros dois `queryid`, como `authenticator`) rodou 115 vezes no Estoque e 61 no Vendas em 22 dias: ~19 s de banco no total. O gateway `gateway-vendas` já responde o ping sozinho desde 04/10 21:00 UTC (`/opt/ntb-vendas-infra/nginx-vendas.conf`, `location = /rest/v1/`). Falta medir o resíduo e de onde vem.
2. **`pgrst_ddl_watch`** só manda `NOTIFY` quando o DDL cria algo de fato: `CREATE TABLE IF NOT EXISTS` de partição que já existe não notifica. As ~40 chamadas por partição do realtime custam ~1 recarga por dia por banco. A migration 190 continua no escopo (pedido explícito), com o ganho medido real.
3. **Outbox:** o índice por `created_at` já existe (`outbox_created_at_idx_n`); a versão em lotes (`/root/outbox-poda-lotes.sh`) foi uma faxina avulsa de 02/10, não roda no cron. O `delete` de hora em hora da tabela atual (recriada em 02/10, `queryid` -8888295578778746708) faz **4,0 s em média, pico 20,6 s** (o 43 s/3,5 min do spec é da tabela antiga). **93 % das linhas da outbox (15,2 mil de 16,4 mil por hora) vêm de `faturamento_importado`**: `syncFaturamento` apaga e reinsere o mês atual e o anterior de todas as lojas a cada hora, e a tabela está no canal offline em modo `log` (cada linha vira versão nova para os desktops).

## Revisão independente (19/10) — corrigido

- C1: regra do esquema dentro dos gatilhos da 190 (sem `extensions.pgrst_deve_recarregar`); teste com papel sem USAGE em `extensions`.
- I1: folga da 193 a partir da execução anterior (`offline_meta.ultima_compactacao`).
- I2: 191 com `lock_timeout` 3 s + nova tentativa no ALTER/CREATE TRIGGER de `webhooks`.
- M1: carga da 191 por `->> is not null`; `indisvalid` conferido no fim da 191 e da 194.
- M2: `filtroInPostgrest` no apagar por rótulo do faturamento.

## Review Focus

- Sync de faturamento por diferença: mês que deixou de ter um rótulo precisa ter a linha APAGADA (senão o total fica maior que o real).
- Rótulo com caracteres especiais (`|`, aspas, acento) e valor que só muda na 2ª casa decimal: a comparação precisa ser pela mesma chave e pelo valor arredondado a 2 casas, igual ao gravado.
- Filtro do `pgrst_ddl_watch`: DDL em `public` (inclusive `CREATE FUNCTION`, `COMMENT`, `ALTER TABLE`) tem que continuar notificando; DDL em esquema não exposto não.
- Poda da outbox em lotes: parar quando um lote apaga 0; nunca apagar o que o `offline_compactar` ainda não leu (ids acima de `offline_meta.ultimo_outbox` − 5000).
- Índices novos não podem mudar resultado das telas (mesma contagem antes × depois no teste SQL).

---

### Task 1: Ping OpenAPI do Vendas e recarga do esquema (item 1)

**Files:**
- Create: `supabase/migrations/190_pgrst_ddl_watch_so_esquemas_expostos.sql`
- Create: `scripts/testes-sql/190_pgrst_ddl_watch.sql`

**Interfaces:**
- Produces: `extensions.pgrst_ddl_watch()` e `extensions.pgrst_drop_watch()` com o mesmo nome/assinatura (os gatilhos de evento não mudam).

- [ ] **Step 1: 3ª foto dos contadores** (`fi_foto.sql` no scratchpad) ≥ 45 min depois da de 04:46 UTC; calcular por hora: raiz OpenAPI do Vendas, recarga de esquema, `notify pgrst`, partições do realtime.
- [ ] **Step 2: Medir o custo da raiz OpenAPI localmente**: PostgREST 14.12 em Docker apontando para `fi` (role anon criada por `fb_base`), `HEAD /` com `openapi-mode` padrão × `PGRST_OPENAPI_MODE=disabled`, conferindo os cabeçalhos CORS da resposta e as linhas novas em `pg_stat_statements`.
- [ ] **Step 3: Teste SQL que falha** (`scripts/testes-sql/190_pgrst_ddl_watch.sql`). O `NOTIFY` não é observável de dentro de uma transação de psql, então a migration extrai a regra para `extensions.pgrst_deve_recarregar(p_schema text) returns boolean` (imutável) e o teste chama essa função: `public`→true, `graphql_public`→true, `realtime`/`storage`/`supabase_functions`/`pg_temp`/`pg_temp_3`/`auth`/`cron`/`net`/`extensions`→false, `null`→true (CREATE SCHEMA/objetos sem esquema), e um `CREATE TABLE public.t190` dentro de `begin; … rollback;` com o gatilho chamando a função sem erro.
- [ ] **Step 4: Rodar no `fi` e ver falhar** (função não existe).
- [ ] **Step 5: Migration 190**: topo com as duas funções originais (texto de produção de 19/10) para reverter; `pgrst_deve_recarregar` = esquema nulo ou em `('public','graphql_public')` ou esquema de `PGRST_DB_SCHEMAS` futuro via lista explícita no corpo (comentário diz para atualizar junto com o `docker-compose`); `pgrst_ddl_watch` passa a notificar só se `pgrst_deve_recarregar(cmd.schema_name)`; `pgrst_drop_watch` idem com `obj.schema_name` (e `obj.object_type='schema'` sempre notifica). Termina com `notify pgrst, 'reload schema'`.
- [ ] **Step 6: Rodar o teste e ver passar**; rodar a 190 duas vezes (idempotente).
- [ ] **Step 7: Commit** `perf(banco): pgrst_ddl_watch ignora esquemas que o PostgREST não expõe (migration 190)`.

### Task 2: Outbox — poda em lotes e fim da reescrita do faturamento (item 2)

**Files:**
- Create: `lib/omie/faturamento-diff.ts` (puro, sem `@/`)
- Create: `lib/omie/faturamento-diff.test.ts`
- Modify: `lib/omie/faturamento.ts` (bloco delete+insert do fim de `syncFaturamento`)
- Create: `scripts/outbox-podar-lotes.sh` (versionado; o crontab chama a cópia em `/opt/ntb-estoque/scripts/`)
- Create: `scripts/testes-sql/outbox_poda_lotes.sql`

**Interfaces:**
- Produces: `type LinhaFat = { dimensao: string; rotulo: string; mes: string; valor: number }`; `diffFaturamentoImportado(existentes: LinhaFat[], novos: LinhaFat[]): { inserir: LinhaFat[]; atualizar: LinhaFat[]; apagar: LinhaFat[] }` (chave = `JSON.stringify([dimensao, rotulo, mes])`, valor comparado arredondado a 2 casas).

- [ ] **Step 1: Teste que falha** `faturamento-diff.test.ts`: (a) iguais → tudo vazio; (b) valor 10.004 vs 10.00 → igual (arredonda); 10.00 → 10.01 → `atualizar`; (c) rótulo só nos existentes → `apagar`; (d) só nos novos → `inserir`; (e) rótulo `'JOHNNIE | BLACK'` e `'a"b'` não colidem com outro mês.
- [ ] **Step 2: `node --test lib/omie/faturamento-diff.test.ts`** → FAIL (módulo não existe).
- [ ] **Step 3: Implementar `diffFaturamentoImportado`.**
- [ ] **Step 4: Teste passa.**
- [ ] **Step 5: `syncFaturamento` grava por diferença**: lê as linhas existentes do mesmo escopo do delete atual (loja, 5 dimensões, `mes` entre `mesIniAno` e `mesFimAno`) paginando com `.order` pela chave completa; apaga as de `apagar` (lotes por `dimensao`+`mes` com `.in('rotulo', …)` de até 200), `upsert` (`onConflict: 'loja_id,dimensao,rotulo,mes'`, PK total, não parcial) de `inserir`+`atualizar` em lotes de 1000; erro de qualquer passo lança (igual hoje). `faturamento_import_meta` continua sendo gravado.
- [ ] **Step 6: `npx tsc --noEmit -p .` + teste** → limpos.
- [ ] **Step 7: Medir no `fi`**: `outbox` sintética com 380 mil linhas/24 h (perfil de produção: 93 % `faturamento_importado` 149 B, resto 800 B) e a poda atual × a poda em lotes de 5.000 por `id` (`delete … where id in (select id … where created_at < now()-'1 day' and id <= ultimo_outbox-5000 order by id limit 5000)`); e o volume/tempo depois do diff (≈ 1,2 mil linhas/h).
- [ ] **Step 8: `scripts/outbox-podar-lotes.sh`** + linha de crontab proposta (`flock`, para quando o lote volta 0, teto de 200 lotes, `vacuum` não — autovacuum já roda 98×).
- [ ] **Step 9: Commit** `perf(outbox): faturamento grava por diferença e poda da outbox em lotes`.

### Task 3: Consultas lentas das telas (item 3)

**Files:**
- Create: `supabase/migrations/191_indices_telas_fase_i.sql` (só se algum índice for necessário; sem transação)
- Create: `scripts/testes-sql/191_*.sql`
- Modify: o loader da tela que precisar de reescrita (decidido pela medição)

- [ ] **Step 1: Medir em produção** (só leitura, `set local role authenticated` + claims de um usuário da loja 5) as consultas reais do código: lista de `webhooks` (`app/(app)/webhooks` ou equivalente), lista de `ordens_producao` (filtros padrão da tela e com `?q=`), `relatorio_compras_matriz/total/dim/detalhe` (período padrão "Ano"), `offline_compactar()` (só `EXPLAIN` da parte de leitura) e a leitura de `movimentos` pelos crons de reenvio (`retryMovimentosManuaisPendentes`, `retryMovimentosTransferenciaPendentes`). `EXPLAIN (ANALYZE, BUFFERS)` de cada uma.
- [ ] **Step 2: Para cada uma, causa** (seq scan, RLS por linha, sort sem índice, função cara por linha).
- [ ] **Step 3: Cópia local com volume parecido** (`fi`: `webhooks` 165 mil, `ordens_producao` 130 mil na loja 5 / 440 mil no total, `movimentos` 410 mil, `nota_fiscal_items` 20 mil na loja 5), antes × depois de cada correção, mesma saída conferida por contagem/soma.
- [ ] **Step 4: Migration 191 + teste SQL** (se houver índice) e reescrita de código (se houver), `tsc` + testes.
- [ ] **Step 5: Commit** por correção.

### Task 4: Crons (item 4, se sobrar tempo)

- [ ] **Step 1:** Ler `/opt/ntb-estoque/sync-cron.log` (só leitura) e `scripts/sync-cron.sh`: tempo por endpoint por ciclo, endpoints que estouram o `-m 240`.
- [ ] **Step 2:** Contar chamadas ao Omie por loja por ciclo pelo código dos crons e por `integration_attempts` (só leitura), comparar com o limite (bloqueio na 10ª requisição com erro por IP+app_key+método).
- [ ] **Step 3:** Registrar no spec o que é proposta (sem código se não houver tempo).

### Task 5: Registro

- [ ] **Step 1:** Acrescentar a seção "Resultados 19/10" ao spec `docs/superpowers/specs/2026-10-18-fase-i-velocidade-achados.md` (tabela antes × depois com origem de cada número, migrations e como reverter, comandos de servidor).
- [ ] **Step 2:** Seção curta no `AGENTS.md` ("Fase I — velocidade"), só com o que muda para quem mexer depois (faturamento grava por diferença; ping do Vendas; poda da outbox).
- [ ] **Step 3:** Commit `docs(fase-i): resultados medidos e propostas de servidor`.
