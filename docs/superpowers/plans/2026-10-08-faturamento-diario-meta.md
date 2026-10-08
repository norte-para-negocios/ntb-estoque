# Faturamento por dia + relatório Meta × Realizado — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar o faturamento dia a dia no relatório de Faturamento e criar o relatório "Meta de faturamento" (meta diária por loja × realizado, por dia/semana/mês).

**Architecture:** Funções puras (datas, agrupamento por dia, resumo de meta) em `lib/`, testadas com `node:test`. Um loader de I/O (`lib/faturamento-diario.ts`) lê cupons do Contabo (lojas Omie) ou `vendas_proprio` (lojas de estoque próprio) e devolve uma série diária. A tela de Faturamento ganha o modo `?ver=diario` (mesmo padrão de `?ver=cupons|descontos`); a rota nova `/relatorio-meta` usa o mesmo loader e uma tabela `metas_faturamento`.

**Tech Stack:** Next.js 16 (App Router, Server Components/Actions), React 19, TypeScript, Supabase/Postgres self-hosted, ExcelJS, Tailwind v4, `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-08-faturamento-diario-meta-design.md`

## Global Constraints

- Next.js desta base tem breaking changes (AGENTS.md): antes de escrever código de página/route/action novo, abrir o guia relevante em `node_modules/next/dist/docs/` e seguir os padrões já usados nos arquivos vizinhos (`searchParams` é `Promise`, server actions com `'use server'`).
- Fuso `America/Bahia`; "hoje" sempre por `hojeBahiaISO()` (`lib/data-bahia.ts`).
- Só quem tem `getAtorGestao().podeGerir` acessa os relatórios (`notFound()` na página, 403 no export) e só `podeGerir` edita a meta.
- Meta diária única por loja, `>= 0`. Meta do período = meta × dias **fechados** do período.
- Dia de hoje é "em andamento": fora de "dias que bateram", da média e da meta do período.
- Período nunca passa de hoje (fim é limitado a hoje) nem de 366 dias.
- "Faturamento do dia" = soma de `valor` dos cupons **não cancelados** (inclui devolvidos, igual ao total mensal já exibido em `relatorio-faturamento`: "Normal + Devolvido"). Em loja própria: `vendas_proprio.cancelado = false`.
- Migration vai em `supabase/migrations/154_metas_faturamento.sql`, aplicada à mão com `docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < arquivo.sql`, confirmando antes qual banco o deploy usa (`.env.local` do deploy). Sem runner automático de migration.
- `git push` não atualiza produção; deploy é `ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "cd /opt/ntb-estoque && bash deploy.sh"`, síncrono, e só depois de testado. Não fazer push nem deploy sem o usuário pedir.
- Testes: `node --test lib/<arquivo>.test.ts` (padrão de `lib/estoque/*.test.ts`; import com extensão `.ts`, sem alias `@/`). Arquivos puros não podem importar nada com alias `@/`.
- Commits terminam com `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`.
- Textos de UI em português, sem a palavra "NTB Vendas" (cliente vê "Norte Vendas").

## Review Focus

- Dia sem nenhuma venda dentro do período aparece com R$ 0,00 (não some da tabela) e conta como "não bateu".
- Meta = 0 ou não cadastrada: sem meta, mostrar estado vazio pedindo a meta; meta 0 não pode dividir por zero (% atingido vira `null`).
- Período que termina no futuro (ex.: "Este mês" no dia 8) não gera dias futuros com R$ 0.
- Período invertido (`data_inicio > data_final`) ou inválido cai no default (mês atual), sem erro.
- Falha ou truncamento na leitura do Contabo mostra aviso e nunca zeros como se fossem dados reais.
- Soma dos dias do modo Diário bate com o total mensal já exibido na mesma loja/período.

---

## File Structure

| Arquivo | Responsabilidade |
|---|---|
| `lib/faturamento-dias.ts` (novo, puro) | datas ISO, `agruparCuponsPorDia`, `preencherDias` |
| `lib/faturamento-dias.test.ts` (novo) | testes das funções acima |
| `lib/meta-faturamento.ts` (novo, puro) | `periodoDoAtalho`, `resumirMeta` |
| `lib/meta-faturamento.test.ts` (novo) | testes da meta |
| `lib/faturamento-diario.ts` (novo, I/O) | `carregarFaturamentoDiario` (Contabo ou `vendas_proprio`) |
| `components/faturamento/BarrasDiarias.tsx` (novo) | gráfico SVG de barras diárias com linha de meta opcional |
| `components/faturamento/TabelaDiaria.tsx` (novo) | tabela dia a dia (com colunas de meta opcionais) |
| `app/(app)/relatorio-faturamento/page.tsx` (editar) | chip "Por dia" + seção diária |
| `app/(app)/relatorio-faturamento/export/route.ts` (editar) | aba diária no Excel quando `ver=diario` |
| `supabase/migrations/154_metas_faturamento.sql` (novo) | tabela + RLS |
| `lib/actions/meta-faturamento.ts` (novo) | `salvarMetaFaturamento` |
| `components/faturamento/FormMeta.tsx` (novo) | campo de meta (client) |
| `app/(app)/relatorio-meta/page.tsx` (novo) | tela Meta × Realizado |
| `app/(app)/relatorio-meta/export/route.ts` (novo) | Excel dia a dia |
| `app/(app)/relatorios/page.tsx` (editar) | card do relatório novo |

---

## PARTE A — Faturamento por dia

### Task 1: Funções puras de dias

**Files:**
- Create: `lib/faturamento-dias.ts`
- Test: `lib/faturamento-dias.test.ts`

**Interfaces:**
- Produces:
  - `type DiaValor = { dia: string; valor: number }` (`dia` = `YYYY-MM-DD`)
  - `const MAX_DIAS = 366`
  - `addDias(iso: string, n: number): string`
  - `diasEntre(ini: string, fim: string): string[]` (inclusive; `[]` se `fim < ini`; no máximo `MAX_DIAS` itens)
  - `agruparCuponsPorDia(cupons: { data: string; valor: number; cancelado: boolean }[]): Map<string, number>`
  - `preencherDias(ini: string, fim: string, porDia: Map<string, number>): DiaValor[]`

- [ ] **Step 1: Escrever o teste que falha**

