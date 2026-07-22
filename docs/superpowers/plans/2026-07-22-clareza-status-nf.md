# Clareza de Status de Nota Fiscal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every NF status state (Concluída / Pendente / Cancelada) visible and filterable everywhere a NF's status is shown or exported, fixing a real bug where cancelled NFs are currently mislabeled "Concluída".

**Architecture:** One shared pure function (`lib/nf-status.ts`) is the single source of truth for turning `(c_etapa, full_object)` into a `{ label, tom }`, replacing 3 separate ad-hoc/duplicated etapa-to-label mappings currently scattered across the list page, detail page, and two export routes. A shared PostgREST filter-fragment constant makes the new "not cancelled" condition consistent and null-safe everywhere it's used.

**Tech Stack:** Next.js App Router, Supabase (`supabase-js` PostgREST filters, including JSONB path filters already used elsewhere in this codebase), `lib/status-cor.ts`'s `SELO_CLASSE` tone tokens.

## Global Constraints

- Only 2 `c_etapa` values exist in production data today (`'60'` = Concluída, `'40'` = Pendente/em recebimento) — no Omie documentation for other codes was found. Any `c_etapa` other than `'60'` renders as `Pendente (etapa {código})` — never invent a label for a code not observed in real data, and never hide the raw code.
- `cCancelada` (at `full_object.infoCadastro.cCancelada`, string `'S'`/`'N'`) is INDEPENDENT of `c_etapa` — a NF can be `c_etapa='60'` AND `cCancelada='S'` simultaneously (confirmed real cases exist, 1-2 per loja). Cancelada always takes priority over the etapa-based label.
- Status precedence, exactly: **Cancelada** (`cCancelada==='S'`, regardless of etapa) > **Concluída** (`c_etapa==='60'` and not cancelled) > **Pendente (etapa X)** (anything else, not cancelled).
- Any Postgres/PostgREST filter for "not cancelled" MUST be null-safe: `full_object->infoCadastro->>cCancelada <> 'S'` is FALSE (not TRUE) when the path is null under standard SQL semantics, which would wrongly exclude rows with no `cCancelada` key at all. Always use the OR-with-is-null form given in Task 1 below — never a bare `.neq(...)`.
- The cold/Contabo-side status **filter** is a pre-existing gap (status filtering has never applied to the merged cold-data portion when a date range crosses the 90-day hot window, for ANY status value, before this branch) — do NOT try to fix that as part of this plan, it's out of scope and a materially bigger change. Cold-side **display** (the badge showing the correct label per row) DOES work correctly without extra fetch changes, because the existing `buscarFrioTudo`/cold API already returns `full_object` unconditionally in every row (confirmed via direct API test) — only the TypeScript type needs widening, not the fetch call.
- Preserve exact backward compatibility for the legacy `status=C` / `status=P` query values (linked from `lib/resumo-dia.ts`'s `href: '/nota-fiscal?status=40'` and other pre-existing links) — they must keep working exactly as before, alongside the new canonical `CONCLUIDA`/`PENDENTE`/`CANCELADA` values.
- No new npm dependencies.
- This repo has no automated test runner. Verification bar: `npx tsc --noEmit`, real SQL cross-validation against the shared dev database (comparing counts before/after a filter change), and a Playwright check for the visible label/filter behavior.
- Every commit that changes rendered pages must be deployed to Contabo afterward: `ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "cd /opt/ntb-estoque && bash deploy.sh"`.

---

### Task 1: `lib/nf-status.ts` — shared status helper

**Files:**
- Create: `lib/nf-status.ts`

**Interfaces:**
- Produces: `statusNF(cEtapa: string | null, fullObject: unknown): { label: string; tom: 'ok' | 'warn' | 'err' }` and `NAO_CANCELADA_OR: string` — every later task imports both from this file. No task re-implements this logic.

- [ ] **Step 1: Write the file**

```typescript
// lib/nf-status.ts
// Fonte única de verdade pro status de uma nota fiscal (Omie): cruza c_etapa
// (fase do recebimento) com cCancelada (flag INDEPENDENTE de etapa -- uma NF
// pode estar em c_etapa='60' e cancelada ao mesmo tempo). Antes desta mudança,
// 3 lugares diferentes (lista, detalhe, export) faziam
// `etapa === '60' ? 'Concluída' : 'Pendente'` cada um do seu jeito, ignorando
// cancelamento -- casos reais confirmados (1-2 por loja) de NF "Concluída" que
// na verdade estava cancelada.
//
// So existem 2 valores reais de c_etapa na base hoje ('60' e '40') -- nao ha
// documentacao da Omie pros demais codigos possiveis, entao qualquer coisa
// != '60' vira "Pendente (etapa X)", nunca escondendo o codigo cru.
export type StatusNF = { label: string; tom: 'ok' | 'warn' | 'err' }

type FullObjectComCadastro = { infoCadastro?: { cCancelada?: string | null } } | null | undefined

export function statusNF(cEtapa: string | null, fullObject: unknown): StatusNF {
  const cancelada = (fullObject as FullObjectComCadastro)?.infoCadastro?.cCancelada === 'S'
  if (cancelada) return { label: 'Cancelada', tom: 'err' }
  if (cEtapa === '60') return { label: 'Concluída', tom: 'ok' }
  return { label: `Pendente (etapa ${cEtapa ?? '?'})`, tom: 'warn' }
}

// Fragmento null-safe pra "nao cancelada", usado dentro de .or(...) do
// supabase-js. `<> 'S'` sozinho seria FALSO (nao verdadeiro) quando o campo
// e null -- excluiria em silencio toda NF sem essa chave no JSONB. Sempre
// usar via .or(NAO_CANCELADA_OR), nunca um .neq(...) isolado nesse campo.
export const NAO_CANCELADA_OR =
  "full_object->infoCadastro->>cCancelada.is.null,full_object->infoCadastro->>cCancelada.neq.S"
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit 2>&1 | tail -30`
Expected: no errors referencing `lib/nf-status.ts`.

- [ ] **Step 3: Commit**

```bash
cd "/Users/joaquimsalles/Projects/norte para negocios/ntb estoque"
git add lib/nf-status.ts
git commit -m "feat: lib/nf-status.ts -- fonte unica de status de NF (concluida/pendente/cancelada)"
```

---

### Task 2: List page — `app/(app)/nota-fiscal/page.tsx`

**Files:**
- Modify: `app/(app)/nota-fiscal/page.tsx`

**Interfaces:**
- Consumes: `statusNF`, `NAO_CANCELADA_OR` from `@/lib/nf-status` (Task 1).
- Produces: nothing new consumed by later tasks — this page is a leaf.

- [ ] **Step 1: Add the import**

Find (near the top, alongside the other lib imports):
```tsx
import { buscarFrioTudo, contarNotasFiscaisAntigas, limiteJanelaQuente } from '@/lib/historico-contabo'
```
Replace:
```tsx
import { buscarFrioTudo, contarNotasFiscaisAntigas, limiteJanelaQuente } from '@/lib/historico-contabo'
import { statusNF, NAO_CANCELADA_OR } from '@/lib/nf-status'
```

- [ ] **Step 2: Widen the `NotaCompleta` type to carry `full_object`**

Find:
```tsx
type NotaCompleta = {
  id: number
  d_emissao_nfe: string | null
  c_numero_nfe: string | null
  c_razao_social: string | null
  c_nome: string | null
  n_valor_nfe: number | string | null
  c_etapa: string | null
  c_natureza_operacao: string | null
  c_modelo_nfe: string | null
  c_serie_nfe: string | null
}
```
Replace:
```tsx
type NotaCompleta = {
  id: number
  d_emissao_nfe: string | null
  c_numero_nfe: string | null
  c_razao_social: string | null
  c_nome: string | null
  n_valor_nfe: number | string | null
  c_etapa: string | null
  c_natureza_operacao: string | null
  c_modelo_nfe: string | null
  c_serie_nfe: string | null
  full_object: unknown
}
```

- [ ] **Step 3: Add `full_object` to the main list query's select, and extend the status filter (3 states + legacy passthrough)**

Find:
```tsx
  // Query da listagem (paginada).
  let query = supabase
    .from('notas_fiscais')
    .select('id, d_emissao_nfe, c_numero_nfe, c_razao_social, c_nome, n_valor_nfe, c_etapa, c_natureza_operacao, c_modelo_nfe, c_serie_nfe')
    .eq('loja_id', lojaId)
    .gte('d_emissao_nfe', dataInicio)
    .lte('d_emissao_nfe', dataFinal)
    .is('deleted_at', null)
    .order(ord, { ascending: dir === 'asc' })
    .range((page - 1) * POR_PAGINA, page * POR_PAGINA) // busca N+1 para detectar próxima
  if (params.num_nfe) query = query.ilike('c_numero_nfe', `%${escapeIlike(params.num_nfe)}%`)
  if (params.fornecedor) query = query.or(`c_razao_social.ilike.%${escapeIlike(params.fornecedor)}%,c_nome.ilike.%${escapeIlike(params.fornecedor)}%`)
  // Status: 'C'/'P' (compat com links antigos) ou a etapa real direta (ex.: '60', '40').
  if (params.status === 'C') query = query.eq('c_etapa', '60')
  else if (params.status === 'P') query = query.neq('c_etapa', '60')
  else if (params.status) query = query.eq('c_etapa', params.status)
  if (params.natureza) query = query.ilike('c_natureza_operacao', `%${escapeIlike(params.natureza)}%`)
  if (categoriaOrClause) query = query.or(categoriaOrClause)
  if (idsIn) query = query.in('id', idsIn)
```
Replace:
```tsx
  // Query da listagem (paginada).
  let query = supabase
    .from('notas_fiscais')
    .select('id, d_emissao_nfe, c_numero_nfe, c_razao_social, c_nome, n_valor_nfe, c_etapa, c_natureza_operacao, c_modelo_nfe, c_serie_nfe, full_object')
    .eq('loja_id', lojaId)
    .gte('d_emissao_nfe', dataInicio)
    .lte('d_emissao_nfe', dataFinal)
    .is('deleted_at', null)
    .order(ord, { ascending: dir === 'asc' })
    .range((page - 1) * POR_PAGINA, page * POR_PAGINA) // busca N+1 para detectar próxima
  if (params.num_nfe) query = query.ilike('c_numero_nfe', `%${escapeIlike(params.num_nfe)}%`)
  if (params.fornecedor) query = query.or(`c_razao_social.ilike.%${escapeIlike(params.fornecedor)}%,c_nome.ilike.%${escapeIlike(params.fornecedor)}%`)
  // Status: 'CONCLUIDA'/'PENDENTE'/'CANCELADA' (novos), 'C'/'P' (compat com
  // links antigos) ou a etapa real direta (ex.: '60', '40') -- ver lib/nf-status.ts.
  if (params.status === 'C' || params.status === 'CONCLUIDA') query = query.eq('c_etapa', '60').or(NAO_CANCELADA_OR)
  else if (params.status === 'P' || params.status === 'PENDENTE') query = query.neq('c_etapa', '60').or(NAO_CANCELADA_OR)
  else if (params.status === 'CANCELADA') query = query.eq('full_object->infoCadastro->>cCancelada', 'S')
  else if (params.status) query = query.eq('c_etapa', params.status)
  if (params.natureza) query = query.ilike('c_natureza_operacao', `%${escapeIlike(params.natureza)}%`)
  if (categoriaOrClause) query = query.or(categoriaOrClause)
  if (idsIn) query = query.in('id', idsIn)
```

- [ ] **Step 4: Apply the identical status-filter extension to `buildTotaisQuery`**

Find:
```tsx
    if (params.num_nfe) q = q.ilike('c_numero_nfe', `%${escapeIlike(params.num_nfe)}%`)
    if (params.fornecedor) q = q.or(`c_razao_social.ilike.%${escapeIlike(params.fornecedor)}%,c_nome.ilike.%${escapeIlike(params.fornecedor)}%`)
    if (params.status === 'C') q = q.eq('c_etapa', '60')
    else if (params.status === 'P') q = q.neq('c_etapa', '60')
    else if (params.status) q = q.eq('c_etapa', params.status)
    if (params.natureza) q = q.ilike('c_natureza_operacao', `%${escapeIlike(params.natureza)}%`)
    if (categoriaOrClause) q = q.or(categoriaOrClause)
    if (idsIn) q = q.in('id', idsIn)
    return q
  }
```
Replace:
```tsx
    if (params.num_nfe) q = q.ilike('c_numero_nfe', `%${escapeIlike(params.num_nfe)}%`)
    if (params.fornecedor) q = q.or(`c_razao_social.ilike.%${escapeIlike(params.fornecedor)}%,c_nome.ilike.%${escapeIlike(params.fornecedor)}%`)
    if (params.status === 'C' || params.status === 'CONCLUIDA') q = q.eq('c_etapa', '60').or(NAO_CANCELADA_OR)
    else if (params.status === 'P' || params.status === 'PENDENTE') q = q.neq('c_etapa', '60').or(NAO_CANCELADA_OR)
    else if (params.status === 'CANCELADA') q = q.eq('full_object->infoCadastro->>cCancelada', 'S')
    else if (params.status) q = q.eq('c_etapa', params.status)
    if (params.natureza) q = q.ilike('c_natureza_operacao', `%${escapeIlike(params.natureza)}%`)
    if (categoriaOrClause) q = q.or(categoriaOrClause)
    if (idsIn) q = q.in('id', idsIn)
    return q
  }
```

- [ ] **Step 5: Same extension + `full_object` in select for the cross-90-day `paginaCompletaRaw` query**

Find:
```tsx
    const paginaCompletaRaw = await buscarTudoPaginado<NotaCompleta>((from, to) => {
      let q = supabase
        .from('notas_fiscais')
        .select('id, d_emissao_nfe, c_numero_nfe, c_razao_social, c_nome, n_valor_nfe, c_etapa, c_natureza_operacao, c_modelo_nfe, c_serie_nfe')
        .eq('loja_id', lojaId)
        .gte('d_emissao_nfe', dataInicio)
        .lte('d_emissao_nfe', dataFinal)
        .is('deleted_at', null)
        .order('id', { ascending: true })
        .range(from, to)
      if (params.num_nfe) q = q.ilike('c_numero_nfe', `%${escapeIlike(params.num_nfe)}%`)
      if (params.fornecedor) q = q.or(`c_razao_social.ilike.%${escapeIlike(params.fornecedor)}%,c_nome.ilike.%${escapeIlike(params.fornecedor)}%`)
      if (params.status === 'C') q = q.eq('c_etapa', '60')
      else if (params.status === 'P') q = q.neq('c_etapa', '60')
      else if (params.status) q = q.eq('c_etapa', params.status)
      if (params.natureza) q = q.ilike('c_natureza_operacao', `%${escapeIlike(params.natureza)}%`)
      if (categoriaOrClause) q = q.or(categoriaOrClause)
      if (idsIn) q = q.in('id', idsIn)
      return q
    })
```
Replace:
```tsx
    const paginaCompletaRaw = await buscarTudoPaginado<NotaCompleta>((from, to) => {
      let q = supabase
        .from('notas_fiscais')
        .select('id, d_emissao_nfe, c_numero_nfe, c_razao_social, c_nome, n_valor_nfe, c_etapa, c_natureza_operacao, c_modelo_nfe, c_serie_nfe, full_object')
        .eq('loja_id', lojaId)
        .gte('d_emissao_nfe', dataInicio)
        .lte('d_emissao_nfe', dataFinal)
        .is('deleted_at', null)
        .order('id', { ascending: true })
        .range(from, to)
      if (params.num_nfe) q = q.ilike('c_numero_nfe', `%${escapeIlike(params.num_nfe)}%`)
      if (params.fornecedor) q = q.or(`c_razao_social.ilike.%${escapeIlike(params.fornecedor)}%,c_nome.ilike.%${escapeIlike(params.fornecedor)}%`)
      if (params.status === 'C' || params.status === 'CONCLUIDA') q = q.eq('c_etapa', '60').or(NAO_CANCELADA_OR)
      else if (params.status === 'P' || params.status === 'PENDENTE') q = q.neq('c_etapa', '60').or(NAO_CANCELADA_OR)
      else if (params.status === 'CANCELADA') q = q.eq('full_object->infoCadastro->>cCancelada', 'S')
      else if (params.status) q = q.eq('c_etapa', params.status)
      if (params.natureza) q = q.ilike('c_natureza_operacao', `%${escapeIlike(params.natureza)}%`)
      if (categoriaOrClause) q = q.or(categoriaOrClause)
      if (idsIn) q = q.in('id', idsIn)
      return q
    })
```

- [ ] **Step 6: Update the filter dropdown options**

Find:
```tsx
    {
      tipo: 'select',
      nome: 'status',
      label: 'Etapa',
      opcoes: [
        { value: '60', label: 'Concluída (autorizada)' },
        { value: '40', label: 'Em recebimento' },
      ],
    },
```
Replace:
```tsx
    {
      tipo: 'select',
      nome: 'status',
      label: 'Situação',
      opcoes: [
        { value: 'CONCLUIDA', label: 'Concluída' },
        { value: 'PENDENTE', label: 'Pendente' },
        { value: 'CANCELADA', label: 'Cancelada' },
      ],
    },
```

- [ ] **Step 7: Replace the Etapa column's StatusPill with the new shared status badge**

Find:
```tsx
          { label: 'Etapa', sort: 'c_etapa', larguraDesktop: 'w-32', render: (nf) => <StatusPill status={nf.c_etapa === '60' ? 'Concluida' : 'Pendente'} /> },
```
Replace:
```tsx
          {
            label: 'Situação',
            sort: 'c_etapa',
            larguraDesktop: 'w-36',
            render: (nf) => {
              const { label, tom } = statusNF(nf.c_etapa, nf.full_object)
              return (
                <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${SELO_CLASSE[tom]}`}>
                  {label}
                </span>
              )
            },
          },
