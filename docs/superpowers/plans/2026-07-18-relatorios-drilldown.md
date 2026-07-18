# Drill-down nos relatórios — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Drill-down nível-a-nível (até o item onde o dado permite) em Compras, Auditoria, Faturamento e Movimentação, com breadcrumb na URL, rótulos opacos explicáveis/clicáveis e tela de pendências de classificação.

**Architecture:** Trilha `drill=dim:rotulo|dim:rotulo` na URL; cada nível vira filtro da consulta do nível seguinte reusando as RPCs existentes (+ sentinela `__sem__` pra valores nulos, migrations 077/078). Faturamento ganha dimensões compostas na ingestão. Tudo espelhado no caminho frio Contabo (`lib/relatorio-frio-nf.ts`).

**Tech Stack:** Next.js App Router (SSR + searchParams), Supabase RPCs SQL, Contabo API.

## Global Constraints

- Sem suite automatizada — verificação manual (`npm run dev` + Playwright, conta QA `claude.qa@ntb-estoque.dev` / `claudeqa123456`).
- Migrations via `node scripts/aplicar-migration.mjs <arquivo>.sql`; próximos números livres: **077** e **078**.
- Sentinela de nulo: string literal `__sem__` (em drill e em parâmetro de RPC).
- Separador de dimensão composta no faturamento: literal `>>` no rotulo (`"<pai>>><filho>"`), dimensões novas `tipo>familia` e `familia>produto`.
- Regra do AGENTS.md: toda mudança nas RPCs `relatorio_compras_*`/`relatorio_auditoria_fiscal_*` se espelha em `lib/relatorio-frio-nf.ts`.
- Filtros da `FiltrosGaveta` continuam valendo em todos os níveis do drill (ortogonais).

---

### Task 1: Infra do drill — `lib/drill.ts` + `DrillBreadcrumb`

**Files:**
- Create: `lib/drill.ts`
- Create: `components/ui-kit/DrillBreadcrumb.tsx`

**Interfaces:**
- Produces: `parseDrill(valor?: string): ParDrill[]` com `type ParDrill = { dim: string; rotulo: string }`; `serializeDrill(pares: ParDrill[]): string`; `hrefComDrill(basePath: string, spAtual: Record<string, string | undefined>, pares: ParDrill[]): string`; componente `<DrillBreadcrumb basePath sp pares rotuloDe? />`. Tasks 6, 8, 9, 10 consomem.

- [ ] **Step 1: Criar `lib/drill.ts`**

```ts
// Trilha de drill-down nos relatórios: ?drill=dim:rotulo|dim:rotulo
// (cada parte URL-encoded individualmente, porque rotulos têm | : e acentos).
// Sentinela '__sem__' no rotulo = "valor nulo" (Sem classificação).
export type ParDrill = { dim: string; rotulo: string }

export const SEM = '__sem__'

export function parseDrill(valor?: string): ParDrill[] {
  if (!valor) return []
  return valor
    .split('|')
    .map((parte) => {
      const i = parte.indexOf(':')
      if (i < 1) return null
      return { dim: parte.slice(0, i), rotulo: decodeURIComponent(parte.slice(i + 1)) }
    })
    .filter((p): p is ParDrill => p !== null)
}

export function serializeDrill(pares: ParDrill[]): string {
  return pares.map((p) => `${p.dim}:${encodeURIComponent(p.rotulo)}`).join('|')
}

// Monta o href preservando os searchParams atuais (exceto o próprio drill e a
// paginação) e aplicando a trilha nova. pares=[] remove o drill (voltar ao topo).
export function hrefComDrill(
  basePath: string,
  spAtual: Record<string, string | undefined>,
  pares: ParDrill[],
): string {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(spAtual)) {
    if (k === 'drill' || k === 'page' || !v) continue
    qs.set(k, v)
  }
  if (pares.length) qs.set('drill', serializeDrill(pares))
  const s = qs.toString()
  return `${basePath}${s ? `?${s}` : ''}`
}
```

- [ ] **Step 2: Criar `components/ui-kit/DrillBreadcrumb.tsx`**

```tsx
import Link from 'next/link'
import { X } from 'lucide-react'
import { hrefComDrill, type ParDrill } from '@/lib/drill'

// Trilha do drill: "‹raiz› › CARNES › Picanha [✕]". Server component.
// rotuloDe deixa a página traduzir o rotulo cru pra exibição (tipo '04' -> nome).
export function DrillBreadcrumb({
  basePath,
  sp,
  pares,
  raiz,
  rotuloDe,
}: {
  basePath: string
  sp: Record<string, string | undefined>
  pares: ParDrill[]
  raiz: string
  rotuloDe?: (par: ParDrill) => string
}) {
  if (!pares.length) return null
  return (
    <nav aria-label="Trilha do detalhamento" className="flex flex-wrap items-center gap-1.5 text-[13px]">
      <Link href={hrefComDrill(basePath, sp, [])} className="text-text-muted hover:text-text hover:underline">
        {raiz}
      </Link>
      {pares.map((p, i) => (
        <span key={`${p.dim}:${p.rotulo}`} className="flex items-center gap-1.5">
          <span className="text-text-muted">›</span>
          {i === pares.length - 1 ? (
            <span className="font-medium text-text">{rotuloDe?.(p) ?? p.rotulo}</span>
          ) : (
            <Link href={hrefComDrill(basePath, sp, pares.slice(0, i + 1))} className="text-text-muted hover:text-text hover:underline">
              {rotuloDe?.(p) ?? p.rotulo}
            </Link>
          )}
        </span>
      ))}
      <Link
        href={hrefComDrill(basePath, sp, [])}
        aria-label="Limpar detalhamento"
        className="ml-1 rounded p-0.5 text-text-muted hover:bg-surface-2 hover:text-text"
      >
        <X className="size-3.5" />
      </Link>
    </nav>
  )
}
```

- [ ] **Step 3: Typecheck e commit**

```bash
npx tsc --noEmit
git add lib/drill.ts components/ui-kit/DrillBreadcrumb.tsx
git commit -m "feat(ui-kit): infra de drill-down (trilha na URL + breadcrumb)"
```

---

### Task 2: Mapa de rótulos opacos — `lib/rotulos-opacos.ts`

**Files:**
- Create: `lib/rotulos-opacos.ts`

**Interfaces:**
- Produces: `explicarRotulo(rotulo: string): { label: string; motivo: string } | null`. Tasks 6, 8, 10 consomem.

- [ ] **Step 1: Criar o arquivo**

```ts
// Tradução central dos rótulos "opacos" que aparecem nos relatórios quando o
// dado de origem não tem classificação. Cada um ganha nome claro + o motivo
// (vira tooltip). null = rotulo normal, exibe como veio.
const MAPA: Record<string, { label: string; motivo: string }> = {
  'Sem classificação': {
    label: 'Sem cadastro de produto',
    motivo: 'Itens de nota fiscal cujo produto não existe no cadastro (ou o campo está vazio). Veja a lista exata em Pendências de classificação.',
  },
  'Não classificado': {
    label: 'Produto sem tipo',
    motivo: 'Cupons de produtos cujo cadastro no Omie não tem "tipo do item" preenchido.',
  },
  'Sem família': {
    label: 'Produto sem família',
    motivo: 'Cupons de produtos cujo cadastro no Omie não tem família preenchida.',
  },
  'Produto não identificado': {
    label: 'Cupom sem produto vinculado',
    motivo: 'Itens de cupom fiscal sem produto correspondente no cadastro.',
  },
  'N/D': {
    label: 'Sem valor no BD',
    motivo: 'Linhas do arquivo MOV_DRV importado que vieram sem esse campo preenchido.',
  },
}

export function explicarRotulo(rotulo: string): { label: string; motivo: string } | null {
  return MAPA[rotulo] ?? null
}
```

