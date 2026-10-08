# Faturamento: tela nova com período, ranking e filtros — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Nova tela `/faturamento` com seletor de período na cara, filtros de tipo/família/situação que valem em todas as abas, ranking de produtos/famílias/tipos (mais e menos vendidos) e detalhe por produto com gráfico diário.

**Architecture:** Uma leitura de itens vendidos por período (Contabo para lojas Omie, `vendas_proprio*` para lojas próprias) vira uma lista de `LinhaItem`. Funções puras (`lib/faturamento-itens.ts`, `lib/faturamento-periodo.ts`) agrupam, ordenam e calculam; a página só compõe. A tela antiga `/relatorio-faturamento` fica intacta e linkada.

**Tech Stack:** Next.js 16 (App Router, Server Components), React 19, TypeScript, Supabase/Postgres, ExcelJS, `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-08-faturamento-painel-design.md`

## Global Constraints

- Next.js 16 tem breaking changes (AGENTS.md): seguir os padrões dos arquivos vizinhos (`searchParams` é `Promise`, componentes client com `'use client'`).
- Fuso `America/Bahia`; "hoje" por `hojeBahiaISO()`.
- Só `getAtorGestao().podeGerir` acessa (`notFound()` na página, 403 no export).
- Período: máximo 366 dias (mantém o trecho mais recente e avisa), nunca depois de hoje, padrão = mês atual até hoje.
- Situação "válidas" = cupom não cancelado (devolvido incluído) em loja Omie; em loja própria exclui também devolvido (igual a `recalcular_faturamento_proprio`).
- Valor do item: `v_item`, ou `v_unit × quant − v_desc` quando `v_item` é 0.
- Arquivos puros (`lib/faturamento-itens.ts`, `lib/faturamento-periodo.ts`) não importam nada com alias `@/` nem com extensão `.ts` (testados direto no `node`).
- Sem migration. Textos em português. Commits terminam com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Push e `deploy.sh` só depois de testado em produção-equivalente; `deploy.sh` é manual (`git push` não atualiza produção).

## Review Focus

- Período vazio/invertido/futuro/maior que 366 dias cai no padrão ou é cortado, sem erro.
- Filtro de tipo ou família que não casa nada: ranking vazio com mensagem, sem quebrar.
- Produto sem cadastro (`id_produto` nulo ou fora de `produtos`): aparece como "Produto não identificado", não some, e a soma bate com os cupons.
- Mesmo produto com nomes diferentes entre cupons: agrupa por id, não por nome.
- Falha/truncamento do Contabo: aviso visível, nunca zeros como se fossem dado.
- "Menos vendidos" mostra só quem vendeu (não lista produto com 0).

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `lib/faturamento-itens.ts` (puro) + teste | `LinhaItem`, ranking, ordenação, busca, KPIs, série diária |
| `lib/faturamento-periodo.ts` (puro) + teste | atalhos, mês vizinho, leitura/validação do período |
| `lib/faturamento-params.ts` | lê os searchParams da tela num objeto único (página + export) |
| `lib/faturamento-itens-loader.ts` | leitura de itens (Omie/Contabo ou loja própria) + opções de filtro |
| `components/faturamento/PeriodoBar.tsx` | barra de período (mês ◀▶, atalhos, datas) |
| `components/faturamento/FiltrosFaturamento.tsx` (client) | Tipo, Família, Situação inline |
| `components/faturamento/RankingBarras.tsx` | lista com barras de participação |
| `components/faturamento/DetalheProduto.tsx` | detalhe do item clicado + gráfico diário |
| `app/(app)/faturamento/page.tsx` | a tela |
| `app/(app)/faturamento/export/route.ts` | Excel do ranking atual |
| `app/(app)/relatorios/page.tsx` (editar) | card aponta para `/faturamento` |

---

### Task 1: Funções puras do ranking

**Files:** Create `lib/faturamento-itens.ts`, Test `lib/faturamento-itens.test.ts`

**Interfaces — Produces:** `LinhaItem`, `Dimensao`, `LinhaRanking`, `rankear(linhas, por)`, `ordenarRanking(r, ordem, sentido)`, `filtrarPorNome(r, q)`, `resumir(linhas)`, `serieDiaria(linhas, ini, fim)`, `posicaoNoRanking(r, chave)`.

- [ ] **Step 1: teste (deve falhar: módulo não existe)**

**File: `lib/faturamento-itens.test.ts`**
```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rankear, ordenarRanking, filtrarPorNome, resumir, serieDiaria, posicaoNoRanking } from './faturamento-itens.ts'

const L = (o: Partial<Parameters<typeof rankear>[0][number]>) => ({
  dia: '2026-10-01', cupom: 1, idProduto: 1, produto: 'Moqueca', tipoCod: '04', tipo: 'Produto acabado',
  familia: 'Pratos', quant: 1, valor: 100, ...o,
})

const linhas = [
  L({ cupom: 1, idProduto: 1, produto: 'Moqueca', quant: 2, valor: 200 }),
  L({ cupom: 2, idProduto: 1, produto: 'Moqueca (nome velho)', quant: 1, valor: 100, dia: '2026-10-02' }),
  L({ cupom: 2, idProduto: 2, produto: 'Casquinha de siri', familia: 'Entradas', quant: 3, valor: 90, dia: '2026-10-02' }),
  L({ cupom: 3, idProduto: null, produto: 'Produto não identificado', tipoCod: '', tipo: 'Não classificado', familia: 'Sem família', quant: 1, valor: 10, dia: '2026-10-03' }),
]

test('rankear por produto agrupa por id (não por nome), soma e conta cupons', () => {
  const r = rankear(linhas, 'produto')
  assert.equal(r.length, 3)
  assert.equal(r[0].rotulo, 'Moqueca')
  assert.equal(r[0].valor, 300)
  assert.equal(r[0].quant, 3)
  assert.equal(r[0].cupons, 2)
  assert.equal(r[0].pct, 75)
  assert.equal(r[1].rotulo, 'Casquinha de siri')
  assert.equal(r[2].rotulo, 'Produto não identificado')
})

test('rankear por família e por tipo', () => {
  const f = rankear(linhas, 'familia')
  assert.deepEqual(f.map((x) => [x.rotulo, x.valor]), [['Pratos', 300], ['Entradas', 90], ['Sem família', 10]])
  const t = rankear(linhas, 'tipo')
  assert.deepEqual(t.map((x) => [x.rotulo, x.valor]), [['Produto acabado', 390], ['Não classificado', 10]])
})

test('ordenarRanking: mais/menos vendidos por valor ou quantidade', () => {
  const r = rankear(linhas, 'produto')
  assert.equal(ordenarRanking(r, 'valor', 'mais')[0].rotulo, 'Moqueca')
  assert.equal(ordenarRanking(r, 'valor', 'menos')[0].rotulo, 'Produto não identificado')
  assert.equal(ordenarRanking(r, 'quant', 'mais')[0].rotulo, 'Casquinha de siri' === 'x' ? '' : 'Moqueca') // 3 un cada; empate desempata pelo nome
  assert.equal(ordenarRanking(r, 'quant', 'menos')[0].rotulo, 'Produto não identificado')
})

test('filtrarPorNome ignora acento e caixa', () => {
  const r = rankear(linhas, 'produto')
  assert.deepEqual(filtrarPorNome(r, 'SIRI').map((x) => x.rotulo), ['Casquinha de siri'])
  assert.deepEqual(filtrarPorNome(r, 'nao identificado').map((x) => x.rotulo), ['Produto não identificado'])
  assert.equal(filtrarPorNome(r, '').length, 3)
})

test('resumir: faturado, cupons distintos, ticket, melhor dia', () => {
  const k = resumir(linhas)
  assert.equal(k.faturado, 400)
  assert.equal(k.cupons, 3)
  assert.equal(k.ticket, 133.33)
  assert.deepEqual(k.melhorDia, { dia: '2026-10-01', valor: 200 })
  assert.equal(k.itens, 7)
})

test('resumir: sem linhas', () => {
  const k = resumir([])
  assert.equal(k.faturado, 0)
  assert.equal(k.ticket, null)
  assert.equal(k.melhorDia, null)
})

test('serieDiaria preenche dias sem venda', () => {
  const s = serieDiaria(linhas, '2026-10-01', '2026-10-04')
  assert.deepEqual(s, [
    { dia: '2026-10-01', valor: 200 },
    { dia: '2026-10-02', valor: 190 },
    { dia: '2026-10-03', valor: 10 },
    { dia: '2026-10-04', valor: 0 },
  ])
})

test('posicaoNoRanking é 1-based e null quando não existe', () => {
  const r = rankear(linhas, 'produto')
  assert.equal(posicaoNoRanking(r, '1'), 1)
  assert.equal(posicaoNoRanking(r, '2'), 2)
  assert.equal(posicaoNoRanking(r, '999'), null)
})
```

