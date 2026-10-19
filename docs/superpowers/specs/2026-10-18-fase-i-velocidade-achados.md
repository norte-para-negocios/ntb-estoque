# Fase I — Velocidade: achados (medição só leitura, 18/10/2026)

Fonte: `pg_stat_statements` do Postgres de produção (Contabo, `supabase-db`), acumulado desde 26/09/2026 20:59 UTC, e `EXPLAIN (ANALYZE)` em transação só leitura como usuário comum da loja 5 (`set local role authenticated` + `request.jwt.claims`). Nada foi alterado.

Cuidado ao ler: os contadores somam 22 dias e incluem código que já foi trocado (ex.: Movimentações completas em 13/10). Medir de novo pela diferença entre duas fotos antes de agir.

## 1. Recarga do esquema do PostgREST disparando sozinha (maior gasto do banco)

- A consulta de introspecção do PostgREST (`WITH base_types AS …`) rodou **35.240 vezes**, **2,06 s em média**: ~**72.000 s (20 h) de banco em 22 dias**, ~1 recarga por minuto somando as duas instâncias (`supabase-rest` do Estoque e `rest-vendas` do Vendas).
- Causa provável: o gatilho de evento `extensions.pgrst_ddl_watch` (do Supabase) manda `NOTIFY pgrst, 'reload schema'` em todo `CREATE TABLE`/`ALTER …` fora de `pg_temp` — inclusive em `realtime.messages_*`, que o serviço de tempo real (realtime) recria como partição várias vezes por dia (`CREATE TABLE IF NOT EXISTS realtime.messages_2026_10_16 PARTITION OF …`: ~40–50 chamadas por partição).
- Cada recarga também faz o PostgREST trocar o cache de esquema: requisições que chegam no meio esperam.
- Confirmar: duas fotos com 30–60 min de intervalo de `sum(calls)` de `%base_types AS%`, `CREATE TABLE IF NOT EXISTS realtime.messages%` e `notify pgrst%` (1ª foto: 20:26 UTC = 35.240 | 900 | 207).
- Correção candidata (precisa OK; mexe em função do Supabase): fazer `pgrst_ddl_watch` ignorar os esquemas que o PostgREST não expõe (`realtime`, `storage`, `supabase_functions`, …), ou desligar o canal de reload do `rest-vendas` se ele não precisa. Reversível (recriar a função original, salva antes).

## 2. Consultas lentas das telas (usuário logado)

| Média | Pico | Vezes | O quê | Situação |
|---|---|---|---|---|
| 1,9 s | 5,0 s | 6 | `saude_banco()` | tela de saúde do banco; pouco usada |
| 1,5 s | 6,6 s | 506 | `movimentos_historico` ordenado por data/saídas com LIMIT/OFFSET | **não existe mais no código atual** (aba antiga). Como admin: 8 ms; como usuário comum na página 21 (offset 20.000): 174 ms por página — paginação por OFFSET num ano inteiro fica quadrática |
| 0,7 s | 5,5 s | 96 | `webhooks` (tela de log) | ver índice por `loja_id, created_at` |
| 0,55–0,64 s | 2,3 s | ~460 | `relatorio_compras_*` | Fase A (176) muda essas funções; medir de novo depois |
| 0,35 s | 7,7 s | 1.381 | lista de `ordens_producao` | picos altos: investigar filtro/ordem + RLS |

Regra a seguir em tudo que for paginado: **chave (keyset) ou agregação no banco**, nunca OFFSET profundo em tabela de histórico.

## 3. Rotinas de fundo pesadas

| Média | Pico | Vezes | O quê |
|---|---|---|---|
| 43 s | 3,5 min | 123 | `delete from outbox where created_at < now() - interval '1 day'` (cron de hora em hora) — trocar por apagar em lotes por `id` (já existe uma versão em lotes rodando: 10,9 s em média) e índice por `created_at` |
| 248 ms | 4 s | 12.931 | `offline_compactar()` (cron de 1 min) |
| 108 ms | 2,4 s | 37.764 | leitura de `movimentos` pelos crons de reenvio (a cada 10 min) |

## Próximos passos (só leitura, depois proposta)

