# Inventario -- Produtos Nao Contados + Periodicidade

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar na tela de contagem uma aba de produtos nao contados (com filtros por tipo/familia/busca e botao para adicionar direto), e na listagem de inventarios um seletor diario/semanal/mensal que agrupa os inventarios por periodo com indicador de cobertura.

**Architecture:** `ContagemInventario.tsx` e Client Component -- a aba "Nao Contados" vai buscar dados via `/api/inventario/[id]/nao-contados` (GET com searchParams de filtros). A periodicidade e tratada na listagem Server Component (`/inventario/page.tsx`) usando um searchParam `periodo` que altera o agrupamento por `date_trunc` via RPC.

**Tech Stack:** Next.js 16, Supabase (pooler aws-1-sa-east-1), TypeScript, shadcn/ui, `components/ui-kit/` existente

## Global Constraints

- Sem travessao (--) em textos visiveis ao usuario
- Free tier apenas
- Middleware e `proxy.ts` (nao `middleware.ts`)
- Migration via `node scripts/aplicar-migration.mjs <arquivo.sql>` (passando SEM o prefixo do path)
- `ContagemInventario.tsx` e Client Component com 'use client' -- novos subcomponents tambem precisam de 'use client' se usarem hooks
- Permissoes: `requirePermissao(lojaId, 'Inventarios - Editar')` antes de qualquer escrita
- Testes ao vivo NUNCA na loja 4 (O SERTAO VAI VIRAR MAR)
- Padrao de design: usar `components/ui-kit/` existente (Combobox, Lista, StatusPill etc.)
- Git push apos cada task

---

## Mapa de arquivos

| Arquivo | Acao | Descricao |
|---|---|---|
| `supabase/migrations/048_inventario_nao_contados.sql` | Criar | RPC `inventario_nao_contados` + `inventario_cobertura` |
| `app/api/inventario/[id]/nao-contados/route.ts` | Criar | Endpoint GET que serve os dados da RPC para o Client Component |
| `components/inventario/NaoContados.tsx` | Criar | Aba de produtos nao contados com filtros e botao adicionar |
| `app/(app)/inventario/[id]/contagem/page.tsx` | Modificar | Passar `familias` e `tipos` como props para ContagemInventario |
| `components/inventario/ContagemInventario.tsx` | Modificar | Adicionar tabs Contados / Nao Contados; renderizar NaoContados |
| `app/(app)/inventario/page.tsx` | Modificar | Seletor de periodo + agrupamento + cobertura |

---

## Task 1: RPC inventario_nao_contados e inventario_cobertura (migration 048)

**Files:**
- Create: `supabase/migrations/048_inventario_nao_contados.sql`

**Interfaces:**
- Produces: `inventario_nao_contados(p_inventario_id, p_loja_id, p_tipo_item, p_familia, p_busca, p_offset, p_limit)` e `inventario_cobertura(p_loja_id, p_ini, p_fim, p_periodo)`

- [ ] **Step 1: Criar migration 048**

Criar `supabase/migrations/048_inventario_nao_contados.sql`:

