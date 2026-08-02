# Backfill de movimentos — 02/08/2026

Resolvido o item pendente do relatório de validação de 01/08 ("lacuna de
~1.585 movimentos vs. Supabase cloud" — a diff exata, feita linha a linha,
achou **2.989**, número maior que a estimativa por contagem total).

## O que foi feito

1. **Diff exato** entre Contabo (produção) e Supabase cloud por
   `(loja_id, id_ajuste)` — chave natural do índice único da tabela.
2. Achado colateral: **53 dessas linhas dependiam de 8 `transferencias`**
   (ids 550–557, lojas 2 e 6) que também não existiam em produção — a
   lacuna da migração afetou as duas tabelas, não só `movimentos`.
3. Verificado que os `user_id` dessas transferências existem em
   `profiles` (produção) antes de inserir — sem isso, o insert quebraria
   por FK.
4. **Dry-run** (transação com `rollback` no lugar de `commit`) confirmou
   que os 2.997 inserts (8 + 2.989) passavam sem erro antes de gravar de
   verdade.
5. Backfill real: `movimentos` foi de 215.235 → 218.224 linhas (+2.989
   exato). Sequence de `transferencias` reajustada pra não colidir com
   as próximas criadas pelo app.
6. **Confirmado zero lacuna** re-rodando o diff exato depois.
7. Confirmado que nenhuma duplicata foi introduzida (a pequena diferença
   entre `count(*)` e `count(distinct id_ajuste)` já existia antes, são
   linhas antigas com `id_ajuste` nulo, sem relação com o backfill).

## Por loja

| Loja | Movimentos recuperados |
|---|---:|
| 5 — Praia do Forte | 1.156 |
| 3 — Rio Vermelho | 888 |
| 6 — Brotas | 511 |
| 2 — Vilas do Atlântico | 434 |

## Achado não resolvido (fora de escopo deste backfill)

Durante a investigação, confirmei que o **Supabase cloud ainda recebe
escritas ativas** de origem não identificada (lotes de ~50 linhas,
terminaram por volta de 05:19 UTC de hoje). Investigado e descartado:
Vercel (sem projetos na conta), GitHub Actions (schedule desativado),
qualquer serviço/timer/processo no Contabo, workers do Laravel legado
(parados desde 31/07), `pg_cron`/`pg_net` (não instalados no cloud).

Não encontrei a origem. O usuário autorizou prosseguir com a
descomissão do cloud mesmo assim.