- [ ] **Step 2: Typecheck e commit**

```bash
npx tsc --noEmit
git add lib/rotulos-opacos.ts
git commit -m "feat: mapa central de rotulos opacos com motivo"
```

---

### Task 3: Migration 077 — compras: `p_produto`/`p_local` no detalhe + sentinela `__sem__` nas 4 funções

**Files:**
- Create: `supabase/migrations/077_compras_detalhe_e_sentinela_sem.sql`

**Interfaces:**
- Produces: `relatorio_compras_detalhe(..., p_produto text default null, p_local bigint default null)`; convenção `'__sem__'` em `p_familias`/`p_tipos`/`p_cfops` (arrays) e `p_fornecedor` (text) nas 4 funções `relatorio_compras_*`. Tasks 5 e 6 consomem.

- [ ] **Step 1: Confirmar assinaturas vivas antes de escrever o drop**

```bash
node scripts/db.mjs "select proname, pg_get_function_identity_arguments(oid) from pg_proc where proname like 'relatorio_compras%' order by proname"
```
Esperado: `_total/_dim/_matriz` com `(p_loja_id bigint, p_ini date, p_fim date, [p_dim text,] p_familias text[], p_tipos text[], p_fornecedor text, p_cfops text[], p_produto text, p_local bigint)` (versão 075) e `_detalhe` com a assinatura curta sem produto/local (versão 067).

- [ ] **Step 2: Escrever a migration**

As condições de filtro trocam, em TODAS as 4 funções, os predicados atuais por versões cientes do sentinela. Padrão (aplicar a cada um):

```sql
-- em vez de:  (p_familias is null or p.descricao_familia = any(p_familias))
and (p_familias is null
     or ('__sem__' = any(p_familias) and p.descricao_familia is null)
     or p.descricao_familia = any(p_familias))
-- em vez de:  (p_tipos is null or p.tipo_item = any(p_tipos))
and (p_tipos is null
     or ('__sem__' = any(p_tipos) and p.tipo_item is null)
     or p.tipo_item = any(p_tipos))
-- em vez de:  (p_fornecedor is null or coalesce(...) ilike '%'||p_fornecedor||'%')
and (p_fornecedor is null
     or (p_fornecedor = '__sem__' and coalesce(nf.c_razao_social, nf.c_nome) is null)
     or coalesce(nf.c_razao_social, nf.c_nome) ilike '%' || p_fornecedor || '%')
-- em vez de:  (p_cfops is null or (...cCFOPEntrada) = any(p_cfops))
and (p_cfops is null
     or ('__sem__' = any(p_cfops) and (i.full_object->'itensAjustes'->>'cCFOPEntrada') is null)
     or (i.full_object->'itensAjustes'->>'cCFOPEntrada') = any(p_cfops))
```

Arquivo completo: recriar `relatorio_compras_total`, `_dim` e `_matriz` EXATAMENTE como estão na migration `075_relatorio_compras_produto_local.sql` (mesmos SELECT/joins/retornos), trocando só os 4 predicados acima; e recriar `relatorio_compras_detalhe` a partir do corpo vivo (conferido no Step 1, é o da migration 067: SELECT com `data, mes, nota, fornecedor, tipo, familia, produto, codigo, ncm, cfop, unidade, qtde, preco_unit, total`, join `notas_fiscais` + left join `produtos`, exclusão 910/908, `order by nf.d_emissao_nfe desc, total desc, i.id`) com: (a) os 2 parâmetros novos `p_produto text default null, p_local bigint default null` no fim; (b) as 2 condições novas idênticas às da 075:

```sql
and (p_produto is null or i.c_descricao_produto ilike '%' || p_produto || '%' or i.c_codigo_produto ilike '%' || p_produto || '%')
and (p_local is null or (i.full_object->'itensAjustes'->>'codigo_local_estoque')::bigint = p_local)
```

(c) os predicados sentinela. Cabeçalho do arquivo:

```sql
-- 077_compras_detalhe_e_sentinela_sem.sql
-- (1) relatorio_compras_detalhe ganha p_produto/p_local (paridade com a 075).
-- (2) As 4 funcoes relatorio_compras_* passam a aceitar o sentinela '__sem__'
--     em p_familias/p_tipos/p_cfops/p_fornecedor = "valor nulo", usado pelo
--     drill de "Sem cadastro de produto". Espelhar em lib/relatorio-frio-nf.ts.

drop function if exists relatorio_compras_total(bigint, date, date, text[], text[], text, text[], text, bigint);
drop function if exists relatorio_compras_dim(bigint, date, date, text, text[], text[], text, text[], text, bigint);
drop function if exists relatorio_compras_matriz(bigint, date, date, text, text[], text[], text, text[], text, bigint);
drop function if exists relatorio_compras_detalhe(bigint, date, date, text[], text[], text, text[]);
```

- [ ] **Step 3: Aplicar e verificar**

```bash
node scripts/aplicar-migration.mjs 077_compras_detalhe_e_sentinela_sem.sql
node scripts/db.mjs "select * from relatorio_compras_dim(2, '2026-01-01', '2026-07-17', 'produto', array['__sem__']) limit 3"
node scripts/db.mjs "select count(*) from relatorio_compras_detalhe(2, '2026-05-01', '2026-07-17', null, null, null, null, 'FILE', null)"
```
Esperado: a primeira lista produtos de itens SEM família; a segunda um count > 0.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/077_compras_detalhe_e_sentinela_sem.sql
git commit -m "feat(db): p_produto/p_local no detalhe de compras + sentinela __sem__"
```

---

### Task 4: Migration 078 — auditoria: sentinela `__sem__` (inclui par CFOP com entrada nula)

**Files:**
- Create: `supabase/migrations/078_auditoria_sentinela_sem.sql`

**Interfaces:**
- Produces: `relatorio_auditoria_fiscal_itens` aceita `p_cfop_entrada = '__sem__'` → `cfop_entrada is null`; `p_familia = '__sem__'` → família nula; `p_fornecedor = '__sem__'` → fornecedor nulo (nas duas funções). Task 9 consome.

- [ ] **Step 1: Escrever a migration**

Recriar as DUAS funções EXATAMENTE como na migration `076_auditoria_fiscal_produto_familia_local.sql`, trocando só estes predicados:

```sql
-- _cfop e _itens:
and (p_familia is null
     or (p_familia = '__sem__' and p.descricao_familia is null)
     or p.descricao_familia = p_familia)
and (p_fornecedor is null
     or (p_fornecedor = '__sem__' and coalesce(nf.c_razao_social, nf.c_nome) is null)
     or coalesce(nf.c_razao_social, nf.c_nome) ilike '%' || p_fornecedor || '%')
-- so em _itens:
and (p_cfop_entrada is null
     or (p_cfop_entrada = '__sem__' and (i.full_object->'itensAjustes'->>'cCFOPEntrada') is null)
     or i.full_object->'itensAjustes'->>'cCFOPEntrada' = p_cfop_entrada)