- [ ] **Step 2:** Run `node --test lib/faturamento-itens.test.ts` — Expected: FAIL (`Cannot find module`).

- [ ] **Step 3: implementar**

**File: `lib/faturamento-itens.ts`**
```ts
// Funcoes puras do painel de Faturamento (sem I/O, sem alias '@/', sem import '.ts').

export type LinhaItem = {
  dia: string // 'YYYY-MM-DD'
  cupom: number
  idProduto: number | null
  produto: string
  tipoCod: string
  tipo: string
  familia: string
  quant: number
  valor: number
}
export type Dimensao = 'produto' | 'familia' | 'tipo'
export type LinhaRanking = { chave: string; rotulo: string; valor: number; quant: number; cupons: number; pct: number }

const round2 = (n: number) => Math.round(n * 100) / 100
const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

function chaveDe(l: LinhaItem, por: Dimensao): { chave: string; rotulo: string } {
  if (por === 'familia') return { chave: l.familia, rotulo: l.familia }
  if (por === 'tipo') return { chave: l.tipoCod || '_', rotulo: l.tipo }
  return { chave: l.idProduto != null ? String(l.idProduto) : `nome:${l.produto}`, rotulo: l.produto }
}

export function rankear(linhas: LinhaItem[], por: Dimensao): LinhaRanking[] {
  const m = new Map<string, { rotulo: string; valor: number; quant: number; cupons: Set<number> }>()
  for (const l of linhas) {
    const { chave, rotulo } = chaveDe(l, por)
    const g = m.get(chave) ?? { rotulo, valor: 0, quant: 0, cupons: new Set<number>() }
    g.valor += l.valor
    g.quant += l.quant
    g.cupons.add(l.cupom)
    m.set(chave, g)
  }
  const total = [...m.values()].reduce((s, g) => s + g.valor, 0)
  return [...m.entries()]
    .map(([chave, g]) => ({
      chave, rotulo: g.rotulo, valor: round2(g.valor), quant: round2(g.quant), cupons: g.cupons.size,
      pct: total > 0 ? round2((g.valor / total) * 100) : 0,
    }))
    .sort((a, b) => b.valor - a.valor || a.rotulo.localeCompare(b.rotulo, 'pt-BR'))
}

export function ordenarRanking(r: LinhaRanking[], ordem: 'valor' | 'quant', sentido: 'mais' | 'menos'): LinhaRanking[] {
  const dir = sentido === 'mais' ? -1 : 1
  return [...r].sort((a, b) => dir * (a[ordem] - b[ordem]) || a.rotulo.localeCompare(b.rotulo, 'pt-BR'))
}

export function filtrarPorNome(r: LinhaRanking[], q: string): LinhaRanking[] {
  const t = semAcento(q.trim())
  return t ? r.filter((x) => semAcento(x.rotulo).includes(t)) : r
}

export type ResumoItens = { faturado: number; cupons: number; ticket: number | null; itens: number; melhorDia: { dia: string; valor: number } | null }

export function resumir(linhas: LinhaItem[]): ResumoItens {
  const cupons = new Set<number>()
  const porDia = new Map<string, number>()
  let faturado = 0
  let itens = 0
  for (const l of linhas) {
    faturado += l.valor
    itens += l.quant
    cupons.add(l.cupom)
    porDia.set(l.dia, (porDia.get(l.dia) ?? 0) + l.valor)
  }
  let melhor: { dia: string; valor: number } | null = null
  for (const [dia, valor] of porDia) if (melhor === null || valor > melhor.valor) melhor = { dia, valor: round2(valor) }
  return {
    faturado: round2(faturado), cupons: cupons.size, itens: round2(itens),
    ticket: cupons.size > 0 ? round2(faturado / cupons.size) : null,
    melhorDia: melhor,
  }
}

function proximoDia(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

export function serieDiaria(linhas: LinhaItem[], ini: string, fim: string): { dia: string; valor: number }[] {
  const porDia = new Map<string, number>()
  for (const l of linhas) porDia.set(l.dia, (porDia.get(l.dia) ?? 0) + l.valor)
  const out: { dia: string; valor: number }[] = []
  for (let d = ini; d <= fim && out.length < 366; d = proximoDia(d)) out.push({ dia: d, valor: round2(porDia.get(d) ?? 0) })
  return out
}

export function posicaoNoRanking(r: LinhaRanking[], chave: string): number | null {
  const i = r.findIndex((x) => x.chave === chave)
  return i < 0 ? null : i + 1
}
```

- [ ] **Step 4:** Run `node --test lib/faturamento-itens.test.ts` — Expected: PASS (8). (Se o teste de `quant` desempatar diferente, o desempate é por nome em pt-BR; "Casquinha" vem antes de "Moqueca" — ajustar o teste para o que o desempate realmente produz: com 3 un cada, "Casquinha de siri" vem primeiro.)

- [ ] **Step 5: Commit** `git add lib/faturamento-itens.ts lib/faturamento-itens.test.ts && git commit -m "feat(faturamento): funcoes puras do ranking"`

### Task 2: Funções puras do período

