# Auditoria dos Relatórios Restantes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-audit the 9 remaining reports (everything except Margem, Pendências de Classificação, and the Resumo Operacional NF card, already fixed 2026-07-22) against 4 known bug patterns, and fix whatever is found — matching the standard this session already established for Compras/Auditoria Fiscal/Margem/Pendências.

**Architecture:** This is investigation-driven, not a pre-specified feature build — each task's implementer runs a fixed set of grep/SQL checks against ONE report's files, and only touches code where a check actually finds the pattern. No task should invent a fix for something the checks don't confirm.

**Tech Stack:** Next.js Server Components/route handlers, Supabase/PostgREST filters, direct SQL cross-validation via `node scripts/db.mjs "<query>"` (no test framework exists in this repo).

## Global Constraints

- **The 4 patterns to check in every report, in this exact order:**
  1. **NF cancelada contada indevidamente**: any query reading `notas_fiscais`/`nota_fiscal_items` for a TOTAL/COUNT/LIST that a user would expect to reflect real, valid purchases/sales must exclude cancelled NFs. Check: does the query filter `c_etapa = '60'`? If yes, does it ALSO apply `NAO_CANCELADA_OR` from `@/lib/nf-status` (or an equivalent JSONB check on `full_object->infoCadastro->>cCancelada`)? A query that checks `c_etapa` but not `cCancelada` is the bug (see reference fix below).
  2. **Produto inativo contado indevidamente**: any query reading `produtos` for a "needs attention"/count/list that implies a product still needs action (classification, restocking, review) must exclude `inativo = true` rows, UNLESS the report is explicitly a full catalog/audit view where showing inactive products is the whole point (e.g., a "Produtos" catalog page with its own explicit ativo/inativo filter toggle — that's correct as-is, don't touch it). Check: does the query select from `produtos` without `.eq('inativo', false)`, in a context implying "this needs fixing"?
  3. **Filtro quebrado ou sem efeito real**: for each filter field the report's `FiltrosGaveta`/`campos` array exposes, confirm the corresponding query actually applies it (no filter that's defined in the UI but silently ignored in the query, and no filter whose value never reaches the query due to a naming mismatch between the URL param and what the query reads).
  4. **Dado importado manualmente sem checagem de atraso**: if the report reads from a manually-uploaded/imported table (comparable to `margem_importada`), confirm there's a freshness check (does it fall back to a live/computed source, or at least warn the user, when the import is older than expected?) — most of these 9 reports do NOT have a manual-import step at all (only Margem did), so this check will usually be "N/A, confirm and move on," not a fix.

- **Reference fix for pattern 1** (already applied and verified in this session — copy this exact shape when pattern 1 is found):
  ```typescript
  import { NAO_CANCELADA_OR } from '@/lib/nf-status'
  // ...
  query = query.eq('c_etapa', '60').or(NAO_CANCELADA_OR)
  ```
  (`NAO_CANCELADA_OR` is a null-safe PostgREST OR-fragment; never use a bare `.neq('full_object->infoCadastro->>cCancelada', 'S')`, which wrongly excludes rows where that JSONB path is simply absent.)

- **Reference fix for pattern 2** (already applied in `app/(app)/pendencias-classificacao/page.tsx` and `lib/resumo-dia.ts` this session):
  ```typescript
  // Add to any produtos query whose result implies "this needs attention":
  .eq('inativo', false)
  // Or, if filtering an already-fetched in-memory array:
  .filter((p) => !p.inativo)
  ```

