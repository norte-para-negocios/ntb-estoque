# Tela de Estoque para loja Omie (espelho) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Abrir as telas `/estoque`, `/estoque/local/[codigo]` e `/estoque/produto/[codigo]` (hoje só da ODARA, modo `proprio`) para lojas `modo_estoque='omie'`, lendo o espelho do Omie, com botão de atualizar e kardex do Omie por produto.

**Architecture:** Um loader novo (`carregarEstoqueOmie`) monta o mesmo `VisaoEstoque` que a tela já consome, a partir da foto mais recente de `posicao_estoques`; a montagem é uma função pura testada (`lib/estoque/espelho-omie.ts`). As páginas escolhem o loader pelo modo da loja e escondem as ações de escrita do modo próprio quando a loja é Omie. O kardex do Omie é uma tabela nova (`kardex_omie`, migration 157) carregada sob demanda por produto via `ListarMovimentoEstoque`.

**Tech Stack:** Next.js (versão do repo — ler `node_modules/next/dist/docs/` antes de mexer em rotas), Supabase/PostgREST self-hosted, `omieRequest` (`lib/omie/client.ts`), testes com `node --test arquivo.test.ts` (sem alias `@/` nos módulos puros).

**Spec:** `docs/superpowers/specs/2026-10-13-estoque-espelho-omie-design.md`

## Global Constraints

- Nenhuma escrita no Omie nesta entrega (só `ListarPosEstoque` via sync existente e `ListarMovimentoEstoque`).
- Toda query que busca `lojas` para falar com o Omie inclui `is_test` no `.select()` (AGENTS.md, "Lojas de Teste").
- Todo `.range()` vem com `.order(<coluna única>)` (AGENTS.md, tiebreak de paginação).
- Migration 157 é manual: NÃO aplicar nem fazer deploy sem OK do dono.
- Saldo do produto = soma dos locais; local `0` em `posicao_estoques` é a linha sentinela (mínimo + CMC), nunca um local.
- Não misturar fotos: os saldos vêm todos da `data_posicao` mais recente da loja. CMC: o da sentinela da foto mais recente se > 0, senão o da foto anterior (o Omie às vezes só fecha o custo no fim do dia — ver comentário em `lib/omie/posicao-estoque.ts`).
- Textos de tela em português, sem jargão ("Espelho do Omie", "Atualizar do Omie").
- Trabalhar no branch `estoque-espelho-omie`. A árvore tem trabalho NÃO commitado de outra feature (`app/(app)/correcoes`, `app/api/correcoes`, `components/correcoes`, `lib/correcoes*`, migration 156, `AGENTS.md`, `NavItems.ts`, `lib/resumo-dia.ts`, `proxy.ts`): **nunca** `git add -A`; adicionar só os arquivos de cada task. `NavItems.ts` e `AGENTS.md` já têm mudanças alheias: usar `git add -p` e só as linhas desta feature.

## Review Focus

- Local ativo que falhou no último sync (sem linhas na foto mais recente, mas com linhas na anterior) — a tela deve avisar "local X não atualizou na última leitura", não mostrar 0 calado.
- Produto com CMC absurdo/negativo na sentinela (lojas 5 e 6 têm `n_cmc` de bilhões em saldo negativo) — valor do estoque não pode virar −R$ bilhões: usar CMC só se `0 < cmc < 1e7`, senão 0 e marcar "custo suspeito".
- Loja Omie sem nenhuma foto ainda — tela vazia com dica "Clique em Atualizar do Omie", sem quebrar.
- Kardex sem movimentos no período (`Não existem registros`) — mostrar "Nenhum movimento nos últimos 55 dias", não erro.
- Clique repetido no "Carregar movimentos do Omie" — no máximo 1 carga por produto a cada 10 min (responde com os dados já gravados).

---

### Task 1: Montagem pura do estoque espelhado + loader

**Files:**
- Create: `lib/estoque/espelho-omie.ts`
- Create: `lib/estoque/espelho-omie.test.ts`
- Create: `app/(app)/estoque/dados-omie.ts`

**Interfaces:**
- Consumes: tipos `LinhaEstoque`, `VisaoEstoque`, `SaldoLocal`, `LocalInfo` e `situacaoDe` de `app/(app)/estoque/dados.ts` (o módulo puro NÃO importa de lá: redeclara um `situacaoDe` local idêntico para não puxar `@/`).
- Produces:
  - `montarVisaoOmie(entrada: EntradaEspelho): VisaoEspelho` (puro)
  - `carregarEstoqueOmie(lojaId: number): Promise<VisaoEspelho>`
  - `type VisaoEspelho = VisaoEstoque & { atualizadoEm: string | null; dataPosicao: string | null; locaisSemLeitura: string[]; custoSuspeito: number }`
  - `LinhaEstoque` ganha campo opcional `custoSuspeito?: boolean` (em `dados.ts`).

- [ ] **Step 1: Write the failing test** (`lib/estoque/espelho-omie.test.ts`)

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { montarVisaoOmie, type EntradaEspelho } from './espelho-omie.ts'

