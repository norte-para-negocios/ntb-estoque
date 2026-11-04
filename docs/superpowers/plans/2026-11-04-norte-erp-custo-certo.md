# Norte ERP — Custo certo (entrada pela data da nota + reprocessamento do CMC) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** o custo de cada baixa do estoque próprio passa a ser o custo real da época, mesmo quando a nota é conferida dias depois, e o CMV da ODARA de outubro e novembro passa a fechar com a realidade (hoje 0,7%; esperado ~19–24%).

**Architecture:** o ledger continua append-only. Uma tabela de revisões (`estoque_mov_revisao`) guarda, por movimento, a data efetiva, o custo unitário, o CMC e os saldos recalculados, com o motivo e o lote de reprocessamento. A visão `estoque_movimentos_efetivo` devolve cada movimento com a última revisão aplicada e é a única fonte de custo para relatórios (`lucro_proprio`, `vendas_proprio_cmv`, kardex, CMV). A função `reprocessar_custo(loja, produtos[], desde)` refaz a cadeia de CMC com as regras provadas do Omie (E9/E10/E12 de `~/Projects/omie-rea/regras/estoque-saldo-e-custo.md`) e propaga para os produtos feitos por OP. `lancar_compra` passa a gravar a entrada na data da nota e dispara o reprocessamento.

**Tech Stack:** Postgres 17 (plpgsql, security definer, dono `supabase_admin`), Next.js 16 server code, `node --test`.

**Spec:** auditoria `docs/auditoria/2026-11-norte-erp/03-auditoria-estrutural.md` §1 + diagnóstico de 04/11/2026 (resumo abaixo). Regras do Omie: `~/Projects/omie-rea/regras/estoque-saldo-e-custo.md` (E9, E10, E12, E13).

### Diagnóstico (ODARA, out/2026, prova em `scratchpad/q/base.sql`)
- 793 linhas de venda sem custo: 525 porque a nota chegou da SEFAZ no dia mas foi lançada em 02/11 (entrada vale na data do lançamento, sem retroação); 79 porque os 25 PIs nunca tiveram OP de pré-preparo; 189 produtos nunca comprados com aquele código.
- Mecanismo: OP da venda consome insumo com CMC 0 → prato sai com custo 0 (`custo_estimado`) → venda baixa com custo 0.
- CMC inflado em novembro (Coca Zero R$ 60,64 contra compra a R$ 3,79): a fórmula é a do Omie (E9 vale com S₀<0); o erro é o CMC herdado de uma entrada errada (fardo) cujo estorno não desfez o CMC, mais o saldo negativo criado pelas notas lançadas fora de ordem.

## Global Constraints
- Ledger append-only: nunca `UPDATE`/`DELETE` em `estoque_movimentos`. Correções só por `estoque_mov_revisao` (insert-only) e pela visão efetiva.
- Fórmulas do Omie, sem inventar: entrada `CMC₁ = (S₀·C₀ + q·vu)/(S₀+q)`, também com S₀<0 (E9); se `S₀+q = 0` ou resultado ≤ 0, `CMC₁ = vu` (E10); saída sai pelo CMC vigente e não o altera (E12). CMC por loja×produto (como hoje), 6 casas.
- Ordem da cadeia: `(data efetiva, id)`. Movimento e seu estorno (`reverses_id`) saem juntos da cadeia de CMC (o par não existe para o custo).
- Mês fechado (`estoque_periodo_fechado`) nunca é reprocessado: o reprocessamento começa no 1º dia após o último fechamento e avisa.
- Modo `omie` e `nenhum`: zero mudança. Nada chama o Omie.
- Migrations a partir de **311**; testadas em Postgres 17 local (Docker/colima) com cópia de esquema da produção e dados sintéticos; depois em produção dentro de `BEGIN … ROLLBACK` com números antes × depois; só então aplicadas. Backup antes.
- ODARA é loja aberta: aplicar e reprocessar só fora do horário (após 01:00).
- Commits em português com `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`; deploy manual de madrugada.

