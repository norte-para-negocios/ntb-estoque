# Filtros completos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar os 14 filtros faltantes identificados no spec (v2) em 9 telas, mais a correção de ingestão do Faturamento (dimensão "produto").

**Architecture:** Replicação do padrão já estabelecido (`campos: CampoFiltro[]` + `FiltrosGaveta` + filtro aplicado na query/RPC do servidor). Duas migrations novas adicionam parâmetros a funções SQL já existentes (`relatorio_compras_*`, `relatorio_auditoria_fiscal_*`); todo o resto é TypeScript puro.

**Tech Stack:** Next.js 16 App Router, TypeScript, Supabase (Postgres + PostgREST).

## Global Constraints

- Sem suite de testes automatizada neste repo — verificação de cada task é manual (`npm run dev` + Playwright com a conta QA `claude.qa@ntb-estoque.dev` / `claudeqa123456`).
- Migrations aplicadas via `node scripts/aplicar-migration.mjs <arquivo>.sql`. Próximo número livre: **075** (`074_produto_substituicoes.sql` já existe).
- Campo confirmado pra "local de estoque" em dados de nota fiscal: `full_object->'itensAjustes'->>'codigo_local_estoque'` (JSON, dentro de `nota_fiscal_items`).
- Nenhum componente novo — sempre reusar `FiltrosGaveta`/`CampoFiltro`/`ChipsFiltrosAtivos` já existentes.

---

### Task 1: Transferências — filtro de produto

**Files:**
- Modify: `app/(app)/transferencia/page.tsx`

**Interfaces:** nenhuma — mudança isolada nesta página.

- [ ] **Step 1: Adicionar `produto` ao tipo de `searchParams`**

Trocar (linhas 28-37):
```ts
  searchParams: Promise<{
    data_inicio?: string
    data_final?: string
    familia?: string
    tipo?: string
    status?: string
    motivo?: string
    local?: string
    page?: string
  }>
```
por:
```ts
  searchParams: Promise<{
    data_inicio?: string
    data_final?: string
    familia?: string
    tipo?: string
    status?: string
    motivo?: string
    local?: string
    page?: string
    produto?: string
  }>
```

- [ ] **Step 2: Importar `escapeIlikeOr` e estender a resolução de `idsFiltrados`**

Adicionar import (perto dos demais imports de `lib`):
```ts
import { escapeIlikeOr } from '@/lib/utils-busca'
```

Trocar (linhas 61-87):
```ts
  const familiasArr = valoresMulti(sp.familia)
  const tiposArr = valoresMulti(sp.tipo)
  let idsFiltrados: number[] | null = null
  if (familiasArr.length || tiposArr.length) {
    let prodQuery = supabase.from('produtos').select('codigo_produto').eq('loja_id', lojaId)
    if (familiasArr.length) prodQuery = prodQuery.in('descricao_familia', familiasArr)
    if (tiposArr.length) prodQuery = prodQuery.in('tipo_item', tiposArr)
    const { data: prods } = await prodQuery
    const codigos = [...new Set((prods ?? []).map((p) => p.codigo_produto).filter(Boolean))]

    if (codigos.length) {
      const { data: movsData } = await supabase
        .from('movimentos')
        .select('id, transferencia_id')
        .eq('loja_id', lojaId)
        .in('id_prod', codigos)
        .not('transferencia_id', 'is', null)
      const movs = await complementarMovimentos(movsData ?? [], { lojaId })
      idsFiltrados = [...new Set((movs ?? []).map((m) => m.transferencia_id).filter((v): v is number => v != null))]
    } else {
      idsFiltrados = []
    }
  }
```
por:
```ts
  const familiasArr = valoresMulti(sp.familia)
  const tiposArr = valoresMulti(sp.tipo)
  let idsFiltrados: number[] | null = null
  if (familiasArr.length || tiposArr.length || sp.produto) {
    let prodQuery = supabase.from('produtos').select('codigo_produto').eq('loja_id', lojaId)
    if (familiasArr.length) prodQuery = prodQuery.in('descricao_familia', familiasArr)
    if (tiposArr.length) prodQuery = prodQuery.in('tipo_item', tiposArr)
    if (sp.produto) {
      const termo = escapeIlikeOr(sp.produto)
      prodQuery = prodQuery.or(`descricao.ilike.%${termo}%,codigo.ilike.%${termo}%`)
    }
    const { data: prods } = await prodQuery
    const codigos = [...new Set((prods ?? []).map((p) => p.codigo_produto).filter(Boolean))]

    if (codigos.length) {
      const { data: movsData } = await supabase
        .from('movimentos')
        .select('id, transferencia_id')
        .eq('loja_id', lojaId)
        .in('id_prod', codigos)
        .not('transferencia_id', 'is', null)
      const movs = await complementarMovimentos(movsData ?? [], { lojaId })
      idsFiltrados = [...new Set((movs ?? []).map((m) => m.transferencia_id).filter((v): v is number => v != null))]
    } else {
      idsFiltrados = []
    }
  }
```

- [ ] **Step 3: Adicionar o campo em `campos: CampoFiltro[]` e em `defaults`**

Adicionar ao array `campos` (perto da entrada de `familia`, linhas 163-202):
```ts
  { tipo: 'texto', nome: 'produto', label: 'Produto (nome ou código)' },
```

Adicionar em `defaults={{ ... }}` do `<FiltrosGaveta>`: `produto: sp.produto ?? ''`.

- [ ] **Step 4: Verificação manual**

`npm run dev`, abrir `/transferencia?produto=<nome de um produto real>`, confirmar que a lista filtra pra só as transferências que envolveram aquele produto.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/transferencia/page.tsx"
git commit -m "feat(transferencia): adiciona filtro de produto"
```

---

### Task 2: Inventário — filtros de produto e local de estoque

**Files:**
- Modify: `app/(app)/inventario/page.tsx`

**Interfaces:** nenhuma.

- [ ] **Step 1: Adicionar `produto` e `local` ao tipo de `searchParams`**

Trocar (linhas 29-38):
```ts
  searchParams: Promise<{
    data_inicio?: string
    data_final?: string
    familia?: string
    tipo?: string
    status?: string
    page?: string
    ord?: string
    dir?: string
  }>
```
por:
```ts
  searchParams: Promise<{
    data_inicio?: string
    data_final?: string
    familia?: string
    tipo?: string
    status?: string
    page?: string
    ord?: string
    dir?: string
    produto?: string
    local?: string
  }>
```

- [ ] **Step 2: Importar `escapeIlikeOr` e `valoresMulti`, estender o bloco de `itemQuery`**

Adicionar import: `import { escapeIlikeOr } from '@/lib/utils-busca'` (se `valoresMulti` já não estiver importado de `@/components/ui-kit/filtros-utils`, adicionar também).

Trocar (linhas 65-92, condição de entrada do bloco):
```ts
  let itemQuery = supabase.from('inventario_items').select('inventario_id').eq('loja_id', lojaId)
  if (sp.familia) itemQuery = itemQuery.eq('produto_familia', sp.familia)
  if (codigosTipo !== null) itemQuery = itemQuery.in('produto_codigo_produto', codigosTipo)
  const { data: items } = await itemQuery
  idsFiltrados = [...new Set((items ?? []).map((i) => i.inventario_id).filter((v): v is number => v != null))]
```
por (a condição que decide SE monta o `itemQuery` também precisa incluir `sp.produto` — ajustar o `if` externo que envolve esse bloco no arquivo real pra também checar `sp.produto`):
```ts
  let itemQuery = supabase.from('inventario_items').select('inventario_id').eq('loja_id', lojaId)
  if (sp.familia) itemQuery = itemQuery.eq('produto_familia', sp.familia)
  if (codigosTipo !== null) itemQuery = itemQuery.in('produto_codigo_produto', codigosTipo)
  if (sp.produto) {
    const termo = escapeIlikeOr(sp.produto)
    itemQuery = itemQuery.or(`produto_descricao.ilike.%${termo}%,produto_codigo.ilike.%${termo}%`)
  }
  const { data: items } = await itemQuery
  idsFiltrados = [...new Set((items ?? []).map((i) => i.inventario_id).filter((v): v is number => v != null))]