```sql
-- Retorna produtos ativos da loja que NAO estao no inventario informado.
-- Inclui saldo (foto mais recente de posicao_estoques) e estoque_minimo.
-- Paginavel via p_offset/p_limit. Total via count(*) over().
create or replace function inventario_nao_contados(
  p_inventario_id bigint,
  p_loja_id       bigint,
  p_tipo_item     text    default null,
  p_familia       text    default null,
  p_busca         text    default null,
  p_offset        int     default 0,
  p_limit         int     default 50
) returns table(
  codigo_produto  bigint,
  codigo          text,
  descricao       text,
  tipo_item       text,
  descricao_familia text,
  unidade         text,
  saldo           numeric,
  estoque_minimo  numeric,
  total           bigint
)
language sql stable as $$
  with foto_max as (
    select max(data_posicao) as dp
    from posicao_estoques
    where loja_id = p_loja_id
  ),
  saldos as (
    select n_cod_prod, sum(n_saldo) as saldo
    from posicao_estoques pe, foto_max
    where pe.loja_id = p_loja_id and pe.data_posicao = foto_max.dp
    group by n_cod_prod
  ),
  filtrados as (
    select p.codigo_produto, p.codigo, p.descricao, p.tipo_item, p.descricao_familia, p.unidade,
           coalesce(s.saldo, 0) as saldo, coalesce(p.estoque_minimo, 0) as estoque_minimo
    from produtos p
    left join saldos s on s.n_cod_prod = p.codigo_produto
    where p.loja_id = p_loja_id
      and p.inativo = false
      and not exists (
        select 1 from inventario_items ii
        where ii.inventario_id = p_inventario_id
          and ii.produto_codigo_produto = p.codigo_produto
      )
      and (p_tipo_item is null or p.tipo_item = p_tipo_item)
      and (p_familia   is null or p.descricao_familia = p_familia)
      and (p_busca     is null
           or p.descricao ilike '%' || p_busca || '%'
           or p.codigo    ilike '%' || p_busca || '%')
  )
  select
    f.codigo_produto, f.codigo, f.descricao, f.tipo_item, f.descricao_familia, f.unidade,
    f.saldo, f.estoque_minimo,
    count(*) over() as total
  from filtrados f
  order by f.descricao
  offset p_offset limit p_limit;
$$;

-- Retorna cobertura de contagem por periodo (dia/semana/mes).
-- Usa date_trunc para agrupar. Para cada grupo: qtd inventarios, produtos
-- unicos contados e total de produtos ativos da loja.
create or replace function inventario_cobertura(
  p_loja_id bigint,
  p_ini     date,
  p_fim     date,
  p_periodo text default 'dia'   -- 'dia' | 'semana' | 'mes'
) returns table(
  periodo_inicio date,
  qtd_inventarios bigint,
  produtos_contados bigint,
  total_produtos bigint
)
language sql stable as $$
  with trunc_unit as (
    select case p_periodo
      when 'semana' then 'week'
      when 'mes'    then 'month'
      else               'day'
    end as u
  ),
  grupos as (
    select
      date_trunc((select u from trunc_unit), inv.data::date)::date as per,
      count(distinct inv.id) as qtd_inv,
      count(distinct ii.produto_codigo_produto) as prod_contados
    from inventarios inv
    left join inventario_items ii
      on ii.inventario_id = inv.id and ii.loja_id = inv.loja_id
    where inv.loja_id = p_loja_id
      and inv.data::date >= p_ini
      and inv.data::date <= p_fim
    group by 1
  ),
  total as (
    select count(*) as total_prod
    from produtos
    where loja_id = p_loja_id and inativo = false
  )
  select
    g.per as periodo_inicio,
    g.qtd_inv as qtd_inventarios,
    g.prod_contados as produtos_contados,
    t.total_prod as total_produtos
  from grupos g, total t
  order by g.per desc;
$$;
```

- [ ] **Step 2: Aplicar migration**

```bash
node scripts/aplicar-migration.mjs 048_inventario_nao_contados.sql
```

Resultado esperado: `CREATE FUNCTION` duas vezes, sem erros.

- [ ] **Step 3: Validar no Supabase SQL Editor**

```sql
-- Pegar um inventario_id real da loja 3 (Donana)
SELECT id FROM inventarios WHERE loja_id = 3 ORDER BY created_at DESC LIMIT 1;

-- Testar a funcao (substituir 99 pelo id real)
SELECT * FROM inventario_nao_contados(99, 3, null, null, null, 0, 5);
-- Esperado: lista de produtos com colunas codigo, descricao, saldo, total

-- Testar cobertura
SELECT * FROM inventario_cobertura(3, '2026-06-01', '2026-06-30', 'semana');
-- Esperado: linhas com periodo_inicio, qtd_inventarios, produtos_contados, total_produtos
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/048_inventario_nao_contados.sql
git commit -m "feat: RPCs inventario_nao_contados e inventario_cobertura (migration 048)"
```

---

## Task 2: Endpoint GET /api/inventario/[id]/nao-contados

**Files:**
- Create: `app/api/inventario/[id]/nao-contados/route.ts`

**Interfaces:**
- Consumes: searchParams `tipo`, `familia`, `q`, `offset`, `limit`
- Produces: `{ items: ProdutoNaoContado[], total: number }`

- [ ] **Step 1: Criar o endpoint**