## Review Focus
1. **Nota lançada depois de vendas que já consumiram o produto** → as saídas entre a data da nota e hoje ganham o custo novo; o CMV do mês muda; o saldo e o CMC de hoje continuam iguais à soma do ledger. (Task 2/3)
2. **Prato feito por OP cujo insumo foi revisado** → o custo da entrada do prato na OP e das vendas dele mudam (cascata), sem laço infinito em receita com sub-receita. (Task 2)
3. **Entrada estornada (fardo errado)** → o par sai da cadeia e o CMC volta ao que seria sem ela. (Task 2)
4. **Mês fechado** → nada antes do fechamento muda; reprocessar pedido para antes dele começa no 1º dia aberto, com aviso (decisão de 04/11). (Task 2)
5. **Duas notas reprocessando o mesmo produto ao mesmo tempo** → sem corrida: trava por loja×produto (`pg_advisory_xact_lock`). (Task 2)
   Nota × OP ao mesmo tempo: `lancar_compra` trava os produtos da nota e da cascata em ordem de código antes de gravar (`_travar_custo_produtos`, mesma ordem de `produzir`); prova em `scripts/testes-sql/313_concorrencia.sh`.

---

### Task 1: revisões e visão efetiva (migration 311)
**Files:** Create `supabase/migrations/311_custo_revisao.sql`; Create `scripts/testes-sql/311_custo_revisao.sql`.
**Interfaces — Produces:**
- Tabela `estoque_mov_revisao (id bigserial pk, movimento_id bigint not null references estoque_movimentos(id), lote uuid not null, data_efetiva date not null, custo_unitario numeric(18,6), cmc_apos numeric(18,6), saldo_apos numeric(18,6), saldo_total_apos numeric(18,6), custo_estimado boolean not null, motivo text not null, criado_em timestamptz default now())`, índice `(movimento_id, id desc)`, RLS no padrão initplan da 156 (via join com o movimento → `loja_id`), insert só por função security definer, triggers que recusam UPDATE/DELETE/TRUNCATE.
- Visão `estoque_movimentos_efetivo` (security invoker): todas as colunas de `estoque_movimentos`, com `data_ref`, `custo_unitario`, `cmc_apos`, `saldo_apos`, `saldo_total_apos`, `custo_estimado` vindos da última revisão quando houver, mais `revisado boolean` e `custo_original numeric`.
- [ ] Teste SQL: movimento sem revisão aparece igual; com 2 revisões, vale a última; UPDATE/DELETE na revisão recusados; usuário `authenticated` de outra loja não vê.
- [ ] Commit.

### Task 2: `reprocessar_custo` (migration 312)
**Files:** Create `supabase/migrations/312_reprocessar_custo.sql`; Create `lib/estoque/reprocessar-custo-puro.ts` + `.test.ts` (espelho da regra em TS para testar casos e conferir a SQL); Create `scripts/testes-sql/312_reprocessar_custo.sql`.
**Interfaces — Produces:** `reprocessar_custo(p_loja bigint, p_produtos bigint[], p_desde date, p_motivo text) returns jsonb` → `{ lote, produtos, movimentos_revisados, desde_efetivo, cascata: [codigo_produto...], avisos: [...] }`. Security definer, `search_path = public`, só loja `modo_estoque = 'proprio'`.
- [ ] TS puro `refazerCadeia(movs: Mov[], inicial: {saldo, cmc}): Revisao[]` com testes: (a) entrada depois de saídas com S₀<0 aplica E9; (b) S₀+q=0 → CMC=vu (E10); (c) saída pelo CMC vigente (E12); (d) par movimento+estorno ignorado; (e) entrada de OP recebe custo = Σ consumos da mesma OP ÷ quantidade produzida; (f) movimento sem mudança não gera revisão.
- [ ] SQL com a mesma regra: estado inicial = último movimento efetivo antes de `desde` (ou zero); percorre `(data efetiva, id)`; grava revisão só onde custo/CMC/saldo mudam; ao fim regrava `estoque_custos.cmc/ultimo_custo/saldo_total` do produto (projeção). Cascata: produtos cujas OPs consumiram um produto revisado entram na fila (receita em DAG; limite de 20 níveis com aviso). Trava `pg_advisory_xact_lock(loja, produto)` em ordem de código. Mês fechado → `desde_efetivo` = dia seguinte ao fechamento + aviso.
- [ ] Conferir: depois do reprocessamento, `saldo_total` e `cmc` de `estoque_custos` = último efetivo da cadeia; soma das quantidades inalterada.
- [ ] Commit.