**Files:** Create `lib/faturamento-periodo.ts`, Test `lib/faturamento-periodo.test.ts`

**Interfaces — Produces:** `type Atalho`, `ATALHOS`, `addDias`, `periodoDoAtalho(a, hoje)`, `periodoDoMes(mes, hoje)`, `mesVizinho(mes, delta)`, `nomeMes(mes)`, `lerPeriodo(sp, hoje): { ini; fim; cortado }`.

- [ ] **Step 1: teste**

**File: `lib/faturamento-periodo.test.ts`**
```ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { periodoDoAtalho, periodoDoMes, mesVizinho, nomeMes, lerPeriodo } from './faturamento-periodo.ts'

test('atalhos', () => {
  assert.deepEqual(periodoDoAtalho('hoje', '2026-10-08'), { ini: '2026-10-08', fim: '2026-10-08' })
  assert.deepEqual(periodoDoAtalho('ontem', '2026-10-08'), { ini: '2026-10-07', fim: '2026-10-07' })
  assert.deepEqual(periodoDoAtalho('7dias', '2026-10-08'), { ini: '2026-10-02', fim: '2026-10-08' })
  assert.deepEqual(periodoDoAtalho('mes', '2026-10-08'), { ini: '2026-10-01', fim: '2026-10-08' })
  assert.deepEqual(periodoDoAtalho('mes_passado', '2026-10-08'), { ini: '2026-09-01', fim: '2026-09-30' })
  assert.deepEqual(periodoDoAtalho('mes_passado', '2027-01-15'), { ini: '2026-12-01', fim: '2026-12-31' })
  assert.deepEqual(periodoDoAtalho('ano', '2026-10-08'), { ini: '2026-01-01', fim: '2026-10-08' })
})

test('periodoDoMes: mês fechado inteiro, mês atual até hoje', () => {
  assert.deepEqual(periodoDoMes('2026-09', '2026-10-08'), { ini: '2026-09-01', fim: '2026-09-30' })
  assert.deepEqual(periodoDoMes('2026-10', '2026-10-08'), { ini: '2026-10-01', fim: '2026-10-08' })
  assert.deepEqual(periodoDoMes('2028-02', '2028-03-01'), { ini: '2028-02-01', fim: '2028-02-29' })
})

test('mesVizinho atravessa o ano', () => {
  assert.equal(mesVizinho('2026-01', -1), '2025-12')
  assert.equal(mesVizinho('2026-12', 1), '2027-01')
  assert.equal(mesVizinho('2026-10', 0), '2026-10')
})

test('nomeMes', () => {
  assert.equal(nomeMes('2026-10'), 'Outubro 2026')
})

test('lerPeriodo: padrão é o mês atual até hoje', () => {
  assert.deepEqual(lerPeriodo({}, '2026-10-08'), { ini: '2026-10-01', fim: '2026-10-08', cortado: false })
})

test('lerPeriodo: mes= e ini/fim', () => {
  assert.deepEqual(lerPeriodo({ mes: '2026-09' }, '2026-10-08'), { ini: '2026-09-01', fim: '2026-09-30', cortado: false })
  assert.deepEqual(lerPeriodo({ ini: '2026-10-03', fim: '2026-10-05' }, '2026-10-08'), { ini: '2026-10-03', fim: '2026-10-05', cortado: false })
  assert.deepEqual(lerPeriodo({ ini: '2026-10-03' }, '2026-10-08'), { ini: '2026-10-03', fim: '2026-10-08', cortado: false })
})

test('lerPeriodo: fim no futuro é limitado a hoje', () => {
  assert.deepEqual(lerPeriodo({ ini: '2026-10-03', fim: '2026-12-31' }, '2026-10-08'), { ini: '2026-10-03', fim: '2026-10-08', cortado: false })
})

test('lerPeriodo: inválido, invertido ou futuro cai no padrão', () => {
  const padrao = { ini: '2026-10-01', fim: '2026-10-08', cortado: false }
  assert.deepEqual(lerPeriodo({ ini: 'abc', fim: 'x' }, '2026-10-08'), padrao)
  assert.deepEqual(lerPeriodo({ ini: '2026-10-05', fim: '2026-10-01' }, '2026-10-08'), padrao)
  assert.deepEqual(lerPeriodo({ ini: '2026-11-01' }, '2026-10-08'), padrao)
  assert.deepEqual(lerPeriodo({ mes: '2026-11' }, '2026-10-08'), padrao)
  assert.deepEqual(lerPeriodo({ mes: '2026-13' }, '2026-10-08'), padrao)
})

test('lerPeriodo: mais de 366 dias mantém o trecho mais recente', () => {
  const r = lerPeriodo({ ini: '2025-01-01', fim: '2026-10-08' }, '2026-10-08')
  assert.equal(r.fim, '2026-10-08')
  assert.equal(r.ini, '2025-10-08')
  assert.equal(r.cortado, true)
})
```

- [ ] **Step 2:** `node --test lib/faturamento-periodo.test.ts` — Expected: FAIL.

- [ ] **Step 3: implementar**

**File: `lib/faturamento-periodo.ts`**
```ts
// Periodo do painel de Faturamento (puro). Datas 'YYYY-MM-DD'; mes 'YYYY-MM'.

export type Atalho = 'hoje' | 'ontem' | '7dias' | 'mes' | 'mes_passado' | 'ano'
export const ATALHOS: { value: Atalho; label: string }[] = [
  { value: 'hoje', label: 'Hoje' },
  { value: 'ontem', label: 'Ontem' },
  { value: '7dias', label: '7 dias' },
  { value: 'mes', label: 'Este mês' },
  { value: 'mes_passado', label: 'Mês passado' },
  { value: 'ano', label: 'Ano' },
]
export const MAX_DIAS = 366

const ISO = /^\d{4}-\d{2}-\d{2}$/
const MES = /^\d{4}-(0[1-9]|1[0-2])$/
const pad = (n: number) => String(n).padStart(2, '0')

export function addDias(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function mesVizinho(mes: string, delta: number): string {
  const [a, m] = mes.split('-').map(Number)
  const d = new Date(Date.UTC(a, m - 1 + delta, 1))
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}`
}

export function periodoDoMes(mes: string, hoje: string): { ini: string; fim: string } {
  const [a, m] = mes.split('-').map(Number)
  const ultimo = `${mes}-${pad(new Date(Date.UTC(a, m, 0)).getUTCDate())}`
  return { ini: `${mes}-01`, fim: ultimo > hoje ? hoje : ultimo }
}

export function periodoDoAtalho(a: Atalho, hoje: string): { ini: string; fim: string } {
  if (a === 'hoje') return { ini: hoje, fim: hoje }
  if (a === 'ontem') { const d = addDias(hoje, -1); return { ini: d, fim: d } }
  if (a === '7dias') return { ini: addDias(hoje, -6), fim: hoje }
  if (a === 'mes') return periodoDoMes(hoje.slice(0, 7), hoje)
  if (a === 'mes_passado') return periodoDoMes(mesVizinho(hoje.slice(0, 7), -1), hoje)
  return { ini: `${hoje.slice(0, 4)}-01-01`, fim: hoje }
}