- **No automated test runner exists.** Verification bar for every task: `npx tsc --noEmit`, a real SQL cross-check via `node scripts/db.mjs "<query>"` comparing before/after counts for at least one real loja (2, 3, 4, 5, or 6 — never loja 7, inactive/test-only), and a Playwright check against a local dev server logged in as `claude.qa@ntb-estoque.dev` / `claudeqa123456` (reset `profiles.current_loja_id` back to `3` for that account when done, via `node scripts/db.mjs "update profiles set current_loja_id=3 where id='0c4e94fe-93be-4914-84b1-263efdbbb7f2'"`).
- Every commit that changes a rendered page/route must be deployed to Contabo afterward: `ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "cd /opt/ntb-estoque && bash deploy.sh"`.
- **No fix without a real, reproduced finding.** If a task's checks find nothing wrong for a given pattern, say so explicitly in the report and move to the next pattern — do not invent a defensive change "just in case."
- **Pattern 3 reforçado (2026-07-22, feedback direto do usuário): "confirmar que o filtro alcança a query" via grep NÃO é suficiente.** Pra cada filtro/dropdown de categoria do relatório (tipo, família, local, fornecedor, situação, período, etc.), o implementador tem que EXECUTAR o relatório de verdade com pelo menos 2 valores diferentes desse filtro (via Playwright contra o dev server, ou uma chamada autenticada equivalente) e confirmar que o resultado (total, contagem de linhas, ou os itens listados) REALMENTE muda entre um valor e outro — não basta ler o código e concluir "parece que aplica". Se o relatório tem uma categoria (ex.: "tipo de mercadoria", "situação") que sempre existiu mas nunca foi de fato testada com um valor real, esse é exatamente o tipo de achado que essa reforço existe pra pegar. Documentar no relatório da tarefa: qual filtro, quais 2 valores testados, qual foi a diferença real observada (números, não "parece ok").
- **Scope discipline**: if a check reveals something bigger than a query-filter fix (e.g., an entire missing feature, like the malha/BOM consumption gap already found and deferred in `/movimentacoes`), do NOT attempt to build it — report it as a finding for the controller to triage, exactly like the already-documented malha gap.

---

### Task 1: Faturamento (`app/(app)/relatorio-faturamento/`)

**Files to investigate:** `app/(app)/relatorio-faturamento/page.tsx`, `app/(app)/relatorio-faturamento/export/route.ts`, `app/(app)/relatorio-faturamento/importar/route.ts` (if it exists — this report has its OWN import step, check if it's the same "manual import" concept as Margem's FAT_DRV).

**Interfaces:**
- Consumes: `NAO_CANCELADA_OR` from `@/lib/nf-status` if pattern 1 applies (Faturamento reads `fat_cupons`/`faturamento_importado`, NOT `notas_fiscais` directly — confirm whether "cancelada"/"devolvido" has an equivalent concept in THIS table before assuming the same fix applies verbatim; per AGENTS.md, `fat_cupons` already tracks its own `cancelado`/`devolvido` fields — check whether queries here already filter those correctly, since this may already be handled, unlike the `notas_fiscais`-based reports).

- [ ] **Step 1: Investigate pattern 1 (cancelled awareness)**