### Task 3: entrada na data da nota (migration 313) e gatilho do reprocessamento
**Files:** Create `supabase/migrations/313_compra_data_da_nota.sql`; Modify o chamador de `lancar_compra` (`lib/estoque/nf-sefaz.ts`, `lib/actions/nota-fiscal*.ts` — localizar) só se precisar passar a data.
- [ ] `lancar_compra`: data da entrada = data de entrada da nota (`dhSaiEnt` se houver, senão emissão), nunca futura, nunca antes do início do ledger da loja, nunca dentro de mês fechado (aí vale o 1º dia aberto, com aviso na compra). Partir da definição de produção (`pg_get_functiondef`), mudar só isso.
- [ ] Depois de lançar (e depois de `estornar_compra`), chamar `reprocessar_custo(loja, produtos_da_nota, data_da_entrada, 'compra <chave>')` na mesma transação.
- [ ] Teste SQL: nota de 09/10 lançada em 02/11 com vendas em 20/10 → venda de 20/10 ganha custo; CMC de hoje bate com o ledger.
- [ ] Commit.

### Task 4: OP com insumo sem custo usa o último custo conhecido (migration 314)
**Files:** Create `supabase/migrations/314_op_custo_fallback.sql`.
- [ ] Em `produzir`/`consumo_por_receita`: consumo de insumo com CMC 0 usa `estoque_custos.ultimo_custo` se > 0, marcando `custo_estimado = true`; sem nenhum custo, 0 + estimado (como hoje). A cascata da Task 2 corrige quando a compra chegar.
- [ ] Commit.

### Task 5: relatórios leem o custo efetivo
**Files:** Create `supabase/migrations/315_relatorios_custo_efetivo.sql` (recria `vendas_proprio_cmv` e `lucro_proprio` sobre `estoque_movimentos_efetivo`, a partir da definição de produção); Modify telas que leem `estoque_movimentos` para custo (kardex `/movimentacoes` do próprio, `/estoque/produto`, CMV) — trocar para a visão; mostrar "custo revisado em dd/mm" quando `revisado`.
- [ ] Teste: `lucro_proprio` com revisão devolve o custo novo; sem revisão, igual ao de hoje (comparar saída antes × depois na cópia).
- [ ] Commit.

### Task 6: reprocessar a ODARA (operação, com prova)
- [ ] Na cópia local e depois em produção com `BEGIN … ROLLBACK`: revisar as 47 entradas de outubro para a data da nota (motivo `entrada pela data da nota`), rodar `reprocessar_custo(15, todos, '2026-10-13', 'correcao custo outubro')`, medir CMV out/nov antes × depois, CMC de hoje × ledger, e a lista do que continua sem custo (PI sem OP, nunca comprado).
- [ ] Aplicar de madrugada; capturas do `/relatorio-cmv` out/nov; tabela antes × depois.
- [ ] Gerar para a equipe da ODARA a lista do que só gente resolve: 25 PIs sem OP de pré-preparo, de-paras (Cachaça 51 × Cabaré Ouro, Tônica Antarctica × Petra, camarões, batata), compras sem nota (açúcar, sal, vodkas, aperol, espumante, acarajé, abará, coco verde, kit praia, açaí).

### Task 7: revisão independente, regressão do modo Omie, AGENTS.md
- [ ] Revisor com contexto limpo; regressão: lojas Omie não leem a visão nova; `npm test`, `tsc`; atualizar `AGENTS.md` e o plano mestre (Fase 5, T5.2).