```

- [ ] **Step 3: Adicionar filtro de local de estoque na query principal de `inventarios`**

Buscar a lista de locais (mesma query já usada em outras telas) antes do `campos`:
```ts
  const { data: locaisRaw } = await supabase
    .from('local_estoques')
    .select('codigo_local_estoque, descricao')
    .eq('loja_id', lojaId)
    .order('descricao')
```

Na query principal de `inventarios` (linhas 94-108), adicionar:
```ts
  const locaisArr = valoresMulti(sp.local).map((v) => Number(v)).filter((n) => !Number.isNaN(n))
  if (locaisArr.length) query = query.in('codigo_local_estoque', locaisArr)
```
(inserir logo após o `.eq('loja_id', lojaId)` da query de `inventarios`, antes do `.range(...)` final).

- [ ] **Step 4: Adicionar os campos em `campos: CampoFiltro[]` e `defaults`**

```ts
  { tipo: 'texto', nome: 'produto', label: 'Produto (nome ou código)' },
  {
    tipo: 'multi-select',
    nome: 'local',
    label: 'Local de estoque',
    opcoes: (locaisRaw ?? [])
      .slice()
      .sort((a, b) => (a.descricao ?? '').localeCompare(b.descricao ?? '', 'pt-BR'))
      .map((l) => ({ value: String(l.codigo_local_estoque), label: l.descricao ?? String(l.codigo_local_estoque) })),
  },
```
E em `defaults`: `produto: sp.produto ?? '', local: sp.local ?? ''`.

- [ ] **Step 5: Verificação manual**

`npm run dev`, abrir `/inventario?produto=<nome>` e `/inventario?local=<codigo>`, confirmar que cada um filtra a lista corretamente (e juntos, que a interseção funciona).

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/inventario/page.tsx"
git commit -m "feat(inventario): adiciona filtros de produto e local de estoque"
```

---

### Task 3: Nota Fiscal — filtros de família e local de estoque

**Files:**
- Modify: `app/(app)/nota-fiscal/page.tsx`

**Interfaces:** nenhuma.

- [ ] **Step 1: Adicionar `familia` e `local` ao tipo de `searchParams`**

Trocar (linhas 39-52):
```ts
  searchParams: Promise<{
    data_inicio?: string
    data_final?: string
    num_nfe?: string
    fornecedor?: string
    status?: string
    tipo?: string
    natureza?: string
    produto?: string
    categoria?: string
    page?: string
    ord?: string
    dir?: string
  }>
```
por:
```ts
  searchParams: Promise<{
    data_inicio?: string
    data_final?: string
    num_nfe?: string
    fornecedor?: string
    status?: string
    tipo?: string
    natureza?: string
    produto?: string
    categoria?: string
    page?: string
    ord?: string
    dir?: string
    familia?: string
    local?: string
  }>
```

- [ ] **Step 2: Estender a resolução de `notaIds` pra também considerar família e local**

Trocar o bloco (linhas 76-124) inteiro por (adiciona `familiasArr`/`localCod` e as condições correspondentes, preservando a lógica existente de `tipo`/`produto`):
```ts
  const tiposArr = valoresMulti(params.tipo)
  const familiasArr = valoresMulti(params.familia)
  const localCod = params.local && !Number.isNaN(Number(params.local)) ? Number(params.local) : null
  let notaIds: number[] | null = null
  if (tiposArr.length || familiasArr.length || params.produto || localCod !== null) {
    let codigos: string[] | null = null
    if (tiposArr.length || familiasArr.length) {
      let prodQuery = supabase.from('produtos').select('codigo_produto').eq('loja_id', lojaId)
      if (tiposArr.length) prodQuery = prodQuery.in('tipo_item', tiposArr)
      if (familiasArr.length) prodQuery = prodQuery.in('descricao_familia', familiasArr)
      const { data: prodCodigos } = await prodQuery
      codigos = (prodCodigos ?? []).map((p) => String(p.codigo_produto))
      if (codigos.length === 0) {
        notaIds = []
      }
    }

    if (notaIds === null) {
      let itemQuery = supabase
        .from('nota_fiscal_items')
        .select('nota_fiscal_id')
        .eq('loja_id', lojaId)
      if (codigos) itemQuery = itemQuery.in('produto_codigo', codigos)
      if (params.produto) {
        const p = escapeIlikeOr(params.produto)
        itemQuery = itemQuery.or(`c_descricao_produto.ilike.%${p}%,c_codigo_produto.ilike.%${p}%`)
      }
      if (localCod !== null) {
        itemQuery = itemQuery.eq('full_object->itensAjustes->>codigo_local_estoque', String(localCod))
      }
      const { data: itemRows } = await itemQuery
      notaIds = Array.from(
        new Set((itemRows ?? []).map((r) => r.nota_fiscal_id).filter((v): v is number => v != null)),
      )
    }
  }
  const idsIn = notaIds !== null ? (notaIds.length ? notaIds : [-1]) : null
```

> Atenção ao aplicar: `escapeIlikeOr` já precisa estar importado neste arquivo (usada anteriormente em `params.produto`, confirmar que já não muda de nome). O `idsIn` resultante já é usado nas 3 queries existentes (paginada, totais, Contabo) — nenhuma delas precisa mudar, só essa resolução acima.

- [ ] **Step 3: Buscar opções de família e local, adicionar aos `campos` e `defaults`**

Antes do array `campos` (perto de onde `buscarFamilias`/locais já são buscados nesse arquivo, ou adicionar):
```ts
  const familiasOpcoes = await buscarFamilias()
  const { data: locaisRaw } = await supabase
    .from('local_estoques')
    .select('codigo_local_estoque, descricao')
    .eq('loja_id', lojaId)
    .order('descricao')
```
(`buscarFamilias` de `@/lib/actions/produto` — importar se ainda não estiver).

Adicionar ao array `campos` (linhas 245-268):
```ts
  { tipo: 'multi-select', nome: 'familia', label: 'Família', opcoes: familiasOpcoes.map((f) => ({ value: f.descricao, label: f.descricao })) },
  {
    tipo: 'select',
    nome: 'local',
    label: 'Local de estoque',
    opcoes: (locaisRaw ?? []).map((l) => ({ value: String(l.codigo_local_estoque), label: l.descricao ?? String(l.codigo_local_estoque) })),
  },
```

Adicionar em `defaults={{ ... }}` (linhas 282-292): `familia: params.familia ?? '', local: params.local ?? ''`.

- [ ] **Step 4: Verificação manual**