This report's data model is DIFFERENT from the NF-based reports (it reads `faturamento_importado` and `fat_cupons`/`fat_cupom_itens`/`fat_cupom_pagamentos`, not `notas_fiscais` — per AGENTS.md's "Fato de faturamento por cupom" section). Read that AGENTS.md section first. Run:
```bash
grep -n "cancelado\|devolvido" app/"(app)"/relatorio-faturamento/page.tsx lib/faturamento-frio.ts lib/omie/faturamento.ts
```
Confirm: does every place that sums/counts cupons correctly exclude `cancelado=true`/`devolvido=true` (if those concepts apply to what's being shown), or is this dimension not applicable here at all? Document what you find — do not assume it needs the NF-based fix, this table's schema is different.

- [ ] **Step 2: Investigate pattern 2 (inactive products)**

```bash
grep -n "from('produtos')\|\.eq('inativo'" app/"(app)"/relatorio-faturamento/page.tsx app/"(app)"/relatorio-faturamento/export/route.ts
```
Faturamento is about sales that already happened — a product being inactive TODAY doesn't retroactively make a past sale wrong, so this pattern likely does NOT apply here as a "needs fixing" case. Confirm this reasoning holds by checking whether any list on this page implies "products needing attention" (unlikely) vs. just historical sales data (expected, not a bug).

- [ ] **Step 3: Investigate pattern 3 (broken filters)**

List every `campos`/`FiltrosGaveta` field defined in `page.tsx`, then for each one, confirm the corresponding `searchParams` value actually reaches the query/RPC call. Report any filter that's declared in the UI but never actually applied.

- [ ] **Step 4: Investigate pattern 4 (manual import staleness)**

Check `app/(app)/relatorio-faturamento/importar/route.ts` — is this analogous to Margem's FAT_DRV manual upload? If Faturamento genuinely has no live-calculation fallback (unlike Margem), does the UI at least show clearly when the last import happened, and is there a real risk of staleness like Margem had? If you find the same "stuck on an old import with no staleness warning" pattern, this is a bigger architectural fix (there's no live-calc equivalent readily available for Faturamento — don't attempt to build one) — report it as a finding rather than fixing it blind.

- [ ] **Step 5: Fix whatever pattern 1-3 checks found** (using the reference fix shapes in Global Constraints, adapted to this report's actual query structure). Skip fixing pattern 4 findings — report only.

- [ ] **Step 6: Typecheck, SQL cross-check, Playwright check, commit**

Run `npx tsc --noEmit 2>&1 | tail -30`. For each fix made, write and run a `node scripts/db.mjs "..."` query proving the before/after difference for one real loja. Then a Playwright check against local dev confirming the page renders correctly logged in as the QA account. Commit with a message describing exactly which of the 4 patterns were found and fixed (and which were checked and found clean).

---

### Task 2: Compras (`app/(app)/relatorio-compras/`)

**Files to investigate:** `app/(app)/relatorio-compras/page.tsx`, `app/(app)/relatorio-compras/export/route.ts`, `app/(app)/relatorio-compras/export-completo/`, `supabase/migrations/083_compras_apenas_concluidas.sql`, `lib/relatorio-frio-nf.ts` (`filtrarItensCompras`).

**Context:** Pattern 1 (cancelled NF) was ALREADY fixed here on 2026-07-20 (migration 083 + `filtrarItensCompras`) — this task re-confirms it's still correct and checks patterns 2-4, which were NOT part of that earlier fix.

- [ ] **Step 1: Re-confirm pattern 1 is still correctly handled** (should be — just grep to confirm, don't re-fix):
```bash
grep -n "c_etapa\|cCancelada\|NAO_CANCELADA_OR" supabase/migrations/083_compras_apenas_concluidas.sql lib/relatorio-frio-nf.ts
```

- [ ] **Step 2: Investigate pattern 2 (inactive products)**

Compras filters by `p.tipo_item`/`p.descricao_familia` via a `left join produtos p` in the RPC (migrations 075/077/083). Check: does an inactive product's past purchase get hidden from the report just because it's inactive NOW? Likely this is fine (a purchase is a purchase regardless of current product status — same reasoning as Faturamento Step 2), but confirm there's no separate "needs attention" list on this page (unlike Pendências) that would need the exclusion. If this report is purely "here's what was purchased," pattern 2 doesn't apply — document that finding.

- [ ] **Step 3: Investigate pattern 3 (broken filters)** — same method as Task 1 Step 3, applied to `app/(app)/relatorio-compras/page.tsx`'s filter fields (produto, família, tipo, fornecedor, cfop, local — check each one's URL param actually reaches `relatorio_compras_*` RPC calls with the right parameter name).

- [ ] **Step 4: Investigate pattern 4** — Compras has no manual import step (data comes from NF sync). Confirm and mark N/A.

- [ ] **Step 5: Fix any pattern 3 findings** (patterns 1-2 expected clean per Steps 1-2's reasoning — do not fix unless a real gap is found).

- [ ] **Step 6: Typecheck, SQL cross-check (if anything was fixed), Playwright check, commit.**

---

### Task 3: Auditoria Fiscal (`app/(app)/auditoria-fiscal/`)

**Files to investigate:** `app/(app)/auditoria-fiscal/page.tsx`, `app/(app)/auditoria-fiscal/export/`, migrations 076/078/081.

**Context:** Pattern 1 was ALREADY correct here before this session even started (migrations 076/078/081 already filter `c_etapa='60' AND not cancelled` — this was the reference implementation Compras/NF-status copied from). Re-confirm, then check patterns 2-4.

- [ ] **Step 1: Re-confirm pattern 1** (should already be correct):
```bash
grep -n "c_etapa\|cCancelada" supabase/migrations/076_auditoria_fiscal_produto_familia_local.sql supabase/migrations/078_auditoria_sentinela_sem.sql supabase/migrations/081_auditoria_fiscal_icms_creditado.sql lib/relatorio-frio-nf.ts
```

- [ ] **Step 2: Investigate pattern 2** — same reasoning as Compras Task 2 Step 2 (a fiscal audit of past NF items shouldn't hide entries just because the product is inactive today — likely N/A, confirm).

- [ ] **Step 3: Investigate pattern 3 (broken filters)** — check every filter field in `auditoria-fiscal/page.tsx` against the RPC calls, same method as prior tasks.

- [ ] **Step 4: Investigate pattern 4** — no manual import here. Mark N/A.

- [ ] **Step 5: Fix any pattern 3 findings only.**

- [ ] **Step 6: Typecheck, SQL cross-check (if fixed), Playwright check, commit.**

---

### Task 4: Estoque Valorizado (`app/(app)/relatorio-estoque-valorizado/`)

**Files to investigate:** `app/(app)/relatorio-estoque-valorizado/page.tsx`, RPC `relatorio_estoque_valorizado` (migration 082 for the CMC-weighting fix already applied 2026-07-19).

**Context:** This report is about CURRENT stock value — pattern 2 (inactive products) is directly relevant here, unlike the historical-NF reports: an inactive product sitting with stock still shows up, which might be correct (you'd still want to know you have inventory of a discontinued item) OR might be noise depending on what "inativo" means in this business's workflow. Investigate carefully, don't assume either way.

- [ ] **Step 1: Investigate pattern 2 carefully**
```bash
grep -n "from('produtos')\|inativo\|tipo_item" "app/(app)/relatorio-estoque-valorizado/page.tsx"
node scripts/db.mjs "select count(*) from produtos p join posicao_estoques pe on pe.n_cod_prod=p.codigo_produto and pe.loja_id=p.loja_id where p.loja_id=3 and p.inativo=true and pe.n_saldo>0"
```
If there are inactive products with real positive stock showing in this report: this is likely CORRECT behavior (you want to know about stock of discontinued items, e.g. to sell it off or write it down) rather than a bug — do not filter it out without being sure. If in doubt, report the finding with the count and let the controller decide; do not unilaterally hide inactive-product stock from a valorization report (this is different from Pendências, where the product just needing classification work is what's inappropriate for inactive items — having stock value is a fact, not a to-do).

- [ ] **Step 2: Pattern 1 (cancelled NF)** — this report doesn't read `notas_fiscais` (it's a snapshot of `posicao_estoques`, not a period-based NF aggregation) — confirm via:
```bash
grep -n "notas_fiscais\|nota_fiscal_items" "app/(app)/relatorio-estoque-valorizado/page.tsx"
```
Expect no matches; mark N/A if so.

- [ ] **Step 3: Investigate pattern 3 (broken filters)** on this page's filter fields (família, tipo, local, busca).

- [ ] **Step 4: Pattern 4** — no manual import. Mark N/A.

- [ ] **Step 5: Fix only confirmed pattern 3 findings** (do not touch pattern 2 without explicit confirmation it's actually wrong — see Step 1's caution).

- [ ] **Step 6: Typecheck, SQL cross-check (if fixed), Playwright check, commit.**

---

### Task 5: Movimentação — relatório (`app/(app)/relatorio-movimentacao/`)

**Files to investigate:** `app/(app)/relatorio-movimentacao/page.tsx`, `app/(app)/relatorio-movimentacao/export/route.ts`, `lib/movimentacao-operacao-auto.ts`.

**Context:** This report has 2 modes ("Em quantidade" native RPC, "Por operação" JS-aggregated) — check both. It reads `movimentos`/`movimentos_historico`, not `notas_fiscais` directly, so pattern 1 likely doesn't apply the same way, but the "Por operação" mode DOES aggregate NF items internally (per `lib/movimentacao-operacao-auto.ts`) — check that path specifically.

- [ ] **Step 1: Investigate pattern 1** in the "Por operação" mode specifically:
```bash
grep -n "nota_fiscal_items\|c_etapa\|cCancelada" lib/movimentacao-operacao-auto.ts
```
If this mode aggregates NF items without checking cancellation, that's a real finding — same reference fix pattern applies (filter before aggregation, matching how the produto-search filter was already threaded through this same file's item loop on 2026-07-20).

- [ ] **Step 2: Investigate pattern 2** — check both `produtos` queries in this file/page for `inativo` exclusion where the report implies "these products moved" (a movement of an inactive product is a historical fact, similar reasoning to Compras — likely N/A unless there's a "needs attention" framing; confirm).

- [ ] **Step 3: Investigate pattern 3 (broken filters)** — this report's filters (produto, tipo, família, local, período, sentido) were partially fixed already this session (produto search added to both modes 2026-07-20) — confirm ALL filters still work in BOTH modes now, not just produto.

- [ ] **Step 4: Pattern 4** — no manual import. Mark N/A.

- [ ] **Step 5: Fix confirmed findings from steps 1-3.**

- [ ] **Step 6: Typecheck, SQL cross-check, Playwright check (test BOTH modes), commit.**

---

### Task 6: Movimentações — operacional (`app/(app)/movimentacoes/`)

**Files to investigate:** `app/(app)/movimentacoes/page.tsx`, `components/movimentacoes/HistoricoTab.tsx`, `components/movimentacoes/MovimentosTab.tsx`.

**Context:** Already partially investigated 2026-07-22 (the malha/BOM consumption gap was found and explicitly deferred — do NOT attempt to build that here, it's tracked separately in memory). This task covers the OTHER 3 patterns only, since pattern-1-adjacent investigation already happened.

- [ ] **Step 1: Investigate pattern 1** in `MovimentosTab.tsx`'s `nfItems`/`entLines` construction (the NF-based "SAI" reconstruction lines):
```bash
grep -n "nota_fiscal_items\|c_etapa\|cCancelada" components/movimentacoes/MovimentosTab.tsx
```

- [ ] **Step 2: Investigate pattern 2** in both `HistoricoTab.tsx` and `MovimentosTab.tsx`'s `produtos` queries (both files query `produtos` for tipo/família filtering — check if inactive products should be excluded from the underlying movement data, or if — like Estoque Valorizado — a historical movement of a now-inactive product is a legitimate fact to show, not a bug).

- [ ] **Step 3: Investigate pattern 3 (broken filters)** across BOTH tabs (Histórico has data/produto/tipo/família/local; Movimentos has data/local/família/tipo) — confirm every one actually filters.

- [ ] **Step 4: Pattern 4** — no manual import. Mark N/A.

- [ ] **Step 5: Fix confirmed findings only.**

- [ ] **Step 6: Typecheck, SQL cross-check, Playwright check (both tabs), commit.**

---

### Task 7: Transferências (`app/(app)/transferencia/`)

**Files to investigate:** `app/(app)/transferencia/page.tsx`, `app/(app)/transferencia/export/route.ts`, `app/(app)/transferencia/relatorio/`.

**IMPORTANT:** `app/(app)/transferencia/page.tsx` is currently modified UNCOMMITTED by another concurrent session (per this session's established convention: check `git status` before touching this file — if it's dirty in the working tree, read the CURRENT committed version via `git show HEAD:"app/(app)/transferencia/page.tsx"` to know what you're actually working from, since a fresh git worktree branching from origin/main will already only see the committed version and won't be affected by the other session's uncommitted changes — this is exactly why this plan's execution should happen in an isolated worktree, per the controller's standard practice this session.)

- [ ] **Step 1: Investigate pattern 1** — transferências likely don't reference `notas_fiscais` at all (internal stock moves between locations, not NF-based). Confirm via grep; expect N/A.

- [ ] **Step 2: Investigate pattern 2** — check `produtos` queries for inativo exclusion where relevant (e.g., filter dropdowns showing "which products can be transferred" should probably exclude inactive ones; a past transfer record showing an inactive product's name is fine/historical).

- [ ] **Step 3: Investigate pattern 3 (broken filters)** on this report's filter fields.

- [ ] **Step 4: Pattern 4** — no manual import. Mark N/A.

- [ ] **Step 5: Fix confirmed findings only.**

- [ ] **Step 6: Typecheck, SQL cross-check, Playwright check, commit.**

---

### Task 8: Inventários (`app/(app)/inventario/`)

**Files to investigate:** `app/(app)/inventario/page.tsx`, `app/(app)/inventario/[id]/`, `app/(app)/inventario/export/route.ts`.

- [ ] **Step 1: Investigate pattern 1** — expect N/A (inventory counts aren't NF-based). Confirm via grep.

- [ ] **Step 2: Investigate pattern 2** — check whether an inventory count LIST/dropdown of products-to-count includes inactive products that shouldn't need counting (this one plausibly DOES apply — you likely don't want to be prompted to physically count stock of a discontinued item). Check `app/(app)/inventario/[id]/` (the actual counting screen) for a `produtos` query without `inativo` exclusion.

- [ ] **Step 3: Investigate pattern 3 (broken filters).**

- [ ] **Step 4: Pattern 4** — no manual import. Mark N/A.

- [ ] **Step 5: Fix confirmed findings.**

- [ ] **Step 6: Typecheck, SQL cross-check, Playwright check, commit.**

---

### Task 9: Ordens de Produção (`app/(app)/ordem-producao/`)

**Files to investigate:** `app/(app)/ordem-producao/page.tsx`, `app/(app)/ordem-producao/export/`, `app/(app)/ordem-producao/relatorio/`, `app/(app)/ordem-producao/nova/` (the "new OP" creation flow — check its product picker specifically for inactive products, since letting someone start a new production order for a discontinued product is a real, plausible bug).

- [ ] **Step 1: Investigate pattern 1** — expect N/A (OPs aren't NF-based, though they can cross-reference `nota_fiscal_items` in `MovimentosTab`-adjacent code found earlier — confirm this file itself doesn't).

- [ ] **Step 2: Investigate pattern 2, with special attention to `ordem-producao/nova/`** (the product picker for creating a NEW production order should almost certainly exclude inactive products — this is the clearest, highest-value check in this whole task):
```bash
grep -rn "from('produtos')\|inativo" "app/(app)/ordem-producao/nova/"
```

- [ ] **Step 3: Investigate pattern 3 (broken filters)** on the list page.

- [ ] **Step 4: Pattern 4** — no manual import. Mark N/A.

- [ ] **Step 5: Fix confirmed findings, prioritizing the `nova/` product-picker check from Step 2.**

- [ ] **Step 6: Typecheck, SQL cross-check, Playwright check, commit.**

---

### Task 10: End-to-end summary + deploy

**Files:** none new — this task aggregates and ships.

- [ ] **Step 1:** After Tasks 1-9 are all individually reviewed and approved, compile one summary of: which of the 4 patterns were found and fixed in which reports, and which were checked and confirmed clean, and which were flagged as bigger findings deferred to the controller (like the malha gap).
- [ ] **Step 2:** Final whole-branch review (per subagent-driven-development) covering all 9 reports' changes together.
- [ ] **Step 3:** Merge, push, deploy to Contabo (`ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "cd /opt/ntb-estoque && bash deploy.sh"`), verify at least 2-3 of the fixed reports live in production.
- [ ] **Step 4:** Report the full summary to the user in Portuguese, matching this session's established honesty standard — do not claim a pattern was "fixed" in a report where the investigation found it was already correct; say "checked, already correct" instead.