Criar `app/api/inventario/[id]/nao-contados/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Inventarios - Ver'))) {
    return NextResponse.json({ error: 'Sem permissao' }, { status: 403 })
  }

  const { id } = await params
  const sp = req.nextUrl.searchParams
  const tipo   = sp.get('tipo')   || null
  const familia = sp.get('familia') || null
  const q      = sp.get('q')     || null
  const offset = parseInt(sp.get('offset') ?? '0', 10)
  const limit  = parseInt(sp.get('limit')  ?? '50', 10)

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('inventario_nao_contados', {
    p_inventario_id: parseInt(id, 10),
    p_loja_id:       lojaId,
    p_tipo_item:     tipo,
    p_familia:       familia,
    p_busca:         q,
    p_offset:        offset,
    p_limit:         limit,
  })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const total = data?.[0]?.total ?? 0
  return NextResponse.json({ items: data ?? [], total })
}
```

- [ ] **Step 2: Testar o endpoint no browser**

Com o servidor de dev rodando (`npm run dev`), abrir:
`http://localhost:3000/api/inventario/99/nao-contados?limit=5`
(substituir 99 pelo id de um inventario real da loja logada)

Resultado esperado: JSON com `{ items: [...], total: N }`

- [ ] **Step 3: Commit**

```bash
git add "app/api/inventario/[id]/nao-contados/route.ts"
git commit -m "feat: endpoint GET /api/inventario/[id]/nao-contados com filtros"
```

---

## Task 3: Componente NaoContados.tsx

**Files:**
- Create: `components/inventario/NaoContados.tsx`

**Interfaces:**
- Consumes: `inventarioId: number`, `familias: string[]`, `onAdicionar: (codigo: string) => void`
- Produces: lista paginada de produtos nao contados com filtros de tipo/familia/busca e botao "Adicionar" que chama `onAdicionar`

- [ ] **Step 1: Criar o componente**

Criar `components/inventario/NaoContados.tsx`:

```tsx
'use client'

import { useState, useEffect, useCallback } from 'react'
import { Search, Plus, Loader2 } from 'lucide-react'
import { Combobox } from '@/components/ui-kit/Combobox'
import { PRODUTO_TIPO_ITEM } from '@/lib/constants-omie'
import { formatarNomeProduto } from '@/lib/formatar-nome'

interface ProdutoNaoContado {
  codigo_produto: number
  codigo: string
  descricao: string
  tipo_item: string | null
  descricao_familia: string | null
  unidade: string | null
  saldo: number
  estoque_minimo: number
}

const POR_PAGINA = 30

export function NaoContados({
  inventarioId,
  familias,
  onAdicionar,
}: {
  inventarioId: number
  familias: string[]
  onAdicionar: (codigoProduto: string) => void
}) {
  const [items, setItems] = useState<ProdutoNaoContado[]>([])
  const [total, setTotal] = useState(0)
  const [offset, setOffset] = useState(0)
  const [carregando, setCarregando] = useState(false)
  const [adicionando, setAdicionando] = useState<string | null>(null)

  // Filtros
  const [busca, setBusca] = useState('')
  const [buscaAplicada, setBuscaAplicada] = useState('')
  const [tipo, setTipo] = useState('')
  const [familia, setFamilia] = useState('')

  const familiasOpts = familias.map((f) => ({ value: f, label: f }))
  const tiposOpts = [{ value: '', label: 'Todos os tipos' }, ...PRODUTO_TIPO_ITEM]
  const familiasOptsAll = [{ value: '', label: 'Todas as familias' }, ...familiasOpts]

  const buscarItens = useCallback(async (off: number, buscaAtual: string) => {
    setCarregando(true)
    try {
      const sp = new URLSearchParams()
      if (tipo) sp.set('tipo', tipo)
      if (familia) sp.set('familia', familia)
      if (buscaAtual) sp.set('q', buscaAtual)
      sp.set('offset', String(off))
      sp.set('limit', String(POR_PAGINA))
      const res = await fetch(`/api/inventario/${inventarioId}/nao-contados?${sp}`)
      const json = await res.json()
      if (off === 0) setItems(json.items ?? [])
      else setItems((prev) => [...prev, ...(json.items ?? [])])
      setTotal(json.total ?? 0)
      setOffset(off + (json.items?.length ?? 0))
    } finally {
      setCarregando(false)
    }
  }, [inventarioId, tipo, familia])

  // Busca inicial e ao mudar filtros
  useEffect(() => {
    setOffset(0)
    buscarItens(0, buscaAplicada)
  }, [tipo, familia, buscaAplicada, buscarItens])

  async function handleAdicionar(codigo: string) {
    setAdicionando(codigo)
    try {
      await onAdicionar(codigo)
      // Remove da lista local imediatamente
      setItems((prev) => prev.filter((p) => p.codigo !== codigo))
      setTotal((t) => Math.max(0, t - 1))
    } finally {
      setAdicionando(null)
    }
  }

  const temMais = offset < total

  return (
    <div className="space-y-3">
      {/* Filtros */}
      <div className="flex flex-wrap gap-2">
        {/* Busca textual */}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-text-muted pointer-events-none" />
          <input
            type="text"
            placeholder="Buscar produto..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            onBlur={() => setBuscaAplicada(busca)}
            onKeyDown={(e) => e.key === 'Enter' && setBuscaAplicada(busca)}
            className="w-full rounded-md border border-border bg-surface py-1.5 pl-8 pr-3 text-sm text-text outline-none focus:border-brand focus:shadow-[0_0_0_3px_var(--brand-soft)]"
          />
        </div>

        {/* Tipo */}
        <Combobox
          options={tiposOpts}
          value={tipo}
          onChange={setTipo}
          placeholder="Tipo"
          className="w-44"
        />

        {/* Familia */}
        {familias.length > 0 && (
          <Combobox
            options={familiasOptsAll}
            value={familia}
            onChange={setFamilia}
            placeholder="Familia"
            className="w-44"
          />
        )}
      </div>

      {/* Contador */}
      {!carregando && (
        <p className="text-[12px] text-text-muted">
          {total === 0 ? 'Nenhum produto sem contagem' : (
            <>
              <span className="font-medium text-text">{total.toLocaleString('pt-BR')}</span>{' '}
              {total === 1 ? 'produto sem contagem' : 'produtos sem contagem'}
              {(tipo || familia || buscaAplicada) ? ' com os filtros aplicados' : ''}
            </>
          )}
        </p>
      )}

      {/* Lista */}
      {carregando && items.length === 0 ? (
        <div className="flex items-center justify-center py-8">
          <Loader2 className="size-5 animate-spin text-text-muted" />
        </div>
      ) : items.length === 0 ? (
        <div className="py-8 text-center text-sm text-text-muted">
          {tipo || familia || buscaAplicada
            ? 'Nenhum produto sem contagem com esses filtros.'
            : 'Todos os produtos ja foram contados neste inventario.'}
        </div>
      ) : (
        <div className="divide-y divide-border rounded-lg border border-border bg-surface">
          {items.map((p) => (
            <div key={p.codigo} className="flex items-center gap-3 px-3 py-2 hover:bg-surface-2/50">
              <div className="min-w-0 flex-1">
                <p className="truncate text-[13px] font-medium text-text">
                  {formatarNomeProduto(p.descricao)}
                </p>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0">
                  <span className="text-[11px] text-text-muted num">{p.codigo}</span>
                  {p.descricao_familia && (
                    <span className="text-[11px] text-text-muted">{p.descricao_familia}</span>
                  )}
                  {p.unidade && (
                    <span className="text-[11px] text-text-muted">{p.unidade}</span>
                  )}
                </div>
              </div>
              {/* Saldo e minimo */}
              <div className="shrink-0 text-right">
                <p className={`num text-[13px] font-medium ${p.saldo <= p.estoque_minimo && p.estoque_minimo > 0 ? 'text-err' : 'text-text'}`}>
                  {p.saldo.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}
                </p>
                {p.estoque_minimo > 0 && (
                  <p className="num text-[11px] text-text-muted">min {p.estoque_minimo}</p>
                )}
              </div>
              {/* Botao adicionar */}
              <button
                type="button"
                disabled={adicionando === p.codigo}
                onClick={() => handleAdicionar(p.codigo)}
                className="shrink-0 inline-flex items-center gap-1 rounded-md border border-border bg-surface px-2 py-1 text-[12px] font-medium text-text hover:bg-surface-2 disabled:opacity-50 transition-colors"
                title="Adicionar ao inventario"
              >
                {adicionando === p.codigo ? (
                  <Loader2 className="size-3 animate-spin" />
                ) : (
                  <Plus className="size-3" />
                )}
                Adicionar
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Ver mais */}
      {temMais && (
        <button
          type="button"
          disabled={carregando}
          onClick={() => buscarItens(offset, buscaAplicada)}
          className="w-full rounded-md border border-border bg-surface py-2 text-sm text-text-muted hover:bg-surface-2 disabled:opacity-50 transition-colors"
        >
          {carregando ? (
            <span className="flex items-center justify-center gap-2"><Loader2 className="size-4 animate-spin" /> Carregando...</span>
          ) : (
            `Ver mais (${(total - offset).toLocaleString('pt-BR')} restantes)`
          )}
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verificar TypeScript**

```bash
npx tsc --noEmit 2>&1 | head -20
```

Resultado esperado: sem erros.

- [ ] **Step 3: Commit**

```bash
git add "components/inventario/NaoContados.tsx"
git commit -m "feat: componente NaoContados com filtros tipo/familia/busca e botao adicionar"
```

---

## Task 4: Integrar NaoContados na tela de contagem

**Files:**
- Modify: `app/(app)/inventario/[id]/contagem/page.tsx`
- Modify: `components/inventario/ContagemInventario.tsx`

**Interfaces:**
- Consumes: `NaoContados` (Task 3), funcao `addInventarioItem` existente em `lib/actions/inventario.ts`
- Produces: tabs "Contados (N)" / "Nao contados (N)" visuals na tela de contagem

- [ ] **Step 1: Passar familias para ContagemInventario via page.tsx**

Em `app/(app)/inventario/[id]/contagem/page.tsx`, adicionar query de familias e passar como prop:

```typescript
// Apos a query de itensRaw (linha ~37), adicionar:
const { data: familiasData } = await supabase
  .from('produtos')
  .select('descricao_familia')
  .eq('loja_id', lojaId)
  .not('descricao_familia', 'is', null)
