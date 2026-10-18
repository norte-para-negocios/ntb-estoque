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