```

Cabeçalho + drops (assinaturas da 076):

```sql
-- 078_auditoria_sentinela_sem.sql
-- Sentinela '__sem__' nas funcoes de auditoria fiscal (p_familia, p_fornecedor
-- e p_cfop_entrada). Destrava o drill dos pares "CFOP -> (sem entrada)", que
-- hoje nem abrem. Espelhar em lib/relatorio-frio-nf.ts.
drop function if exists relatorio_auditoria_fiscal_cfop(bigint, date, date, text, text, text, bigint);
drop function if exists relatorio_auditoria_fiscal_itens(bigint, date, date, text, text, text, text, text, bigint);
```

- [ ] **Step 2: Aplicar e verificar**

```bash
node scripts/aplicar-migration.mjs 078_auditoria_sentinela_sem.sql
node scripts/db.mjs "select count(*) from relatorio_auditoria_fiscal_itens(2, '2026-01-01', '2026-07-17', '5.102', '__sem__', null)"
```
Esperado: count > 0 (itens do CFOP 5.102 sem CFOP de entrada — existem, vide resumo).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/078_auditoria_sentinela_sem.sql
git commit -m "feat(db): sentinela __sem__ na auditoria fiscal (drill de entrada nula)"
```

---

### Task 5: Espelho frio — sentinela + detalhe de compras em `lib/relatorio-frio-nf.ts`

**Files:**
- Modify: `lib/relatorio-frio-nf.ts`

**Interfaces:**
- Consumes: convenções `__sem__` das Tasks 3/4.
- Produces: `filtrarItensCompras`/`filtrarItensAuditoria` cientes de `__sem__`; novo export `mapearComprasDetalhe(itens: ItemNFFrio[], meta: MetaProdutoNF): LinhaDetalheCompra[]` com `type LinhaDetalheCompra = { data: string; mes: string; nota: string; fornecedor: string; tipo: string | null; familia: string | null; produto: string; codigo: string; ncm: string; cfop: string; unidade: string; qtde: number; preco_unit: number; total: number }`. Tasks 6 e 9 consomem.

- [ ] **Step 1: Sentinela em `filtrarItensCompras`**

Trocar o corpo do filter (linhas 115-126) por:

```ts
  const SEM = '__sem__'
  return itens.filter((it) => {
    const m = it.n_id_produto != null ? meta.get(Number(it.n_id_produto)) : undefined
    if (f.familias.length) {
      const fam = m?.familia ?? null
      const casa = f.familias.includes(fam ?? '') || (f.familias.includes(SEM) && fam === null)
      if (!casa) return false
    }
    if (f.tipos.length) {
      const tipo = m?.tipo ?? null
      const casa = f.tipos.includes(tipo ?? '') || (f.tipos.includes(SEM) && tipo === null)
      if (!casa) return false
    }
    if (f.fornecedor) {
      if (f.fornecedor === SEM) { if (it.nf_fornecedor != null) return false }
      else if (!ilike(it.nf_fornecedor, f.fornecedor)) return false
    }
    const cfopEnt = cfopEntradaDe(it)
    if (f.cfops.length) {
      const casa = f.cfops.includes(cfopEnt ?? '') || (f.cfops.includes(SEM) && cfopEnt === null)
      if (!casa) return false
    }
    if (f.produto && !ilike(it.c_descricao_produto, f.produto) && !ilike(it.c_codigo_produto, f.produto)) return false
    if (f.local !== null && localDe(it) !== f.local) return false
    if (['910', '908'].includes(right3(cfopEnt))) return false
    return true
  })
```

- [ ] **Step 2: Sentinela em `filtrarItensAuditoria`**

Trocar as condições de família e fornecedor (linhas 179-185) por:

```ts
    if (f.produto && !ilike(it.c_descricao_produto, f.produto) && !ilike(it.c_codigo_produto, f.produto)) return false
    if (f.familia) {
      const m = it.n_id_produto != null ? meta.get(Number(it.n_id_produto)) : undefined
      const fam = m?.familia ?? null
      if (f.familia === '__sem__') { if (fam !== null) return false }
      else if (fam !== f.familia) return false
    }
    if (f.fornecedor) {
      if (f.fornecedor === '__sem__') { if (it.nf_fornecedor != null) return false }
      else if (!ilike(it.nf_fornecedor, f.fornecedor)) return false
    }
    if (f.local !== null && localDe(it) !== f.local) return false
    return true
```

- [ ] **Step 3: `mapearAuditoriaItens` aceita `__sem__` como "entrada nula"**

Trocar o `.filter` (linha 242) por:

```ts
    .filter((it) => {
      if ((cfopDocDe(it) ?? '') !== sel.cfopDoc) return false
      const ent = cfopEntradaDe(it)
      if (sel.cfopEntrada === '__sem__') return ent === null
      return (ent ?? '') === sel.cfopEntrada
    })
```

- [ ] **Step 4: Novo export `mapearComprasDetalhe`** (após `agregarComprasMatriz`)

```ts
export type LinhaDetalheCompra = {
  data: string; mes: string; nota: string; fornecedor: string
  tipo: string | null; familia: string | null; produto: string; codigo: string
  ncm: string; cfop: string; unidade: string; qtde: number; preco_unit: number; total: number
}

/** Espelha o SELECT de relatorio_compras_detalhe pro pedaço frio. */
export function mapearComprasDetalhe(itens: ItemNFFrio[], meta: MetaProdutoNF): LinhaDetalheCompra[] {
  return itens.map((it) => {
    const m = it.n_id_produto != null ? meta.get(Number(it.n_id_produto)) : undefined
    const fo = it.full_object as { itensCabec?: { cNCM?: string } } | null
    return {
      data: it.nf_d_emissao_nfe,
      mes: it.nf_d_emissao_nfe.slice(0, 7),
      nota: it.nf_c_numero_nfe ?? '',
      fornecedor: it.nf_fornecedor ?? '',
      tipo: m?.tipo ?? null,
      familia: m?.familia ?? null,
      produto: it.c_descricao_produto ?? '',
      codigo: it.c_codigo_produto ?? '',
      ncm: fo?.itensCabec?.cNCM ?? '',
      cfop: cfopEntradaDe(it) ?? '',
      unidade: (it as { c_unidade_nfe?: string | null }).c_unidade_nfe ?? '',
      qtde: Number(it.n_qtde_nfe) || 0,
      preco_unit: Number(it.n_preco_unit) || 0,
      total: valorDe(it),
    }
  })
}
```

> Nota: se `c_unidade_nfe` não vier do endpoint `/nota_fiscal_items`, o campo fica `''` — aceitável (coluna informativa). Não mudar o server.js.

- [ ] **Step 5: Typecheck e commit**

```bash
npx tsc --noEmit
git add lib/relatorio-frio-nf.ts
git commit -m "feat(frio): sentinela __sem__ + detalhe de compras no caminho Contabo"
```

---

### Task 6: Compras — drill dimensão → produto → itens

**Files:**
- Modify: `app/(app)/relatorio-compras/page.tsx`

**Interfaces:**
- Consumes: Tasks 1, 2, 3, 5.

- [ ] **Step 1: Ler `drill` e derivar dimensão exibida + filtros extras**

Adicionar `drill?: string` ao tipo de `searchParams`. Depois de `const dim = ...` (linha ~70), adicionar:

```ts
  const pares = parseDrill(sp.drill)
  // Cada par da trilha vira filtro; a dimensão exibida desce a cadeia:
  // qualquer dim -> produto -> itens.
  const nivelItens = pares.some((p) => p.dim === 'produto') || (dim === 'produto' && pares.length > 0)
  const dimExibida = nivelItens ? null : pares.length > 0 ? 'produto' : dim
```

E mesclar os pares nos filtros existentes (logo após montar `filtros`, linha ~92):