const familias = [...new Set(
  (familiasData ?? []).map((p) => p.descricao_familia).filter(Boolean)
)].sort() as string[]
```

Passar para o componente:
```tsx
<ContagemInventario
  inventarioId={inventario.id}
  itensIniciais={(itens ?? []) as ItemContagem[]}
  finalizado={finalizado}
  podeEditar={podeEditar}
  familias={familias}         {/* novo */}
/>
```

- [ ] **Step 2: Adicionar tabs ao ContagemInventario.tsx**

Abrir `components/inventario/ContagemInventario.tsx`. Localizar a definicao de props e adicionar `familias`:

```typescript
// Encontrar a interface/tipo de props e adicionar:
familias?: string[]
```

Localizar o retorno JSX. Antes da lista de itens, adicionar tabs:

```tsx
// Estado da aba ativa (fora do componente ou em useState):
const [aba, setAba] = useState<'contados' | 'nao_contados'>('contados')

// No topo do JSX, antes da lista:
{!finalizado && podeEditar && (
  <div className="flex gap-0 rounded-lg border border-border bg-surface-2 p-0.5 w-fit">
    <button
      type="button"
      onClick={() => setAba('contados')}
      className={`rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors ${
        aba === 'contados'
          ? 'bg-surface shadow-sm text-text'
          : 'text-text-muted hover:text-text'
      }`}
    >
      Contados <span className="ml-1 text-[11px] opacity-70">({itens.length})</span>
    </button>
    <button
      type="button"
      onClick={() => setAba('nao_contados')}
      className={`rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors ${
        aba === 'nao_contados'
          ? 'bg-surface shadow-sm text-text'
          : 'text-text-muted hover:text-text'
      }`}
    >
      Nao contados
    </button>
  </div>
)}
```

Adicionar renderizacao condicional:

```tsx
{/* Substituir o bloco que renderiza os itens por: */}
{aba === 'nao_contados' && !finalizado && podeEditar ? (
  <NaoContados
    inventarioId={inventarioId}
    familias={familias ?? []}
    onAdicionar={async (codigoProduto: string) => {
      // Reutilizar a funcao de adicionar produto existente no componente
      // Buscar o produto pelo codigo e chamar addInventarioItem
      await adicionarPorCodigo(codigoProduto)
    }}
  />
) : (
  // ... bloco existente de renderizacao dos itens contados (manter como estava)
)}
```

IMPORTANTE: `adicionarPorCodigo` e a funcao existente que busca pelo codigo e adiciona. Se o componente usa busca por QR/codigo, reutilizar a mesma logica. Verificar qual funcao ja existe no ContagemInventario que recebe um `produto_codigo` e adiciona -- adaptar para chamar com o codigo passado pelo NaoContados.

Tambem adicionar o import:
```tsx
import { NaoContados } from './NaoContados'
```

- [ ] **Step 3: Verificar TypeScript**

```bash
npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 4: Testar no browser (loja 3 ou 7)**