1. Segunda foto dos contadores para confirmar o item 1 (frequência real das recargas).
2. Medir tela por tela como usuário logado (precisa da senha da conta de QA `claude.qa@ntb-estoque.dev`).
3. Para cada item: plano de execução, causa e correção com antes × depois — tudo testado na cópia local antes de propor.

## Resultados 19/10 (branch `fase-i-velocidade`; nada aplicado em produção)

Medição em produção só leitura (`begin read only`, usuário comum da loja 5 por `set local role authenticated` + `request.jwt.claims`); provas na cópia local `fi` (container `ntb-teste-sql`) com volume de produção ou dados reais da loja 5 (`copy ... to stdout`).

### Fotos dos contadores (pg_stat_statements, acumulado desde 26/09)

| Contador | 18/10 20:26 | 19/10 04:46 | 19/10 19:02 | Por hora (04:46→19:02) |
|---|---|---|---|---|
| `WITH base_types` (todas) | 35.240 | 35.290 | 35.310 | 1,4 |
| raiz OpenAPI do Vendas (`anon`, banco `ntb_vendas`) | — | 34.938 | 34.938 | **0** |
| recarga de esquema de verdade (2 instâncias) | — | 176 | 186 | 0,7 |
| `CREATE TABLE IF NOT EXISTS realtime.messages…` | 900 | 905 | 950 | 3,2 |
| `notify pgrst` (manual, migrations) | 207 | 221 | 223 | 0,1 |

**Correção do item 1 do spec**: as 34.938 execuções de 2 s não eram recarga de esquema. Eram a especificação OpenAPI que o PostgREST do Vendas monta a cada `HEAD /rest/v1/` (o ping de conectividade dos apps do Norte Vendas). O `gateway-vendas` já responde esse ping sozinho desde 04/10 21:00 UTC (`location = /rest/v1/` em `/opt/ntb-vendas-infra/nginx-vendas.conf`) e o contador não mexeu em 14 h. Recarga de esquema de verdade: 176 em 22 dias, ~19 s de banco no total. Só o `CREATE` que cria uma partição de fato avisa o PostgREST (repetir o `IF NOT EXISTS` não avisa; teste 190).

### Antes × depois

| Item | Antes | Depois | Origem do número |
|---|---|---|---|
| Ping OpenAPI do Vendas | 2,06 s × 34.938 (~20 h de banco, 26/09–04/10) | 0 em 14 h (gateway, desde 04/10) | pg_stat_statements; local: `HEAD /` 0,9 s com OpenAPI × 1 ms com `PGRST_OPENAPI_MODE=disabled` (404 com CORS) |
| Recarga por DDL fora de `public` (190) | partição criada ou apagada no realtime recarrega as 2 instâncias | não recarrega; `public`/`graphql_public`/schema continuam | teste 190 (LISTEN ponta a ponta, 21 casos) |
| Outbox: linhas por dia | 362.070 (86 % `faturamento_importado`) | ~51 mil das outras tabelas + só as linhas de faturamento que mudaram de fato (estimativa: as outras tabelas somaram 51.117 em 24 h) | produção, últimas 24 h por tabela |
| Outbox: poda de hora em hora | 4,0 s em média (pico 20,6 s), 55 MB de WAL e 10 mil full-page images por execução (tabela atual, desde 02/10) | proporcional ao volume (−86 %); lotes de 5.000 que respeitam a folga do `offline_compactar` | pg_stat_statements (`wal_bytes`, `wal_fpi`); local: 16,4 mil linhas 3–12 ms num `delete` só × 98–445 ms em lotes (no local não há disputa de disco) |
| Histórico de status da nota (webhooks, 191) | 0,6 s + 0,2 s por nota (seq scan em 22 mil blocos, 1.524 mensagens filtradas em JS) | local: 215 ms → 0,9 ms (índice em `n_id_receb`); via PostgREST local 1,5–4 ms em 8 chamadas seguidas | produção EXPLAIN; local 165 mil webhooks |
| Lista de OPs (mês corrente) | 352 ms em média, pico 7,7 s (acumulado) | já 18 ms hoje (índice da 170 + RLS initplan da 156); 191 antecipa o autovacuum (64 mil linhas mortas, 7.711 entradas de índice para 4.900 linhas) | produção EXPLAIN |
| `relatorio_compras_total`/`_matriz`/`_dim` (192) | 3,1–3,5 s cada (a tela chama 5 em paralelo) | 1,7–1,9 s cada | produção, corpo novo rodado como SELECT só leitura; 0 diferenças em 69.232 itens; local 600 → 390 ms |
| `custo_estoque_item_omie` (192) | 85 µs por item (função não embutível) | embutida: 1,71 → 0,75 s nos 20.432 itens da loja 5 | produção, só leitura |
| `offline_compactar()` (193) | 245 ms em média por minuto (leitura de ~5.000 linhas: 141 ms) | local, passada sem novidade: 27 ms → 1,5 ms | produção EXPLAIN da leitura; local 400 mil linhas |
| Leitura de `movimentos` pelos reenvios (194) | 96–106 ms, ~11,4 mil blocos por chamada (~6 mil s desde 26/09) | local 6.869 → 13 blocos, 15 ms → 0,01 ms | pg_stat_statements; local 414 mil linhas |
| Checagem de duplicado do webhook | 14 ms em média (acumulado, antes do índice manual) | 0,08 ms (índice `idx_webhooks_loja_message`, criado à mão; a 191 o versiona) | produção EXPLAIN |