```ts
// lib/faturamento-dias.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { addDias, diasEntre, agruparCuponsPorDia, preencherDias, MAX_DIAS } from './faturamento-dias.ts'

test('addDias atravessa mês e ano', () => {
  assert.equal(addDias('2026-01-31', 1), '2026-02-01')
  assert.equal(addDias('2026-12-31', 1), '2027-01-01')
  assert.equal(addDias('2026-03-01', -1), '2026-02-28')
})

test('diasEntre é inclusivo e vazio quando invertido', () => {
  assert.deepEqual(diasEntre('2026-10-06', '2026-10-08'), ['2026-10-06', '2026-10-07', '2026-10-08'])
  assert.deepEqual(diasEntre('2026-10-08', '2026-10-08'), ['2026-10-08'])
  assert.deepEqual(diasEntre('2026-10-09', '2026-10-08'), [])
})

test('diasEntre limita a MAX_DIAS', () => {
  assert.equal(diasEntre('2020-01-01', '2026-01-01').length, MAX_DIAS)
})

test('agruparCuponsPorDia soma por dia, ignora cancelado e arredonda centavos', () => {
  const m = agruparCuponsPorDia([
    { data: '2026-10-06', valor: 10.1, cancelado: false },
    { data: '2026-10-06', valor: 20.2, cancelado: false },
    { data: '2026-10-06', valor: 999, cancelado: true },
    { data: '2026-10-07T03:00:00.000Z', valor: 5, cancelado: false },
  ])
  assert.equal(m.get('2026-10-06'), 30.3)
  assert.equal(m.get('2026-10-07'), 5)
  assert.equal(m.size, 2)
})

test('preencherDias inclui dias sem venda com 0', () => {
  const r = preencherDias('2026-10-06', '2026-10-08', new Map([['2026-10-07', 50]]))
  assert.deepEqual(r, [
    { dia: '2026-10-06', valor: 0 },
    { dia: '2026-10-07', valor: 50 },
    { dia: '2026-10-08', valor: 0 },
  ])
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test lib/faturamento-dias.test.ts`
Expected: FAIL (`Cannot find module './faturamento-dias.ts'`)

- [ ] **Step 3: Implementar**

```ts
// lib/faturamento-dias.ts
// Funcoes puras (sem I/O, sem alias '@/') para o faturamento diario.
// Datas sempre 'YYYY-MM-DD'; aritmetica em UTC ao meio-dia para nao escorregar de dia.

export type DiaValor = { dia: string; valor: number }
export const MAX_DIAS = 366

const round2 = (n: number) => Math.round(n * 100) / 100

export function addDias(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

export function diasEntre(ini: string, fim: string): string[] {
  const out: string[] = []
  for (let d = ini; d <= fim && out.length < MAX_DIAS; d = addDias(d, 1)) out.push(d)
  return out
}

export function agruparCuponsPorDia(cupons: { data: string; valor: number; cancelado: boolean }[]): Map<string, number> {
  const m = new Map<string, number>()
  for (const c of cupons) {
    if (c.cancelado) continue
    const dia = String(c.data).slice(0, 10)
    m.set(dia, (m.get(dia) ?? 0) + c.valor)
  }
  for (const [k, v] of m) m.set(k, round2(v))
  return m
}

export function preencherDias(ini: string, fim: string, porDia: Map<string, number>): DiaValor[] {
  return diasEntre(ini, fim).map((dia) => ({ dia, valor: porDia.get(dia) ?? 0 }))
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test lib/faturamento-dias.test.ts`
Expected: PASS (5 testes)

- [ ] **Step 5: Commit**

```bash
git add lib/faturamento-dias.ts lib/faturamento-dias.test.ts
git commit -m "feat(faturamento): funcoes puras de dias (agrupar, preencher, datas)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 2: Loader do faturamento diário

**Files:**
- Create: `lib/faturamento-diario.ts`

**Interfaces:**
- Consumes: `agruparCuponsPorDia`, `preencherDias`, `MAX_DIAS`, `DiaValor` (Task 1); `buscarFatCupons` (`lib/faturamento-frio.ts`, assinatura `({lojaId, dataInicio, dataFinal, onTruncado}) => Promise<CupomFat[]>`); `createServiceClient` (`lib/supabase/server`); `modoDaLoja(lojaId): Promise<'omie'|'proprio'|'nenhum'>` (`lib/estoque/ledger`).
- Produces:
  - `type FaturamentoDiario = { dias: DiaValor[]; aviso: string | null }`
  - `carregarFaturamentoDiario(lojaId: number, ini: string, fim: string): Promise<FaturamentoDiario>`

- [ ] **Step 1: Implementar** (sem teste unitário: é I/O; validado ao vivo na Task 10)

```ts
// lib/faturamento-diario.ts
import { createServiceClient } from '@/lib/supabase/server'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { buscarFatCupons } from '@/lib/faturamento-frio'
import { agruparCuponsPorDia, preencherDias, type DiaValor } from '@/lib/faturamento-dias'

export type FaturamentoDiario = { dias: DiaValor[]; aviso: string | null }

// Faturamento por dia. Loja Omie: cupons do Contabo (fat_cupons), mesmo fato
// que alimenta "Ver cupons". Loja de estoque proprio: vendas_proprio.
// Cancelado nunca entra; devolvido entra (bate com o total mensal da tela).
export async function carregarFaturamentoDiario(lojaId: number, ini: string, fim: string): Promise<FaturamentoDiario> {
  const modo = await modoDaLoja(lojaId)
  let aviso: string | null = null
  let porDia: Map<string, number>

  if (modo === 'proprio') {
    const supabase = createServiceClient()
    const { data, error } = await supabase
      .from('vendas_proprio')
      .select('data, valor, cancelado')
      .eq('loja_id', lojaId)
      .gte('data', ini)
      .lte('data', fim)
      .limit(50000)
    if (error) aviso = `Falha ao ler as vendas (${error.message}). Os valores abaixo podem estar incompletos.`
    porDia = agruparCuponsPorDia(
      ((data ?? []) as { data: string; valor: number | string; cancelado: boolean }[]).map((v) => ({
        data: v.data, valor: Number(v.valor) || 0, cancelado: v.cancelado,
      })),
    )
  } else {
    let truncou = false
    const cupons = await buscarFatCupons({ lojaId, dataInicio: ini, dataFinal: fim, onTruncado: () => { truncou = true } })
    if (truncou) aviso = 'A consulta ao histórico foi cortada antes do fim. Os valores abaixo podem estar incompletos.'
    if (!cupons.length) aviso = aviso ?? 'Nenhum cupom retornado para o período. Se isso não é esperado, o histórico pode estar indisponível — recarregue a página.'
    porDia = agruparCuponsPorDia(cupons)
  }

  return { dias: preencherDias(ini, fim, porDia), aviso }
}
```

- [ ] **Step 2: Checar tipos**

Run: `npx tsc --noEmit -p . 2>&1 | grep -E "faturamento-diario|faturamento-dias" || echo OK`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add lib/faturamento-diario.ts
git commit -m "feat(faturamento): loader do faturamento diario (Contabo ou vendas_proprio)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 3: Gráfico e tabela diários

**Files:**
- Create: `components/faturamento/BarrasDiarias.tsx`
- Create: `components/faturamento/TabelaDiaria.tsx`

**Interfaces:**
- Consumes: `DiaValor` (Task 1); `Money` (`components/ui-kit/Money`).
- Produces:
  - `<BarrasDiarias dias={DiaValor[]} meta?={number | null} hoje?={string} />`
  - `<TabelaDiaria dias={DiaValor[]} meta?={number | null} hoje?={string} />` — com `meta` mostra colunas "Meta", "Diferença" e "Bateu".

- [ ] **Step 1: Criar o gráfico** (SVG puro, mesmo estilo de `app/(app)/relatorio-lucro/EvolucaoDiaria.tsx`)

```tsx
// components/faturamento/BarrasDiarias.tsx
import type { DiaValor } from '@/lib/faturamento-dias'