```

This introduces a new usage of `SELO_CLASSE` in this file — check whether `SELO_CLASSE` (from `@/lib/status-cor`) is already imported here. It is not (only `StatusPill` is imported, which internally uses `SELO_CLASSE` but doesn't re-export it). Find:
```tsx
import { StatusPill } from '@/components/ui-kit/StatusPill'
```
Replace:
```tsx
import { StatusPill } from '@/components/ui-kit/StatusPill'
import { SELO_CLASSE } from '@/lib/status-cor'
```

If `StatusPill` ends up with no remaining usages in this file after this edit, remove its import — check with a search for `StatusPill` in the rest of the file before removing; if it's still used elsewhere (e.g. for a sync-status pill unrelated to NF etapa), keep the import.

- [ ] **Step 8: Typecheck**

Run: `npx tsc --noEmit 2>&1 | tail -30`
Expected: no errors referencing `nota-fiscal/page.tsx`.

- [ ] **Step 9: SQL cross-check the new CANCELADA filter against real data**

Run (adjust loja as needed, this is read-only):
```bash
node scripts/db.mjs "select count(*) from notas_fiscais where loja_id=2 and deleted_at is null and full_object->'infoCadastro'->>'cCancelada' = 'S'"
```
Compare this count against what the `/nota-fiscal?status=CANCELADA` filter returns when manually checked in Step 10 below — they must match exactly.

- [ ] **Step 10: Manual verification against local dev**

Start the dev server if not already running, log in as `claude.qa@ntb-estoque.dev` / `claudeqa123456`, navigate to `/nota-fiscal?status=CANCELADA` and confirm: (a) the page loads without error, (b) every row shown displays the red "Cancelada" badge, (c) the row count shown matches Step 9's SQL count. Also check `/nota-fiscal` with no filter and confirm most rows show green "Concluída" and a few show amber "Pendente (etapa 40)".

- [ ] **Step 11: Commit**

```bash
git add "app/(app)/nota-fiscal/page.tsx"
git commit -m "feat: lista de NF mostra e filtra por Concluida/Pendente/Cancelada"
```

---

### Task 3: Detail page — `app/(app)/nota-fiscal/[id]/page.tsx`

**Files:**
- Modify: `app/(app)/nota-fiscal/[id]/page.tsx`

**Interfaces:**
- Consumes: `statusNF` from `@/lib/nf-status` (Task 1).

- [ ] **Step 1: Add the import**

Find:
```tsx
import { complementarNotasFiscais, complementarNotaFiscalItems } from '@/lib/historico-contabo'
```
Replace:
```tsx
import { complementarNotasFiscais, complementarNotaFiscalItems } from '@/lib/historico-contabo'
import { statusNF } from '@/lib/nf-status'
```

- [ ] **Step 2: Add `full_object` to the select**

Find:
```tsx
  const { data: nfSupabase } = await supabase
    .from('notas_fiscais')
    .select('id, c_numero_nfe, c_razao_social, c_nome, c_chave_nfe, d_emissao_nfe, n_valor_nfe, c_etapa, n_id_receb')
    .eq('id', id)
    .eq('loja_id', lojaId)
    .maybeSingle()