### Crons (item 4, só leitura de `/opt/ntb-estoque/sync-cron.log` e `integration_attempts`)

- Ciclo de 10 min: mediana 346 s, máximo 586 s (18/10 22:22 → 19/10 19:00, 121 ciclos). Com o `flock -n`, um ciclo que passa de 600 s faz o próximo ser pulado.
- `retry-ajustes-movimentos` é metade do ciclo: mediana 189 s; 57 de 121 ciclos estouraram o `-m 240` (`000ERR`) e 44 voltaram 502. A loja 4 tem 451 SAI em "Sem CMC" (87 já no teto de 20 tentativas) e o disjuntor recusa a maior parte das chamadas ("API do Omie bloqueada para esta loja por consumo indevido", 557 erros de `Movimento` em 24 h). Essas recusas são locais e não chegam ao Omie.
- Outros pesados: `sync-faturamento` mediana 139 s (1×/hora), `sync-posicao` 58 s, `sync-produtos` 41 s, `sync-ops` 33 s.
- Loja 7 (chave suspensa desde 15/10): 415 tentativas em 24 h, todas com erro, e 16 bloqueios reais do Omie (`[BLOQUEIO OMIE] ListarAjusteEstoque` 6, `ListarPosEstoque` 5, `ListarOrdemProducao` 3, `ListarRecebimentos` 2). Proposta (decisão do dono): tirar a loja 7 dos crons (`lojas.ativo` ou flag) até a chave voltar, e deixar o disjuntor do 18a6ff0 tratar erro de chave como bloqueio da loja inteira.
- Proposta: `retry-ajustes-movimentos` numa linha própria do crontab (com `flock` próprio), fora do ciclo principal, para que o reenvio travado da loja 4 não atrase `sync-nfs`/`sync-ops`/`sync-posicao`.

### Achados sem correção nesta fase

- `/api/cron/prune` (webhooks > 7 dias, integration_attempts) não está no `sync-cron.sh` local nem no do servidor: webhooks desde 03/09 (137 mil > 7 dias) e integration_attempts com 215 mil linhas. Ligar só depois da 191, para o histórico da nota não depender disso. Cada `delete` gera linha na outbox (gatilho em todas as 77 tabelas; webhooks/integration_attempts/audit_log não estão no canal offline, então essas linhas são puro desperdício).
- `lojas` recebe ~190 UPDATE/h e `produtos` ~735/h com mudança real (alguma coluna de controle da sync). Cada um vai inteiro para os desktops pela outbox.
- `wal_compression` está `off`. `alter system set wal_compression = 'lz4'` + `select pg_reload_conf()` (sem restart) reduziria as full-page images da poda e das syncs. É mudança de servidor, precisa de OK.
- Compras ainda gasta ~1,7 s por RPC: a leitura dos itens com os filtros no `full_object` custa ~0,5 s e o custo embutido ~0,75 s. O próximo passo seria gravar `valor_estoque` (e CFOP/local de entrada) em colunas na entrada da nota.