const base = (): EntradaEspelho => ({
  produtos: [
    { codigo_produto: 1, codigo: '90150', descricao: 'Moqueca', unidade: 'UN', tipo_item: '04', codigo_familia: 10, estoque_minimo: null },
    { codigo_produto: 2, codigo: '80104', descricao: 'Pescada', unidade: 'KG', tipo_item: '01', codigo_familia: null, estoque_minimo: 5 },
    { codigo_produto: 3, codigo: '70119', descricao: 'Camarão PI', unidade: 'KG', tipo_item: '03', codigo_familia: 10, estoque_minimo: null },
  ],
  posicoes: [
    // foto mais recente (13/10): local 100 e 200; sentinela 0 com CMC
    { data_posicao: '2026-10-13', codigo_local_estoque: 0, n_cod_prod: 1, n_saldo: 0, n_cmc: 66.5, estoque_minimo: 2, updated_at: '2026-10-13T13:00:00Z' },
    { data_posicao: '2026-10-13', codigo_local_estoque: 100, n_cod_prod: 1, n_saldo: 3, n_cmc: 66.5, estoque_minimo: 0, updated_at: '2026-10-13T13:05:00Z' },
    { data_posicao: '2026-10-13', codigo_local_estoque: 200, n_cod_prod: 1, n_saldo: -1, n_cmc: 66.5, estoque_minimo: 0, updated_at: '2026-10-13T13:06:00Z' },
    { data_posicao: '2026-10-13', codigo_local_estoque: 0, n_cod_prod: 2, n_saldo: 0, n_cmc: 0, estoque_minimo: 0, updated_at: '2026-10-13T13:00:00Z' },
    { data_posicao: '2026-10-13', codigo_local_estoque: 100, n_cod_prod: 2, n_saldo: 10, n_cmc: 0, estoque_minimo: 0, updated_at: '2026-10-13T13:05:00Z' },
    { data_posicao: '2026-10-13', codigo_local_estoque: 0, n_cod_prod: 3, n_saldo: 0, n_cmc: 27960529129.45, estoque_minimo: 0, updated_at: '2026-10-13T13:00:00Z' },
    { data_posicao: '2026-10-13', codigo_local_estoque: 100, n_cod_prod: 3, n_saldo: -4, n_cmc: 27960529129.45, estoque_minimo: 0, updated_at: '2026-10-13T13:05:00Z' },
    // foto anterior (12/10): CMC do produto 2 e local 300 que não veio hoje
    { data_posicao: '2026-10-12', codigo_local_estoque: 0, n_cod_prod: 2, n_saldo: 0, n_cmc: 30, estoque_minimo: 0, updated_at: '2026-10-12T13:00:00Z' },
    { data_posicao: '2026-10-12', codigo_local_estoque: 300, n_cod_prod: 2, n_saldo: 7, n_cmc: 30, estoque_minimo: 0, updated_at: '2026-10-12T13:00:00Z' },
  ],
  locais: [
    { codigo_local_estoque: 100, descricao: 'PADRAO', inativo: 'N' },
    { codigo_local_estoque: 200, descricao: 'COZINHA', inativo: 'N' },
    { codigo_local_estoque: 300, descricao: 'BAR', inativo: 'N' },
  ],
  familias: [{ codigo_familia: 10, nome: 'Pratos' }],
})

test('soma saldos dos locais da foto mais recente e ignora a sentinela como local', () => {
  const v = montarVisaoOmie(base())
  const p1 = v.linhas.find((l) => l.codigoProduto === 1)!
  assert.equal(p1.saldo, 2)
  assert.deepEqual(p1.locais.map((l) => [l.local, l.saldo]), [['PADRAO', 3], ['COZINHA', -1]])
  assert.equal(p1.cmc, 66.5)
  assert.equal(p1.valor, 133)
  assert.equal(p1.minimo, 2)
  assert.equal(v.dataPosicao, '2026-10-13')
  assert.equal(v.atualizadoEm, '2026-10-13T13:06:00Z')
})

test('CMC zerado na foto de hoje cai para o da foto anterior; saldo nunca mistura fotos', () => {
  const p2 = montarVisaoOmie(base()).linhas.find((l) => l.codigoProduto === 2)!
  assert.equal(p2.cmc, 30)
  assert.equal(p2.saldo, 10) // o 7 do BAR é da foto de ontem: não entra
  assert.equal(p2.minimo, 5) // sem mínimo no Omie: usa o do cadastro
})

test('CMC absurdo vira 0 e marca custo suspeito', () => {
  const v = montarVisaoOmie(base())
  const p3 = v.linhas.find((l) => l.codigoProduto === 3)!
  assert.equal(p3.cmc, 0)
  assert.equal(p3.valor, 0)
  assert.equal(p3.custoSuspeito, true)
  assert.equal(v.custoSuspeito, 1)
  assert.equal(p3.situacao, 'negativo')
})

test('local ativo que veio na foto anterior e não na mais recente é avisado', () => {
  assert.deepEqual(montarVisaoOmie(base()).locaisSemLeitura, ['BAR'])
})