// Barras de faturamento por dia, com linha horizontal opcional da meta.
// Barra verde = bateu a meta; cinza = nao bateu; clara = dia em andamento (hoje).
export function BarrasDiarias({ dias, meta, hoje }: { dias: DiaValor[]; meta?: number | null; hoje?: string }) {
  if (!dias.length) return null
  const W = 960, H = 160, PAD = 8
  const max = Math.max(1, meta ?? 0, ...dias.map((d) => d.valor))
  const largura = (W - PAD * 2) / dias.length
  const rotulo = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
  const passo = Math.max(1, Math.ceil(dias.length / 10))
  const yMeta = meta && meta > 0 ? H - (meta / max) * H : null
  return (
    <figure className="rounded-[var(--r-lg)] bg-surface p-4 shadow-[var(--shadow-sm)]" aria-label="Faturamento por dia">
      <figcaption className="mb-2 flex flex-wrap items-center gap-4 text-[12px] text-text-muted">
        <span className="font-semibold text-text">Dia a dia</span>
        {yMeta !== null && (
          <>
            <span className="inline-flex items-center gap-1.5"><i className="inline-block size-2.5 rounded-sm bg-brand" /> Bateu a meta</span>
            <span className="inline-flex items-center gap-1.5"><i className="inline-block size-2.5 rounded-sm bg-brand/30" /> Abaixo da meta</span>
          </>
        )}
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H + 22}`} className="h-auto w-full" role="img">
        {dias.map((d, i) => {
          const x = PAD + i * largura
          const h = (d.valor / max) * H
          const andamento = hoje === d.dia
          const bateu = yMeta !== null && !andamento && d.valor >= (meta as number)
          const cls = andamento ? 'fill-text-muted/30' : yMeta === null || bateu ? 'fill-brand' : 'fill-brand/30'
          return (
            <g key={d.dia}>
              <title>{`${rotulo(d.dia)}: ${d.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}${andamento ? ' (em andamento)' : ''}`}</title>
              <rect x={x + largura * 0.12} y={H - h} width={largura * 0.76} height={h} rx={3} className={cls} />
              {i % passo === 0 && <text x={x + largura / 2} y={H + 16} textAnchor="middle" className="fill-text-muted text-[11px]">{rotulo(d.dia)}</text>}
            </g>
          )
        })}
        {yMeta !== null && <line x1={PAD} x2={W - PAD} y1={yMeta} y2={yMeta} strokeDasharray="6 4" className="stroke-warn" strokeWidth={1.5} />}
      </svg>
    </figure>
  )
}
```

- [ ] **Step 2: Criar a tabela**

```tsx
// components/faturamento/TabelaDiaria.tsx
import type { DiaValor } from '@/lib/faturamento-dias'
import { Money } from '@/components/ui-kit/Money'

const DIAS_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const rotuloDia = (iso: string) => {
  const dow = new Date(`${iso}T12:00:00Z`).getUTCDay()
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)} · ${DIAS_SEMANA[dow]}`
}