```ts
  const drillFiltros: Record<string, unknown> = {}
  for (const p of pares) {
    if (p.dim === 'familia') drillFiltros.p_familias = [p.rotulo]
    if (p.dim === 'tipo') drillFiltros.p_tipos = [p.rotulo]
    if (p.dim === 'fornecedor') drillFiltros.p_fornecedor = p.rotulo
    if (p.dim === 'cfop') drillFiltros.p_cfops = [p.rotulo]
    if (p.dim === 'produto') drillFiltros.p_produto = p.rotulo === SEM ? null : p.rotulo
  }
  const filtrosComDrill = { ...filtros, ...drillFiltros }
```

Imports novos: `import { parseDrill, hrefComDrill, SEM, type ParDrill } from '@/lib/drill'`, `import { DrillBreadcrumb } from '@/components/ui-kit/DrillBreadcrumb'`, `import { explicarRotulo } from '@/lib/rotulos-opacos'`, `import { mapearComprasDetalhe, type LinhaDetalheCompra } from '@/lib/relatorio-frio-nf'`.

> Atenção: quando um par é `produto:__sem__` o filtro certo não é `p_produto` (busca texto) e sim manter o `p_familias`/`p_tipos` do par anterior — o nível de itens já herda os pares anteriores; `p_produto: null` + os demais pares reproduzem o conjunto. Quando o par é `produto:<nome>`, `p_produto` recebe o nome exato (ilike acha).

- [ ] **Step 2: Usar `filtrosComDrill` e `dimExibida` nas consultas**

Nas 2 chamadas de RPC (`relatorio_compras_total` e `relatorio_compras_matriz`, linhas 123-125), trocar `...filtros` por `...filtrosComDrill` e `p_dim: dim` por `p_dim: dimExibida ?? 'produto'`. No bloco frio (linha 145-147), estender `filtrarItensCompras` com os pares (as chaves do objeto de filtro frio: `familias`, `tipos`, `fornecedor`, `cfops`, `produto`):

```ts
    const fDrill = { familias: [...familiasSel], tipos: [...tiposSel], fornecedor, cfops: [...cfopsSel], produto, local: localCod }
    for (const p of pares) {
      if (p.dim === 'familia') fDrill.familias = [p.rotulo]
      if (p.dim === 'tipo') fDrill.tipos = [p.rotulo]
      if (p.dim === 'fornecedor') fDrill.fornecedor = p.rotulo
      if (p.dim === 'cfop') fDrill.cfops = [p.rotulo]
      if (p.dim === 'produto' && p.rotulo !== SEM) fDrill.produto = p.rotulo
    }
    const filtrados = filtrarItensCompras(itensFrios, fDrill, meta)
```

E `agregarComprasMatriz(filtrados, dimExibida ?? 'produto', meta)`.

- [ ] **Step 3: Nível de itens**

Quando `nivelItens`, em vez da matriz, buscar o detalhe (novo bloco após o pivot):

```ts
  let itensDetalhe: LinhaDetalheCompra[] = []
  if (nivelItens) {
    const { data: det } = await supabase
      .rpc('relatorio_compras_detalhe', { p_loja_id: lojaId, p_ini: iniRpc, p_fim: fim, ...filtrosComDrill })
      .range(0, 499)
    itensDetalhe = (det ?? []) as LinhaDetalheCompra[]
    if (ini < corte) {
      // filtrados/meta vêm do bloco frio acima (reusar; se nivelItens, o bloco frio roda igual)
      itensDetalhe = [...mapearComprasDetalhe(filtrados, meta), ...itensDetalhe]
        .sort((a, b) => b.data.localeCompare(a.data) || b.total - a.total)
        .slice(0, 500)
    }
  }
```

> Estruturar o código pra `filtrados`/`meta` do bloco frio ficarem acessíveis (declarar `let filtrados: ItemNFFrio[] = []` e `let meta: MetaProdutoNF = new Map()` fora do `if (ini < corte)`).

- [ ] **Step 4: Render — breadcrumb, linhas clicáveis, rótulos opacos, tabela de itens**

(a) Breadcrumb logo acima da tabela:

```tsx
  <DrillBreadcrumb basePath="/relatorio-compras" sp={sp} pares={pares} raiz={`Compras por ${dimLabel.toLowerCase()}`} rotuloDe={(p) => (p.rotulo === SEM ? 'Sem cadastro' : p.dim === 'tipo' ? TIPO_LABEL.get(p.rotulo) ?? p.rotulo : p.dim === 'produto' ? formatarNomeProduto(p.rotulo) || p.rotulo : p.rotulo)} />
```

(b) Preservar o rotulo cru no pivot — trocar (linha 172):

```ts
  const linhas = ordenadas.slice(0, LIMITE_LINHAS).map(([rotulo, ent]) => ({ rotuloRaw: rotulo, rotulo: rotuloDe(rotulo), meses: ent.meses, total: ent.total }))
```

(c) Toda linha da matriz vira Link de drill (substitui o render atual da 1ª célula, mantendo o link de movimentações só no nível produto como ícone secundário — simplificação: o link principal agora é o drill):

```tsx
  <td className="sticky left-0 z-10 bg-surface px-3 py-2 text-text" title={explicarRotulo(l.rotuloRaw)?.motivo ?? l.rotulo}>
    <div className="max-w-[140px] truncate">
      <Link
        href={hrefComDrill('/relatorio-compras', sp, [...pares, { dim: dimExibida ?? dim, rotulo: l.rotuloRaw === 'Sem classificação' ? SEM : l.rotuloRaw }])}
        className="hover:underline"
      >
        {explicarRotulo(l.rotuloRaw)?.label ?? l.rotulo}
        {explicarRotulo(l.rotuloRaw) && <span className="ml-1 text-text-muted" aria-hidden>ⓘ</span>}
      </Link>
    </div>
  </td>
```

> O rotulo cru `'Sem classificação'` vem da RPC quando o campo é nulo — o par de drill usa `SEM` pra virar o filtro certo no nível seguinte.

(d) Tabela de itens quando `nivelItens` (substitui a matriz), colunas Data | NF | Fornecedor | Produto | CFOP | Qtde | Unit | Total:

```tsx
  <div className="overflow-x-auto rounded-lg border border-border bg-surface">
    <table className="w-full min-w-[760px] border-collapse text-sm">
      <thead><tr className="bg-surface-2">
        {['Data', 'NF', 'Fornecedor', 'Produto', 'CFOP', 'Qtde', 'Unit.', 'Total'].map((h) => (
          <th key={h} className={`${th} ${['Qtde', 'Unit.', 'Total'].includes(h) ? 'text-right' : 'text-left'}`}>{h}</th>
        ))}
      </tr></thead>
      <tbody>
        {itensDetalhe.map((it, i) => (
          <tr key={`${it.nota}-${i}`} className="border-t border-border/60 hover:bg-surface-2/40">
            <td className="num whitespace-nowrap px-3 py-2 text-text-muted">{fmtData(it.data)}</td>
            <td className="num px-3 py-2 text-text-muted">{it.nota}</td>
            <td className="max-w-[180px] truncate px-3 py-2 text-text-muted" title={it.fornecedor}>{it.fornecedor}</td>
            <td className="max-w-[220px] truncate px-3 py-2 text-text" title={it.produto}>
              <Link href={`/movimentacoes?produto=${encodeURIComponent(it.produto)}`} className="hover:underline">{formatarNomeProduto(it.produto) || it.produto}</Link>
            </td>
            <td className="num px-3 py-2 text-text-muted">{it.cfop || '-'}</td>
            <td className="num px-3 py-2 text-right text-text-muted">{Number(it.qtde).toLocaleString('pt-BR')}</td>
            <td className="num px-3 py-2 text-right text-text-muted">{fmtCel(Number(it.preco_unit))}</td>
            <td className="num px-3 py-2 text-right font-medium text-text">{fmtMoeda(Number(it.total))}</td>
          </tr>
        ))}
      </tbody>
    </table>
    {itensDetalhe.length >= 500 && <p className="px-3 py-2 text-[11px] text-text-muted">Mostrando os 500 itens mais recentes — use o Excel pra lista completa.</p>}
  </div>
```