export function nomeMes(mes: string): string {
  const s = new Date(`${mes}-15T12:00:00Z`).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  return (s.charAt(0).toUpperCase() + s.slice(1)).replace(' de ', ' ')
}

export function lerPeriodo(sp: { ini?: string; fim?: string; mes?: string }, hoje: string): { ini: string; fim: string; cortado: boolean } {
  const padrao = periodoDoMes(hoje.slice(0, 7), hoje)
  let p = padrao
  if (sp.ini && ISO.test(sp.ini) && sp.ini <= hoje) {
    const fim = sp.fim && ISO.test(sp.fim) ? (sp.fim > hoje ? hoje : sp.fim) : hoje
    p = fim >= sp.ini ? { ini: sp.ini, fim } : padrao
  } else if (sp.mes && MES.test(sp.mes) && sp.mes <= hoje.slice(0, 7)) {
    p = periodoDoMes(sp.mes, hoje)
  }
  const minIni = addDias(p.fim, -(MAX_DIAS - 1))
  return p.ini < minIni ? { ini: minIni, fim: p.fim, cortado: true } : { ...p, cortado: false }
}
```

- [ ] **Step 4:** `node --test lib/faturamento-periodo.test.ts lib/faturamento-itens.test.ts` — Expected: PASS.
  (`ini: '2025-01-01'` a `2026-10-08` = mais de 366 dias → `minIni = 2025-10-08`; confirmar que `addDias('2026-10-08', -365)` é `2025-10-08`.)

- [ ] **Step 5: Commit** `git add lib/faturamento-periodo.ts lib/faturamento-periodo.test.ts && git commit -m "feat(faturamento): periodo (atalhos, mes, validacao)"`

### Task 3: Parâmetros e loader de itens

**Files:** Create `lib/faturamento-params.ts`, `lib/faturamento-itens-loader.ts`

**Interfaces — Consumes:** `lerPeriodo` (Task 2), `LinhaItem` (Task 1), `buscarFatCupons`/`buscarFatCupomItens` (`lib/faturamento-frio.ts`), `buscarTodasLinhas`, `modoDaLoja`, `TIPO_NOME`. **Produces:** `lerParamsFaturamento(sp, hoje)`, `type ParamsFat`, `carregarItens(lojaId, ini, fim, filtros)`, `type Situacao`, `type ItensCarregados`.

- [ ] **Step 1: params**

**File: `lib/faturamento-params.ts`**
```ts
import { lerPeriodo } from '@/lib/faturamento-periodo'

export type Situacao = 'validas' | 'devolvidas' | 'canceladas'
export type Aba = 'produtos' | 'familias' | 'tipos' | 'dias'
export type SpFat = Record<string, string | undefined>

export type ParamsFat = {
  ini: string; fim: string; cortado: boolean
  aba: Aba; tipos: string[]; familias: string[]; situacao: Situacao
  q: string; ordem: 'valor' | 'quant'; sentido: 'mais' | 'menos'; produto: string
}

const lista = (v?: string) => (v ?? '').split(',').map((x) => x.trim()).filter(Boolean)

export function lerParamsFaturamento(sp: SpFat, hoje: string): ParamsFat {
  const per = lerPeriodo({ ini: sp.ini, fim: sp.fim, mes: sp.mes }, hoje)
  return {
    ...per,
    aba: (['produtos', 'familias', 'tipos', 'dias'] as const).find((a) => a === sp.aba) ?? 'produtos',
    tipos: lista(sp.tipo),
    familias: lista(sp.familia),
    situacao: (['devolvidas', 'canceladas'] as const).find((s) => s === sp.situacao) ?? 'validas',
    q: (sp.q ?? '').slice(0, 80),
    ordem: sp.ordem === 'quant' ? 'quant' : 'valor',
    sentido: sp.sentido === 'menos' ? 'menos' : 'mais',
    produto: sp.produto ?? '',
  }
}
```

- [ ] **Step 2: loader**

**File: `lib/faturamento-itens-loader.ts`**
```ts
import { createServiceClient } from '@/lib/supabase/server'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { buscarFatCupons, buscarFatCupomItens } from '@/lib/faturamento-frio'
import { buscarTodasLinhas } from '@/lib/supabase/buscar-todas-linhas'
import { TIPO_NOME } from '@/lib/omie/faturamento'
import type { LinhaItem } from '@/lib/faturamento-itens'
import type { Situacao } from '@/lib/faturamento-params'

export type FiltrosItens = { tipos: string[]; familias: string[]; situacao: Situacao }
export type Opcao = { value: string; label: string }
export type ItensCarregados = { linhas: LinhaItem[]; aviso: string | null; opcoes: { tipos: Opcao[]; familias: Opcao[] } }

type Meta = { codigo_produto: number; tipo_item: string | null; descricao_familia: string | null; descricao: string | null; codigo: string | null }

const rotuloTipo = (cod: string) => (cod ? (TIPO_NOME[cod] ?? `Tipo ${cod}`) : 'Não classificado')
const SEM_FAMILIA = 'Sem família'