Abrir um inventario em aberto da loja 3. Verificar:
- Tabs "Contados (N)" e "Nao contados" aparecem
- Clicar em "Nao contados" mostra a lista de produtos
- Filtros de tipo/familia funcionam
- Clicar "Adicionar" move o produto para a lista de contados (sem quantidade ainda)
- A aba "Contados" volta a mostrar o produto adicionado

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/inventario/[id]/contagem/page.tsx" "components/inventario/ContagemInventario.tsx"
git commit -m "feat: aba nao contados na tela de contagem com filtros e adicionar rapido"
```

---

## Task 5: Seletor diario/semanal/mensal na listagem de inventarios

**Files:**
- Modify: `app/(app)/inventario/page.tsx`

**Interfaces:**
- Consumes: `inventario_cobertura` RPC (Task 1), searchParam `periodo` = `'dia' | 'semana' | 'mes'`
- Produces: listagem com painel de cobertura por periodo + chips de selecao de granularidade

- [ ] **Step 1: Adicionar `periodo` aos searchParams**

Em `app/(app)/inventario/page.tsx`, adicionar `periodo` ao tipo de `searchParams`:

```typescript
// No tipo de searchParams, adicionar:
periodo?: string
```

Logo apos `const sp = await searchParams`, calcular datas do periodo atual para a cobertura:

```typescript
const periodo = (sp.periodo === 'semana' || sp.periodo === 'mes') ? sp.periodo : 'dia'

// Janela de exibicao da cobertura: 30 dias para dia, 12 semanas para semana, 12 meses para mes
const hoje = new Date()
const janelas: Record<string, number> = { dia: 30, semana: 84, mes: 365 }
const dataIniCobertura = new Date(hoje.getTime() - janelas[periodo] * 86400000)
  .toISOString().slice(0, 10)
const dataFimCobertura = hoje.toISOString().slice(0, 10)
```

- [ ] **Step 2: Buscar dados de cobertura em paralelo**

Adicionar query de cobertura ao Promise.all existente (ou criar um novo se nao tiver):

```typescript
// Buscar cobertura em paralelo com a listagem
const [{ data: inventariosRaw }, { data: coberturaData }] = await Promise.all([
  query,
  supabase.rpc('inventario_cobertura', {
    p_loja_id: lojaId,
    p_ini: dataIniCobertura,
    p_fim: dataFimCobertura,
    p_periodo: periodo,
  }),
])
```

- [ ] **Step 3: Adicionar chips de periodo e painel de cobertura ao JSX**

Logo DEPOIS do `ListaHeader` (antes da `Lista`), adicionar:

```tsx
{/* Seletor de granularidade */}
<div className="flex items-center gap-2">
  <span className="text-[12px] text-text-muted">Ver por:</span>
  {(['dia', 'semana', 'mes'] as const).map((p) => {
    const sp2 = new URLSearchParams()
    if (sp.data_inicio) sp2.set('data_inicio', sp.data_inicio)
    if (sp.data_final) sp2.set('data_final', sp.data_final)
    if (sp.status) sp2.set('status', sp.status)
    sp2.set('periodo', p)
    const label = p === 'dia' ? 'Diario' : p === 'semana' ? 'Semanal' : 'Mensal'
    return (
      <Link
        key={p}
        href={`/inventario?${sp2.toString()}`}
        className={`rounded-full border px-3 py-1 text-[12px] font-medium transition-colors ${
          periodo === p
            ? 'border-brand bg-brand/10 text-brand'
            : 'border-border bg-surface text-text-muted hover:border-brand/40 hover:text-text'
        }`}
      >
        {label}
      </Link>
    )
  })}
</div>