(e) Esconder o `SegmentLinks` de dimensão quando `pares.length > 0` (a trilha comanda).

- [ ] **Step 5: Verificação manual**

`npm run dev` → `/relatorio-compras`: clicar CARNES → produtos de CARNES → clicar um produto → itens; conferir que o total do nível bate com a célula clicada. Clicar "Sem cadastro de produto" → produtos sem família. Testar com período cruzando 90 dias.

- [ ] **Step 6: Typecheck e commit**

```bash
npx tsc --noEmit
git add "app/(app)/relatorio-compras/page.tsx"
git commit -m "feat(relatorio-compras): drill dimensao -> produto -> itens com breadcrumb"
```

---

### Task 7: Faturamento — dimensões compostas na ingestão

**Files:**
- Modify: `lib/omie/faturamento.ts`

**Interfaces:**
- Produces: linhas `dimensao='tipo>familia'` (rotulo `"<tipoLabel>>><familia>"`) e `dimensao='familia>produto'` (rotulo `"<familia>>><produtoNome>"`) em `faturamento_importado`. Task 8 consome.

- [ ] **Step 1: Gravar as dimensões compostas**

No loop de itens (após as 4 chamadas `add(...)` existentes, linhas ~95-98), adicionar:

```ts
          const tipoLabel = info?.tipo ? (TIPO_NOME[info.tipo] ?? `Tipo ${info.tipo}`) : 'Não classificado'
          const familiaLabel = info?.familia || 'Sem família'
          const produtoLabel = info?.nome || 'Produto não identificado'
          add('tipo>familia', `${tipoLabel}>>${familiaLabel}`, mesISO, v)
          add('familia>produto', `${familiaLabel}>>${produtoLabel}`, mesISO, v)
```

(refatorar as 3 chamadas `add('tipo'...)/add('familia'...)/add('produto'...)` existentes pra usarem essas mesmas consts, evitando duplicar a lógica de fallback).

- [ ] **Step 2: Delete inclui as dimensões novas**

```ts
    .in('dimensao', ['tipo', 'familia', 'produto', 'tipo>familia', 'familia>produto'])
```

- [ ] **Step 3: Rodar o sync de verdade e conferir**

```bash
# dev server rodando na porta 3007:
CRON_SECRET=$(grep "^CRON_SECRET=" .env.local | cut -d= -f2-) && curl -s --max-time 590 -H "Authorization: Bearer $CRON_SECRET" http://localhost:3007/api/cron/sync-faturamento
node scripts/db.mjs "select dimensao, count(*) from faturamento_importado where dimensao like '%>%' group by dimensao"
```
Esperado: contagens > 0 nas duas dimensões compostas (pelo menos pras lojas que o sync completar dentro do timeout; o cron noturno completa o resto).

- [ ] **Step 4: Commit**

```bash
git add lib/omie/faturamento.ts
git commit -m "feat(faturamento): dimensoes compostas tipo>familia e familia>produto"
```

---

### Task 8: Faturamento — drill tipo → família → produto na tela

**Files:**
- Modify: `app/(app)/relatorio-faturamento/page.tsx`

**Interfaces:**
- Consumes: Tasks 1, 2, 7.

- [ ] **Step 1: Ler o drill e escolher a dimensão de consulta**

Adicionar `drill?: string` ao searchParams. Após `const dim = ...` (linha 71):

```ts
  const pares = parseDrill(sp.drill)
  // Cadeia: tipo -> familia -> produto. O drill usa as dimensões compostas
  // (tipo>familia / familia>produto) gravadas pela ingestão.
  const ultimo = pares[pares.length - 1]
  const consultaDim = !ultimo ? dim : ultimo.dim === 'tipo' ? 'tipo>familia' : 'familia>produto'
  const prefixo = ultimo ? `${ultimo.rotulo}>>` : null
```

Imports: `parseDrill`, `hrefComDrill`, `DrillBreadcrumb`, `explicarRotulo` (como na Task 6; sem `SEM` — os rotulos opacos do faturamento são strings gravadas, não nulos).

- [ ] **Step 2: Consultar e filtrar por prefixo**

Trocar `p_dim: dim` por `p_dim: consultaDim` na chamada da matriz (linha 108) e, quando em drill, ignorar `p_rotulos` (o filtro é o prefixo): `p_rotulos: prefixo ? null : rotulosFiltro.length ? rotulosFiltro : null`. Após receber `matriz`:

```ts
  const matrizNivel = prefixo
    ? matriz.filter((r) => r.rotulo.startsWith(prefixo)).map((r) => ({ ...r, rotulo: r.rotulo.slice(prefixo.length) }))
    : matriz
```

Usar `matrizNivel` no pivot (linha 128 em diante) no lugar de `matriz`. O empty-state de "sem dados" também usa `matrizNivel`.

- [ ] **Step 3: Render — breadcrumb, linhas clicáveis, opacos**

(a) Breadcrumb acima do `SegmentLinks` (e esconder o `SegmentLinks` quando `pares.length > 0`):

```tsx
  <DrillBreadcrumb basePath="/relatorio-faturamento" sp={sp} pares={pares} raiz={`Faturamento por ${DIMS.find((d) => d.value === dim)?.label.toLowerCase()}`} />
```

(b) Linha da matriz vira Link quando ainda há nível abaixo (tipo e família descem; produto e forma_pgto não):

```tsx
  {linhas.map((l) => {
    const dimDoNivel = ultimo ? (ultimo.dim === 'tipo' ? 'familia' : 'produto') : dim
    const desce = dimDoNivel === 'tipo' || dimDoNivel === 'familia'
    const opaco = explicarRotulo(l.rotulo)
    return (
      <tr key={l.rotulo} className="border-t border-border/60 hover:bg-surface-2/40">
        <td className="sticky left-0 z-10 max-w-[240px] truncate bg-surface px-3 py-2 text-text" title={opaco?.motivo ?? l.rotulo}>
          {desce ? (
            <Link href={hrefComDrill('/relatorio-faturamento', sp, [...pares, { dim: dimDoNivel, rotulo: l.rotulo }])} className="hover:underline">
              {opaco?.label ?? l.rotulo}{opaco && <span className="ml-1 text-text-muted" aria-hidden>ⓘ</span>}
            </Link>
          ) : (
            <>{opaco?.label ?? l.rotulo}{opaco && <span className="ml-1 text-text-muted" aria-hidden>ⓘ</span>}</>
          )}
        </td>
        {/* células de mês/total/% iguais às atuais */}
      </tr>
    )
  })}
```

> `dimDoNivel` é a dimensão DAS LINHAS EXIBIDAS (não a de consulta): sem drill = `dim`; drill em tipo = as linhas são famílias; drill em família = produtos.

- [ ] **Step 4: Verificação manual**

`/relatorio-faturamento`: clicar "Produto acabado" → famílias dele; clicar uma família → produtos; total de cada nível bate com a linha clicada. Clicar "Produto sem tipo" (ex-"Não classificado") também desce.

