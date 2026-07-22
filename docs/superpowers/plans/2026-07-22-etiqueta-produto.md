# Etiqueta de Produto (nome + QR + logo) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user select one or more products on the Produtos list and print a batch of labels containing just the product name, its QR code (encodes `codigo_produto`, permanently stable), and the mandatory NTB logo.

**Architecture:** Pure server-rendered HTML `<form method="GET">` around the existing Produtos table (no new client component, no React state) submits checked `codigo_produto` values to a new GET route. That route fetches the matching products, builds one `Etiqueta` per product reusing the existing `EtiquetaPDF` renderer with all NF/OP-specific fields turned off, and streams back a PDF — the exact same pattern already used by `app/(app)/ordem-producao/[id]/imprimir/route.ts`.

**Tech Stack:** Next.js App Router route handlers, `@react-pdf/renderer`, `qrcode` npm package, Supabase (service client), existing `components/etiqueta/EtiquetaPDF.tsx`.

## Global Constraints

- Reuse `EtiquetaPDF` — do not create a second PDF renderer.
- The QR code must encode only `codigo_produto` (matches `QrScanner`'s expectation elsewhere in the app — do not change what the QR encodes).
- Logo is already hardcoded to always render in `EtiquetaPDF` (`mostrarLogo` is ignored) — no config needed for it.
- No new npm dependencies.
- Selection scope is the current page only (no cross-page persistence) — do not build anything more elaborate.
- This repo has no automated test runner. "Test" steps below mean: `npx tsc --noEmit`, a manual run against the local dev server, and a Playwright throwaway script (pattern already used all session: `scripts/qa-*.mjs`, deleted after use except reusable ones).
- Every commit that touches `app/(app)/produto/page.tsx` or adds the new route must be deployed to Contabo afterward per project convention: `ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "cd /opt/ntb-estoque && bash deploy.sh"`.

---

### Task 1: Allow `'PRODUTO'` as a valid `origem` in `impressao_etiquetas`

**Files:**
- Create: `supabase/migrations/084_impressao_etiquetas_origem_produto.sql`

**Interfaces:**
- Produces: `impressao_etiquetas.origem` now accepts `'NF' | 'OP' | 'PRODUTO'` — Task 3 relies on being able to insert `origem: 'PRODUTO'`.

- [ ] **Step 1: Write the migration**

```sql
-- 084_impressao_etiquetas_origem_produto.sql
-- Etiqueta de produto (nome+QR+logo, sem NF/OP de origem) precisa de um
-- terceiro valor de origem pro historico de impressoes.
alter table impressao_etiquetas drop constraint impressao_etiquetas_origem_check;
alter table impressao_etiquetas add constraint impressao_etiquetas_origem_check
  check (origem in ('NF', 'OP', 'PRODUTO'));
```

- [ ] **Step 2: Apply the migration**

Run: `node scripts/aplicar-migration.mjs 084_impressao_etiquetas_origem_produto.sql`
Expected output: `MIGRATION APLICADA.`

- [ ] **Step 3: Verify the constraint**

Run:
```bash
node scripts/db.mjs "select pg_get_constraintdef(oid) from pg_constraint where conname='impressao_etiquetas_origem_check'"
```
Expected: contains `'PRODUTO'::character varying` in the array.

- [ ] **Step 4: Commit**

```bash
cd "/Users/joaquimsalles/Projects/norte para negocios/ntb estoque"
git add supabase/migrations/084_impressao_etiquetas_origem_produto.sql
git commit -m "feat: permite origem PRODUTO em impressao_etiquetas"
```

---

### Task 2: Print route — `/produto/imprimir-etiquetas`

**Files:**
- Create: `app/(app)/produto/imprimir-etiquetas/route.ts`

**Interfaces:**
- Consumes: `Etiqueta`, `EtiquetaConfig` from `@/components/etiqueta/EtiquetaPDF` (existing, unchanged); `formatarNomeProduto` from `@/lib/formatar-nome` (existing).
- Produces: `GET /produto/imprimir-etiquetas?codigos=123&codigos=456` → `application/pdf` response. Task 3's form submits to this exact path/param name (`codigos`, repeated).

- [ ] **Step 1: Write the route**

```typescript
// app/(app)/produto/imprimir-etiquetas/route.ts
import { NextResponse } from 'next/server'
import { renderToBuffer } from '@react-pdf/renderer'
import { createElement } from 'react'
import QRCode from 'qrcode'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId, getUser, requirePermissao } from '@/lib/auth'
import { EtiquetaPDF, type Etiqueta, type EtiquetaConfig } from '@/components/etiqueta/EtiquetaPDF'
import { formatarNomeProduto } from '@/lib/formatar-nome'

// Config fixa: só nome do produto + QR + logo (logo já é obrigatória no
// EtiquetaPDF, independente de config). Nada de campos de NF/OP (validade,
// lote, fornecedor, etc.) -- essa etiqueta não vem de um recebimento/produção.
const CONFIG_MINIMA: EtiquetaConfig = {
  mostrarFabricacao: false,
  mostrarValidade: false,
  mostrarQtdeNf: false,
  mostrarQtdeEtiqueta: false,
  mostrarLote: false,
  mostrarRecebido: false,
  mostrarFornecedor: false,
  mostrarCnpj: false,
}

export async function GET(request: Request) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Produtos'))) {
    return NextResponse.json({ error: 'Sem permissao' }, { status: 403 })
  }

  const url = new URL(request.url)
  const codigos = [...new Set(url.searchParams.getAll('codigos').map(Number).filter((n) => Number.isFinite(n) && n > 0))]
  if (!codigos.length) {
    return NextResponse.json({ error: 'Nenhum produto selecionado' }, { status: 400 })
  }

  const supabase = await createClient()
  const { data: loja } = await supabase.from('lojas').select('nome, nome_fantasia').eq('id', lojaId).single()
  const { data: produtosRaw } = await supabase
    .from('produtos')
    .select('codigo_produto, codigo, descricao')
    .eq('loja_id', lojaId)
    .in('codigo_produto', codigos)
  const produtos = produtosRaw ?? []
  if (!produtos.length) {
    return NextResponse.json({ error: 'Produtos não encontrados' }, { status: 404 })
  }

  const nomeLoja = loja?.nome_fantasia || loja?.nome || ''
  const etiquetas: Etiqueta[] = []
  for (const p of produtos) {
    const codigoExibido = p.codigo || String(p.codigo_produto)
    const qr = await QRCode.toDataURL(String(p.codigo_produto), { margin: 1, width: 160 })
    etiquetas.push({
      codigo_produto: codigoExibido,
      descricao: formatarNomeProduto(p.descricao),
      quantidade: '',
      qtde_nf: '',
      qtde_etiqueta: '',
      validade: '',
      produzido: '',
      inclusao: '',
      lote: '',
      fornecedor: '',
      cnpj: '',
      qr,
      nome_loja: nomeLoja,
    })
  }

  const element = createElement(EtiquetaPDF, { etiquetas, config: CONFIG_MINIMA }) as Parameters<typeof renderToBuffer>[0]
  const buffer = await renderToBuffer(element)

  try {
    const service = createServiceClient()
    await service.from('impressao_etiquetas').insert({
      loja_id: lojaId,
      origem: 'PRODUTO',
      referencia_id: 0,
      qtd_etiquetas: etiquetas.length,
      user_id: (await getUser())?.id ?? null,
    })
  } catch {
    // ignora falha de registro de historico, igual aos outros imprimir/route.ts
  }

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': 'inline; filename="etiquetas-produtos.pdf"',
    },
  })
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -v "valida-agg-claude"`
Expected: no errors mentioning `imprimir-etiquetas/route.ts`.

- [ ] **Step 3: Manual smoke test against local dev**

With the dev server running on port 3051 and logged in as the QA account, run:
```bash
curl -s -o /tmp/etiquetas-teste.pdf -w "%{http_code}\n" "http://localhost:3051/produto/imprimir-etiquetas?codigos=<um_codigo_produto_real>" -H "Cookie: <sessao valida>"
file /tmp/etiquetas-teste.pdf
```
Expected: `200`, and `file` reports `PDF document`.
(Simplest in practice: reuse the Playwright QA pattern from Task 4's script instead of hand-crafting cookies — Task 4 covers this exact check end-to-end.)

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/produto/imprimir-etiquetas/route.ts"
git commit -m "feat: rota de impressao de etiquetas de produto (nome+qr+logo)"
```

---

### Task 3: Checkbox selection + submit button on the Produtos list

**Files:**
- Modify: `app/(app)/produto/page.tsx`

**Interfaces:**
- Consumes: nothing new — uses the existing `produtos` array already fetched in this file (`ProdutoLinha[]`, has `codigo_produto: number | null`).
- Produces: an HTML form with `id="form-etiquetas-produto"` submitting `GET` to `/produto/imprimir-etiquetas` — matches Task 2's route exactly.

- [ ] **Step 1: Wrap the actions area's button and the table in the same form**

Find this block (around line 410-443):
```tsx
  return (
    <div className="space-y-4">
      <ListaHeader>
        <PageHeader
          title="Produtos"
          icon={Package}
          actions={
            <>
              <FiltrosGaveta
```

Change the opening to add the form and a submit button right after the `FiltrosGaveta` closing tag but still inside the `<>...</>` actions fragment. Find:
```tsx
              <FiltrosGaveta
                basePath="/produto"
                campos={campos}
                defaults={{ q: params.q ?? '', familia: params.familia ?? '', tipo: params.tipo ?? '', fornecedor: params.fornecedor ?? '', situacao: params.situacao ?? 'ativos', ord: params.ord ?? '' }}
                persistirEm="/produto"
              />
```
Replace with:
```tsx
              <FiltrosGaveta
                basePath="/produto"
                campos={campos}
                defaults={{ q: params.q ?? '', familia: params.familia ?? '', tipo: params.tipo ?? '', fornecedor: params.fornecedor ?? '', situacao: params.situacao ?? 'ativos', ord: params.ord ?? '' }}
                persistirEm="/produto"
              />
              <button type="submit" form="form-etiquetas-produto" formTarget="_blank" className={btnClass('outline')}>
                <Printer className="size-4" /> Imprimir etiquetas selecionadas
              </button>
```

Find (line 28):
```tsx
import { Package, Download, Plus } from 'lucide-react'
```
Replace with:
```tsx
import { Package, Download, Plus, Printer } from 'lucide-react'
```

- [ ] **Step 2: Wrap the `<Lista>` block in the form**

Find:
```tsx
      <Lista
        linhas={produtos ?? []}
        chaveLinha={(p) => p.id}
        colunas={[
```
Replace the opening with:
```tsx
      <form id="form-etiquetas-produto" action="/produto/imprimir-etiquetas" method="GET">
      <Lista
        linhas={produtos ?? []}
        chaveLinha={(p) => p.id}
        colunas={[
          {
            label: '',
            larguraDesktop: 'w-10',
            render: (p: ProdutoLinha) =>
              p.codigo_produto != null ? (
                <input type="checkbox" name="codigos" value={p.codigo_produto} className="size-4" />
              ) : null,
          },
```

Then find this exact closing (the end of the `vazio` prop and the `<Lista` element itself, currently at lines ~697-704):
```tsx
        vazio={
          <EmptyState
            icon={Package}
            title="Nenhum produto"
            hint="Sincronize com o Omie ou ajuste a busca."
          />
        }
      />

      {(page > 1 || temProxima) && (
```
Replace with (adds `</form>` right after the `<Lista>` closes, before pagination — pagination links aren't part of the checkbox selection):
```tsx
        vazio={
          <EmptyState
            icon={Package}
            title="Nenhum produto"
            hint="Sincronize com o Omie ou ajuste a busca."
          />
        }
      />
      </form>

      {(page > 1 || temProxima) && (
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit 2>&1 | grep -v "valida-agg-claude"`
Expected: no new errors in `produto/page.tsx`.

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/produto/page.tsx"
git commit -m "feat: selecionar produtos e imprimir etiquetas em lote"
```

---

### Task 4: End-to-end verification with Playwright + deploy

**Files:**
- Create (throwaway, delete after use): `scripts/qa-etiqueta-produto.mjs`

**Interfaces:**
- Consumes: the QA login pattern already used all session (`claude.qa@ntb-estoque.dev` / `claudeqa123456`, `scripts/db.mjs` to switch `current_loja_id`).

- [ ] **Step 1: Write the script**

```javascript
// scripts/qa-etiqueta-produto.mjs
import { chromium } from 'playwright'

const BASE = process.env.QA_BASE || 'http://localhost:3051'
const browser = await chromium.launch()
const page = await browser.newPage()

await page.goto(`${BASE}/login`)
await page.fill('input[type="email"]', 'claude.qa@ntb-estoque.dev')
await page.fill('input[type="password"]', 'claudeqa123456')
await page.click('button[type="submit"]')
await page.waitForTimeout(2000)

await page.goto(`${BASE}/produto`, { waitUntil: 'domcontentloaded' })
await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {})

const checkboxes = page.locator('input[type="checkbox"][name="codigos"]')
const total = await checkboxes.count()
console.log('checkboxes encontrados:', total)
await checkboxes.nth(0).check()
await checkboxes.nth(1).check()

const [popup] = await Promise.all([
  page.waitForEvent('popup'),
  page.click('button:has-text("Imprimir etiquetas selecionadas")'),
])
await popup.waitForLoadState()
console.log('URL da nova aba:', popup.url())
const resp = await popup.request().get(popup.url()).catch(() => null)
console.log('status via re-fetch (referencia):', resp?.status())
await browser.close()
```

- [ ] **Step 2: Run it**

Run: `cd "/Users/joaquimsalles/Projects/norte para negocios/ntb estoque" && node scripts/qa-etiqueta-produto.mjs`
Expected: `checkboxes encontrados: <N > 0>`, `URL da nova aba:` containing `/produto/imprimir-etiquetas?codigos=...&codigos=...` (two values).

- [ ] **Step 3: Confirm the PDF byte-for-byte via curl with the same session**

If Step 2's popup URL loaded a PDF viewer (not an error page), that's sufficient confirmation — Chromium renders PDFs natively, so `popup.url()` resolving without a Next.js error page confirms success. If it shows a JSON error body instead, read it and fix before proceeding.

- [ ] **Step 4: Delete the throwaway script**

```bash
rm scripts/qa-etiqueta-produto.mjs
```

- [ ] **Step 5: Push and deploy to Contabo**

```bash
git push origin main
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "cd /opt/ntb-estoque && bash deploy.sh"
```

- [ ] **Step 6: Verify on production**

Repeat Step 2 with `QA_BASE=https://app-estoque.norteparanegocios.com.br node scripts/qa-etiqueta-produto.mjs` — but only after re-creating the script (it was deleted in Step 4); write it again identically, run once against production, then delete again.