// Leitura de itens vendidos do periodo, ja com tipo/familia/nome do cadastro e filtros aplicados.
export async function carregarItens(lojaId: number, ini: string, fim: string, filtros: FiltrosItens): Promise<ItensCarregados> {
  const supabase = createServiceClient()
  let aviso: string | null = null
  const sinalizar = (msg: string) => { aviso = msg }

  const produtos = await buscarTodasLinhas<Meta>(
    (from, to) => supabase.from('produtos').select('codigo_produto, tipo_item, descricao_familia, descricao, codigo').eq('loja_id', lojaId).order('id').range(from, to),
    undefined,
    (e) => sinalizar(`Falha ao ler o cadastro de produtos (${e.message}). Tipo e família podem estar incompletos.`),
  )
  const meta = new Map<number, Meta>(produtos.map((p) => [Number(p.codigo_produto), p]))

  const tiposVistos = new Set<string>()
  const familiasVistas = new Set<string>()
  for (const p of produtos) {
    tiposVistos.add(p.tipo_item ?? '')
    familiasVistas.add(p.descricao_familia || SEM_FAMILIA)
  }
  const opcoes = {
    tipos: [...tiposVistos].sort().map((c) => ({ value: c || '_', label: rotuloTipo(c) })),
    familias: [...familiasVistas].sort((a, b) => a.localeCompare(b, 'pt-BR')).map((f) => ({ value: f, label: f })),
  }

  const montar = (idProduto: number | null, nomeBruto: string | null, dia: string, cupom: number, quant: number, valor: number): LinhaItem | null => {
    const m = idProduto != null ? meta.get(idProduto) : undefined
    const tipoCod = m?.tipo_item ?? ''
    const familia = m?.descricao_familia || SEM_FAMILIA
    if (filtros.tipos.length && !filtros.tipos.includes(tipoCod || '_')) return null
    if (filtros.familias.length && !filtros.familias.includes(familia)) return null
    return {
      dia: String(dia).slice(0, 10), cupom, idProduto, produto: m?.descricao || m?.codigo || nomeBruto || 'Produto não identificado',
      tipoCod, tipo: rotuloTipo(tipoCod), familia, quant, valor,
    }
  }

  const linhas: LinhaItem[] = []
  const modo = await modoDaLoja(lojaId)

  if (modo === 'proprio') {
    const bate = (v: { cancelado: boolean; devolvido: boolean }) =>
      filtros.situacao === 'canceladas' ? v.cancelado : filtros.situacao === 'devolvidas' ? v.devolvido && !v.cancelado : !v.cancelado && !v.devolvido
    const vendas = (await buscarTodasLinhas<{ id: number; data: string; cancelado: boolean; devolvido: boolean }>(
      (from, to) => supabase.from('vendas_proprio').select('id, data, cancelado, devolvido').eq('loja_id', lojaId).gte('data', ini).lte('data', fim).order('id').range(from, to),
      undefined,
      (e) => sinalizar(`Falha ao ler as vendas (${e.message}). Os valores podem estar incompletos.`),
    )).filter(bate)
    const porVenda = new Map(vendas.map((v) => [v.id, v.data]))
    const ids = [...porVenda.keys()]
    for (let i = 0; i < ids.length; i += 150) {
      const lote = ids.slice(i, i + 150)
      const itens = await buscarTodasLinhas<{ venda_id: number; codigo_produto: number | null; nome: string | null; quantidade: number | string; valor: number | string }>(
        (from, to) => supabase.from('vendas_proprio_itens').select('venda_id, codigo_produto, nome, quantidade, valor').in('venda_id', lote).order('id').range(from, to),
        undefined,
        (e) => sinalizar(`Falha ao ler os itens (${e.message}). Os valores podem estar incompletos.`),
      )
      for (const it of itens) {
        const l = montar(it.codigo_produto != null ? Number(it.codigo_produto) : null, it.nome, porVenda.get(it.venda_id)!, it.venda_id, Number(it.quantidade) || 0, Number(it.valor) || 0)
        if (l) linhas.push(l)
      }
    }
  } else {
    let truncou = false
    const onTruncado = () => { truncou = true }
    const [cupons, itens] = await Promise.all([
      buscarFatCupons({ lojaId, dataInicio: ini, dataFinal: fim, onTruncado }),
      buscarFatCupomItens({ lojaId, dataInicio: ini, dataFinal: fim, onTruncado }),
    ])
    if (truncou) aviso = 'A consulta ao histórico foi cortada antes do fim. Os valores abaixo podem estar incompletos.'
    const bate = (c: { cancelado: boolean; devolvido: boolean }) =>
      filtros.situacao === 'canceladas' ? c.cancelado : filtros.situacao === 'devolvidas' ? c.devolvido && !c.cancelado : !c.cancelado
    const porCupom = new Map(cupons.filter(bate).map((c) => [c.n_id_cupom, c.data]))
    for (const it of itens) {
      const dia = porCupom.get(it.n_id_cupom)
      if (dia === undefined) continue
      const valor = it.v_item || it.v_unit * it.quant - it.v_desc || 0
      const l = montar(it.id_produto, it.x_prod, dia, it.n_id_cupom, it.quant, valor)
      if (l) linhas.push(l)
    }
  }

  return { linhas, aviso, opcoes }
}
```

- [ ] **Step 3:** `npx tsc --noEmit -p . 2>&1 | grep -E "faturamento-(params|itens)" || echo TSC_OK` — Expected: `TSC_OK`.
- [ ] **Step 4: Commit** `git add lib/faturamento-params.ts lib/faturamento-itens-loader.ts && git commit -m "feat(faturamento): leitura de itens e parametros do painel"`

### Task 4: Componentes

**Files:** Create `components/faturamento/PeriodoBar.tsx`, `FiltrosFaturamento.tsx`, `RankingBarras.tsx`, `DetalheProduto.tsx`.

- [ ] **Step 1: barra de período**

**File: `components/faturamento/PeriodoBar.tsx`**
```tsx
import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { ATALHOS, mesVizinho, nomeMes, periodoDoAtalho } from '@/lib/faturamento-periodo'

const chipBase = 'inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-full px-3.5 text-[13px] font-semibold u-motion u-press-sm'
const chipAtivo = `${chipBase} bg-brand-fill text-white`
const chipInativo = `${chipBase} bg-surface-2 text-text-muted hover:bg-[var(--border)] hover:text-text`
const fmt = (iso: string) => iso.split('-').reverse().join('/')

// Seletor de periodo sempre visivel: mes com setas, atalhos e datas livres.
export function PeriodoBar({ basePath, params, ini, fim, hoje }: { basePath: string; params: Record<string, string>; ini: string; fim: string; hoje: string }) {
  const href = (over: Record<string, string>) => {
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries({ ...params, ...over })) if (v) q.set(k, v)
    return `${basePath}${q.size ? `?${q}` : ''}`
  }
  const mesUnico = ini.slice(0, 7) === fim.slice(0, 7)
  const mesRef = ini.slice(0, 7)
  const mesAtual = hoje.slice(0, 7)
  const irMes = (m: string) => href({ mes: m, ini: '', fim: '' })
  const outros = Object.entries(params).filter(([k, v]) => v && !['ini', 'fim', 'mes'].includes(k))
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1 rounded-full bg-surface-2 p-0.5">
        <Link href={irMes(mesVizinho(mesRef, -1))} aria-label="Mês anterior" className="flex size-8 items-center justify-center rounded-full text-text-muted hover:bg-[var(--border)] hover:text-text"><ChevronLeft className="size-4" /></Link>
        <span className="min-w-[8.5rem] px-1 text-center text-[13px] font-semibold text-text">{mesUnico ? nomeMes(mesRef) : `${fmt(ini)} a ${fmt(fim)}`}</span>
        {mesRef < mesAtual
          ? <Link href={irMes(mesVizinho(mesRef, 1))} aria-label="Próximo mês" className="flex size-8 items-center justify-center rounded-full text-text-muted hover:bg-[var(--border)] hover:text-text"><ChevronRight className="size-4" /></Link>
          : <span className="flex size-8 items-center justify-center text-text-muted/30"><ChevronRight className="size-4" /></span>}
      </div>
      <div className="flex flex-nowrap items-center gap-1.5 overflow-x-auto [scrollbar-width:none] sm:flex-wrap [&::-webkit-scrollbar]:hidden">
        {ATALHOS.map((a) => {
          const p = periodoDoAtalho(a.value, hoje)
          return <Link key={a.value} href={href({ ini: p.ini, fim: p.fim, mes: '' })} className={p.ini === ini && p.fim === fim ? chipAtivo : chipInativo}>{a.label}</Link>
        })}
      </div>
      <form action={basePath} className="flex items-center gap-1.5 text-[13px] text-text-muted">
        {outros.map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <input type="date" name="ini" defaultValue={ini} max={hoje} aria-label="Data inicial" className="h-8 rounded-[var(--r-md)] border border-border bg-surface px-2 text-text" />
        <span>a</span>
        <input type="date" name="fim" defaultValue={fim} max={hoje} aria-label="Data final" className="h-8 rounded-[var(--r-md)] border border-border bg-surface px-2 text-text" />
        <button type="submit" className={chipInativo}>Aplicar</button>
      </form>
    </div>
  )
}
```

- [ ] **Step 2: filtros inline (client)**

**File: `components/faturamento/FiltrosFaturamento.tsx`**
```tsx
'use client'