- [ ] **Step 5: Typecheck e commit**

```bash
npx tsc --noEmit
git add "app/(app)/relatorio-faturamento/page.tsx"
git commit -m "feat(relatorio-faturamento): drill tipo -> familia -> produto"
```

---

### Task 9: Auditoria Fiscal — unificar drill no padrão trilha + entrada nula + tooltip CFOP

**Files:**
- Modify: `app/(app)/auditoria-fiscal/page.tsx`

**Interfaces:**
- Consumes: Tasks 1, 4, 5.

- [ ] **Step 1: `drill` como fonte, `cfop` como alias legado**

```ts
  const pares = parseDrill(sp.drill)
  const parCfop = pares.find((p) => p.dim === 'cfop')
  // Alias legado ?cfop=doc|entrada (links salvos): converte pro formato novo.
  const [aliasDoc, aliasEnt] = (sp.cfop ?? '').split('|')
  const cfopDocSel = parCfop ? parCfop.rotulo.split('→')[0] : aliasDoc || ''
  const cfopEntSel = parCfop ? (parCfop.rotulo.split('→')[1] ?? '__sem__') : aliasEnt || ''
```

O par de drill guarda o par inteiro num rotulo só: `cfop:5.102→1.102` (ou `cfop:5.102→__sem__` quando a entrada é nula). Trocar a condição do drill (linha 115) de `if (cfopDocSel && cfopEntSel)` pra `if (cfopDocSel)` — com `__sem__` o par de entrada nula agora abre.

- [ ] **Step 2: Passar `__sem__` pra RPC e pro frio**

Na chamada `relatorio_auditoria_fiscal_itens`, `p_cfop_entrada: cfopEntSel` (o `__sem__` agora é entendido pela função — migration 078). No frio, `mapearAuditoriaItens(filtrados, { cfopDoc: cfopDocSel, cfopEntrada: cfopEntSel })` (Task 5 já trata `__sem__`).

- [ ] **Step 3: Link da linha do resumo usa o drill novo + tooltip de CFOP**

Trocar o Link (linha 261):

```tsx
  <Link
    href={`${hrefComDrill('/auditoria-fiscal', sp, [{ dim: 'cfop', rotulo: `${l.cfop_doc}→${l.cfop_entrada ?? '__sem__'}` }])}#detalhe-cfop`}
    title={`${descreverCFOP(l.cfop_doc).desc}${l.cfop_entrada ? ` → ${descreverCFOP(l.cfop_entrada).desc}` : ' → sem CFOP de entrada'}`}
    className="num font-medium text-text hover:text-brand"
  >
```

> Conferir no arquivo se `descreverCFOP` já está importado (é usado em relatorio-compras; importar de `@/lib/cfop` se faltar). Atenção à template string: o `#detalhe-cfop` concatena FORA do `hrefComDrill`.

E no cabeçalho do drill (linha ~286), trocar o `Link href={qs({})}` de fechar pelo `DrillBreadcrumb`:

```tsx
  <DrillBreadcrumb basePath="/auditoria-fiscal" sp={sp} pares={[{ dim: 'cfop', rotulo: `${cfopDocSel}→${cfopEntSel}` }]} raiz="Auditoria por CFOP" rotuloDe={(p) => p.rotulo.replace('__sem__', 'sem entrada')} />
```

- [ ] **Step 4: Verificação manual**

`/auditoria-fiscal`: clicar um par com entrada → itens (como antes, agora com breadcrumb); clicar um par SEM entrada (antes não abria) → itens aparecem. Link legado `?cfop=5.102|1.102` continua abrindo.

- [ ] **Step 5: Typecheck e commit**

```bash
npx tsc --noEmit
git add "app/(app)/auditoria-fiscal/page.tsx"
git commit -m "feat(auditoria-fiscal): drill unificado com trilha + par de entrada nula"
```

---

### Task 10: Movimentação (modo operação) — drill em memória entre dimensões

**Files:**
- Modify: `app/(app)/relatorio-movimentacao/page.tsx` (bloco `modo === 'operacao'`)

**Interfaces:**
- Consumes: Tasks 1, 2.

- [ ] **Step 1: Ler drill e aplicar como filtro em memória**

Adicionar `drill?: string` ao searchParams. No bloco operação (após `const dim = ...`, linha ~108):

```ts
  const pares = parseDrill(sp.drill)
  // Cadeia dinâmica: a próxima dimensão é a primeira de [familia, local, tipo_sped]
  // que ainda não está na trilha nem é a dimensão exibida de partida.
  const CADEIA_OP = ['familia', 'local', 'tipo_sped'] as const
  const usadas = new Set([...(pares.length ? [] : [dim]), ...pares.map((p) => p.dim)])
  const proxDim = CADEIA_OP.find((d) => !usadas.has(d) && d !== (pares.length ? '' : dim))
  const dimExibida = pares.length ? (CADEIA_OP.find((d) => !new Set(pares.map((p) => p.dim)).has(d) && d !== dim) ?? dim) : dim
```

> Simplificação deliberada: com 3 dimensões e a trilha começando na exibida, `dimExibida` após 1 clique é a próxima da cadeia que não está na trilha (partindo de `dim`); após 2 cliques, a última restante. Implementar como função pura no topo do arquivo:

```ts
function proximaDimOperacao(dimInicial: string, trilha: { dim: string }[]): string {
  const todas = ['familia', 'local', 'tipo_sped']
  const usadas = new Set([dimInicial, ...trilha.map((p) => p.dim)])
  return todas.find((d) => !usadas.has(d)) ?? dimInicial
}
```

e usar `const dimExibida = pares.length ? proximaDimOperacao(dim, pares) : dim`.

No predicado `filtradas` (que já tem op/loc/sent/família/tipo/mês), adicionar:

```ts
      pares.every((p) => {
        const v = p.dim === 'familia' ? r.familia : p.dim === 'local' ? r.local : r.tipo_sped
        return p.rotulo === 'N/D' ? !v : v === p.rotulo
      }) &&
```

E na montagem de `porDim` (linha ~183), trocar `dim` por `dimExibida`:

```ts
      const rot = (dimExibida === 'local' ? r.local : dimExibida === 'tipo_sped' ? r.tipo_sped : r.familia) || 'N/D'
```

- [ ] **Step 2: Render — breadcrumb + linhas clicáveis (com opacos)**

Breadcrumb acima da matriz; linha da matriz vira Link enquanto a trilha tiver menos de 2 pares:

```tsx
  <DrillBreadcrumb basePath="/relatorio-movimentacao" sp={sp} pares={pares} raiz={`Movimentação por ${dimLabel.toLowerCase()}`} rotuloDe={(p) => explicarRotulo(p.rotulo)?.label ?? p.rotulo} />
```

```tsx
  const opaco = explicarRotulo(rot)
  // dentro do <td> da 1ª coluna:
  {pares.length < 2 ? (
    <Link href={hrefComDrill('/relatorio-movimentacao', sp, [...pares, { dim: dimExibida, rotulo: rot }])} className="hover:underline" title={opaco?.motivo}>
      {opaco?.label ?? rot}{opaco && <span className="ml-1 text-text-muted" aria-hidden>ⓘ</span>}
    </Link>
  ) : (
    <span title={opaco?.motivo}>{opaco?.label ?? rot}</span>
  )}
```

> `modo=operacao` precisa continuar na URL: `hrefComDrill` preserva os searchParams — conferir que `sp.modo` está no objeto passado.

- [ ] **Step 3: Verificação manual**