test('sem nenhuma foto: lista produtos com saldo 0 e atualizadoEm null', () => {
  const v = montarVisaoOmie({ ...base(), posicoes: [] })
  assert.equal(v.atualizadoEm, null)
  assert.equal(v.dataPosicao, null)
  assert.ok(v.linhas.every((l) => l.saldo === 0 && l.situacao === 'zerado'))
  assert.deepEqual(v.locaisSemLeitura, [])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test lib/estoque/espelho-omie.test.ts`
Expected: FAIL (`Cannot find module './espelho-omie.ts'`).

- [ ] **Step 3: Write minimal implementation** (`lib/estoque/espelho-omie.ts`)

```ts
// Monta a visão de Estoque de uma loja Omie a partir do espelho (posicao_estoques).
// Puro (sem banco, sem '@/'), testado em espelho-omie.test.ts.
// Regras: saldos só da foto mais recente (nunca misturar datas); local 0 = sentinela
// (mínimo + CMC do local padrão), nunca um local; CMC da foto mais recente se > 0,
// senão da anterior; CMC fora de (0, 1e7) é tratado como suspeito (o Omie devolve
// custos de bilhões em saldo negativo nas lojas 5 e 6).

export type Situacao = 'negativo' | 'zerado' | 'baixo' | 'ok'
export const CMC_MAX_PLAUSIVEL = 1e7

export type PosicaoRow = {
  data_posicao: string; codigo_local_estoque: number; n_cod_prod: number
  n_saldo: number | null; n_cmc: number | null; estoque_minimo: number | null; updated_at: string | null
}
export type ProdutoRow = {
  codigo_produto: number; codigo: string | null; descricao: string | null; unidade: string | null
  tipo_item: string | null; codigo_familia: number | null; estoque_minimo: number | null
}
export type EntradaEspelho = {
  produtos: ProdutoRow[]
  posicoes: PosicaoRow[]
  locais: { codigo_local_estoque: number; descricao: string | null; inativo: string | null }[]
  familias: { codigo_familia: number; nome: string | null }[]
}

export type SaldoLocal = { codigoLocal: number; local: string; saldo: number; minimo: number | null }
export type LinhaEspelho = {
  codigoProduto: number; codigo: string; descricao: string; unidade: string; tipoItem: string | null
  codigoFamilia: number | null; familia: string; saldo: number; cmc: number; valor: number
  minimo: number | null; situacao: Situacao; locais: SaldoLocal[]; custoSuspeito?: boolean
}
export type VisaoEspelho = {
  linhas: LinhaEspelho[]
  locais: { codigoLocal: number; descricao: string; inativo: boolean }[]
  familias: { codigo: number; nome: string }[]
  atualizadoEm: string | null
  dataPosicao: string | null
  locaisSemLeitura: string[]
  custoSuspeito: number
}

export function situacaoDe(saldo: number, minimo: number | null): Situacao {
  if (saldo < 0) return 'negativo'
  if (saldo === 0) return 'zerado'
  if (minimo != null && minimo > 0 && saldo < minimo) return 'baixo'
  return 'ok'
}

export function montarVisaoOmie(e: EntradaEspelho): VisaoEspelho {
  const datas = [...new Set(e.posicoes.map((p) => p.data_posicao))].sort().reverse()
  const [dataAtual = null, dataAnterior = null] = datas
  const atual = e.posicoes.filter((p) => p.data_posicao === dataAtual)
  const anterior = e.posicoes.filter((p) => p.data_posicao === dataAnterior)

  const locais = e.locais.map((l) => ({
    codigoLocal: Number(l.codigo_local_estoque), descricao: l.descricao ?? String(l.codigo_local_estoque), inativo: l.inativo === 'S',
  }))
  const nomeLocal = new Map(locais.map((l) => [l.codigoLocal, l.descricao]))
  const familias = e.familias.map((f) => ({ codigo: Number(f.codigo_familia), nome: f.nome ?? String(f.codigo_familia) }))
  const nomeFamilia = new Map(familias.map((f) => [f.codigo, f.nome]))

  const cmcDe = (rows: PosicaoRow[]) => new Map(rows.filter((r) => Number(r.codigo_local_estoque) === 0).map((r) => [Number(r.n_cod_prod), Number(r.n_cmc ?? 0)]))
  const cmcAtual = cmcDe(atual), cmcAnterior = cmcDe(anterior)
  const minimoOmie = new Map(atual.filter((r) => Number(r.codigo_local_estoque) === 0 && Number(r.estoque_minimo ?? 0) > 0).map((r) => [Number(r.n_cod_prod), Number(r.estoque_minimo)]))

  const saldos = new Map<number, SaldoLocal[]>()
  for (const r of atual) {
    const loc = Number(r.codigo_local_estoque)
    if (loc === 0) continue
    const arr = saldos.get(Number(r.n_cod_prod)) ?? []
    arr.push({ codigoLocal: loc, local: nomeLocal.get(loc) ?? String(loc), saldo: Number(r.n_saldo ?? 0), minimo: null })
    saldos.set(Number(r.n_cod_prod), arr)
  }

  let nSuspeito = 0
  const linhas: LinhaEspelho[] = e.produtos.map((p) => {
    const cod = Number(p.codigo_produto)
    const locs = saldos.get(cod) ?? []
    const saldo = locs.reduce((a, l) => a + l.saldo, 0)
    const bruto = (cmcAtual.get(cod) ?? 0) > 0 ? cmcAtual.get(cod)! : (cmcAnterior.get(cod) ?? 0)
    const suspeito = bruto < 0 || bruto >= CMC_MAX_PLAUSIVEL
    if (suspeito) nSuspeito++
    const cmc = suspeito ? 0 : bruto
    const minimo = minimoOmie.get(cod) ?? (p.estoque_minimo != null && Number(p.estoque_minimo) > 0 ? Number(p.estoque_minimo) : null)
    return {
      codigoProduto: cod, codigo: p.codigo ?? String(cod), descricao: p.descricao ?? '(sem descrição)', unidade: p.unidade ?? 'UN',
      tipoItem: p.tipo_item, codigoFamilia: p.codigo_familia == null ? null : Number(p.codigo_familia),
      familia: p.codigo_familia == null ? 'Sem família' : (nomeFamilia.get(Number(p.codigo_familia)) ?? 'Sem família'),
      saldo, cmc, valor: saldo * cmc, minimo, situacao: situacaoDe(saldo, minimo), locais: locs,
      ...(suspeito ? { custoSuspeito: true } : {}),
    }
  })

  const locaisHoje = new Set(atual.map((r) => Number(r.codigo_local_estoque)))
  const locaisOntem = new Set(anterior.map((r) => Number(r.codigo_local_estoque)))
  const locaisSemLeitura = locais
    .filter((l) => !l.inativo && l.codigoLocal !== 0 && locaisOntem.has(l.codigoLocal) && !locaisHoje.has(l.codigoLocal))
    .map((l) => l.descricao)

  const atualizadoEm = atual.reduce<string | null>((m, r) => (r.updated_at && (!m || r.updated_at > m) ? r.updated_at : m), null)
  return { linhas, locais, familias, atualizadoEm, dataPosicao: dataAtual, locaisSemLeitura, custoSuspeito: nSuspeito }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test lib/estoque/espelho-omie.test.ts`
Expected: PASS (5 testes).

- [ ] **Step 5: Loader** (`app/(app)/estoque/dados-omie.ts`)

```ts
import { createClient } from '@/lib/supabase/server'
import { buscarTodasLinhas } from '@/lib/supabase/buscar-todas-linhas'
import { montarVisaoOmie, type PosicaoRow, type ProdutoRow, type VisaoEspelho } from '@/lib/estoque/espelho-omie'

export type { VisaoEspelho }

/** Estoque da loja Omie a partir do espelho (posicao_estoques): só as 2 fotos mais recentes existem na tabela. */
export async function carregarEstoqueOmie(lojaId: number): Promise<VisaoEspelho> {
  const supabase = await createClient()
  const [produtos, posicoes, locaisRes, famRes] = await Promise.all([
    buscarTodasLinhas<ProdutoRow>((from, to) =>
      supabase.from('produtos')
        .select('codigo_produto, codigo, descricao, unidade, tipo_item, codigo_familia, estoque_minimo')
        .eq('loja_id', lojaId).neq('inativo', true).order('id').range(from, to)),
    buscarTodasLinhas<PosicaoRow>((from, to) =>
      supabase.from('posicao_estoques')
        .select('data_posicao, codigo_local_estoque, n_cod_prod, n_saldo, n_cmc, estoque_minimo, updated_at')
        .eq('loja_id', lojaId).order('id').range(from, to)),
    supabase.from('local_estoques').select('codigo_local_estoque, descricao, inativo').eq('loja_id', lojaId).order('descricao'),
    supabase.from('familias').select('codigo_familia, nome').eq('loja_id', lojaId).order('nome'),
  ])
  return montarVisaoOmie({ produtos, posicoes, locais: locaisRes.data ?? [], familias: famRes.data ?? [] })
}
```

Conferir a assinatura real de `buscarTodasLinhas` em `lib/supabase/buscar-todas-linhas.ts` (se ela lançar em erro, ótimo; se devolver `{data,error}`, adaptar como em `dados.ts`).

- [ ] **Step 6: Tipos** — em `app/(app)/estoque/dados.ts`, acrescentar `custoSuspeito?: boolean` em `LinhaEstoque` (o `LinhaEspelho` é estruturalmente compatível com `LinhaEstoque`).

- [ ] **Step 7: Typecheck + commit**

Run: `npx tsc --noEmit -p . 2>&1 | grep -E "estoque/(dados|espelho)" ; node --test lib/estoque/espelho-omie.test.ts`
Expected: nenhum erro nesses arquivos; testes PASS.

```bash
git checkout -b estoque-espelho-omie
git add lib/estoque/espelho-omie.ts lib/estoque/espelho-omie.test.ts "app/(app)/estoque/dados-omie.ts" "app/(app)/estoque/dados.ts"
git commit -m "feat(estoque): monta a visao de estoque da loja Omie a partir do espelho"
```

---

### Task 2: Telas de Estoque abertas para loja Omie + "Atualizar do Omie"

**Files:**
- Modify: `app/(app)/estoque/page.tsx`
- Modify: `app/(app)/estoque/local/[codigo]/page.tsx`
- Modify: `app/(app)/estoque/produto/[codigo]/page.tsx`
- Create: `components/estoque-proprio/EspelhoOmieBarra.tsx`
- Modify: `components/shell/NavItems.ts` (+ `Sidebar.tsx`/`MobileNav.tsx` se preciso)

**Interfaces:**
- Consumes: `carregarEstoqueOmie(lojaId): Promise<VisaoEspelho>` (Task 1); rota existente `POST /api/sync/posicao` (permissão `Produtos - Sincronizar`, roda `syncPosicaoEstoque` da loja atual).
- Produces: `EspelhoOmieBarra({ atualizadoEm, locaisSemLeitura, custoSuspeito, podeAtualizar })` (client component).

- [ ] **Step 1: Barra do espelho** (`components/estoque-proprio/EspelhoOmieBarra.tsx`)

```tsx
'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { RefreshCw } from 'lucide-react'
import { toast } from 'sonner'

const quando = (iso: string) => new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Bahia', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })

/** Faixa "Espelho do Omie": hora da última leitura, avisos e botão de atualizar (só leitura do Omie). */
export function EspelhoOmieBarra({ atualizadoEm, locaisSemLeitura, custoSuspeito, podeAtualizar }: {
  atualizadoEm: string | null; locaisSemLeitura: string[]; custoSuspeito: number; podeAtualizar: boolean
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [ultimoClique, setUltimoClique] = useState(0)

  function atualizar() {
    if (Date.now() - ultimoClique < 5 * 60_000) { toast.info('Já atualizado há pouco. Tente de novo em alguns minutos.'); return }
    setUltimoClique(Date.now())
    start(async () => {
      const r = await fetch('/api/sync/posicao', { method: 'POST' })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) { toast.error('Não foi possível atualizar do Omie', { description: j.error ?? `HTTP ${r.status}` }); return }
      toast.success('Estoque atualizado do Omie')
      router.refresh()
    })
  }

  return (
    <div className="rounded-[var(--r-lg)] bg-surface-2 px-4 py-3 text-[13px] text-text-muted">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>Espelho do Omie · {atualizadoEm ? `atualizado em ${quando(atualizadoEm)}` : 'ainda sem leitura'}</span>
        {podeAtualizar && (
          <button type="button" onClick={atualizar} disabled={pending}
            className="inline-flex items-center gap-1.5 rounded-full bg-surface px-3 py-1 font-medium text-text u-card disabled:opacity-60">
            <RefreshCw className={`size-3.5 ${pending ? 'animate-spin' : ''}`} /> {pending ? 'Atualizando…' : 'Atualizar do Omie'}
          </button>
        )}
      </div>
      {locaisSemLeitura.length > 0 && <p className="mt-1 text-warn">Não atualizou na última leitura: {locaisSemLeitura.join(', ')}. O saldo desses locais aparece zerado até a próxima leitura.</p>}
      {custoSuspeito > 0 && <p className="mt-1 text-warn">{custoSuspeito} produto{custoSuspeito === 1 ? '' : 's'} com custo médio fora do normal no Omie (não entram no valor do estoque).</p>}
    </div>
  )
}
```

Conferir se a classe `text-warn` existe no tema (procurar `text-warn` / `text-err` em `components/`); se não, usar a mesma classe de aviso usada em `Indicador` com `tom='aviso'`.

- [ ] **Step 2: `/estoque` (page.tsx)** — trocar o portão e o loader:

```tsx
import { carregarEstoqueOmie } from './dados-omie'
import { EspelhoOmieBarra } from '@/components/estoque-proprio/EspelhoOmieBarra'
// ...
  const modo = await modoDaLoja(lojaId)
  if (modo !== 'proprio' && modo !== 'omie') notFound()
  if (!(await requirePermissao(lojaId, 'Movimentacoes'))) notFound()
  const ehOmie = modo === 'omie'
  const podeMovimentar = !ehOmie && (await requirePermissao(lojaId, 'Movimentacoes - Criar'))
  const podeAtualizar = ehOmie && (await requirePermissao(lojaId, 'Produtos - Sincronizar'))
  const sp = await searchParams
  const visao = ehOmie ? await carregarEstoqueOmie(lojaId) : await carregarEstoque(lojaId)
```

  - Logo abaixo do `ListaHeader`: `{ehOmie && <EspelhoOmieBarra atualizadoEm={(visao as VisaoEspelho).atualizadoEm} locaisSemLeitura={(visao as VisaoEspelho).locaisSemLeitura} custoSuspeito={(visao as VisaoEspelho).custoSuspeito} podeAtualizar={podeAtualizar} />}` (tipar com um `'atualizadoEm' in visao` guard em vez de cast se preferir).
  - Descrição do `PageHeader`: em loja Omie, `"Saldo, custo e situação de cada produto, em cada local (espelho do Omie)"`.
  - Texto do bloco de negativos: em loja Omie trocar a dica por `"Saldo negativo no Omie. Confira o kardex do produto para ver a origem."`.
  - Em loja Omie, abaixo dos filtros, uma linha de links para os fluxos que escrevem no Omie: `Movimentações` (`/movimentacoes`), `Transferência` (`/transferencia`), `Inventário` (`/inventario`).
  - Coluna "Custo médio": se `l.custoSuspeito`, mostrar `<span className="text-warn">suspeito</span>`.
  - `EmptyState` quando `visao.linhas.length > 0` mas `ehOmie && !visao.atualizadoEm`: título `"Sem leitura do Omie ainda"`, hint `"Clique em Atualizar do Omie para trazer o saldo."`.

- [ ] **Step 3: `/estoque/local/[codigo]`** — mesmo portão (`proprio` ou `omie`), mesmo loader por modo, `EspelhoOmieBarra` no topo em loja Omie (sem botão: `podeAtualizar={false}`), e em loja Omie NÃO chamar `carregarMovimentos` (tabela `estoque_movimentos` é só do modo próprio): no lugar do kardex, um texto `"Os movimentos ficam na página de cada produto."`.

- [ ] **Step 4: `/estoque/produto/[codigo]`** — mesmo portão e loader; em loja Omie esconder `AcoesProduto` e o kardex próprio (o kardex Omie entra na Task 3; até lá, uma seção vazia com o título "Movimentos no Omie"). Os cartões "Saldo por local" funcionam igual.

- [ ] **Step 5: Menu** — em `components/shell/NavItems.ts` linha do `/estoque`: trocar `soEstoqueProprio: true` por um flag novo `comEstoque: true` documentado como "aparece em loja `proprio` ou `omie` (some só em `nenhum`)". Em `Sidebar.tsx` e `MobileNav.tsx`, ver de onde vem `estoqueProprio` (boolean) e passar a receber também o modo (ou um boolean `temEstoque = modo !== 'nenhum'`) e filtrar `(!i.comEstoque || temEstoque)`. Seguir o caminho de dado já usado para `estoqueProprio` (server component pai → prop).

- [ ] **Step 6: Typecheck/lint/build**

Run: `npx tsc --noEmit -p . && npm run lint -- --quiet "app/(app)/estoque" components/estoque-proprio components/shell`
Expected: sem erros novos (comparar com `git stash`-free baseline: rodar `npx tsc --noEmit` antes de começar e anotar erros pré-existentes).

- [ ] **Step 7: Commit**

```bash
git add "app/(app)/estoque/page.tsx" "app/(app)/estoque/local/[codigo]/page.tsx" "app/(app)/estoque/produto/[codigo]/page.tsx" components/estoque-proprio/EspelhoOmieBarra.tsx components/shell/Sidebar.tsx components/shell/MobileNav.tsx
git add -p components/shell/NavItems.ts   # só a linha do /estoque e o flag novo
git commit -m "feat(estoque): tela de Estoque para loja Omie (espelho) com Atualizar do Omie"
```

---

### Task 3: Kardex do Omie por produto (migration 157 + carga sob demanda)

**Files:**
- Create: `supabase/migrations/157_kardex_omie.sql`
- Create: `lib/omie/kardex.ts` (normalização pura + busca)
- Create: `lib/omie/kardex.test.ts`
- Create: `app/api/estoque/kardex-omie/route.ts`
- Create: `components/estoque-proprio/KardexOmie.tsx`
- Modify: `app/(app)/estoque/produto/[codigo]/page.tsx`
- Modify: `proxy.ts` só se rotas `/api/*` exigirem liberação (NÃO deve precisar: a rota usa sessão).

**Interfaces:**
- Consumes: `omieRequest`, `LojaOmie` (`lib/omie/client.ts`); `getCurrentLojaId`, `requirePermissao` (`lib/auth`).
- Produces:
  - `normalizarMovOmie(m: MovOmie, lojaId: number): LinhaKardexOmie` (puro)
  - `marcarSaltosCmc(linhas: LinhaKardexOmie[]): (LinhaKardexOmie & { saltoCmc: boolean })[]` (puro; ordena por data e id)
  - `buscarKardexOmie(loja: LojaOmie, idProd: number, codigoLocal: number, dIni: string, dFim: string): Promise<MovOmie[]>`
  - `POST /api/estoque/kardex-omie` body `{ codigoProduto: number }` → `{ ok: true, gravados: number, doCache: boolean }`
  - `<KardexOmie codigoProduto unidade linhas podeCarregar />`

- [ ] **Step 1: Migration** (`supabase/migrations/157_kardex_omie.sql`)

```sql
-- 157 — Kardex do Omie (ListarMovimentoEstoque) espelhado por produto, sob demanda pela tela de Estoque.
-- NÃO aplicada automaticamente (migrations deste projeto são manuais, ver AGENTS.md).
-- Aplicar: docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < 157_kardex_omie.sql
create table if not exists public.kardex_omie (
  id                  bigint generated always as identity primary key,
  loja_id             bigint not null references public.lojas(id) on delete cascade,
  id_mov              bigint not null,
  n_cod_prod          bigint not null,
  codigo_local_estoque bigint not null,
  data_mov            date not null,
  cod_origem          text not null default '',
  des_origem          text,
  tipo                text,            -- 'entrada' | 'saida' (como vem do Omie)
  quantidade          numeric not null, -- assinada (saída negativa), como o Omie devolve
  valor_unit          numeric,
  cmc_apos            numeric,
  saldo_apos          numeric,
  num_doc             text,
  num_pedido          text,
  id_ajuste           bigint,
  id_cupom            bigint,
  cancelado           boolean not null default false,
  carregado_em        timestamptz not null default now(),
  constraint kardex_omie_mov unique (loja_id, id_mov)
);
create index if not exists kardex_omie_prod_idx on public.kardex_omie (loja_id, n_cod_prod, data_mov desc, id_mov desc);

alter table public.kardex_omie enable row level security;
drop policy if exists kardex_omie_select_por_loja on public.kardex_omie;
create policy kardex_omie_select_por_loja on public.kardex_omie for select using (
  usuario_tem_acesso_loja(loja_id) or usuario_e_admin()
);
revoke insert, update, delete, truncate on public.kardex_omie from anon, authenticated;
revoke all on public.kardex_omie from anon;
grant select on public.kardex_omie to authenticated;
```

O índice único é TOTAL (não parcial), então `.upsert(..., { onConflict: 'loja_id,id_mov' })` funciona (ver AGENTS.md sobre índice parcial).

- [ ] **Step 2: Failing test** (`lib/omie/kardex.test.ts`)

```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizarMovOmie, marcarSaltosCmc, type MovOmie } from './kardex.ts'

const mov = (o: Partial<MovOmie>): MovOmie => ({
  idMov: 1, idProd: 9, codigo_local_estoque: 100, dtMov: '16/08/2026', codOrigem: 'PDV', desOrigem: 'Movimento Gerado pelo PDV',
  tipo: 'saida', qtde: -1, valor: 66.56, cmc: 66.56, saldo: 20, numDoc: '000202169/001', numPedido: 'NFC-e 202169',
  idAjuste: 5, idCupom: 7, cancelamento: 'N', ...o,
})

test('normaliza data dd/mm/aaaa para ISO e mantém o sinal da quantidade', () => {
  const l = normalizarMovOmie(mov({}), 5)
  assert.equal(l.data_mov, '2026-08-16')
  assert.equal(l.quantidade, -1)
  assert.equal(l.loja_id, 5)
  assert.equal(l.id_mov, 1)
  assert.equal(l.cancelado, false)
})

test('cancelamento S vira cancelado true; campos ausentes viram null', () => {
  const l = normalizarMovOmie(mov({ cancelamento: 'S', numDoc: undefined, idCupom: undefined }), 5)
  assert.equal(l.cancelado, true)
  assert.equal(l.num_doc, null)
  assert.equal(l.id_cupom, null)
})

test('marca salto de CMC de 10x ou mais em relação ao movimento anterior', () => {
  const ls = [
    normalizarMovOmie(mov({ idMov: 2, dtMov: '17/08/2026', cmc: 700 }), 5),
    normalizarMovOmie(mov({ idMov: 1, dtMov: '16/08/2026', cmc: 66 }), 5),
    normalizarMovOmie(mov({ idMov: 3, dtMov: '17/08/2026', cmc: 710 }), 5),
  ]
  const r = marcarSaltosCmc(ls)
  assert.deepEqual(r.map((x) => [x.id_mov, x.saltoCmc]), [[1, false], [2, true], [3, false]])
})
```

- [ ] **Step 3: Run** `node --test lib/omie/kardex.test.ts` → FAIL (módulo inexistente).

- [ ] **Step 4: Implementation** (`lib/omie/kardex.ts`)

```ts
// Kardex do Omie (estoque/consulta ListarMovimentoEstoque). As funções puras no topo não
// importam nada com '@/' (testadas com node --test). `buscarKardexOmie` faz a chamada.
import { omieRequest, type LojaOmie } from './client.ts'

export type MovOmie = {
  idMov: number; idProd: number; codigo_local_estoque: number; dtMov: string
  codOrigem?: string; desOrigem?: string; tipo?: string; qtde: number; valor?: number; cmc?: number; saldo?: number
  numDoc?: string; numPedido?: string; idAjuste?: number; idCupom?: number; cancelamento?: string
}
export type LinhaKardexOmie = {
  loja_id: number; id_mov: number; n_cod_prod: number; codigo_local_estoque: number; data_mov: string
  cod_origem: string; des_origem: string | null; tipo: string | null; quantidade: number
  valor_unit: number | null; cmc_apos: number | null; saldo_apos: number | null
  num_doc: string | null; num_pedido: string | null; id_ajuste: number | null; id_cupom: number | null; cancelado: boolean
}

const iso = (br: string) => { const [d, m, a] = br.split('/'); return `${a}-${m}-${d}` }
const numOuNull = (v: unknown) => (v == null || v === '' ? null : Number(v))

export function normalizarMovOmie(m: MovOmie, lojaId: number): LinhaKardexOmie {
  return {
    loja_id: lojaId, id_mov: Number(m.idMov), n_cod_prod: Number(m.idProd), codigo_local_estoque: Number(m.codigo_local_estoque),
    data_mov: iso(m.dtMov), cod_origem: m.codOrigem ?? '', des_origem: m.desOrigem ?? null, tipo: m.tipo ?? null,
    quantidade: Number(m.qtde ?? 0), valor_unit: numOuNull(m.valor), cmc_apos: numOuNull(m.cmc), saldo_apos: numOuNull(m.saldo),
    num_doc: m.numDoc ?? null, num_pedido: m.numPedido ?? null, id_ajuste: numOuNull(m.idAjuste), id_cupom: numOuNull(m.idCupom),
    cancelado: m.cancelamento === 'S',
  }
}

/** Ordena por data e id_mov e marca o movimento cujo CMC é >= 10x o do anterior (mesmo local). */
export function marcarSaltosCmc(linhas: LinhaKardexOmie[]): (LinhaKardexOmie & { saltoCmc: boolean })[] {
  const ord = [...linhas].sort((a, b) => a.data_mov.localeCompare(b.data_mov) || a.id_mov - b.id_mov)
  const ultimo = new Map<number, number>()
  return ord.map((l) => {
    const ant = ultimo.get(l.codigo_local_estoque)
    const atual = Math.abs(l.cmc_apos ?? 0)
    const saltoCmc = ant != null && ant > 0 && atual >= ant * 10
    if (atual > 0) ultimo.set(l.codigo_local_estoque, atual)
    return { ...l, saltoCmc }
  })
}

type RespMov = { nTotPaginas?: number; movProdutoListar?: MovOmie[] }

/** Movimentos de 1 produto em 1 local no período (dd/mm/aaaa, até ~55 dias: o Omie corta perto de 60 sem avisar). */
export async function buscarKardexOmie(loja: LojaOmie, idProd: number, codigoLocal: number, dIni: string, dFim: string): Promise<MovOmie[]> {
  const out: MovOmie[] = []
  let pagina = 1, total = 1
  do {
    let r: RespMov
    try {
      r = await omieRequest<RespMov>({
        loja_id: loja.id, omie_app_key: loja.omie_app_key, omie_app_secret: loja.omie_app_secret, is_test: loja.is_test,
        endpoint: 'v1/estoque/consulta', call: 'ListarMovimentoEstoque',
        data: { nPagina: pagina, nRegPorPagina: 100, dDtInicial: dIni, dDtFinal: dFim, codigo_local_estoque: codigoLocal, idProd },
      })
    } catch (e) {
      if (/n[ãa]o existem registros/i.test(e instanceof Error ? e.message : String(e))) break
      throw e
    }
    total = r.nTotPaginas || 1
    out.push(...(r.movProdutoListar ?? []))
    pagina++
  } while (pagina <= total)
  return out
}
```

Antes de escrever: confirmar em `lib/omie/client.ts` o formato de `endpoint` usado pelos outros módulos (`'v1/estoque/consulta'` em `posicao-estoque.ts`) e que importar `./client.ts` com extensão funciona no `tsc` do repo — se o `tsc` reclamar de `.ts` em import (AGENTS.md cita isso em `meta-faturamento.ts`), mover as funções puras para `lib/estoque/kardex-omie-puro.ts` (sem imports) e deixar `buscarKardexOmie` em `lib/omie/kardex.ts` importando `./client` sem extensão; ajustar o teste para o arquivo puro.

- [ ] **Step 5: Run** `node --test lib/omie/kardex.test.ts` (ou o arquivo puro) → PASS.

- [ ] **Step 6: Rota** (`app/api/estoque/kardex-omie/route.ts`)

```ts
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import type { LojaOmie } from '@/lib/omie/client'
import { buscarKardexOmie, normalizarMovOmie } from '@/lib/omie/kardex'
import { modoDaLoja } from '@/lib/estoque/ledger'

export const maxDuration = 300
const JANELA_DIAS = 55
const INTERVALO_MIN = 10
const br = (d: Date) => d.toLocaleDateString('pt-BR', { timeZone: 'America/Bahia' })

/** Carrega do Omie os movimentos de 1 produto (todos os locais ativos, últimos 55 dias). Só leitura do Omie. */
export async function POST(req: Request) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Movimentacoes'))) return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
  if ((await modoDaLoja(lojaId)) !== 'omie') return NextResponse.json({ error: 'Só para loja com Omie' }, { status: 400 })
  const body = await req.json().catch(() => ({}))
  const codigoProduto = Number(body?.codigoProduto)
  if (!Number.isFinite(codigoProduto) || codigoProduto <= 0) return NextResponse.json({ error: 'codigoProduto inválido' }, { status: 400 })

  const supabase = createServiceClient()
  const { data: recente } = await supabase.from('kardex_omie').select('carregado_em')
    .eq('loja_id', lojaId).eq('n_cod_prod', codigoProduto).order('carregado_em', { ascending: false }).limit(1).maybeSingle()
  if (recente && Date.now() - new Date(recente.carregado_em as string).getTime() < INTERVALO_MIN * 60_000) {
    return NextResponse.json({ ok: true, gravados: 0, doCache: true })
  }

  const { data: loja } = await supabase.from('lojas').select('id, omie_app_key, omie_app_secret, is_test').eq('id', lojaId).single<LojaOmie>()
  if (!loja?.omie_app_key) return NextResponse.json({ error: 'Loja sem integração Omie' }, { status: 400 })
  const { data: locais } = await supabase.from('local_estoques').select('codigo_local_estoque').eq('loja_id', lojaId).neq('inativo', 'S')

  const fim = new Date(), ini = new Date(Date.now() - JANELA_DIAS * 86_400_000)
  let gravados = 0
  try {
    for (const l of locais ?? []) {
      const movs = await buscarKardexOmie(loja, codigoProduto, Number(l.codigo_local_estoque), br(ini), br(fim))
      const linhas = movs.map((m) => ({ ...normalizarMovOmie(m, lojaId), carregado_em: new Date().toISOString() }))
      for (let i = 0; i < linhas.length; i += 500) {
        const { error } = await supabase.from('kardex_omie').upsert(linhas.slice(i, i + 500), { onConflict: 'loja_id,id_mov' })
        if (error) throw new Error(error.message)
      }
      gravados += linhas.length
    }
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Falha ao ler o Omie', gravados }, { status: 502 })
  }
  return NextResponse.json({ ok: true, gravados, doCache: false })
}
```

Nota: se o produto não tiver movimento algum, nada é gravado e o controle de 10 min não segura cliques repetidos — aceitável (cada clique custa 1 chamada por local). Se `getCurrentLojaId`/`requirePermissao` tiverem outra assinatura, seguir `app/api/sync/posicao/route.ts`.

- [ ] **Step 7: Componente** (`components/estoque-proprio/KardexOmie.tsx`) — client component com:
  - botão "Carregar movimentos do Omie" (quando `podeCarregar`) que faz `fetch('/api/estoque/kardex-omie', { method: 'POST', body: JSON.stringify({ codigoProduto }) , headers: { 'Content-Type': 'application/json' } })`, toast de erro/sucesso ("Movimentos atualizados" / "Já carregado há pouco") e `router.refresh()`;
  - tabela (mesmo visual de `Kardex.tsx`: reutilizar as classes) com colunas: Data (`dd/mm`), Local, Origem (`cod_origem` + `des_origem` em texto pequeno), Quantidade (verde/vermelho pelo sinal, com unidade), Custo unit. (`formatCustoUnit(valor_unit)`), CMC após (com selo "salto" em `text-err` quando `saltoCmc`), Saldo após, Documento (`num_pedido ?? num_doc`); linha cancelada com `line-through opacity-60`;
  - vazio: `"Nenhum movimento carregado. Clique em Carregar movimentos do Omie (últimos 55 dias)."`.
  - Props: `{ codigoProduto: number; unidade: string; linhas: (LinhaKardexOmie & { saltoCmc: boolean; local: string })[]; podeCarregar: boolean }`.

- [ ] **Step 8: Página do produto** — em loja Omie, ler `kardex_omie` do produto (client de sessão, `.eq('loja_id').eq('n_cod_prod').order('data_mov', desc).order('id_mov', desc).limit(300)`), passar por `marcarSaltosCmc`, inverter para mais recente primeiro, mapear nome do local (`visao.locais`), e renderizar `<KardexOmie … podeCarregar={await requirePermissao(lojaId, 'Movimentacoes')} />` na seção "Movimentos no Omie". Se a tabela não existir (migration não aplicada → erro `42P01`/`relation … does not exist`), mostrar `"Kardex do Omie ainda não ativado."` em vez de quebrar.

- [ ] **Step 9: Typecheck, testes, commit**

Run: `npx tsc --noEmit -p . && node --test lib/omie/kardex.test.ts lib/estoque/espelho-omie.test.ts`
Expected: PASS, sem erros novos.

```bash
git add supabase/migrations/157_kardex_omie.sql lib/omie/kardex.ts lib/omie/kardex.test.ts app/api/estoque/kardex-omie/route.ts components/estoque-proprio/KardexOmie.tsx "app/(app)/estoque/produto/[codigo]/page.tsx"
git commit -m "feat(estoque): kardex do Omie por produto (migration 157, carga sob demanda)"
```

---

### Task 4: Documentação + verificação final

**Files:**
- Modify: `AGENTS.md` (nova seção no fim, via `git add -p` só dela)

- [ ] **Step 1: AGENTS.md** — seção "Estoque da loja Omie (espelho), 13/10/2026": telas `/estoque*` agora valem para `omie` e `proprio`; fonte `posicao_estoques` (foto mais recente; CMC com fallback; CMC fora de (0, 1e7) = suspeito); botão usa `/api/sync/posicao`; kardex `kardex_omie` (migration 157, manual) via `POST /api/estoque/kardex-omie` (55 dias, todos os locais ativos, 1 carga a cada 10 min por produto); nenhuma escrita no Omie; estado: NÃO deployado, migration 157 NÃO aplicada.

- [ ] **Step 2: Verificação final**

Run: `node --test lib/estoque/espelho-omie.test.ts lib/omie/kardex.test.ts && npx tsc --noEmit -p . && npm run build`
Expected: testes PASS, tsc limpo, build OK.

- [ ] **Step 3: Commit**

```bash
git add -p AGENTS.md
git commit -m "docs: AGENTS.md - estoque da loja Omie (espelho) e kardex do Omie"
```