{/* Painel de cobertura */}
{coberturaData && coberturaData.length > 0 && (
  <div className="rounded-lg border border-border bg-surface overflow-clip">
    <div className="border-b border-border bg-surface-2 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
      Cobertura de contagem ({periodo === 'dia' ? 'ultimos 30 dias' : periodo === 'semana' ? 'ultimas 12 semanas' : 'ultimos 12 meses'})
    </div>
    <div className="divide-y divide-border">
      {coberturaData.map((row: { periodo_inicio: string; qtd_inventarios: number; produtos_contados: number; total_produtos: number }) => {
        const pct = row.total_produtos > 0
          ? Math.round((row.produtos_contados / row.total_produtos) * 100)
          : 0
        const label = periodo === 'dia'
          ? new Date(row.periodo_inicio + 'T12:00:00').toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' })
          : periodo === 'semana'
          ? `Semana de ${new Date(row.periodo_inicio + 'T12:00:00').toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}`
          : new Date(row.periodo_inicio + 'T12:00:00').toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })
        return (
          <div key={row.periodo_inicio} className="flex items-center gap-3 px-4 py-2">
            <span className="w-40 shrink-0 text-[13px] text-text-muted capitalize">{label}</span>
            <div className="flex-1">
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
                <div
                  className={`h-full rounded-full transition-all ${pct >= 80 ? 'bg-ok' : pct >= 40 ? 'bg-warn' : 'bg-err/60'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>
            <span className="w-20 shrink-0 text-right text-[12px] text-text-muted num">
              {row.produtos_contados}/{row.total_produtos}
            </span>
            <span className={`w-10 shrink-0 text-right num text-[12px] font-medium ${pct >= 80 ? 'text-ok' : pct >= 40 ? 'text-warn' : 'text-err'}`}>
              {pct}%
            </span>
            <span className="w-24 shrink-0 text-right text-[11px] text-text-muted">
              {row.qtd_inventarios} {row.qtd_inventarios === 1 ? 'inv.' : 'invs.'}
            </span>
          </div>
        )
      })}
    </div>
  </div>
)}
```

- [ ] **Step 4: Verificar TypeScript**

```bash
npx tsc --noEmit 2>&1 | head -20
```

- [ ] **Step 5: Testar no browser**

Abrir `/inventario`. Verificar:
- Chips "Diario / Semanal / Mensal" aparecem
- Ao clicar em "Semanal", o painel muda para semanas
- Barra de progresso fica verde (>=80%), amarela (>=40%) ou vermelha (<40%)
- A listagem de inventarios abaixo continua funcionando normalmente

- [ ] **Step 6: Commit e push**

```bash
git add "app/(app)/inventario/page.tsx"
git commit -m "feat: seletor diario/semanal/mensal com cobertura de contagem por periodo"
git push
```

---

## Self-Review

### Cobertura dos requisitos

- [x] Filtro de produtos nao contados no inventario -- Tasks 1, 2, 3, 4
- [x] Filtro por tipo na lista de nao contados -- Task 3 (Combobox tipo)
- [x] Filtro por familia na lista de nao contados -- Task 3 (Combobox familia)
- [x] Busca textual na lista de nao contados -- Task 3 (input busca)
- [x] Botao adicionar produto direto da lista de nao contados -- Task 3 (onAdicionar)
- [x] Saldo atual e minimo ao lado de cada produto -- Task 1 (RPC), Task 3 (render)
- [x] Periodo diario -- Task 5 (periodo='dia')
- [x] Periodo semanal -- Task 5 (periodo='semana')
- [x] Periodo mensal -- Task 5 (periodo='mes')
- [x] Indicador de cobertura (% de produtos contados) por periodo -- Tasks 1, 5

### Restricoes criticas

- Loja 4 proibida para testes ao vivo
- NaoContados.tsx usa 'use client' (client component que faz fetch)
- Migration 048 deve ser aplicada ANTES de testar as Tasks 2-5
- ContagemInventario.tsx -- verificar como `adicionarPorCodigo` esta implementado antes de conectar o callback (nao inventar uma funcao que nao existe)

### Ordem de execucao

Task 1 (migration) -> Task 2 (endpoint) -> Task 3 (componente) -> Task 4 (integracao) -> Task 5 (listagem)

Estimativa: ~6h total