`/relatorio-movimentacao?modo=operacao`: clicar uma família → abre por local daquela família; clicar um local → por tipo SPED. "N/D" clicável (vira "Sem valor no BD" com tooltip). Somas batem nível a nível.

- [ ] **Step 4: Typecheck e commit**

```bash
npx tsc --noEmit
git add "app/(app)/relatorio-movimentacao/page.tsx"
git commit -m "feat(relatorio-movimentacao): drill em memoria no modo operacao"
```

---

### Task 11: Movimentação (modo quantidade) — linhas de produto clicáveis

**Files:**
- Modify: `app/(app)/relatorio-movimentacao/page.tsx` (bloco final, modo quantidade)

**Interfaces:** nenhuma nova.

**Desvio do spec (documentar no commit):** o modo quantidade já exibe SEMPRE por produto (a dimensão tipo/família ali é só filtro, não display) — não há cadeia a descer. O drill certo é levar o produto clicado pra visão de item que já existe: a aba Movimentos.

- [ ] **Step 1: Linha vira link pra Movimentações**

No render das linhas do modo quantidade (a 1ª célula, que hoje exibe `l.rotulo` puro), trocar por:

```tsx
  <td className="sticky left-0 z-10 bg-surface px-3 py-2 text-text" title={l.rotulo}>
    <div className="max-w-[140px] truncate">
      <Link href={`/movimentacoes?produto=${encodeURIComponent(l.rotuloRaw)}`} className="hover:underline">{l.rotulo}</Link>
    </div>
  </td>
```

Preservando o rotulo cru no map (linha ~494):

```ts
  const linhas = ordenadas.slice(0, LIMITE_LINHAS).map(([rotulo, ent]) => ({ rotuloRaw: rotulo, rotulo: formatarNomeProduto(rotulo) || rotulo, meses: ent.meses, total: ent.total }))
```

- [ ] **Step 2: Verificação manual + commit**

Clicar um produto → abre `/movimentacoes` com a busca preenchida e o extrato do produto.

```bash
npx tsc --noEmit
git add "app/(app)/relatorio-movimentacao/page.tsx"
git commit -m "feat(relatorio-movimentacao): produto clicavel no modo quantidade (desvio do spec: ja e o nivel maximo)"
```

---

### Task 12: Tela de pendências de classificação

**Files:**
- Create: `app/(app)/pendencias-classificacao/page.tsx`
- Modify: `app/(app)/relatorios/page.tsx`

**Interfaces:**
- Consumes: `buscarItensNFFrio` + `MetaProdutoNF` (lib/relatorio-frio-nf.ts), `limiteJanelaQuente` (lib/historico-contabo.ts), `getAtorGestao` (lib/auth.ts).

- [ ] **Step 1: Criar a página**

```tsx
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId, getAtorGestao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { ListaHeader } from '@/components/ui-kit/ListaHeader'
import { Money } from '@/components/ui-kit/Money'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { limiteJanelaQuente } from '@/lib/historico-contabo'
import { buscarItensNFFrio } from '@/lib/relatorio-frio-nf'
import { ClipboardX, Download } from 'lucide-react'
import { btnClass } from '@/components/ui-kit/Button'
import type { ReactNode } from 'react'

const th = 'whitespace-nowrap px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-text-muted'

export default async function PendenciasClassificacaoPage() {
  const lojaId = await getCurrentLojaId()
  if (!(await getAtorGestao()).podeGerir) notFound()
  const supabase = createServiceClient()

  const hojeISO = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bahia' })
  const ini12m = `${Number(hojeISO.slice(0, 4)) - 1}${hojeISO.slice(4, 10)}`

  // Blocos 1 e 2: cadastro incompleto.
  const { data: prods } = await supabase
    .from('produtos')
    .select('codigo_produto, codigo, descricao, tipo_item, descricao_familia')
    .eq('loja_id', lojaId)
  type Prod = { codigo_produto: number; codigo: string | null; descricao: string | null; tipo_item: string | null; descricao_familia: string | null }
  const todos = (prods ?? []) as Prod[]
  const semFamilia = todos.filter((p) => !p.descricao_familia)
  const semTipo = todos.filter((p) => !p.tipo_item)

  // Bloco 3 + R$: itens de NF dos últimos 12 meses (quente + frio) sem vínculo.
  const corte = limiteJanelaQuente()
  type ItemNF = { n_id_produto: number | null; c_descricao_produto: string | null; c_codigo_produto: string | null; n_qtde_nfe: number | null; n_preco_unit: number | null; fornecedor?: string | null }
  const { data: quentesRaw } = await supabase
    .from('nota_fiscal_items')
    .select('n_id_produto, c_descricao_produto, c_codigo_produto, n_qtde_nfe, n_preco_unit, notas_fiscais!inner(deleted_at, d_emissao_nfe, c_razao_social, c_nome)')
    .eq('loja_id', lojaId)
    .is('notas_fiscais.deleted_at', null)
    .gte('notas_fiscais.d_emissao_nfe', corte)
    .limit(50000)
  const quentes: ItemNF[] = ((quentesRaw ?? []) as (ItemNF & { notas_fiscais: { c_razao_social: string | null; c_nome: string | null } })[]).map((r) => ({
    ...r, fornecedor: r.notas_fiscais?.c_razao_social || r.notas_fiscais?.c_nome || null,
  }))
  const friosRaw = await buscarItensNFFrio({ lojaId, dataInicio: ini12m, dataFinal: corte })
  const frios: ItemNF[] = friosRaw.map((it) => ({
    n_id_produto: it.n_id_produto, c_descricao_produto: it.c_descricao_produto, c_codigo_produto: it.c_codigo_produto,
    n_qtde_nfe: Number(it.n_qtde_nfe) || 0, n_preco_unit: Number(it.n_preco_unit) || 0, fornecedor: it.nf_fornecedor ?? null,
  }))
  const itens12m = [...quentes, ...frios]

  const codigosCadastro = new Set(todos.map((p) => Number(p.codigo_produto)))
  const valorDe = (it: ItemNF) => (Number(it.n_qtde_nfe) || 0) * (Number(it.n_preco_unit) || 0)

  const codsSemFamilia = new Set(semFamilia.map((p) => Number(p.codigo_produto)))
  const codsSemTipo = new Set(semTipo.map((p) => Number(p.codigo_produto)))
  let valorSemFamilia = 0
  let valorSemTipo = 0
  const semCadastro = new Map<string, { descricao: string; codigo: string; fornecedor: string; ocorrencias: number; valor: number }>()
  for (const it of itens12m) {
    const cod = it.n_id_produto != null ? Number(it.n_id_produto) : null
    const v = valorDe(it)
    if (cod !== null && codsSemFamilia.has(cod)) valorSemFamilia += v
    if (cod !== null && codsSemTipo.has(cod)) valorSemTipo += v
    if (cod === null || !codigosCadastro.has(cod)) {
      const k = `${it.c_descricao_produto ?? ''}|${it.c_codigo_produto ?? ''}`
      const e = semCadastro.get(k) ?? { descricao: it.c_descricao_produto ?? '(sem descrição)', codigo: it.c_codigo_produto ?? '-', fornecedor: it.fornecedor ?? '-', ocorrencias: 0, valor: 0 }
      e.ocorrencias += 1
      e.valor += v
      semCadastro.set(k, e)
    }
  }
  const semCadastroLinhas = [...semCadastro.values()].sort((a, b) => b.valor - a.valor)
  const valorSemCadastro = semCadastroLinhas.reduce((s, l) => s + l.valor, 0)

  const Bloco = ({ titulo, valor, exportBloco, children }: { titulo: string; valor: number; exportBloco: string; children: ReactNode }) => (
    <section className="space-y-2">
      <h2 className="flex flex-wrap items-baseline gap-2 text-[15px] font-semibold text-text">
        {titulo}
        <span className="text-[13px] font-normal text-text-muted">R$ associado (12 meses): <span className="num font-medium text-text"><Money value={valor} /></span></span>
        <a href={`/pendencias-classificacao/export?bloco=${exportBloco}`} target="_blank" rel="noopener noreferrer" className={btnClass('outline')}>
          <Download className="size-4" /> CSV
        </a>
      </h2>
      {children}
    </section>
  )

  return (
    <div className="space-y-6">
      <ListaHeader>
        <PageHeader
          title="Pendências de classificação"
          icon={ClipboardX}
          description="O que arrumar no Omie pra sumir com os 'Sem cadastro/família/tipo' dos relatórios"
          voltarHref="/relatorios"
        />
      </ListaHeader>

      <Bloco titulo={`Produtos sem família (${semFamilia.length})`} valor={valorSemFamilia} exportBloco="sem-familia">
        {!semFamilia.length ? <EmptyState icon={ClipboardX} title="Nenhum" hint="Todos os produtos têm família." /> : (
          <div className="overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="w-full min-w-[480px] text-sm">
              <thead><tr className="bg-surface-2"><th className={th}>Código</th><th className={th}>Descrição</th><th className={th}>Tipo</th></tr></thead>
              <tbody>{semFamilia.map((p) => (
                <tr key={p.codigo_produto} className="border-t border-border/60">
                  <td className="num px-3 py-2 text-text-muted">{p.codigo ?? p.codigo_produto}</td>
                  <td className="px-3 py-2 text-text">{p.descricao ?? '-'}</td>
                  <td className="px-3 py-2 text-text-muted">{p.tipo_item ?? '—'}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Bloco>

      <Bloco titulo={`Produtos sem tipo (${semTipo.length})`} valor={valorSemTipo} exportBloco="sem-tipo">
        {/* mesma tabela do bloco acima, trocando a fonte por semTipo e a 3ª coluna por familia */}
        {!semTipo.length ? <EmptyState icon={ClipboardX} title="Nenhum" hint="Todos os produtos têm tipo." /> : (
          <div className="overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="w-full min-w-[480px] text-sm">
              <thead><tr className="bg-surface-2"><th className={th}>Código</th><th className={th}>Descrição</th><th className={th}>Família</th></tr></thead>
              <tbody>{semTipo.map((p) => (
                <tr key={p.codigo_produto} className="border-t border-border/60">
                  <td className="num px-3 py-2 text-text-muted">{p.codigo ?? p.codigo_produto}</td>
                  <td className="px-3 py-2 text-text">{p.descricao ?? '-'}</td>
                  <td className="px-3 py-2 text-text-muted">{p.descricao_familia ?? '—'}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </Bloco>

      <Bloco titulo={`Itens de NF sem produto no cadastro (${semCadastroLinhas.length})`} valor={valorSemCadastro} exportBloco="sem-cadastro">
        {!semCadastroLinhas.length ? <EmptyState icon={ClipboardX} title="Nenhum" hint="Todo item de NF dos últimos 12 meses tem produto no cadastro." /> : (
          <div className="overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="w-full min-w-[560px] text-sm">
              <thead><tr className="bg-surface-2"><th className={th}>Descrição na NF</th><th className={th}>Código na NF</th><th className={th}>Fornecedor</th><th className={`${th} text-right`}>Ocorrências</th><th className={`${th} text-right`}>Valor</th></tr></thead>
              <tbody>{semCadastroLinhas.map((l, i) => (
                <tr key={i} className="border-t border-border/60">
                  <td className="max-w-[260px] truncate px-3 py-2 text-text" title={l.descricao}>{l.descricao}</td>
                  <td className="num px-3 py-2 text-text-muted">{l.codigo}</td>
                  <td className="max-w-[180px] truncate px-3 py-2 text-text-muted" title={l.fornecedor}>{l.fornecedor}</td>
                  <td className="num px-3 py-2 text-right text-text-muted">{l.ocorrencias}</td>
                  <td className="num px-3 py-2 text-right font-medium text-text"><Money value={l.valor} /></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <p className="px-1 text-[12px] text-text-muted">
          É esta lista que vira <Link href="/relatorio-compras" className="underline">"Sem cadastro de produto"</Link> no relatório de Compras. Corrija os cadastros no Omie.
        </p>
      </Bloco>
    </div>
  )
}
```