```
Replace:
```tsx
  const { data: nfSupabase } = await supabase
    .from('notas_fiscais')
    .select('id, c_numero_nfe, c_razao_social, c_nome, c_chave_nfe, d_emissao_nfe, n_valor_nfe, c_etapa, n_id_receb, full_object')
    .eq('id', id)
    .eq('loja_id', lojaId)
    .maybeSingle()
```

- [ ] **Step 3: Replace the raw "Etapa: 60" text with a status badge**

Find:
```tsx
              {nf.c_etapa && <span>Etapa: <span className="num">{nf.c_etapa}</span></span>}
```
Replace:
```tsx
              {nf.c_etapa && (() => {
                const { label, tom } = statusNF(nf.c_etapa, nf.full_object)
                return (
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${tom === 'ok' ? 'text-ok bg-ok/10' : tom === 'err' ? 'text-err bg-err/10' : 'text-warn bg-warn/10'}`}
                  >
                    {label} <span className="num ml-1 opacity-70">({nf.c_etapa})</span>
                  </span>
                )
              })()}
```

This inlines the tone-to-class mapping instead of importing `SELO_CLASSE` here, since this file doesn't otherwise use that module and a single inline ternary is simpler than adding an import for one usage — if a reviewer prefers consistency with Task 2's `SELO_CLASSE[tom]` pattern, that's a legitimate Minor suggestion, not a blocker.

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit 2>&1 | tail -30`
Expected: no errors referencing `nota-fiscal/[id]/page.tsx`.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/nota-fiscal/[id]/page.tsx"
git commit -m "feat: detalhe de NF mostra status com rotulo em vez do codigo cru"
```

---

### Task 4: Export routes — `export/route.ts` and `relatorio/route.ts`

**Files:**
- Modify: `app/(app)/nota-fiscal/export/route.ts`
- Modify: `app/(app)/nota-fiscal/relatorio/route.ts`

**Interfaces:**
- Consumes: `statusNF` from `@/lib/nf-status` (Task 1). Both files currently define their own local `labelEtapa` function with identical bodies (`etapa === '60' ? 'Concluída' : 'Pendente'`) — both get removed and replaced by calls to `statusNF(...).label`.

- [ ] **Step 1: Fix `export/route.ts`**

Before editing, read the live file to confirm these snippets still match exactly (line numbers may have drifted).

Find:
```typescript
import { complementarNotasFiscais, limiteJanelaQuente } from '@/lib/historico-contabo'

function fmtData(d: string | null): string {
  if (!d) return '-'
  const [y, m, day] = d.split('-')
  return `${day}/${m}/${y}`
}

function labelEtapa(etapa: string | null): string {
  return etapa === '60' ? 'Concluída' : 'Pendente'
}
```
Replace:
```typescript
import { complementarNotasFiscais, limiteJanelaQuente } from '@/lib/historico-contabo'
import { statusNF, NAO_CANCELADA_OR } from '@/lib/nf-status'

function fmtData(d: string | null): string {
  if (!d) return '-'
  const [y, m, day] = d.split('-')
  return `${day}/${m}/${y}`
}
```
(This removes the local `labelEtapa` function and adds the shared import in the same edit.)

Find the type definition:
```typescript
  type Nota = {
    id: number
    d_emissao_nfe: string | null
    c_numero_nfe: string | null
    c_razao_social: string | null
    c_nome: string | null
    n_valor_nfe: number | null
    c_etapa: string | null
  }
```
Replace:
```typescript
  type Nota = {
    id: number
    d_emissao_nfe: string | null
    c_numero_nfe: string | null
    c_razao_social: string | null
    c_nome: string | null
    n_valor_nfe: number | null
    c_etapa: string | null
    full_object: unknown
  }
```

Find:
```typescript
      .select('id, d_emissao_nfe, c_numero_nfe, c_razao_social, c_nome, n_valor_nfe, c_etapa')
```
Replace:
```typescript
      .select('id, d_emissao_nfe, c_numero_nfe, c_razao_social, c_nome, n_valor_nfe, c_etapa, full_object')
```

Find:
```typescript
    if (params.num_nfe) q = q.ilike('c_numero_nfe', `%${escapeIlike(params.num_nfe)}%`)
    if (params.fornecedor) q = q.ilike('c_nome', `%${escapeIlike(params.fornecedor)}%`)

    if (params.status === 'C') q = q.eq('c_etapa', '60')
    else if (params.status === 'P') q = q.neq('c_etapa', '60')

    if (notaIdsFiltro !== null) q = q.in('id', notaIdsFiltro)
```
Replace:
```typescript
    if (params.num_nfe) q = q.ilike('c_numero_nfe', `%${escapeIlike(params.num_nfe)}%`)
    if (params.fornecedor) q = q.ilike('c_nome', `%${escapeIlike(params.fornecedor)}%`)

    if (params.status === 'C' || params.status === 'CONCLUIDA') q = q.eq('c_etapa', '60').or(NAO_CANCELADA_OR)
    else if (params.status === 'P' || params.status === 'PENDENTE') q = q.neq('c_etapa', '60').or(NAO_CANCELADA_OR)
    else if (params.status === 'CANCELADA') q = q.eq('full_object->infoCadastro->>cCancelada', 'S')

    if (notaIdsFiltro !== null) q = q.in('id', notaIdsFiltro)
```

Find:
```typescript
    etapa: labelEtapa(n.c_etapa),
```
Replace:
```typescript
    etapa: statusNF(n.c_etapa, n.full_object).label,
```

- [ ] **Step 2: Typecheck after `export/route.ts`**

Run: `npx tsc --noEmit 2>&1 | tail -30`
Expected: no errors referencing `nota-fiscal/export/route.ts`. Confirm no leftover unused `labelEtapa` reference anywhere in this file.

- [ ] **Step 3: Fix `relatorio/route.ts`**

Before editing, read the live file to confirm these snippets still match exactly (line numbers may have drifted).

Find:
```typescript
import { complementarNotasFiscais, limiteJanelaQuente } from '@/lib/historico-contabo'

function labelEtapa(etapa: string | null): string {
  return etapa === '60' ? 'Concluída' : 'Pendente'
}
```
Replace:
```typescript
import { complementarNotasFiscais, limiteJanelaQuente } from '@/lib/historico-contabo'
import { statusNF, NAO_CANCELADA_OR } from '@/lib/nf-status'
```

Find:
```typescript
  const PAGE_SIZE = 1000
  type Nota = {
    id: number
    d_emissao_nfe: string | null
    c_numero_nfe: string | null
    c_razao_social: string | null
    c_nome: string | null
    n_valor_nfe: number | null
    c_etapa: string | null
  }
```
Replace:
```typescript
  const PAGE_SIZE = 1000
  type Nota = {
    id: number
    d_emissao_nfe: string | null
    c_numero_nfe: string | null
    c_razao_social: string | null
    c_nome: string | null
    n_valor_nfe: number | null
    c_etapa: string | null
    full_object: unknown
  }
```

Find:
```typescript
      .select('id, d_emissao_nfe, c_numero_nfe, c_razao_social, c_nome, n_valor_nfe, c_etapa, full_object')
```

Find:
```typescript
    if (numNfe) q = q.ilike('c_numero_nfe', `%${escapeIlike(numNfe)}%`)
    if (fornecedor) q = q.ilike('c_nome', `%${escapeIlike(fornecedor)}%`)
    if (status === 'C') q = q.eq('c_etapa', '60')
    else if (status === 'P') q = q.neq('c_etapa', '60')
    if (notaIdsFiltro !== null) q = q.in('id', notaIdsFiltro)
    return q
  }
```
Replace:
```typescript
    if (numNfe) q = q.ilike('c_numero_nfe', `%${escapeIlike(numNfe)}%`)
    if (fornecedor) q = q.ilike('c_nome', `%${escapeIlike(fornecedor)}%`)
    if (status === 'C' || status === 'CONCLUIDA') q = q.eq('c_etapa', '60').or(NAO_CANCELADA_OR)
    else if (status === 'P' || status === 'PENDENTE') q = q.neq('c_etapa', '60').or(NAO_CANCELADA_OR)
    else if (status === 'CANCELADA') q = q.eq('full_object->infoCadastro->>cCancelada', 'S')
    if (notaIdsFiltro !== null) q = q.in('id', notaIdsFiltro)
    return q
  }
```

Find:
```typescript
  const itens: RelatorioNFItem[] = notasCompletas.map((n) => ({
    emissao: fmtData(n.d_emissao_nfe),
    numero: String(n.c_numero_nfe ?? '-'),
    fornecedor: n.c_razao_social || n.c_nome || '-',
    etapa: labelEtapa(n.c_etapa),
    valor: n.n_valor_nfe ?? 0,
  }))
```
Replace:
```typescript
  const itens: RelatorioNFItem[] = notasCompletas.map((n) => ({
    emissao: fmtData(n.d_emissao_nfe),
    numero: String(n.c_numero_nfe ?? '-'),
    fornecedor: n.c_razao_social || n.c_nome || '-',
    etapa: statusNF(n.c_etapa, n.full_object).label,
    valor: n.n_valor_nfe ?? 0,
  }))
```

This file also has a SEPARATE binary status label used in the PDF's filter-summary subtitle line (not caught by the `labelEtapa` replacement above, since it inlines its own ternary):

Find:
```typescript
  if (status) filtrosAtivos.push(`Status: ${status === 'C' ? 'Concluída' : 'Pendente'}`)
```
Replace:
```typescript
  if (status) filtrosAtivos.push(`Status: ${status === 'C' || status === 'CONCLUIDA' ? 'Concluída' : status === 'CANCELADA' ? 'Cancelada' : 'Pendente'}`)
```

- [ ] **Step 4: Typecheck after both files**

Run: `npx tsc --noEmit 2>&1 | tail -30`
Expected: no errors referencing either file.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/nota-fiscal/export/route.ts" "app/(app)/nota-fiscal/relatorio/route.ts"
git commit -m "fix: export/relatorio de NF usam o status compartilhado (cancelada nao vira mais Concluida)"
```

---

### Task 5: End-to-end verification + deploy

**Files:**
- Create (throwaway, delete after use): `scripts/qa-status-nf.mjs`

- [ ] **Step 1: Write and run a verification script**

```javascript
// scripts/qa-status-nf.mjs
import { chromium } from 'playwright'
const BASE = process.env.QA_BASE || 'http://localhost:3051'
const browser = await chromium.launch()
const page = await browser.newPage()
await page.goto(`${BASE}/login`)
await page.fill('input[type="email"]', 'claude.qa@ntb-estoque.dev')
await page.fill('input[type="password"]', 'claudeqa123456')
await page.click('button[type="submit"]')
await page.waitForTimeout(2000)

for (const status of ['', 'CONCLUIDA', 'PENDENTE', 'CANCELADA']) {
  const url = `${BASE}/nota-fiscal${status ? `?status=${status}` : ''}`
  await page.goto(url, { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {})
  const text = await page.locator('body').innerText()
  const idx = text.indexOf('Situação')
  console.log(`\n=== status=${status || '(nenhum)'} ===`)
  console.log(text.slice(idx, idx + 400))
}
await browser.close()
```

Run: `cd "/Users/joaquimsalles/Projects/norte para negocios/ntb estoque" && node scripts/qa-status-nf.mjs`

Expected: for `status=CANCELADA`, every row's badge shows "Cancelada"; for `CONCLUIDA`, every row shows "Concluída"; for `PENDENTE`, every row shows "Pendente (etapa ...)"; for no filter, a mix appears matching the overall proportions already known (mostly Concluída, a handful of Pendente, 1-2 Cancelada per loja).

- [ ] **Step 2: Cross-check counts against SQL**

For each status value, run the equivalent count via `node scripts/db.mjs "..."` (same pattern as Task 2 Step 9) for the loja the QA account is on, and confirm they match the number of rows Playwright found on the page (accounting for pagination — compare against the "N notas" badge text shown near the top of the page, not just visible `<tr>` count).

- [ ] **Step 3: Delete the throwaway script**

```bash
rm scripts/qa-status-nf.mjs
```

- [ ] **Step 4: Push and deploy**

```bash
git push origin main
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "cd /opt/ntb-estoque && bash deploy.sh"
```

- [ ] **Step 5: Verify on production**

Re-create the script from Step 1 temporarily, run with `QA_BASE=https://app-estoque.norteparanegocios.com.br`, confirm the same behavior, then delete it again.