import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { MultiSelect } from '@/components/ui-kit/MultiSelect'

type Opcao = { value: string; label: string }
const lista = (v: string | null) => (v ?? '').split(',').filter(Boolean)

// Tipo, Familia e Situacao sempre visiveis. Mudar qualquer um mantem periodo/aba e fecha o detalhe aberto.
export function FiltrosFaturamento({ tipos, familias }: { tipos: Opcao[]; familias: Opcao[] }) {
  const router = useRouter()
  const pathname = usePathname()
  const sp = useSearchParams()
  function set(chave: string, valor: string) {
    const q = new URLSearchParams(sp.toString())
    if (valor) q.set(chave, valor)
    else q.delete(chave)
    q.delete('produto')
    router.push(`${pathname}?${q}`)
  }
  const lbl = 'flex flex-col gap-1 text-[12px] text-text-muted'
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className={lbl}>Tipo<MultiSelect className="w-52" options={tipos} value={lista(sp.get('tipo'))} onChange={(v) => set('tipo', v.join(','))} placeholder="Todos os tipos" /></label>
      <label className={lbl}>Família<MultiSelect className="w-52" options={familias} value={lista(sp.get('familia'))} onChange={(v) => set('familia', v.join(','))} placeholder="Todas as famílias" /></label>
      <label className={lbl}>Situação
        <select value={sp.get('situacao') ?? ''} onChange={(e) => set('situacao', e.target.value)} className="h-9 rounded-[var(--r-md)] border border-border bg-surface px-2 text-sm text-text">
          <option value="">Vendas válidas</option>
          <option value="devolvidas">Só devolvidas</option>
          <option value="canceladas">Só canceladas</option>
        </select>
      </label>
    </div>
  )
}
```

- [ ] **Step 3: ranking com barras**

**File: `components/faturamento/RankingBarras.tsx`**
```tsx
import Link from 'next/link'
import type { LinhaRanking } from '@/lib/faturamento-itens'
import { Money } from '@/components/ui-kit/Money'

const fmtQtd = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
const fmtPct = (n: number) => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`

// Lista ordenada com barra proporcional ao maior valor. `hrefDe` (opcional) torna a linha clicavel.
export function RankingBarras({ linhas, ordem, selecionado, hrefDe }: { linhas: LinhaRanking[]; ordem: 'valor' | 'quant'; selecionado?: string; hrefDe?: (chave: string) => string }) {
  const max = Math.max(1, ...linhas.map((l) => l[ordem]))
  return (
    <ol className="divide-y divide-border/60 overflow-hidden rounded-[var(--r-lg)] bg-surface shadow-[var(--shadow-sm)]">
      {linhas.map((l, i) => {
        const corpo = (
          <div className={`grid grid-cols-[2rem_1fr_auto] items-center gap-3 px-3 py-2.5 ${selecionado === l.chave ? 'bg-brand-soft' : ''} ${hrefDe ? 'u-motion hover:bg-surface-2' : ''}`}>
            <span className="num text-right text-[12px] text-text-muted">{i + 1}</span>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-text">{l.rotulo}</div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                <div className="h-1.5 rounded-full bg-brand" style={{ width: `${Math.max(1, (l[ordem] / max) * 100)}%` }} />
              </div>
            </div>
            <div className="text-right">
              <div className="num text-sm font-semibold text-text"><Money value={l.valor} /></div>
              <div className="num text-[12px] text-text-muted">{fmtQtd(l.quant)} un · {fmtPct(l.pct)}</div>
            </div>
          </div>
        )
        return <li key={l.chave}>{hrefDe ? <Link href={hrefDe(l.chave)} scroll={false}>{corpo}</Link> : corpo}</li>
      })}
    </ol>
  )
}
```

- [ ] **Step 4: detalhe do produto**

**File: `components/faturamento/DetalheProduto.tsx`**
```tsx
import Link from 'next/link'
import { X } from 'lucide-react'
import type { LinhaRanking } from '@/lib/faturamento-itens'
import { Money } from '@/components/ui-kit/Money'
import { BarrasDiarias } from '@/components/faturamento/BarrasDiarias'

function Info({ t, children }: { t: string; children: React.ReactNode }) {
  return <div><div className="text-[12px] text-text-muted">{t}</div><div className="num text-[18px] font-semibold text-text">{children}</div></div>
}

// Painel do item clicado no ranking: numeros dele no periodo e o grafico dia a dia.
export function DetalheProduto({ item, posicao, total, serie, hoje, fecharHref }: {
  item: LinhaRanking; posicao: number | null; total: number; serie: { dia: string; valor: number }[]; hoje: string; fecharHref: string
}) {
  const precoMedio = item.quant > 0 ? item.valor / item.quant : null
  return (
    <section className="space-y-3 rounded-[var(--r-lg)] bg-surface p-4 shadow-[var(--shadow-sm)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[12px] text-text-muted">{posicao ? `#${posicao} de ${total} no ranking` : 'Fora do ranking'}</div>
          <h2 className="truncate text-[18px] font-semibold text-text">{item.rotulo}</h2>
        </div>
        <Link href={fecharHref} scroll={false} aria-label="Fechar detalhe" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-text-muted hover:text-text"><X className="size-4" /></Link>
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Info t="Faturamento"><Money value={item.valor} /></Info>
        <Info t="Quantidade">{item.quant.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} un</Info>
        <Info t="Preço médio">{precoMedio == null ? '—' : <Money value={precoMedio} />}</Info>
        <Info t="% do total">{item.pct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</Info>
      </div>
      <BarrasDiarias dias={serie} hoje={hoje} />
    </section>
  )
}
```

- [ ] **Step 5:** `npx tsc --noEmit -p . 2>&1 | grep -E "components/faturamento" || echo TSC_OK` — Expected `TSC_OK`.
- [ ] **Step 6: Commit** `git add components/faturamento && git commit -m "feat(faturamento): componentes do painel"`

### Task 5: Página, export e link

**Files:** Create `app/(app)/faturamento/page.tsx`, `app/(app)/faturamento/export/route.ts`; Modify `app/(app)/relatorios/page.tsx`.

- [ ] **Step 1: página**

**File: `app/(app)/faturamento/page.tsx`**
```tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { DollarSign, Download } from 'lucide-react'
import { getAtorGestao, getCurrentLojaId } from '@/lib/auth'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Money } from '@/components/ui-kit/Money'
import { btnClass } from '@/components/ui-kit/Button'
import { lerParamsFaturamento, type SpFat } from '@/lib/faturamento-params'
import { carregarItens } from '@/lib/faturamento-itens-loader'
import { filtrarPorNome, ordenarRanking, posicaoNoRanking, rankear, resumir, serieDiaria, type Dimensao } from '@/lib/faturamento-itens'
import { PeriodoBar } from '@/components/faturamento/PeriodoBar'
import { FiltrosFaturamento } from '@/components/faturamento/FiltrosFaturamento'
import { RankingBarras } from '@/components/faturamento/RankingBarras'
import { DetalheProduto } from '@/components/faturamento/DetalheProduto'
import { BarrasDiarias } from '@/components/faturamento/BarrasDiarias'
import { TabelaDiaria } from '@/components/faturamento/TabelaDiaria'