export function TabelaDiaria({ dias, meta, hoje }: { dias: DiaValor[]; meta?: number | null; hoje?: string }) {
  const comMeta = meta != null && meta > 0
  const th = 'px-3 py-2 text-[12px] font-semibold text-text-muted'
  return (
    <div className="overflow-x-auto rounded-[var(--r-lg)] bg-surface shadow-[var(--shadow-sm)]">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border bg-surface">
            <th className={`text-left ${th}`}>Dia</th>
            <th className={`text-right ${th}`}>Faturamento</th>
            {comMeta && <th className={`text-right ${th}`}>Meta</th>}
            {comMeta && <th className={`text-right ${th}`}>Diferença</th>}
            {comMeta && <th className={`text-center ${th}`}>Meta</th>}
          </tr>
        </thead>
        <tbody>
          {dias.map((d) => {
            const andamento = hoje === d.dia
            const dif = comMeta ? d.valor - (meta as number) : 0
            return (
              <tr key={d.dia} className="border-t border-border/60">
                <td className="whitespace-nowrap px-3 py-2 text-text">{rotuloDia(d.dia)}</td>
                <td className="px-3 py-2 text-right text-text"><Money value={d.valor} /></td>
                {comMeta && <td className="px-3 py-2 text-right text-text-muted"><Money value={meta as number} /></td>}
                {comMeta && <td className={`px-3 py-2 text-right ${dif >= 0 ? 'text-ok' : 'text-warn'}`}><Money value={dif} /></td>}
                {comMeta && (
                  <td className="px-3 py-2 text-center text-[12px] font-semibold">
                    {andamento ? <span className="text-text-muted">em andamento</span> : dif >= 0 ? <span className="text-ok">✓ bateu</span> : <span className="text-warn">✗ não bateu</span>}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
```

- [ ] **Step 3: Checar tipos e que as classes `text-ok`/`text-warn` existem**

Run: `npx tsc --noEmit -p . 2>&1 | grep -E "BarrasDiarias|TabelaDiaria" || echo OK; grep -rn "text-ok\b" app components | head -2`
Expected: `OK` e pelo menos uma ocorrência de `text-ok` (se não houver, trocar por `text-success`/o token verde usado em `StatusPill.tsx`).

- [ ] **Step 4: Commit**

```bash
git add components/faturamento/BarrasDiarias.tsx components/faturamento/TabelaDiaria.tsx
git commit -m "feat(faturamento): grafico e tabela diarios

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 4: Modo "Por dia" na página de Faturamento + Excel

**Files:**
- Modify: `app/(app)/relatorio-faturamento/page.tsx` (imports no topo; ~linha 423 `const verDescontos`; ~linha 735 chips; ~linha 753 `{verDescontos ? (`)
- Modify: `app/(app)/relatorio-faturamento/export/route.ts` (início de `GET`, após ler `searchParams`)

**Interfaces:**
- Consumes: `carregarFaturamentoDiario` (Task 2), `BarrasDiarias`, `TabelaDiaria` (Task 3), `hojeBahiaISO`, `addDias`, `MAX_DIAS`, `hrefComVer` (já existe na página).
- Produces: URL `?ver=diario` (usa `data_inicio`/`data_final`; default = dia 1 do mês atual até hoje). Export `?ver=diario` devolve Excel com uma aba "Por dia".

- [ ] **Step 1: Imports e flag em `page.tsx`**

Adicionar junto aos imports do topo:

```tsx
import { hojeBahiaISO } from '@/lib/data-bahia'
import { carregarFaturamentoDiario } from '@/lib/faturamento-diario'
import { BarrasDiarias } from '@/components/faturamento/BarrasDiarias'
import { TabelaDiaria } from '@/components/faturamento/TabelaDiaria'
```

Logo antes de `const verDescontos = sp.ver === 'descontos'` (~linha 423) adicionar:

```tsx
  const verDiario = sp.ver === 'diario'
  const hojeISO = hojeBahiaISO()
  const iniDiario = dataIni && dataIni <= hojeISO ? dataIni : `${hojeISO.slice(0, 8)}01`
  const fimDiario = dataFim && dataFim >= iniDiario ? (dataFim > hojeISO ? hojeISO : dataFim) : hojeISO
  const fatDiario = verDiario ? await carregarFaturamentoDiario(lojaId, iniDiario, fimDiario) : null
```

- [ ] **Step 2: Chip "Por dia"** — dentro do `<div className="flex flex-wrap items-center gap-2">` onde estão "Ver cupons" e "Descontos" (~linha 732-737), adicionar antes do link de "Ver cupons":

```tsx
            <Link href={verDiario ? hrefComVer(null) : hrefComVer('diario')} className={verDiario ? chipAtivo : chipInativo}>
              {verDiario ? 'Ver resumo' : 'Por dia'}
            </Link>
```

- [ ] **Step 3: Seção diária** — trocar a linha `{verDescontos ? (` (~753) por:

```tsx
          {verDiario && fatDiario ? (
            <div className="space-y-3">
              {fatDiario.aviso && (
                <p className="rounded-[var(--r-md)] bg-surface px-3 py-2 text-[13px] text-warn shadow-[var(--shadow-sm)]">{fatDiario.aviso}</p>
              )}
              <p className="text-[13px] text-text-muted">
                Período: {iniDiario.split('-').reverse().join('/')} a {fimDiario.split('-').reverse().join('/')} · use o filtro de datas para mudar.
                Total: <strong className="text-text">{fmtMoeda(fatDiario.dias.reduce((s, d) => s + d.valor, 0))}</strong>
              </p>
              <BarrasDiarias dias={fatDiario.dias} hoje={hojeISO} />
              <TabelaDiaria dias={fatDiario.dias} hoje={hojeISO} />
            </div>
          ) : verDescontos ? (
```

- [ ] **Step 4: Excel** — em `export/route.ts`, adicionar imports `hojeBahiaISO`, `carregarFaturamentoDiario` e, logo depois de `const { searchParams } = new URL(request.url)`, inserir o ramo diário:

```ts
  if (searchParams.get('ver') === 'diario') {
    const hoje = hojeBahiaISO()
    const di = searchParams.get('data_inicio') ?? ''
    const df = searchParams.get('data_final') ?? ''
    const ok = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s)
    const ini = ok(di) && di <= hoje ? di : `${hoje.slice(0, 8)}01`
    const fim = ok(df) && df >= ini ? (df > hoje ? hoje : df) : hoje
    const { dias, aviso } = await carregarFaturamentoDiario(lojaId, ini, fim)
    const buffer = await gerarPlanilhaMulti([{
      rows: dias.map((d) => ({ dia: d.dia, valor: d.valor })),
      colunas: [
        { key: 'dia', label: 'Dia', tipo: 'data', largura: 14 },
        { key: 'valor', label: 'Faturamento', tipo: 'moeda', largura: 18, somar: true },
      ],
      opts: { titulo: 'Faturamento por dia', subtitulo: `${ini} a ${fim}${aviso ? ` · ATENÇÃO: ${aviso}` : ''}` },
      nome: 'Por dia',
    }])
    return planilhaResponse('faturamento-por-dia', buffer)
  }
```

E em `page.tsx`, no `exportParams` (~linha 596-621) adicionar, antes de `const exportHref`: `if (verDiario) exportParams.set('ver', 'diario')` e garantir que `verDiario`/`iniDiario`/`fimDiario` sejam declarados **antes** desse ponto (se a declaração do Step 1 ficar depois da linha ~596, mover o bloco do Step 1 para antes de `const exportParams`). No bloco `if (verDiario)` usar também `exportParams.set('data_inicio', iniDiario); exportParams.set('data_final', fimDiario)`.

- [ ] **Step 5: Checar tipos e lint**

Run: `npx tsc --noEmit -p . 2>&1 | grep -E "relatorio-faturamento" || echo OK; npx eslint "app/(app)/relatorio-faturamento" 2>&1 | tail -5`
Expected: `OK` e sem erros novos de lint.

- [ ] **Step 6: Verificar no navegador** (conta QA, produção — nunca `localhost`, ver AGENTS.md): abrir `/relatorio-faturamento?ver=diario` numa loja Omie e numa de estoque próprio. Conferir: gráfico e tabela aparecem, dias sem venda com R$ 0,00, total do período bate com a linha do mês na visão normal. Se a produção ainda não tem o código, fazer o deploy da Parte A primeiro (Task 5).

- [ ] **Step 7: Commit**

```bash
git add "app/(app)/relatorio-faturamento/page.tsx" "app/(app)/relatorio-faturamento/export/route.ts"
git commit -m "feat(faturamento): visao 'Por dia' com grafico, tabela e Excel

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 5: Deploy da Parte A (só com o usuário pedindo)

- [ ] **Step 1:** Perguntar ao usuário se pode subir. Se sim: `git push origin main` e depois o `deploy.sh` (comando em Global Constraints), síncrono. Se o build parecer velho, `rm -rf .next` no servidor antes do build.
- [ ] **Step 2:** `curl -s -o /dev/null -w "HTTP %{http_code}\n" https://app-estoque.norteparanegocios.com.br/login` → `200`.
- [ ] **Step 3:** Repetir a verificação do Task 4 Step 6 em produção com a conta QA (`claude.qa@ntb-estoque.dev`) e mandar o print ao usuário.

---

## PARTE B — Relatório Meta × Realizado

### Task 6: Cálculo da meta (puro)

**Files:**
- Create: `lib/meta-faturamento.ts`
- Test: `lib/meta-faturamento.test.ts`

**Interfaces:**
- Consumes: `DiaValor`, `addDias` (Task 1).
- Produces:
  - `type Atalho = 'hoje' | 'semana' | 'mes'`
  - `periodoDoAtalho(atalho: Atalho, hoje: string): { ini: string; fim: string }` (semana = segunda a hoje; mês = dia 1 a hoje)
  - `type ResumoMeta = { diasFechados: number; realizado: number; metaPeriodo: number; pctAtingido: number | null; media: number | null; melhor: DiaValor | null; pior: DiaValor | null; diasBateram: number; emAndamento: DiaValor | null }`
  - `resumirMeta(dias: DiaValor[], meta: number, hoje: string): ResumoMeta` — usa só dias com `dia < hoje`; `dia === hoje` vai em `emAndamento`; dias `> hoje` são ignorados.

- [ ] **Step 1: Teste que falha**

```ts
// lib/meta-faturamento.test.ts
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { periodoDoAtalho, resumirMeta } from './meta-faturamento.ts'

test('periodoDoAtalho: hoje, semana (segunda a hoje), mes (dia 1 a hoje)', () => {
  // 2026-10-08 é quinta-feira
  assert.deepEqual(periodoDoAtalho('hoje', '2026-10-08'), { ini: '2026-10-08', fim: '2026-10-08' })
  assert.deepEqual(periodoDoAtalho('semana', '2026-10-08'), { ini: '2026-10-05', fim: '2026-10-08' })
  assert.deepEqual(periodoDoAtalho('mes', '2026-10-08'), { ini: '2026-10-01', fim: '2026-10-08' })
})

test('periodoDoAtalho: semana quando hoje é domingo começa na segunda anterior', () => {
  assert.deepEqual(periodoDoAtalho('semana', '2026-10-11'), { ini: '2026-10-05', fim: '2026-10-11' })
})

const dias = [
  { dia: '2026-10-05', valor: 1200 },
  { dia: '2026-10-06', valor: 800 },
  { dia: '2026-10-07', valor: 1000 },
  { dia: '2026-10-08', valor: 300 }, // hoje, em andamento
  { dia: '2026-10-09', valor: 0 }, // futuro, ignorado
]

test('resumirMeta: usa só dias fechados e separa o dia em andamento', () => {
  const r = resumirMeta(dias, 1000, '2026-10-08')
  assert.equal(r.diasFechados, 3)
  assert.equal(r.realizado, 3000)
  assert.equal(r.metaPeriodo, 3000)
  assert.equal(r.pctAtingido, 100)
  assert.equal(r.media, 1000)
  assert.deepEqual(r.melhor, { dia: '2026-10-05', valor: 1200 })
  assert.deepEqual(r.pior, { dia: '2026-10-06', valor: 800 })
  assert.equal(r.diasBateram, 2) // 1200 e 1000 (>= meta)
  assert.deepEqual(r.emAndamento, { dia: '2026-10-08', valor: 300 })
})

test('resumirMeta: meta 0 não divide por zero', () => {
  const r = resumirMeta(dias, 0, '2026-10-08')
  assert.equal(r.pctAtingido, null)
  assert.equal(r.diasBateram, 3)
})

test('resumirMeta: só hoje no período (nenhum dia fechado)', () => {
  const r = resumirMeta([{ dia: '2026-10-08', valor: 300 }], 1000, '2026-10-08')
  assert.equal(r.diasFechados, 0)
  assert.equal(r.media, null)
  assert.equal(r.melhor, null)
  assert.equal(r.pctAtingido, null)
  assert.deepEqual(r.emAndamento, { dia: '2026-10-08', valor: 300 })
})

test('resumirMeta: dia sem venda conta como não bateu', () => {
  const r = resumirMeta([{ dia: '2026-10-06', valor: 0 }, { dia: '2026-10-07', valor: 1500 }], 1000, '2026-10-08')
  assert.equal(r.diasBateram, 1)
  assert.deepEqual(r.pior, { dia: '2026-10-06', valor: 0 })
})
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `node --test lib/meta-faturamento.test.ts`
Expected: FAIL (`Cannot find module './meta-faturamento.ts'`)

- [ ] **Step 3: Implementar**

```ts
// lib/meta-faturamento.ts
// Funcoes puras do relatorio Meta x Realizado (sem I/O, sem alias '@/').
import { addDias, type DiaValor } from './faturamento-dias.ts'

export type Atalho = 'hoje' | 'semana' | 'mes'

export function periodoDoAtalho(atalho: Atalho, hoje: string): { ini: string; fim: string } {
  if (atalho === 'hoje') return { ini: hoje, fim: hoje }
  if (atalho === 'mes') return { ini: `${hoje.slice(0, 8)}01`, fim: hoje }
  const dow = new Date(`${hoje}T12:00:00Z`).getUTCDay() // 0=dom
  const desdeSegunda = (dow + 6) % 7
  return { ini: addDias(hoje, -desdeSegunda), fim: hoje }
}

export type ResumoMeta = {
  diasFechados: number
  realizado: number
  metaPeriodo: number
  pctAtingido: number | null
  media: number | null
  melhor: DiaValor | null
  pior: DiaValor | null
  diasBateram: number
  emAndamento: DiaValor | null
}

const round2 = (n: number) => Math.round(n * 100) / 100

export function resumirMeta(dias: DiaValor[], meta: number, hoje: string): ResumoMeta {
  const fechados = dias.filter((d) => d.dia < hoje)
  const emAndamento = dias.find((d) => d.dia === hoje) ?? null
  const realizado = round2(fechados.reduce((s, d) => s + d.valor, 0))
  const metaPeriodo = round2(meta * fechados.length)
  const melhor = fechados.reduce<DiaValor | null>((m, d) => (m === null || d.valor > m.valor ? d : m), null)
  const pior = fechados.reduce<DiaValor | null>((m, d) => (m === null || d.valor < m.valor ? d : m), null)
  return {
    diasFechados: fechados.length,
    realizado,
    metaPeriodo,
    pctAtingido: metaPeriodo > 0 ? round2((realizado / metaPeriodo) * 100) : null,
    media: fechados.length ? round2(realizado / fechados.length) : null,
    melhor,
    pior,
    diasBateram: fechados.filter((d) => d.valor >= meta).length,
    emAndamento,
  }
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `node --test lib/meta-faturamento.test.ts lib/faturamento-dias.test.ts`
Expected: PASS (todos)

- [ ] **Step 5: Commit**

```bash
git add lib/meta-faturamento.ts lib/meta-faturamento.test.ts
git commit -m "feat(meta): calculo puro de meta x realizado e atalhos de periodo

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 7: Migration `metas_faturamento` + action de salvar

**Files:**
- Create: `supabase/migrations/154_metas_faturamento.sql`
- Create: `lib/actions/meta-faturamento.ts`

**Interfaces:**
- Consumes: `getAtorGestao()`, `getCurrentLojaId()` (`lib/auth`); `createServiceClient`.
- Produces: tabela `public.metas_faturamento(loja_id bigint pk → lojas, valor_diario numeric(14,2) >= 0, atualizado_em, atualizado_por uuid)`; `salvarMetaFaturamento(valor: number): Promise<{ ok: true } | { error: string }>`.

- [ ] **Step 1: Escrever a migration** (policy no padrão canônico da Fase 2a: `usuario_tem_acesso_loja(loja_id) or usuario_e_admin()`; escrita só via service role, sem policy de escrita)

```sql
-- 154 — Meta diária de faturamento por loja (relatório Meta × Realizado).
-- Aplicar: docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < 154_metas_faturamento.sql
create table if not exists public.metas_faturamento (
  loja_id        bigint primary key references public.lojas(id) on delete cascade,
  valor_diario   numeric(14,2) not null check (valor_diario >= 0),
  atualizado_em  timestamptz not null default now(),
  atualizado_por uuid
);

alter table public.metas_faturamento enable row level security;

drop policy if exists metas_faturamento_select_por_loja on public.metas_faturamento;
create policy metas_faturamento_select_por_loja on public.metas_faturamento for select using (
  usuario_tem_acesso_loja(loja_id) or usuario_e_admin()
);

revoke insert, update, delete, truncate on public.metas_faturamento from anon, authenticated;
grant select on public.metas_faturamento to authenticated;
```

- [ ] **Step 2: Conferir o banco-alvo e aplicar**

Run (read-only primeiro): `grep -E "SUPABASE_URL" .env.local` e confirmar com o `.env.local` do **deploy** no servidor qual banco a produção usa (lição do `reference_ntb_dual_databases`: Estoque e Vendas são bancos diferentes; o cloud do `.env.local` local está descontinuado).
Aplicar no Postgres de produção (Contabo):

```bash
scp -i ~/.ssh/notebook_contabo_key supabase/migrations/154_metas_faturamento.sql root@185.193.66.240:/tmp/
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec -i supabase-db psql -v ON_ERROR_STOP=1 -U supabase_admin -d postgres < /tmp/154_metas_faturamento.sql && docker exec supabase-db psql -U supabase_admin -d postgres -c '\d public.metas_faturamento'"
```

Expected: `CREATE TABLE`, `ALTER TABLE`, `CREATE POLICY`, e `\d` mostrando as 4 colunas. **Pedir confirmação ao usuário antes de rodar**, porque é escrita em produção.

- [ ] **Step 3: Criar a action** (padrão de `lib/actions/mapeamento-local-estoque.ts`)

```ts
// lib/actions/meta-faturamento.ts
'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { getAtorGestao, getCurrentLojaId } from '@/lib/auth'
import { revalidatePath } from 'next/cache'

// Salva a meta diaria de faturamento da loja ativa (uma linha por loja).
export async function salvarMetaFaturamento(valor: number): Promise<{ ok: true } | { error: string }> {
  const ator = await getAtorGestao()
  if (!ator.podeGerir) return { error: 'Sem permissão' }
  if (!Number.isFinite(valor) || valor < 0) return { error: 'Informe um valor maior ou igual a zero' }
  if (valor > 100_000_000) return { error: 'Valor alto demais' }

  const lojaId = await getCurrentLojaId()
  const supabase = createServiceClient()
  const { error } = await supabase
    .from('metas_faturamento')
    .upsert({ loja_id: lojaId, valor_diario: Math.round(valor * 100) / 100, atualizado_em: new Date().toISOString(), atualizado_por: ator.id }, { onConflict: 'loja_id' })
  if (error) return { error: error.message }

  revalidatePath('/relatorio-meta')
  return { ok: true }
}
```

(`metas_faturamento` tem PK simples `loja_id`, então `onConflict: 'loja_id'` funciona; não é índice parcial.)

- [ ] **Step 4: Checar tipos**

Run: `npx tsc --noEmit -p . 2>&1 | grep -E "meta-faturamento" || echo OK`
Expected: `OK` (se `ator.id` não existir em `AtorGestao`, abrir `lib/auth.ts:182-190` e usar o campo correto do usuário logado).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/154_metas_faturamento.sql lib/actions/meta-faturamento.ts
git commit -m "feat(meta): tabela metas_faturamento (migration 154) e action de salvar

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 8: Tela `/relatorio-meta`

**Files:**
- Create: `components/faturamento/FormMeta.tsx`
- Create: `app/(app)/relatorio-meta/page.tsx`

**Interfaces:**
- Consumes: `carregarFaturamentoDiario` (Task 2), `resumirMeta`, `periodoDoAtalho`, `Atalho` (Task 6), `salvarMetaFaturamento` (Task 7), `BarrasDiarias`, `TabelaDiaria` (Task 3), `PageHeader`, `EmptyState`, `Money`, `getAtorGestao`, `getCurrentLojaId`, `hojeBahiaISO`.
- Produces: rota `/relatorio-meta?atalho=hoje|semana|mes&data_inicio=&data_final=`.

- [ ] **Step 1: Formulário da meta (client)**

```tsx
// components/faturamento/FormMeta.tsx
'use client'

import { useState, useTransition } from 'react'
import { salvarMetaFaturamento } from '@/lib/actions/meta-faturamento'

export function FormMeta({ valorInicial }: { valorInicial: number | null }) {
  const [valor, setValor] = useState(valorInicial != null ? String(valorInicial).replace('.', ',') : '')
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, start] = useTransition()

  function salvar() {
    const n = Number(valor.replace(/\./g, '').replace(',', '.'))
    start(async () => {
      const r = await salvarMetaFaturamento(n)
      setMsg('error' in r ? r.error : 'Meta salva')
    })
  }

  return (
    <div className="flex flex-wrap items-end gap-2 rounded-[var(--r-lg)] bg-surface p-4 shadow-[var(--shadow-sm)]">
      <label className="flex flex-col gap-1 text-[13px] text-text-muted">
        Meta diária de faturamento (R$)
        <input
          inputMode="decimal"
          value={valor}
          onChange={(e) => { setValor(e.target.value); setMsg(null) }}
          placeholder="Ex.: 5000,00"
          className="h-9 w-44 rounded-[var(--r-md)] border border-border bg-surface px-3 text-sm text-text"
        />
      </label>
      <button type="button" onClick={salvar} disabled={pending || valor.trim() === ''} className="h-9 rounded-full bg-brand-fill px-4 text-[13px] font-semibold text-white disabled:opacity-50">
        {pending ? 'Salvando…' : 'Salvar meta'}
      </button>
      {msg && <span className="pb-2 text-[13px] text-text-muted" role="status">{msg}</span>}
    </div>
  )
}
```

- [ ] **Step 2: Página**

```tsx
// app/(app)/relatorio-meta/page.tsx
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Target, Download } from 'lucide-react'
import { createServiceClient } from '@/lib/supabase/server'
import { getAtorGestao, getCurrentLojaId } from '@/lib/auth'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Money } from '@/components/ui-kit/Money'
import { btnClass } from '@/components/ui-kit/Button'
import { carregarFaturamentoDiario } from '@/lib/faturamento-diario'
import { periodoDoAtalho, resumirMeta, type Atalho } from '@/lib/meta-faturamento'
import { BarrasDiarias } from '@/components/faturamento/BarrasDiarias'
import { TabelaDiaria } from '@/components/faturamento/TabelaDiaria'
import { FormMeta } from '@/components/faturamento/FormMeta'

const ATALHOS: { value: Atalho; label: string }[] = [
  { value: 'hoje', label: 'Hoje' },
  { value: 'semana', label: 'Esta semana' },
  { value: 'mes', label: 'Este mês' },
]
const ISO = /^\d{4}-\d{2}-\d{2}$/
const fmtData = (iso: string) => iso.split('-').reverse().join('/')

export default async function RelatorioMetaPage({
  searchParams,
}: {
  searchParams: Promise<{ atalho?: string; data_inicio?: string; data_final?: string }>
}) {
  if (!(await getAtorGestao()).podeGerir) notFound()
  const lojaId = await getCurrentLojaId()
  const sp = await searchParams
  const hoje = hojeBahiaISO()

  // Periodo: datas livres tem prioridade; senao atalho; default = este mes.
  const custom = ISO.test(sp.data_inicio ?? '') && sp.data_inicio! <= hoje
  const atalho: Atalho | null = custom ? null : (ATALHOS.some((a) => a.value === sp.atalho) ? (sp.atalho as Atalho) : 'mes')
  let { ini, fim } = atalho ? periodoDoAtalho(atalho, hoje) : { ini: sp.data_inicio!, fim: ISO.test(sp.data_final ?? '') ? sp.data_final! : hoje }
  if (fim > hoje) fim = hoje
  if (fim < ini) fim = ini

  const supabase = createServiceClient()
  const { data: metaRow } = await supabase.from('metas_faturamento').select('valor_diario').eq('loja_id', lojaId).maybeSingle()
  const meta = metaRow?.valor_diario != null ? Number(metaRow.valor_diario) : null

  const chipBase = 'inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-full px-3.5 text-[13px] font-semibold u-motion u-press-sm'
  const chipAtivo = `${chipBase} bg-brand-fill text-white`
  const chipInativo = `${chipBase} bg-surface-2 text-text-muted hover:bg-[var(--border)] hover:text-text`

  const fat = meta != null ? await carregarFaturamentoDiario(lojaId, ini, fim) : null
  const resumo = fat && meta != null ? resumirMeta(fat.dias, meta, hoje) : null
  const qs = new URLSearchParams({ data_inicio: ini, data_final: fim }).toString()

  return (
    <div className="space-y-4">
      <PageHeader
        title="Meta de faturamento"
        icon={Target}
        voltarHref="/relatorios"
        description="Defina a meta diária e veja se o faturamento bateu, dia a dia."
        actions={meta != null ? (
          <a href={`/relatorio-meta/export?${qs}`} target="_blank" rel="noopener noreferrer" className={btnClass('outline')}>
            <Download className="size-4" /> Baixar
          </a>
        ) : undefined}
      />

      <FormMeta valorInicial={meta} />

      {meta == null ? (
        <EmptyState icon={Target} title="Defina a meta diária" hint="Informe quanto a loja quer faturar por dia e salve. Depois escolha o período para comparar." />
      ) : (
        <>
          <div className="flex flex-nowrap items-center gap-1.5 overflow-x-auto [scrollbar-width:none] sm:flex-wrap [&::-webkit-scrollbar]:hidden">
            {ATALHOS.map((a) => (
              <Link key={a.value} href={`/relatorio-meta?atalho=${a.value}`} className={atalho === a.value ? chipAtivo : chipInativo}>{a.label}</Link>
            ))}
            <form action="/relatorio-meta" className="flex items-center gap-1.5 text-[13px] text-text-muted">
              <input type="date" name="data_inicio" defaultValue={ini} max={hoje} className="h-8 rounded-[var(--r-md)] border border-border bg-surface px-2 text-text" />
              <span>a</span>
              <input type="date" name="data_final" defaultValue={fim} max={hoje} className="h-8 rounded-[var(--r-md)] border border-border bg-surface px-2 text-text" />
              <button type="submit" className={custom ? chipAtivo : chipInativo}>Aplicar</button>
            </form>
          </div>

          <p className="text-[13px] text-text-muted">Período: {fmtData(ini)} a {fmtData(fim)} · meta diária <Money value={meta} /></p>

          {fat?.aviso && <p className="rounded-[var(--r-md)] bg-surface px-3 py-2 text-[13px] text-warn shadow-[var(--shadow-sm)]">{fat.aviso}</p>}

          {resumo && (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <Card titulo="Realizado" valor={<Money value={resumo.realizado} />} sub={`meta do período: ${resumo.metaPeriodo.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`} />
                <Card titulo="% da meta" valor={resumo.pctAtingido == null ? '—' : `${resumo.pctAtingido.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`} sub={`${resumo.diasFechados} dia(s) fechado(s)`} />
                <Card titulo="Média por dia" valor={resumo.media == null ? '—' : <Money value={resumo.media} />} sub={resumo.melhor ? `melhor: ${fmtData(resumo.melhor.dia)} · pior: ${fmtData(resumo.pior!.dia)}` : undefined} />
                <Card titulo="Dias que bateram" valor={`${resumo.diasBateram} de ${resumo.diasFechados}`} sub={resumo.emAndamento ? `hoje (em andamento): ${resumo.emAndamento.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}` : undefined} />
              </div>
              {fat && fat.dias.length > 0 ? (
                <>
                  <BarrasDiarias dias={fat.dias} meta={meta} hoje={hoje} />
                  <TabelaDiaria dias={[...fat.dias].reverse()} meta={meta} hoje={hoje} />
                </>
              ) : (
                <EmptyState icon={Target} title="Sem dados no período" hint="Escolha outro período." />
              )}
            </>
          )}
        </>
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

- [ ] **Step 3: Checar tipos e lint**

Run: `npx tsc --noEmit -p . 2>&1 | grep -E "relatorio-meta|FormMeta" || echo OK; npx eslint "app/(app)/relatorio-meta" components/faturamento 2>&1 | tail -5`
Expected: `OK`, sem erros de lint. Se `Target` não existir no `lucide-react` instalado (v1.x), trocar por `Crosshair`/`Flag`.

- [ ] **Step 4: Commit**

```bash
git add components/faturamento/FormMeta.tsx "app/(app)/relatorio-meta/page.tsx"
git commit -m "feat(meta): tela /relatorio-meta (meta x realizado)

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 9: Excel da meta + card em /relatorios

**Files:**
- Create: `app/(app)/relatorio-meta/export/route.ts`
- Modify: `app/(app)/relatorios/page.tsx` (import de ícone ~linha 8-10; grupo `'Faturamento'` ~linha 59-64)

**Interfaces:**
- Consumes: `carregarFaturamentoDiario`, `resumirMeta`, `gerarPlanilhaMulti`, `planilhaResponse`, `AbaPlanilha`.
- Produces: `GET /relatorio-meta/export?data_inicio=&data_final=` → Excel com aba "Dia a dia" (Dia, Faturamento, Meta, Diferença, Situação).

- [ ] **Step 1: Rota de export**

```ts
// app/(app)/relatorio-meta/export/route.ts
import { createServiceClient } from '@/lib/supabase/server'
import { getAtorGestao, getCurrentLojaId } from '@/lib/auth'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { carregarFaturamentoDiario } from '@/lib/faturamento-diario'
import { gerarPlanilhaMulti, planilhaResponse } from '@/lib/excel'

export const dynamic = 'force-dynamic'
const ISO = /^\d{4}-\d{2}-\d{2}$/

export async function GET(request: Request) {
  if (!(await getAtorGestao()).podeGerir) return new Response('Sem permissão', { status: 403 })
  const lojaId = await getCurrentLojaId()
  const hoje = hojeBahiaISO()
  const { searchParams } = new URL(request.url)
  const di = searchParams.get('data_inicio') ?? ''
  const df = searchParams.get('data_final') ?? ''
  const ini = ISO.test(di) && di <= hoje ? di : `${hoje.slice(0, 8)}01`
  const fim = ISO.test(df) && df >= ini ? (df > hoje ? hoje : df) : hoje

  const supabase = createServiceClient()
  const { data: metaRow } = await supabase.from('metas_faturamento').select('valor_diario').eq('loja_id', lojaId).maybeSingle()
  if (metaRow?.valor_diario == null) return new Response('Meta diária não cadastrada', { status: 404 })
  const meta = Number(metaRow.valor_diario)

  const { dias, aviso } = await carregarFaturamentoDiario(lojaId, ini, fim)
  const rows = dias.map((d) => ({
    dia: d.dia,
    valor: d.valor,
    meta,
    dif: Math.round((d.valor - meta) * 100) / 100,
    situacao: d.dia === hoje ? 'Em andamento' : d.valor >= meta ? 'Bateu' : 'Não bateu',
  }))
  const buffer = await gerarPlanilhaMulti([{
    rows,
    colunas: [
      { key: 'dia', label: 'Dia', tipo: 'data', largura: 14 },
      { key: 'valor', label: 'Faturamento', tipo: 'moeda', largura: 18, somar: true },
      { key: 'meta', label: 'Meta', tipo: 'moeda', largura: 16 },
      { key: 'dif', label: 'Diferença', tipo: 'moeda', largura: 16 },
      { key: 'situacao', label: 'Situação', tipo: 'texto', largura: 16 },
    ],
    opts: { titulo: 'Meta de faturamento', subtitulo: `${ini} a ${fim} · meta diária ${meta}${aviso ? ` · ATENÇÃO: ${aviso}` : ''}` },
    nome: 'Dia a dia',
  }])
  return planilhaResponse('meta-faturamento', buffer)
}
```

- [ ] **Step 2: Card em `/relatorios`** — em `app/(app)/relatorios/page.tsx`, adicionar `Target` ao import de `lucide-react` e, no grupo `'Faturamento'`, acrescentar o item depois de "Faturamento x Compras":

```tsx
      { href: '/relatorio-meta', titulo: 'Meta de faturamento', icon: Target, descricao: 'Defina a meta diária e compare com o faturamento de cada dia, semana ou mês.', pergunta: 'Bati a meta?' },
```

- [ ] **Step 3: Checar tipos**

Run: `npx tsc --noEmit -p . 2>&1 | grep -E "relatorio-meta|relatorios/page" || echo OK`
Expected: `OK`

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/relatorio-meta/export/route.ts" "app/(app)/relatorios/page.tsx"
git commit -m "feat(meta): Excel dia a dia e card em Relatorios

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

### Task 10: Verificação ponta a ponta e deploy

- [ ] **Step 1: Testes puros**

Run: `node --test lib/faturamento-dias.test.ts lib/meta-faturamento.test.ts`
Expected: todos passam.

- [ ] **Step 2: Build**

Run: `npm run build 2>&1 | tail -15`
Expected: build sem erros de tipo.

- [ ] **Step 3: Conferir a soma dos dias contra o mês** (uma loja Omie real, ex. loja 3, e uma de estoque próprio): no Postgres do Contabo (ntb_frio para Omie), `select sum(valor) from fat_cupons where loja_id=3 and data between '2026-10-01' and '2026-10-07' and not cancelado` deve bater com a soma da tabela em `?ver=diario` no mesmo intervalo. Para loja própria: `select sum(valor) from vendas_proprio where loja_id=<id> and not cancelado and data between ...`. Se a loja própria divergir do total mensal da tela (que vem de `faturamento_importado`), ajustar o filtro de `devolvido` em `carregarFaturamentoDiario` e registrar o motivo.
- [ ] **Step 4: QA no navegador em produção** (depois do deploy, conta QA `claude.qa@ntb-estoque.dev`; Chrome em segundo plano, sem tela cheia): `/relatorio-faturamento?ver=diario` e `/relatorio-meta` — sem meta (estado vazio), salvar meta, atalhos Hoje/Semana/Mês, período personalizado, meta 0, mobile (largura 390px), Excel baixa e abre. Mandar prints ao usuário em cada etapa.
- [ ] **Step 5: Deploy** (migration 154 já aplicada no Task 7): perguntar ao usuário; `git push origin main`; `deploy.sh` síncrono; `curl` no `/login` → 200. Atualizar o pacote do GPT (`~/Downloads/arquivos-para-enviar-ao-gpt`) conforme a rotina do usuário, e acrescentar uma nota curta em `AGENTS.md` (seção Faturamento) sobre o modo `ver=diario` e a tabela `metas_faturamento`.

---

## Self-Review

- **Cobertura da spec:** Parte A (seletor/modo diário, gráfico+tabela, CSV, função única de busca) → Tasks 1-5; Parte B (tabela+RLS, atalhos, cálculo, cards, gráfico com linha da meta, edição da meta, estado vazio, export, card em `/relatorios`) → Tasks 6-9; erros/bordas (hoje em andamento, futuro, 366 dias, falha do Contabo, loja sem venda) → Tasks 1, 2, 6, 8; verificação e ordem de entrega → Tasks 5 e 10.
- **Divergência consciente da spec:** o loader usa `buscarFatCupons` (cupom a cupom, agrupado em JS) em vez de `buscarFatAgregado(group:'dia')`, porque só assim dá para excluir cancelado e manter devolvido de forma verificável (o endpoint `/fat_agregado` não tem noção de status). O seletor "Mensal | Diário" virou o chip "Por dia", seguindo o padrão `?ver=` da página. A spec foi escrita antes; esta decisão está registrada aqui.
- **Premissa corrigida:** a spec dizia que cancelado **e devolvido** ficam de fora. Para o total diário bater com o total mensal exibido hoje ("Normal + Devolvido"), só cancelado fica de fora. Está nas Global Constraints.
- **Tipos consistentes:** `DiaValor`, `resumirMeta`, `periodoDoAtalho`, `carregarFaturamentoDiario`, `salvarMetaFaturamento`, `BarrasDiarias`/`TabelaDiaria` usam os mesmos nomes e assinaturas em todas as tasks.