- [ ] **Step 2: Card no hub `/relatorios`**

Adicionar ao grupo dos relatórios financeiros em `app/(app)/relatorios/page.tsx` (mesma estrutura das entradas existentes; importar `ClipboardX` de lucide):

```ts
      { href: '/pendencias-classificacao', titulo: 'Pendências de classificação', icon: ClipboardX, descricao: 'Produtos sem família/tipo e itens de NF sem cadastro, com o R$ que representam.', pergunta: 'O que falta classificar?' },
```

- [ ] **Step 3: Verificação manual**

Abrir `/pendencias-classificacao`; cruzar: o valor do bloco 3 ≈ linha "Sem cadastro de produto" de Compras no mesmo período (12 meses).

- [ ] **Step 4: Typecheck e commit**

```bash
npx tsc --noEmit
git add "app/(app)/pendencias-classificacao/page.tsx" "app/(app)/relatorios/page.tsx"
git commit -m "feat: tela de pendencias de classificacao"
```

---

### Task 13: QA de ponta a ponta (Playwright)

**Files:**
- Create: `scripts/qa-drilldown.mjs` (descartável, fora do commit se preferir)

- [ ] **Step 1: Roteiro** — com `npm run dev` de pé e `playwright`/`pg` instalados ad-hoc (`npm install pg playwright --no-save --no-audit --no-fund`), logar com a conta QA e percorrer:

1. `/relatorio-compras` → clicar a 1ª família → somar a coluna Total do nível e comparar com a célula clicada (tolerância de arredondamento 0,05) → clicar 1º produto → conferir que a soma dos itens bate → breadcrumb volta ao topo.
2. Mesmo drill com `?data_inicio=<antes do corte de 90 dias>` (valida o frio).
3. `/relatorio-compras` → clicar "Sem cadastro de produto" → nível seguinte não-vazio.
4. `/relatorio-faturamento` → tipo → família → produto, somas batendo.
5. `/auditoria-fiscal` → par com entrada nula abre itens.
6. `/relatorio-movimentacao?modo=operacao` → família → local, somas batendo.
7. `/pendencias-classificacao` renderiza os 3 blocos.

Usar `waitForTimeout` (não `networkidle`) após navegações — lição registrada da Fase A.

- [ ] **Step 2: Rodar, corrigir o que falhar, re-rodar até verde.**

- [ ] **Step 3: Commit final de ajustes + atualizar AGENTS.md**

Adicionar ao AGENTS.md (seção de leitura híbrida) uma linha: sentinela `__sem__` e dimensões compostas `tipo>familia`/`familia>produto` existem e estão espelhadas no frio.

```bash
git add -A
git commit -m "test: QA de drill-down nos relatorios + docs"
```

---

## Ordem de execução

1 → 2 → (3, 4 em qualquer ordem) → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13.
Tasks 6, 8, 9, 10, 11, 12 são independentes entre si depois que 1-5 e 7 existirem (10 e 11 mexem no mesmo arquivo — executar em sequência).