const ABAS = [
  { value: 'produtos', label: 'Produtos' },
  { value: 'familias', label: 'Famílias' },
  { value: 'tipos', label: 'Tipos' },
  { value: 'dias', label: 'Por dia' },
] as const
const POR_ABA: Record<string, Dimensao> = { produtos: 'produto', familias: 'familia', tipos: 'tipo' }
const fmtDM = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`

export default async function FaturamentoPage({ searchParams }: { searchParams: Promise<SpFat> }) {
  if (!(await getAtorGestao()).podeGerir) notFound()
  const lojaId = await getCurrentLojaId()
  const sp = await searchParams
  const hoje = hojeBahiaISO()
  const p = lerParamsFaturamento(sp, hoje)

  const { linhas, aviso, opcoes } = await carregarItens(lojaId, p.ini, p.fim, { tipos: p.tipos, familias: p.familias, situacao: p.situacao })
  const kp = resumir(linhas)

  // Parametros que atravessam links (periodo, aba, filtros, ordenacao, busca).
  const base: Record<string, string> = {
    ini: p.ini, fim: p.fim, aba: p.aba, tipo: p.tipos.join(','), familia: p.familias.join(','),
    situacao: p.situacao === 'validas' ? '' : p.situacao, q: p.q, ordem: p.ordem === 'valor' ? '' : p.ordem, sentido: p.sentido === 'mais' ? '' : p.sentido,
  }
  const href = (over: Record<string, string>) => {
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries({ ...base, ...over })) if (v) q.set(k, v)
    return `/faturamento${q.size ? `?${q}` : ''}`
  }

  const dim = POR_ABA[p.aba]
  const rankingTodos = dim ? rankear(linhas, dim) : []
  const ranking = dim ? ordenarRanking(filtrarPorNome(rankingTodos, p.q), p.ordem, p.sentido) : []
  const selecionado = p.aba === 'produtos' && p.produto ? rankingTodos.find((r) => r.chave === p.produto) : undefined
  const serieSel = selecionado ? serieDiaria(linhas.filter((l) => (l.idProduto != null ? String(l.idProduto) : `nome:${l.produto}`) === p.produto), p.ini, p.fim) : []
  const serie = serieDiaria(linhas, p.ini, p.fim)

  const chipBase = 'inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-full px-3.5 text-[13px] font-semibold u-motion u-press-sm'
  const chipAtivo = `${chipBase} bg-brand-fill text-white`
  const chipInativo = `${chipBase} bg-surface-2 text-text-muted hover:bg-[var(--border)] hover:text-text`
  const exportQs = new URLSearchParams(Object.entries(base).filter(([, v]) => v)).toString()

  return (
    <div className="space-y-4">
      <PageHeader
        title="Faturamento"
        icon={DollarSign}
        voltarHref="/relatorios"
        description="Escolha o período, filtre e veja o que mais vendeu."
        actions={
          <>
            <Link href="/relatorio-faturamento" className={btnClass('outline')}>Evolução mensal, forma de pgto e cupons</Link>
            {p.aba !== 'dias' && <a href={`/faturamento/export?${exportQs}`} target="_blank" rel="noopener noreferrer" className={btnClass('outline')}><Download className="size-4" /> Baixar</a>}
          </>
        }
      />

      <PeriodoBar basePath="/faturamento" params={{ ...base, produto: '' }} ini={p.ini} fim={p.fim} hoje={hoje} />
      <FiltrosFaturamento tipos={opcoes.tipos} familias={opcoes.familias} />

      {p.cortado && <p className="text-[13px] text-text-muted">Período limitado a 366 dias: mostrando os dias mais recentes.</p>}
      {aviso && <p className="rounded-[var(--r-md)] bg-surface px-3 py-2 text-[13px] text-warn shadow-[var(--shadow-sm)]">{aviso}</p>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Card titulo="Faturado" valor={<Money value={kp.faturado} />} />
        <Card titulo="Cupons" valor={kp.cupons.toLocaleString('pt-BR')} sub={`${kp.itens.toLocaleString('pt-BR', { maximumFractionDigits: 0 })} itens vendidos`} />
        <Card titulo="Ticket médio" valor={kp.ticket == null ? '—' : <Money value={kp.ticket} />} />
        <Card titulo="Melhor dia" valor={kp.melhorDia ? <Money value={kp.melhorDia.valor} /> : '—'} sub={kp.melhorDia ? fmtDM(kp.melhorDia.dia) : undefined} />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {ABAS.map((a) => <Link key={a.value} href={href({ aba: a.value, produto: '' })} className={p.aba === a.value ? chipAtivo : chipInativo}>{a.label}</Link>)}
      </div>

      {linhas.length === 0 ? (
        <EmptyState icon={DollarSign} title="Sem vendas no período" hint="Mude o período ou limpe os filtros de tipo, família e situação." />
      ) : p.aba === 'dias' ? (
        <div className="space-y-3">
          <BarrasDiarias dias={serie} hoje={hoje} />
          <TabelaDiaria dias={[...serie].reverse()} hoje={hoje} />
        </div>
      ) : (
        <div className="space-y-3">
          {selecionado && (
            <DetalheProduto item={selecionado} posicao={posicaoNoRanking(rankingTodos, selecionado.chave)} total={rankingTodos.length} serie={serieSel} hoje={hoje} fecharHref={href({ produto: '' })} />
          )}
          <form action="/faturamento" className="flex flex-wrap items-center gap-2">
            {Object.entries(base).filter(([k, v]) => v && !['q', 'ordem', 'sentido'].includes(k)).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
            <input name="q" defaultValue={p.q} placeholder={`Buscar ${p.aba === 'produtos' ? 'produto' : p.aba === 'familias' ? 'família' : 'tipo'}…`} className="h-9 w-60 rounded-[var(--r-md)] border border-border bg-surface px-3 text-sm text-text" />
            <input type="hidden" name="ordem" value={p.ordem === 'valor' ? '' : p.ordem} />
            <input type="hidden" name="sentido" value={p.sentido === 'mais' ? '' : p.sentido} />
            <button type="submit" className={chipInativo}>Buscar</button>
            <Link href={href({ sentido: '' })} className={p.sentido === 'mais' ? chipAtivo : chipInativo}>Mais vendidos</Link>
            <Link href={href({ sentido: 'menos' })} className={p.sentido === 'menos' ? chipAtivo : chipInativo}>Menos vendidos</Link>
            <span className="text-[12px] text-text-muted">por</span>
            <Link href={href({ ordem: '' })} className={p.ordem === 'valor' ? chipAtivo : chipInativo}>R$</Link>
            <Link href={href({ ordem: 'quant' })} className={p.ordem === 'quant' ? chipAtivo : chipInativo}>Quantidade</Link>
          </form>
          {ranking.length === 0 ? (
            <EmptyState icon={DollarSign} title="Nada encontrado" hint="Nenhum item bate com a busca." />
          ) : (
            <RankingBarras linhas={ranking} ordem={p.ordem} selecionado={p.produto} hrefDe={p.aba === 'produtos' ? (chave) => href({ produto: chave }) : undefined} />
          )}
        </div>
      )}
    </div>
  )
}

function Card({ titulo, valor, sub }: { titulo: string; valor: React.ReactNode; sub?: string }) {
  return (
    <div className="rounded-[var(--r-lg)] bg-surface p-4 shadow-[var(--shadow-sm)]">
      <div className="text-[13px] text-text-muted">{titulo}</div>
      <div className="num mt-1 text-[22px] font-semibold leading-none tracking-[-0.02em] text-text">{valor}</div>
      {sub && <div className="mt-1.5 text-[12px] text-text-muted">{sub}</div>}
    </div>
  )
}
```