`npm run dev`, abrir `/nota-fiscal?familia=<família real>` e `/nota-fiscal?local=<código de local real>`, confirmar que cada um filtra a lista.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/nota-fiscal/page.tsx"
git commit -m "feat(nota-fiscal): adiciona filtros de familia e local de estoque"
```

---

### Task 4: Movimentações (aba Movimentos) — filtros de família e tipo

**Files:**
- Modify: `components/movimentacoes/MovimentosTab.tsx`
- Modify: `app/(app)/movimentacoes/page.tsx`

**Interfaces:** nenhuma nova.

- [ ] **Step 1: Adicionar `familia`/`tipo` ao tipo `SP` de `MovimentosTab.tsx`**

Trocar (linha 37):
```ts
type SP = { data_inicio?: string; data_final?: string; produto?: string; local?: string }
```
por:
```ts
type SP = { data_inicio?: string; data_final?: string; produto?: string; local?: string; familia?: string; tipo?: string }
```

- [ ] **Step 2: Intersectar `idsProdDetalhes` com família/tipo quando presentes**

Código real confirmado em `components/movimentacoes/MovimentosTab.tsx` (linhas 95-120):
```ts
  const termo = sp.produto ? escapeIlikeOr(sp.produto) : null
  let movDetalhes: LinhaDetalhe[] = []
  let idsProdDetalhes: number[] = []
  let produtoUnico: { id_prod: number; codigo: string; descricao: string } | null = null
  const locaisMap = new Map<number, string>()
  let saldoInicial: number | null = null
  let saldoFinal: number | null = null
  let totalOmie: { entradas: number; saidas: number } | null = null

  if (termo) {
    const { data: prodsMatch } = await supabase
      .from('produtos')
      .select('codigo_produto, codigo, descricao')
      .eq('loja_id', lojaId)
      .or(`descricao.ilike.%${termo}%,codigo.ilike.%${termo}%`)
      .limit(100)

    idsProdDetalhes = [...new Set((prodsMatch ?? []).map((p) => Number(p.codigo_produto)).filter(Boolean))]
    if (idsProdDetalhes.length === 1) {
      const p = (prodsMatch ?? [])[0] as { codigo_produto: number; codigo: string; descricao: string } | undefined
      if (p) produtoUnico = { id_prod: Number(p.codigo_produto), codigo: p.codigo, descricao: p.descricao }
    }

    if (idsProdDetalhes.length) {
      ...
```

Inserir o filtro de família/tipo logo depois da linha `idsProdDetalhes = [...new Set(...)]` e **antes** do `if (idsProdDetalhes.length === 1)` (pra que a detecção de "produto único" já reflita o resultado filtrado):
```ts
    idsProdDetalhes = [...new Set((prodsMatch ?? []).map((p) => Number(p.codigo_produto)).filter(Boolean))]

    if ((sp.familia || sp.tipo) && idsProdDetalhes.length) {
      let fq = supabase.from('produtos').select('codigo_produto').eq('loja_id', lojaId).in('codigo_produto', idsProdDetalhes)
      if (sp.familia) fq = fq.eq('descricao_familia', sp.familia)
      if (sp.tipo) fq = fq.eq('tipo_item', sp.tipo)
      const { data: prodsFiltro } = await fq
      const codigosFiltro = new Set((prodsFiltro ?? []).map((p) => Number(p.codigo_produto)))
      idsProdDetalhes = idsProdDetalhes.filter((id) => codigosFiltro.has(id))
    }

    if (idsProdDetalhes.length === 1) {
      const p = (prodsMatch ?? [])[0] as { codigo_produto: number; codigo: string; descricao: string } | undefined
      if (p) produtoUnico = { id_prod: Number(p.codigo_produto), codigo: p.codigo, descricao: p.descricao }
    }
```

- [ ] **Step 3: Adicionar seletores de família e tipo na UI da aba**

Buscar família/tipo perto de onde `locais` já é buscado (linhas 84-93 da versão atual):
```ts
  const { data: familiasRaw } = await supabase
    .from('familias')
    .select('nome')
    .eq('loja_id', lojaId)
    .eq('inativo', false)
    .order('nome')
  const familias = (familiasRaw ?? []).map((f) => f.nome as string)
```
(tipo usa a lista fixa `PRODUTO_TIPO_ITEM` de `@/lib/constants-omie`, já usada em outras telas — importar direto, não precisa buscar do banco).

Criar `components/movimentacoes/FiltroFamiliaMovimentos.tsx` (mesmo molde de `FiltroLocalMovimentos.tsx`):
```tsx
'use client'

import { useRouter, useSearchParams } from 'next/navigation'

export function FiltroFamiliaMovimentos({ familias, valorAtual }: { familias: string[]; valorAtual: string }) {
  const router = useRouter()
  const sp = useSearchParams()

  function trocar(v: string) {
    const params = new URLSearchParams(sp.toString())
    if (v) params.set('familia', v)
    else params.delete('familia')
    router.push(`/movimentacoes?${params.toString()}`)
  }

  return (
    <select
      value={valorAtual}
      onChange={(e) => trocar(e.target.value)}
      className="h-8 rounded-md border border-border bg-surface px-2 text-[13px] text-text outline-none transition-colors focus:border-brand"
    >
      <option value="">Todas as famílias</option>
      {familias.map((f) => (
        <option key={f} value={f}>{f}</option>
      ))}
    </select>
  )
}
```

Criar `components/movimentacoes/FiltroTipoMovimentos.tsx` (mesmo molde, opções fixas):
```tsx
'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { PRODUTO_TIPO_ITEM } from '@/lib/constants-omie'

export function FiltroTipoMovimentos({ valorAtual }: { valorAtual: string }) {
  const router = useRouter()
  const sp = useSearchParams()

  function trocar(v: string) {
    const params = new URLSearchParams(sp.toString())
    if (v) params.set('tipo', v)
    else params.delete('tipo')
    router.push(`/movimentacoes?${params.toString()}`)
  }

  return (
    <select
      value={valorAtual}
      onChange={(e) => trocar(e.target.value)}
      className="h-8 rounded-md border border-border bg-surface px-2 text-[13px] text-text outline-none transition-colors focus:border-brand"
    >
      <option value="">Todos os tipos</option>
      {PRODUTO_TIPO_ITEM.map((t) => (
        <option key={t.value} value={t.value}>{t.label}</option>
      ))}
    </select>
  )
}
```

Trocar o bloco de ações (linhas 326-335 confirmadas):
```tsx
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <BuscaProdutoInline valorAtual={sp.produto ?? ''} />
        <FiltroDataMovimentos ini={ini} fim={fim} />
        <FiltroLocalMovimentos locais={locais} valorAtual={sp.local ?? ''} />
        {podeCriar && produtoUnico && (
          <NovoAjusteManual locais={locais} produto={produtoUnico} />
        )}
      </div>
```
por:
```tsx
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <BuscaProdutoInline valorAtual={sp.produto ?? ''} />
        <FiltroDataMovimentos ini={ini} fim={fim} />
        <FiltroLocalMovimentos locais={locais} valorAtual={sp.local ?? ''} />
        <FiltroFamiliaMovimentos familias={familias} valorAtual={sp.familia ?? ''} />
        <FiltroTipoMovimentos valorAtual={sp.tipo ?? ''} />
        {podeCriar && produtoUnico && (
          <NovoAjusteManual locais={locais} produto={produtoUnico} />
        )}
      </div>
```
(adicionar os 2 imports novos no topo do arquivo, mesmo padrão de `import { FiltroLocalMovimentos } from './FiltroLocalMovimentos'`).

- [ ] **Step 4: Passar `sp` com os novos campos em `movimentacoes/page.tsx`**

Em `app/(app)/movimentacoes/page.tsx`, o tipo de `searchParams` (linhas 18-29) já inclui `familia?: string; tipo?: string` — confirmar que esses valores continuam sendo passados pra `<MovimentosTab sp={sp} lojaId={lojaId} />` (linha 90) sem mudança adicional (já são repassados via `sp` inteiro).

- [ ] **Step 5: Verificação manual**

`npm run dev`, abrir `/movimentacoes?aba=movimentos`, buscar um produto, depois aplicar família e tipo, confirmar que a busca por produto continua funcionando E que família/tipo restringem ainda mais o resultado.

- [ ] **Step 6: Commit**

```bash
git add components/movimentacoes/MovimentosTab.tsx components/movimentacoes/FiltroFamiliaMovimentos.tsx components/movimentacoes/FiltroTipoMovimentos.tsx
git commit -m "feat(movimentacoes): adiciona filtros de familia e tipo na aba Movimentos"
```

---

### Task 5: Relatório de Movimentação (modo operação) — filtros de família, tipo e período

**Files:**
- Modify: `app/(app)/relatorio-movimentacao/page.tsx`

**Interfaces:** nenhuma.

- [ ] **Step 1: Adicionar `familia`/`tipo` (já existe `familia`/`tipo` no tipo geral de `searchParams` — confirmar, já que a página cobre os dois modos) e ler os novos valores no bloco "modo operação"**

O tipo de `searchParams` (linhas 43-47) já tem `produto?, tipo?, familia?, local?` — esses nomes já existem porque o modo "quantidade" os usa. Reaproveitar as MESMAS chaves para o modo "operação" (não criar nomes novos).

Dentro do bloco do modo "operação" (linhas 74-107), depois de calcular `origens`/`locais`, adicionar:
```ts
  const familiasSel = valoresMulti(sp.familia)
  const tiposSel = valoresMulti(sp.tipo)
  const mesIniOp = sp.data_inicio ? sp.data_inicio.slice(0, 7) : null
  const mesFimOp = sp.data_final ? sp.data_final.slice(0, 7) : null
  const familias = [...new Set(rows.map((r) => r.familia))].sort()
  const tiposSped = [...new Set(rows.map((r) => r.tipo_sped))].sort()
```

- [ ] **Step 2: Aplicar os 3 filtros no predicado `filtradas` já existente**

Localizar o filtro `filtradas` (linhas 172-176) e adicionar as 3 condições novas ao mesmo `.filter(...)`:
```ts
  const filtradas = rows.filter((r) => {
    if (opsSel.length && !opsSel.includes(r.origem)) return false
    if (locsSel.length && !locsSel.includes(r.local)) return false
    if (sentSel.length && !sentSel.includes(r.sentido)) return false
    if (familiasSel.length && !familiasSel.includes(r.familia)) return false
    if (tiposSel.length && !tiposSel.includes(r.tipo_sped)) return false
    if (mesIniOp && r.mes < mesIniOp) return false
    if (mesFimOp && r.mes > mesFimOp) return false
    return true
  })
```
(preservar as condições originais `op`/`loc`/`sent` exatamente como já estão — só adicionar as 3 novas linhas de `if`).

- [ ] **Step 3: Adicionar os campos em `campos: CampoFiltro[]` do modo operação**

Trocar (linhas 103-107):
```ts
const campos: CampoFiltro[] = [
  { tipo: 'multi-select', nome: 'op', label: 'Operação', opcoes: origens.map((o) => ({ value: o, label: o })) },
  { tipo: 'multi-select', nome: 'loc', label: 'Local de estoque', opcoes: locais.map((l) => ({ value: l, label: l })) },
  { tipo: 'multi-select', nome: 'sent', label: 'Sentido', opcoes: [{ value: 'E', label: 'Entrada' }, { value: 'S', label: 'Saída' }] },
]
```
por:
```ts
const campos: CampoFiltro[] = [
  { tipo: 'multi-select', nome: 'op', label: 'Operação', opcoes: origens.map((o) => ({ value: o, label: o })) },
  { tipo: 'multi-select', nome: 'loc', label: 'Local de estoque', opcoes: locais.map((l) => ({ value: l, label: l })) },
  { tipo: 'multi-select', nome: 'sent', label: 'Sentido', opcoes: [{ value: 'E', label: 'Entrada' }, { value: 'S', label: 'Saída' }] },
  { tipo: 'multi-select', nome: 'familia', label: 'Família', opcoes: familias.map((f) => ({ value: f, label: f })) },
  { tipo: 'multi-select', nome: 'tipo', label: 'Tipo (SPED)', opcoes: tiposSped.map((t) => ({ value: t, label: t })) },
  { tipo: 'data', nome: 'data_inicio', label: 'Mês inicial (dia é ignorado)' },
  { tipo: 'data', nome: 'data_final', label: 'Mês final (dia é ignorado)' },
]
```

> Os rótulos "Mês inicial/final (dia é ignorado)" avisam explicitamente que a granularidade é mensal, já que `movimentacao_operacao.mes` não guarda dia — evita o usuário achar que o filtro tem precisão de dia como nas outras telas.

- [ ] **Step 4: Verificação manual**

`npm run dev`, abrir `/relatorio-movimentacao?modo=operacao`, aplicar família, tipo e período, confirmar que a tabela filtra corretamente e que o rótulo dos campos de data deixa claro que é granularidade de mês.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/relatorio-movimentacao/page.tsx"
git commit -m "feat(relatorio-movimentacao): filtros de familia/tipo/periodo no modo operacao"
```

---

### Task 6: Validade — filtro de local de estoque

**Files:**
- Modify: `app/(app)/validade/page.tsx`

**Interfaces:** nenhuma.

- [ ] **Step 1: Adicionar `local` ao tipo de `searchParams`**

Trocar (linha 49):
```ts
  searchParams: Promise<{ dias?: string; tipo?: string; modo?: string; familia?: string; produto?: string }>
```
por:
```ts
  searchParams: Promise<{ dias?: string; tipo?: string; modo?: string; familia?: string; produto?: string; local?: string }>
```

- [ ] **Step 2: Buscar locais e aplicar o filtro na query de `ordens_producao`**

Antes do bloco de `codigosTipo` (linha 66), adicionar:
```ts
  const { data: locaisRaw } = await supabase
    .from('local_estoques')
    .select('codigo_local_estoque, descricao')
    .eq('loja_id', lojaId)
    .order('descricao')
  const localCod = sp.local && !Number.isNaN(Number(sp.local)) ? Number(sp.local) : null
```

Na query `ordensQuery` (linhas 79-90), adicionar logo após `.not('validade', 'is', null)`:
```ts
  if (localCod !== null) ordensQuery = ordensQuery.eq('identificacao_codigo_local_estoque', localCod)
```

Nas duas queries de contagem (`queryContagem()`, linhas 130-141, e `vencidasQuery`, linhas 157-166), adicionar a mesma condição dentro de cada uma (`.eq('identificacao_codigo_local_estoque', localCod)` quando `localCod !== null`), pra que os chips de contagem por período continuem batendo com a lista filtrada.

- [ ] **Step 3: Adicionar o campo em `campos` e no `sufixo`/`defaults`**

Adicionar ao array `campos` (linhas 178-182):
```ts
  {
    tipo: 'select',
    nome: 'local',
    label: 'Local de estoque',
    opcoes: (locaisRaw ?? []).map((l) => ({ value: String(l.codigo_local_estoque), label: l.descricao ?? String(l.codigo_local_estoque) })),
  },
```

Adicionar `local` ao array `extra` (linhas 185-189, que preserva filtros ao trocar de período) e em `defaults={{ ... }}` (linha 204): `local: sp.local ?? ''`.

- [ ] **Step 4: Verificação manual**

`npm run dev`, abrir `/validade?local=<código real>`, confirmar que a lista e os chips de contagem por período batem entre si.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/validade/page.tsx"
git commit -m "feat(validade): adiciona filtro de local de estoque"
```

---

### Task 7: Auditoria Fiscal — ligar o parâmetro `fornecedor` já existente no drill-down

**Files:**
- Modify: `app/(app)/auditoria-fiscal/page.tsx`

**Interfaces:** nenhuma — `p_fornecedor` já existe na função `relatorio_auditoria_fiscal_itens` (migration 047), esta task só passa o valor.

- [ ] **Step 1: Adicionar `fornecedor` ao tipo de `searchParams`**

Trocar (linha 33):
```ts
  searchParams: Promise<{ data_inicio?: string; data_final?: string; cfop?: string }>
```
por:
```ts
  searchParams: Promise<{ data_inicio?: string; data_final?: string; cfop?: string; fornecedor?: string }>
```

- [ ] **Step 2: Passar `p_fornecedor` na chamada da RPC de itens**

Trocar (linhas 66-70):
```ts
    const { data } = await supabase
      .rpc('relatorio_auditoria_fiscal_itens', {
        p_loja_id: lojaId, p_ini: ini, p_fim: fim, p_cfop_doc: cfopDocSel, p_cfop_entrada: cfopEntSel,
      })
      .range(0, 299)
```
por:
```ts
    const { data } = await supabase
      .rpc('relatorio_auditoria_fiscal_itens', {
        p_loja_id: lojaId, p_ini: ini, p_fim: fim, p_cfop_doc: cfopDocSel, p_cfop_entrada: cfopEntSel,
        p_fornecedor: sp.fornecedor || null,
      })
      .range(0, 299)
```

- [ ] **Step 3: Adicionar o campo em `campos` e `defaults`**

Trocar (linhas 74-77):
```ts
  const campos: CampoFiltro[] = [
    { tipo: 'data', nome: 'data_inicio', label: 'Data inicial' },
    { tipo: 'data', nome: 'data_final', label: 'Data final' },
  ]
```
por:
```ts
  const campos: CampoFiltro[] = [
    { tipo: 'data', nome: 'data_inicio', label: 'Data inicial' },
    { tipo: 'data', nome: 'data_final', label: 'Data final' },
    { tipo: 'texto', nome: 'fornecedor', label: 'Fornecedor (só no detalhe do CFOP)' },
  ]
```
E em `defaults={{ ... }}` (linha 101): `fornecedor: sp.fornecedor ?? ''`.

> Rótulo deixa explícito que esse filtro só afeta o drill-down (a tabela de itens), não o resumo por CFOP — a task 9 abaixo é o que adiciona fornecedor ao resumo, via migration.

- [ ] **Step 4: Verificação manual**

`npm run dev`, abrir `/auditoria-fiscal`, clicar num CFOP pra abrir o drill-down, aplicar o filtro de fornecedor, confirmar que a tabela de itens filtra.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/auditoria-fiscal/page.tsx"
git commit -m "feat(auditoria-fiscal): liga o filtro de fornecedor ja existente na RPC de itens"
```

---

### Task 8: Faturamento — dimensão "produto" (correção de ingestão, sem migration)

**Files:**
- Modify: `lib/omie/faturamento.ts`
- Modify: `app/(app)/relatorio-faturamento/page.tsx`

**Interfaces:**
- Produces: linhas com `dimensao='produto'` em `faturamento_importado` — nenhuma outra task depende disso.

- [ ] **Step 1: Estender o `select` de produtos e gravar a dimensão "produto"**

Trocar (linhas 45-48):
```ts
  const { data: prods } = await supabase
    .from('produtos')
    .select('codigo_produto, tipo_item, descricao_familia')
    .eq('loja_id', loja.id)
  const mapProd = new Map<number, { tipo: string | null; familia: string | null }>()
  for (const p of prods ?? []) {
    mapProd.set(Number(p.codigo_produto), {
      tipo: p.tipo_item as string | null,
      familia: p.descricao_familia as string | null,
    })
  }
```
por:
```ts
  const { data: prods } = await supabase
    .from('produtos')
    .select('codigo_produto, tipo_item, descricao_familia, codigo, descricao')
    .eq('loja_id', loja.id)
  const mapProd = new Map<number, { tipo: string | null; familia: string | null; nome: string }>()
  for (const p of prods ?? []) {
    mapProd.set(Number(p.codigo_produto), {
      tipo: p.tipo_item as string | null,
      familia: p.descricao_familia as string | null,
      nome: (p.descricao as string | null) || (p.codigo as string | null) || String(p.codigo_produto),
    })
  }
```

Trocar (linhas 93-95):
```ts
          const info = it.idProduto != null ? mapProd.get(Number(it.idProduto)) : undefined
          add('tipo', info?.tipo ? (TIPO_NOME[info.tipo] ?? `Tipo ${info.tipo}`) : 'Não classificado', mesISO, v)
          add('familia', info?.familia || 'Sem família', mesISO, v)
```
por:
```ts
          const info = it.idProduto != null ? mapProd.get(Number(it.idProduto)) : undefined
          add('tipo', info?.tipo ? (TIPO_NOME[info.tipo] ?? `Tipo ${info.tipo}`) : 'Não classificado', mesISO, v)
          add('familia', info?.familia || 'Sem família', mesISO, v)
          add('produto', info?.nome || 'Produto não identificado', mesISO, v)
```

- [ ] **Step 2: Incluir `'produto'` no delete que substitui as dimensões**

Trocar (linhas 105-109):
```ts
  const { error: delErro } = await supabase
    .from('faturamento_importado')
    .delete()
    .eq('loja_id', loja.id)
    .in('dimensao', ['tipo', 'familia'])
```
por:
```ts
  const { error: delErro } = await supabase
    .from('faturamento_importado')
    .delete()
    .eq('loja_id', loja.id)
    .in('dimensao', ['tipo', 'familia', 'produto'])
```

- [ ] **Step 3: Adicionar "Produto" como dimensão selecionável na tela**

Em `app/(app)/relatorio-faturamento/page.tsx`, trocar (linhas 19-23):
```ts
const DIMS = [
  { value: 'tipo', label: 'Tipo' },
  { value: 'familia', label: 'Família' },
  { value: 'forma_pgto', label: 'Forma de pgto' },
] as const
```
por:
```ts
const DIMS = [
  { value: 'tipo', label: 'Tipo' },
  { value: 'familia', label: 'Família' },
  { value: 'forma_pgto', label: 'Forma de pgto' },
  { value: 'produto', label: 'Produto' },
] as const
```

> Não precisa mexer em `relatorio_faturamento_matriz`/`relatorio_faturamento_opcoes` — as duas já filtram por `dimensao = p_dim` genericamente (confirmado no spec), então `p_dim='produto'` já funciona assim que a linha existir na tabela.

- [ ] **Step 4: Rodar a sincronização de verdade e conferir**

Rodar o cron/rota manual (mesmo processo já usado antes nesta sessão: `curl -H "Authorization: Bearer $CRON_SECRET" http://localhost:PORT/api/cron/sync-faturamento`, ou clicar em "Atualizar" na tela de uma loja de teste), depois:
```bash
node scripts/db.mjs "select count(*) from faturamento_importado where dimensao = 'produto'"
```
Esperado: número maior que 0.

- [ ] **Step 5: Verificação manual da tela**

`npm run dev`, abrir `/relatorio-faturamento?dim=produto`, confirmar que a aba "Produto" aparece e mostra a matriz por produto/mês.

- [ ] **Step 6: Commit**

```bash
git add lib/omie/faturamento.ts "app/(app)/relatorio-faturamento/page.tsx"
git commit -m "feat(faturamento): adiciona dimensao produto (dado ja vinha, so nao era gravado)"
```

---

### Task 9: Migration — `relatorio_compras_*` ganham `p_produto` e `p_local`

**Files:**
- Create: `supabase/migrations/075_relatorio_compras_produto_local.sql`

**Interfaces:**
- Produces: `relatorio_compras_total`/`relatorio_compras_dim`/`relatorio_compras_matriz` com 2 parâmetros novos (`p_produto text default null`, `p_local bigint default null`) — Task 10 consome.

- [ ] **Step 1: Escrever a migration**

Corpo idêntico ao de `067_relatorio_compras_cfop_entrada.sql` nas 3 funções, só acrescentando os 2 parâmetros novos e as 2 condições novas no `where` de cada uma:

```sql
-- 075_relatorio_compras_produto_local.sql
-- Adiciona p_produto (busca por nome/codigo) e p_local (codigo_local_estoque,
-- extraido de full_object->itensAjustes->>codigo_local_estoque, confirmado
-- populado no Supabase) as relatorio_compras_total/_dim/_matriz. O join com
-- produtos ja existe nas 3 (usado pelo dim='produto'); so falta o parametro.

drop function if exists relatorio_compras_total(bigint, date, date, text[], text[], text, text[]);
drop function if exists relatorio_compras_dim(bigint, date, date, text, text[], text[], text, text[]);
drop function if exists relatorio_compras_matriz(bigint, date, date, text, text[], text[], text, text[]);

create or replace function relatorio_compras_total(
  p_loja_id bigint, p_ini date, p_fim date,
  p_familias text[] default null, p_tipos text[] default null, p_fornecedor text default null,
  p_cfops text[] default null, p_produto text default null, p_local bigint default null
) returns table(valor numeric, n_notas bigint)
language sql stable as $$
  select
    coalesce(sum(coalesce(i.n_qtde_nfe, 0) * coalesce(i.n_preco_unit, 0)), 0)::numeric,
    count(distinct nf.id)::bigint
  from nota_fiscal_items i
  join notas_fiscais nf on nf.id = i.nota_fiscal_id and nf.loja_id = i.loja_id
  left join produtos p on p.loja_id = i.loja_id and p.codigo_produto = i.n_id_produto
  where i.loja_id = p_loja_id
    and nf.deleted_at is null
    and nf.d_emissao_nfe >= p_ini and nf.d_emissao_nfe <= p_fim
    and (p_familias is null or p.descricao_familia = any(p_familias))
    and (p_tipos is null or p.tipo_item = any(p_tipos))
    and (p_fornecedor is null or coalesce(nf.c_razao_social, nf.c_nome) ilike '%' || p_fornecedor || '%')
    and (p_cfops is null or (i.full_object->'itensAjustes'->>'cCFOPEntrada') = any(p_cfops))
    and (p_produto is null or i.c_descricao_produto ilike '%' || p_produto || '%' or i.c_codigo_produto ilike '%' || p_produto || '%')
    and (p_local is null or (i.full_object->'itensAjustes'->>'codigo_local_estoque')::bigint = p_local)
    and right(regexp_replace(coalesce(i.full_object->'itensAjustes'->>'cCFOPEntrada', ''), '\D', '', 'g'), 3) not in ('910', '908');
$$;

create or replace function relatorio_compras_dim(
  p_loja_id bigint, p_ini date, p_fim date, p_dim text,
  p_familias text[] default null, p_tipos text[] default null, p_fornecedor text default null,
  p_cfops text[] default null, p_produto text default null, p_local bigint default null
) returns table(rotulo text, valor numeric, itens bigint)
language sql stable as $$
  select
    coalesce(nullif(
      case p_dim
        when 'familia'    then p.descricao_familia
        when 'tipo'       then p.tipo_item
        when 'produto'    then i.c_descricao_produto
        when 'fornecedor' then coalesce(nf.c_razao_social, nf.c_nome)
        when 'cfop'       then i.full_object->'itensAjustes'->>'cCFOPEntrada'
      end, ''), 'Sem classificação') as rotulo,
    sum(coalesce(i.n_qtde_nfe, 0) * coalesce(i.n_preco_unit, 0))::numeric as valor,
    count(*)::bigint as itens
  from nota_fiscal_items i
  join notas_fiscais nf on nf.id = i.nota_fiscal_id and nf.loja_id = i.loja_id
  left join produtos p on p.loja_id = i.loja_id and p.codigo_produto = i.n_id_produto
  where i.loja_id = p_loja_id
    and nf.deleted_at is null
    and nf.d_emissao_nfe >= p_ini and nf.d_emissao_nfe <= p_fim
    and (p_familias is null or p.descricao_familia = any(p_familias))
    and (p_tipos is null or p.tipo_item = any(p_tipos))
    and (p_fornecedor is null or coalesce(nf.c_razao_social, nf.c_nome) ilike '%' || p_fornecedor || '%')
    and (p_cfops is null or (i.full_object->'itensAjustes'->>'cCFOPEntrada') = any(p_cfops))
    and (p_produto is null or i.c_descricao_produto ilike '%' || p_produto || '%' or i.c_codigo_produto ilike '%' || p_produto || '%')
    and (p_local is null or (i.full_object->'itensAjustes'->>'codigo_local_estoque')::bigint = p_local)
    and right(regexp_replace(coalesce(i.full_object->'itensAjustes'->>'cCFOPEntrada', ''), '\D', '', 'g'), 3) not in ('910', '908')
  group by 1
  order by valor desc;
$$;

create or replace function relatorio_compras_matriz(
  p_loja_id bigint, p_ini date, p_fim date, p_dim text,
  p_familias text[] default null, p_tipos text[] default null, p_fornecedor text default null,
  p_cfops text[] default null, p_produto text default null, p_local bigint default null
) returns table(rotulo text, mes text, valor numeric)
language sql stable as $$
  select
    coalesce(nullif(
      case p_dim
        when 'familia'    then p.descricao_familia
        when 'tipo'       then p.tipo_item
        when 'produto'    then i.c_descricao_produto
        when 'fornecedor' then coalesce(nf.c_razao_social, nf.c_nome)
        when 'cfop'       then i.full_object->'itensAjustes'->>'cCFOPEntrada'
      end, ''), 'Sem classificação') as rotulo,
    to_char(nf.d_emissao_nfe, 'YYYY-MM') as mes,
    sum(coalesce(i.n_qtde_nfe, 0) * coalesce(i.n_preco_unit, 0))::numeric as valor
  from nota_fiscal_items i
  join notas_fiscais nf on nf.id = i.nota_fiscal_id and nf.loja_id = i.loja_id
  left join produtos p on p.loja_id = i.loja_id and p.codigo_produto = i.n_id_produto
  where i.loja_id = p_loja_id
    and nf.deleted_at is null
    and nf.d_emissao_nfe >= p_ini and nf.d_emissao_nfe <= p_fim
    and (p_familias is null or p.descricao_familia = any(p_familias))
    and (p_tipos is null or p.tipo_item = any(p_tipos))
    and (p_fornecedor is null or coalesce(nf.c_razao_social, nf.c_nome) ilike '%' || p_fornecedor || '%')
    and (p_cfops is null or (i.full_object->'itensAjustes'->>'cCFOPEntrada') = any(p_cfops))
    and (p_produto is null or i.c_descricao_produto ilike '%' || p_produto || '%' or i.c_codigo_produto ilike '%' || p_produto || '%')
    and (p_local is null or (i.full_object->'itensAjustes'->>'codigo_local_estoque')::bigint = p_local)
    and right(regexp_replace(coalesce(i.full_object->'itensAjustes'->>'cCFOPEntrada', ''), '\D', '', 'g'), 3) not in ('910', '908')
  group by 1, 2
  order by 1, 2;
$$;
```

> Nota: o `drop function` no topo precisa bater com a assinatura ATUAL das 3 funções (a de `067`) pra funcionar — se ao aplicar der erro de "function does not exist" com essa assinatura exata, rodar `select pg_get_functiondef(oid) from pg_proc where proname = 'relatorio_compras_total'` (mesmo padrão já usado nesta conversa) pra confirmar a assinatura viva antes de ajustar o `drop`.

- [ ] **Step 2: Aplicar a migration**

```bash
node scripts/aplicar-migration.mjs 075_relatorio_compras_produto_local.sql
```

- [ ] **Step 3: Verificação manual**

```bash
node scripts/db.mjs "select relatorio_compras_total(2, '2026-01-01', '2026-07-16', null, null, null, null, 'algum produto real', null)"
```
Esperado: retorna um valor menor ou igual ao total sem o filtro de produto (rodar sem `p_produto` pra comparar).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/075_relatorio_compras_produto_local.sql
git commit -m "feat(db): adiciona p_produto e p_local as funcoes relatorio_compras_*"
```

---

### Task 10: Relatório de Compras — ligar produto e local de estoque na tela

**Files:**
- Modify: `app/(app)/relatorio-compras/page.tsx`

**Interfaces:**
- Consumes: `p_produto`/`p_local` das 3 funções (Task 9).

- [ ] **Step 1: Adicionar `produto`/`local` ao tipo de `searchParams` e resolver os valores**

Trocar (linhas 56-64):
```ts
  searchParams: Promise<{
    data_inicio?: string
    data_final?: string
    dim?: string
    familia?: string
    tipo?: string
    fornecedor?: string
    cfop?: string
  }>
```
por:
```ts
  searchParams: Promise<{
    data_inicio?: string
    data_final?: string
    dim?: string
    familia?: string
    tipo?: string
    fornecedor?: string
    cfop?: string
    produto?: string
    local?: string
  }>
```

Trocar (linhas 78-87):
```ts
  const familiasSel = valoresMulti(sp.familia)
  const tiposSel = valoresMulti(sp.tipo)
  const cfopsSel = valoresMulti(sp.cfop)
  const fornecedor = sp.fornecedor || null
  const filtros = {
    p_familias: arrOrNull(familiasSel),
    p_tipos: arrOrNull(tiposSel),
    p_fornecedor: fornecedor,
    p_cfops: arrOrNull(cfopsSel),
  }
```
por:
```ts
  const familiasSel = valoresMulti(sp.familia)
  const tiposSel = valoresMulti(sp.tipo)
  const cfopsSel = valoresMulti(sp.cfop)
  const fornecedor = sp.fornecedor || null
  const produto = sp.produto || null
  const localCod = sp.local && !Number.isNaN(Number(sp.local)) ? Number(sp.local) : null
  const filtros = {
    p_familias: arrOrNull(familiasSel),
    p_tipos: arrOrNull(tiposSel),
    p_fornecedor: fornecedor,
    p_cfops: arrOrNull(cfopsSel),
    p_produto: produto,
    p_local: localCod,
  }
```

- [ ] **Step 2: Buscar locais e adicionar os campos em `campos`/`defaults`**

Buscar locais perto de onde `familias` (via `buscarFamilias()`) já é buscado:
```ts
  const { data: locaisRaw } = await supabase
    .from('local_estoques')
    .select('codigo_local_estoque, descricao')
    .eq('loja_id', lojaId)
    .order('descricao')
```

Adicionar ao array `campos` (linhas 144-151):
```ts
  { tipo: 'texto', nome: 'produto', label: 'Produto (nome ou código)' },
  {
    tipo: 'select',
    nome: 'local',
    label: 'Local de estoque',
    opcoes: (locaisRaw ?? []).map((l) => ({ value: String(l.codigo_local_estoque), label: l.descricao ?? String(l.codigo_local_estoque) })),
  },
```
E em `defaults`: `produto: sp.produto ?? '', local: sp.local ?? ''`.

- [ ] **Step 3: Verificação manual**

`npm run dev`, abrir `/relatorio-compras?produto=<nome>` e `/relatorio-compras?local=<código>`, confirmar que os totais/matriz mudam de acordo.

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/relatorio-compras/page.tsx"
git commit -m "feat(relatorio-compras): liga filtros de produto e local de estoque"
```

---

### Task 11: Migration — `relatorio_auditoria_fiscal_*` ganham `p_produto`, `p_familia`, `p_fornecedor` (resumo) e `p_local`

**Files:**
- Create: `supabase/migrations/076_auditoria_fiscal_produto_familia_local.sql`

**Interfaces:**
- Produces: `relatorio_auditoria_fiscal_cfop`/`relatorio_auditoria_fiscal_itens` com os 4 parâmetros novos — Task 12 consome.

- [ ] **Step 1: Escrever a migration**

```sql
-- 076_auditoria_fiscal_produto_familia_local.sql
-- Adiciona p_produto/p_familia/p_fornecedor/p_local as duas funcoes de
-- auditoria fiscal. p_fornecedor ja existia em relatorio_auditoria_fiscal_itens
-- (migration 047) mas nao em relatorio_auditoria_fiscal_cfop -- unifica os dois.
-- p_local usa full_object->itensAjustes->>codigo_local_estoque, confirmado
-- populado no Supabase (mesmo campo usado em relatorio_compras_*, migration 075).

drop function if exists relatorio_auditoria_fiscal_cfop(bigint, date, date);
drop function if exists relatorio_auditoria_fiscal_itens(bigint, date, date, text, text, text);

create or replace function relatorio_auditoria_fiscal_cfop(
  p_loja_id bigint, p_ini date, p_fim date,
  p_produto text default null, p_familia text default null,
  p_fornecedor text default null, p_local bigint default null
) returns table(cfop_doc text, cfop_entrada text, itens bigint, valor numeric, credita_icms bigint, move_estoque bigint)
language sql stable as $$
  select
    coalesce(i.c_cfop, i.full_object->'itensCabec'->>'cCFOP') as cfop_doc,
    i.full_object->'itensAjustes'->>'cCFOPEntrada' as cfop_entrada,
    count(*)::bigint as itens,
    sum(coalesce(i.n_qtde_nfe, 0) * coalesce(i.n_preco_unit, 0))::numeric as valor,
    count(*) filter (where coalesce(i.full_object->'itensAjustes'->'itensSitTribEnt'->>'cNaoCredICMSE', 'N') <> 'S')::bigint as credita_icms,
    count(*) filter (where coalesce(i.full_object->'itensAjustes'->>'cNaoGerarMovEstoque', 'N') <> 'S')::bigint as move_estoque
  from nota_fiscal_items i
  join notas_fiscais nf on nf.id = i.nota_fiscal_id and nf.loja_id = i.loja_id and nf.deleted_at is null
  left join produtos p on p.loja_id = i.loja_id and p.codigo_produto = i.n_id_produto
  where i.loja_id = p_loja_id
    and nf.d_emissao_nfe >= p_ini and nf.d_emissao_nfe <= p_fim
    and nf.c_etapa = '60'
    and coalesce(nf.full_object->'infoCadastro'->>'cCancelada', 'N') != 'S'
    and (p_produto is null or i.c_descricao_produto ilike '%' || p_produto || '%' or i.c_codigo_produto ilike '%' || p_produto || '%')
    and (p_familia is null or p.descricao_familia = p_familia)
    and (p_fornecedor is null or coalesce(nf.c_razao_social, nf.c_nome) ilike '%' || p_fornecedor || '%')
    and (p_local is null or (i.full_object->'itensAjustes'->>'codigo_local_estoque')::bigint = p_local)
  group by 1, 2
  order by valor desc, cfop_doc, cfop_entrada;
$$;

create or replace function relatorio_auditoria_fiscal_itens(
  p_loja_id bigint, p_ini date, p_fim date,
  p_cfop_doc text default null, p_cfop_entrada text default null, p_fornecedor text default null,
  p_produto text default null, p_familia text default null, p_local bigint default null
) returns table(
  data date, nota text, fornecedor text, produto text, codigo text,
  cfop_doc text, cfop_entrada text, cst_icms text, origem text,
  credita_icms boolean, move_estoque boolean, valor numeric, item_id bigint
)
language sql stable as $$
  select
    nf.d_emissao_nfe as data,
    nf.c_numero_nfe as nota,
    coalesce(nf.c_razao_social, nf.c_nome) as fornecedor,
    i.c_descricao_produto as produto,
    i.c_codigo_produto as codigo,
    coalesce(i.c_cfop, i.full_object->'itensCabec'->>'cCFOP') as cfop_doc,
    i.full_object->'itensAjustes'->>'cCFOPEntrada' as cfop_entrada,
    i.full_object->'itensICMS'->>'cSitTrib' as cst_icms,
    i.full_object->'itensICMS'->>'cOrigem' as origem,
    (coalesce(i.full_object->'itensAjustes'->'itensSitTribEnt'->>'cNaoCredICMSE', 'N') <> 'S') as credita_icms,
    (coalesce(i.full_object->'itensAjustes'->>'cNaoGerarMovEstoque', 'N') <> 'S') as move_estoque,
    coalesce(i.n_qtde_nfe, 0) * coalesce(i.n_preco_unit, 0) as valor,
    i.id as item_id
  from nota_fiscal_items i
  join notas_fiscais nf on nf.id = i.nota_fiscal_id and nf.loja_id = i.loja_id and nf.deleted_at is null
  left join produtos p on p.loja_id = i.loja_id and p.codigo_produto = i.n_id_produto
  where i.loja_id = p_loja_id
    and nf.d_emissao_nfe >= p_ini and nf.d_emissao_nfe <= p_fim
    and nf.c_etapa = '60'
    and coalesce(nf.full_object->'infoCadastro'->>'cCancelada', 'N') != 'S'
    and (p_cfop_doc is null or coalesce(i.c_cfop, i.full_object->'itensCabec'->>'cCFOP') = p_cfop_doc)
    and (p_cfop_entrada is null or i.full_object->'itensAjustes'->>'cCFOPEntrada' = p_cfop_entrada)
    and (p_fornecedor is null or coalesce(nf.c_razao_social, nf.c_nome) ilike '%' || p_fornecedor || '%')
    and (p_produto is null or i.c_descricao_produto ilike '%' || p_produto || '%' or i.c_codigo_produto ilike '%' || p_produto || '%')
    and (p_familia is null or p.descricao_familia = p_familia)
    and (p_local is null or (i.full_object->'itensAjustes'->>'codigo_local_estoque')::bigint = p_local)
  order by nf.d_emissao_nfe desc, i.id;
$$;
```

> Mesma nota da Task 9: confirmar a assinatura viva de ambas as funções antes de aplicar (`select pg_get_functiondef(oid) from pg_proc where proname = 'relatorio_auditoria_fiscal_cfop'`), já que o corpo acima replica o que foi confirmado na pesquisa desta conversa (migration `047`), não uma releitura feita nesta task.

- [ ] **Step 2: Aplicar a migration**

```bash
node scripts/aplicar-migration.mjs 076_auditoria_fiscal_produto_familia_local.sql
```

- [ ] **Step 3: Verificação manual**

```bash
node scripts/db.mjs "select * from relatorio_auditoria_fiscal_cfop(2, '2026-01-01', '2026-07-16', null, null, null, null) limit 3"
```
Esperado: retorna linhas no mesmo formato de antes (a função continua funcionando sem os filtros novos, já que todos têm `default null`).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/076_auditoria_fiscal_produto_familia_local.sql
git commit -m "feat(db): adiciona p_produto/p_familia/p_fornecedor/p_local as funcoes de auditoria fiscal"
```

---

### Task 12: Auditoria Fiscal — ligar produto, família e local de estoque na tela (e fornecedor no resumo)

**Files:**
- Modify: `app/(app)/auditoria-fiscal/page.tsx`

**Interfaces:**
- Consumes: os 4 parâmetros novos das duas RPCs (Task 11) e o campo `fornecedor` já adicionado na Task 7 (reaproveitar o mesmo searchParam pro resumo também).

- [ ] **Step 1: Adicionar `produto`/`familia`/`local` ao tipo de `searchParams`**

Trocar (do resultado da Task 7):
```ts
  searchParams: Promise<{ data_inicio?: string; data_final?: string; cfop?: string; fornecedor?: string }>
```
por:
```ts
  searchParams: Promise<{ data_inicio?: string; data_final?: string; cfop?: string; fornecedor?: string; produto?: string; familia?: string; local?: string }>
```

- [ ] **Step 2: Passar os novos parâmetros nas duas chamadas de RPC**

Trocar (linha 44):
```ts
  const { data: cfopRaw } = await supabase.rpc('relatorio_auditoria_fiscal_cfop', { p_loja_id: lojaId, p_ini: ini, p_fim: fim })
```
por:
```ts
  const localCod = sp.local && !Number.isNaN(Number(sp.local)) ? Number(sp.local) : null
  const { data: cfopRaw } = await supabase.rpc('relatorio_auditoria_fiscal_cfop', {
    p_loja_id: lojaId, p_ini: ini, p_fim: fim,
    p_produto: sp.produto || null, p_familia: sp.familia || null,
    p_fornecedor: sp.fornecedor || null, p_local: localCod,
  })
```

Trocar (bloco da Task 7, que já passa `p_fornecedor`):
```ts
    const { data } = await supabase
      .rpc('relatorio_auditoria_fiscal_itens', {
        p_loja_id: lojaId, p_ini: ini, p_fim: fim, p_cfop_doc: cfopDocSel, p_cfop_entrada: cfopEntSel,
        p_fornecedor: sp.fornecedor || null,
      })
      .range(0, 299)
```
por:
```ts
    const { data } = await supabase
      .rpc('relatorio_auditoria_fiscal_itens', {
        p_loja_id: lojaId, p_ini: ini, p_fim: fim, p_cfop_doc: cfopDocSel, p_cfop_entrada: cfopEntSel,
        p_fornecedor: sp.fornecedor || null,
        p_produto: sp.produto || null, p_familia: sp.familia || null, p_local: localCod,
      })
      .range(0, 299)
```

- [ ] **Step 3: Buscar família/local e adicionar/ajustar `campos`**

Adicionar antes do array `campos`:
```ts
  const familiasOpcoes = await buscarFamilias()
  const { data: locaisRaw } = await supabase
    .from('local_estoques')
    .select('codigo_local_estoque, descricao')
    .eq('loja_id', lojaId)
    .order('descricao')
```
(importar `buscarFamilias` de `@/lib/actions/produto`).

Trocar o array `campos` (resultado da Task 7) pra incluir os campos novos e ajustar o rótulo do fornecedor (que agora afeta os dois, não só o drill-down):
```ts
  const campos: CampoFiltro[] = [
    { tipo: 'data', nome: 'data_inicio', label: 'Data inicial' },
    { tipo: 'data', nome: 'data_final', label: 'Data final' },
    { tipo: 'texto', nome: 'produto', label: 'Produto (nome ou código)' },
    { tipo: 'select', nome: 'familia', label: 'Família', opcoes: familiasOpcoes.map((f) => ({ value: f.descricao, label: f.descricao })) },
    { tipo: 'texto', nome: 'fornecedor', label: 'Fornecedor' },
    {
      tipo: 'select',
      nome: 'local',
      label: 'Local de estoque',
      opcoes: (locaisRaw ?? []).map((l) => ({ value: String(l.codigo_local_estoque), label: l.descricao ?? String(l.codigo_local_estoque) })),
    },
  ]
```
E em `defaults={{ ... }}`: adicionar `produto: sp.produto ?? '', familia: sp.familia ?? '', local: sp.local ?? ''` (mantendo `fornecedor` já presente da Task 7).

- [ ] **Step 4: Verificação manual**

`npm run dev`, abrir `/auditoria-fiscal?produto=<nome>`, `/auditoria-fiscal?familia=<família>`, `/auditoria-fiscal?local=<código>`, confirmar que o resumo por CFOP muda de acordo com cada filtro (não só o drill-down).

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/auditoria-fiscal/page.tsx"
git commit -m "feat(auditoria-fiscal): liga filtros de produto, familia e local no resumo"
```

---

## Ordem sugerida de execução

Tasks 1-6 e 8 são independentes entre si (podem ir em qualquer ordem, inclusive em paralelo — cada uma mexe num arquivo diferente). Task 7 precisa vir **antes** da Task 12 (as duas mexem em `auditoria-fiscal/page.tsx` em sequência — Task 12 assume o `searchParams`/`campos` já com `fornecedor` da Task 7). Task 9 precisa vir antes da Task 10 (migration antes da tela). Task 11 precisa vir antes da Task 12 (migration antes da tela) — ou seja, a ordem real da Auditoria Fiscal é **7 → 11 → 12**. Task 9/10 (Compras) são independentes do trio 7/11/12 (Auditoria Fiscal), mesmo mexendo em RPCs parecidas.