- [ ] **Step 2: export**

**File: `app/(app)/faturamento/export/route.ts`**
```ts
import { getAtorGestao, getCurrentLojaId } from '@/lib/auth'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { gerarPlanilhaMulti, planilhaResponse } from '@/lib/excel'
import { lerParamsFaturamento } from '@/lib/faturamento-params'
import { carregarItens } from '@/lib/faturamento-itens-loader'
import { filtrarPorNome, ordenarRanking, rankear, type Dimensao } from '@/lib/faturamento-itens'

export const dynamic = 'force-dynamic'
const POR_ABA: Record<string, { dim: Dimensao; nome: string }> = {
  produtos: { dim: 'produto', nome: 'Produtos' }, familias: { dim: 'familia', nome: 'Famílias' }, tipos: { dim: 'tipo', nome: 'Tipos' },
}

export async function GET(request: Request) {
  if (!(await getAtorGestao()).podeGerir) return new Response('Sem permissão', { status: 403 })
  const lojaId = await getCurrentLojaId()
  const sp = Object.fromEntries(new URL(request.url).searchParams.entries())
  const p = lerParamsFaturamento(sp, hojeBahiaISO())
  const alvo = POR_ABA[p.aba] ?? POR_ABA.produtos
  const { linhas, aviso } = await carregarItens(lojaId, p.ini, p.fim, { tipos: p.tipos, familias: p.familias, situacao: p.situacao })
  const rows = ordenarRanking(filtrarPorNome(rankear(linhas, alvo.dim), p.q), p.ordem, p.sentido)
    .map((r, i) => ({ pos: i + 1, rotulo: r.rotulo, valor: r.valor, quant: r.quant, cupons: r.cupons, pct: r.pct }))
  if (!rows.length) return new Response('Sem vendas no período/filtro selecionado', { status: 404 })
  const buffer = await gerarPlanilhaMulti([{
    rows,
    colunas: [
      { key: 'pos', label: '#', tipo: 'numero', largura: 6 },
      { key: 'rotulo', label: alvo.nome.replace(/s$/, ''), tipo: 'texto', largura: 44 },
      { key: 'valor', label: 'Faturamento', tipo: 'moeda', largura: 18, somar: true },
      { key: 'quant', label: 'Quantidade', tipo: 'numero', largura: 14, somar: true },
      { key: 'cupons', label: 'Cupons', tipo: 'numero', largura: 10 },
      { key: 'pct', label: '% do total', tipo: 'numero', largura: 12 },
    ],
    opts: { titulo: `Faturamento por ${alvo.nome.toLowerCase()}`, subtitulo: `${p.ini} a ${p.fim}${aviso ? ` · ATENÇÃO: ${aviso}` : ''}`, autoFiltro: true },
    nome: alvo.nome,
  }])
  return planilhaResponse('faturamento', buffer)
}
```

- [ ] **Step 3: link em Relatórios** — em `app/(app)/relatorios/page.tsx`, trocar `href: '/relatorio-faturamento', titulo: 'Faturamento'` por `href: '/faturamento'` e a descrição por `'Escolha o período e veja o que mais vendeu: ranking de produtos, famílias e tipos, com gráfico dia a dia.'`.

- [ ] **Step 4:** `npx tsc --noEmit -p . | grep -E "faturamento|relatorios" || echo TSC_OK; npx eslint "app/(app)/faturamento" components/faturamento lib/faturamento-*.ts; npm run build | tail -5` — Expected: sem erros.
- [ ] **Step 5: Commit** `git add "app/(app)/faturamento" "app/(app)/relatorios/page.tsx" && git commit -m "feat(faturamento): tela nova com periodo, filtros e ranking"`

### Task 6: Verificação em produção e deploy

- [ ] **Step 1:** Todos os testes: `node --test lib/*.test.ts` — Expected: PASS.
- [ ] **Step 2:** `git push origin main` e `deploy.sh` (síncrono); `curl .../login` → 200.
- [ ] **Step 3:** Conta QA, loja Donana Rio Vermelho: `/faturamento?mes=2026-09` — soma do ranking e "Faturado" = R$ 657.434,28 (cupons de set/2026, lojas conferidas por SQL). Clicar no 1º produto: faturamento do detalhe = valor da linha. Filtro de tipo/família reduz o ranking e o card Faturado. "Menos vendidos" inverte. "Por dia" mostra só o período. Excel baixa (200).
- [ ] **Step 4:** Atualizar `AGENTS.md` (nota curta) e a memória do projeto.

---

## Self-Review

- **Cobertura da spec:** período na cara (Task 4 PeriodoBar, Task 2), filtros inline válidos em todas as abas (Task 3 loader aplica na leitura; Task 4), ranking mais/menos, ordenar R$/qtd, busca (Task 1, 5), detalhe com gráfico (Task 4/5), Por dia por período (Task 5), Excel (Task 5), link da tela antiga (Task 5), validação em produção (Task 6).
- **Tipos consistentes:** `LinhaItem`, `LinhaRanking`, `Dimensao`, `Situacao`, `ParamsFat`, `carregarItens`, `rankear`/`ordenarRanking`/`filtrarPorNome`/`resumir`/`serieDiaria`/`posicaoNoRanking` têm os mesmos nomes e assinaturas em todas as tasks.
- **Placeholders:** nenhum.
