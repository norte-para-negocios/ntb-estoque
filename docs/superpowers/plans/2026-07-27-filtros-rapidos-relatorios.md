# Filtros Rápidos e Dimensões Novas nos Relatórios — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar chips de período/status visíveis (sem clicar em nada) em 8 telas de relatório que hoje só têm a gaveta de filtro, mais 3 dimensões de filtro que faltam onde o dado já existe (período em Pendências de Classificação, local de estoque em Indicadores, família multi-select em Auditoria Fiscal).

**Architecture:** Um componente client novo (`ChipsPeriodo`) escreve os mesmos 2 query params (`data_inicio`/`data_final`) que a gaveta de filtro livre já usa em cada tela — não é um searchParam novo por página, é um atalho pros mesmos 2 campos. `ChipsStatus` (já existe, usado em OP/Transferências) ganha um novo consumidor (Notas Fiscais). As 3 dimensões novas seguem os padrões já estabelecidos no repo (RPC com `text[]`/`= any()`, complemento frio via `lib/relatorio-frio-nf.ts`).

**Tech Stack:** Next.js App Router (Server Components + um client component novo), Supabase (RPC em SQL + `.from()`), API HTTP do Contabo (`lib/historico-contabo.ts`/`lib/relatorio-frio-nf.ts`).

## Global Constraints

- Nenhum framework de teste automatizado no repo — verificação via `npx tsc --noEmit -p .` e `npm run build` depois de CADA tarefa (não só no final).
- Nunca usar `git add -A`/`git add .` — sempre arquivos nomeados.
- `ChipsPeriodo` escreve/lê **exatamente** `data_inicio`/`data_final` (formato `YYYY-MM-DD`) — os MESMOS params que a gaveta de cada tela já usa. Nunca introduzir um searchParam novo tipo `periodo=` para essas 6 telas (isso é específico de Faturamento, que já existe e não muda).
- Margem e Estoque Valorizado estão FORA de escopo deste plano — não tocar.
- Todo `filtrarItensCompras`/`filtrarItensAuditoria`/RPC SQL tocado neste plano já filtra `c_etapa = '60'` + não cancelada — não remover essa condição em nenhuma edição.
- Sentinela `'__sem__'` (valor nulo/sem classificação) já existe nos filtros de família/tipo/fornecedor/cfop/local — preservar em qualquer mudança de assinatura.

---

## Task 1: Componente `ChipsPeriodo` + helper `chipsPeriodoPadrao`

**Files:**
- Create: `components/ui-kit/ChipsPeriodo.tsx`
- Create: `lib/periodo-rapido.ts`

**Interfaces:**
- Consumes: `hojeBahiaISO()` de `lib/data-bahia.ts` (já existe, retorna `YYYY-MM-DD`).
- Produces: `ChipsPeriodo` (componente React, `basePath: string`, `opcoes: ChipPeriodoOpcao[]`) e `chipsPeriodoPadrao(extra?: ChipPeriodoOpcao): ChipPeriodoOpcao[]` — usados pelas Tasks 2, 3 e 4. Tipo `ChipPeriodoOpcao = { value: string; label: string; dataIni: string; dataFim: string }` exportado de `lib/periodo-rapido.ts`.

- [ ] **Step 1: Criar `lib/periodo-rapido.ts`**

```ts
// lib/periodo-rapido.ts
// Chips de atalho de período (Este mês/3 meses/6 meses/Ano passado) para as
// telas de relatório que já têm data_inicio/data_final na gaveta mas nenhum
// atalho visível fora dela. Cada chip carrega um par de datas prontas (não
// um enum) -- o clique escreve os MESMOS 2 params que a gaveta já usa, sem
// introduzir um searchParam novo por página.
import { hojeBahiaISO } from '@/lib/data-bahia'

export type ChipPeriodoOpcao = { value: string; label: string; dataIni: string; dataFim: string }

function primeiroDiaMesAtras(hoje: string, meses: number): string {
  const [ano, mes] = hoje.slice(0, 7).split('-').map(Number)
  let a = ano
  let m = mes - meses
  while (m < 1) { m += 12; a-- }
  return `${a}-${String(m).padStart(2, '0')}-01`
}

/**
 * Gera os 4 chips padrão (Este mês / 3 meses / 6 meses / Ano passado),
 * relativos a hoje (America/Bahia). `extra`, quando informado, é
 * PREPENDADO à lista -- cada tela usa isso pro seu próprio chip de default
 * (ex.: {value:'', label:'Ano corrente', dataIni:'2026-01-01', dataFim:hoje}
 * ou {value:'', label:'Tudo', dataIni:'', dataFim:''} quando a tela não tem
 * piso nenhum por padrão).
 */
export function chipsPeriodoPadrao(extra?: ChipPeriodoOpcao): ChipPeriodoOpcao[] {
  const hoje = hojeBahiaISO()
  const anoAtual = Number(hoje.slice(0, 4))
  const chips: ChipPeriodoOpcao[] = [
    { value: 'mes', label: 'Este mês', dataIni: primeiroDiaMesAtras(hoje, 0), dataFim: hoje },
    { value: '3m', label: '3 meses', dataIni: primeiroDiaMesAtras(hoje, 2), dataFim: hoje },
    { value: '6m', label: '6 meses', dataIni: primeiroDiaMesAtras(hoje, 5), dataFim: hoje },
    { value: 'ano_passado', label: 'Ano passado', dataIni: `${anoAtual - 1}-01-01`, dataFim: `${anoAtual - 1}-12-31` },
  ]
  return extra ? [extra, ...chips] : chips
}
```

- [ ] **Step 2: Criar `components/ui-kit/ChipsPeriodo.tsx`**

```tsx
'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import type { ChipPeriodoOpcao } from '@/lib/periodo-rapido'

/**
 * Chips de atalho de período ACIMA da tabela: 1 clique escreve os MESMOS 2
 * searchParams (data_inicio/data_final) que a gaveta de filtro livre já usa
 * nesta tela, preservando os demais params. Mesmo molde de ChipsStatus.tsx,
 * mas escreve 2 params de uma vez em vez de 1.
 * `opcoes[0]` deve ser o default da própria tela (value='' -- ex.: "Ano
 * corrente" ou "Tudo"), pra sempre existir uma opção que limpa/reseta.
 */
export function ChipsPeriodo({
  basePath,
  opcoes,
}: {
  basePath: string
  opcoes: ChipPeriodoOpcao[]
}) {
  const router = useRouter()
  const sp = useSearchParams()
  const iniAtual = sp.get('data_inicio') ?? ''
  const fimAtual = sp.get('data_final') ?? ''

  function selecionar(o: ChipPeriodoOpcao) {
    const params = new URLSearchParams(sp.toString())
    params.delete('page')
    if (o.value === '' && !o.dataIni && !o.dataFim) {
      params.delete('data_inicio')
      params.delete('data_final')
    } else {
      params.set('data_inicio', o.dataIni)
      params.set('data_final', o.dataFim)
    }
    const qs = params.toString()
    router.push(qs ? `${basePath}?${qs}` : basePath)
  }

  return (
    <div className="flex flex-nowrap items-center gap-1.5 overflow-x-auto [scrollbar-width:none] sm:flex-wrap [&::-webkit-scrollbar]:hidden">
      {opcoes.map((o) => {
        // Ativo = os 2 params atuais batem com este chip (ou, pro chip default
        // vazio, nenhum dos dois está setado -- período customizado da gaveta
        // sempre desativa todos os chips, igual ao comportamento já existente
        // em Faturamento).
        const ativo =
          o.value === '' && !o.dataIni && !o.dataFim
            ? !iniAtual && !fimAtual
            : iniAtual === o.dataIni && fimAtual === o.dataFim
        return (
          <button
            key={o.value || '_default'}
            type="button"
            aria-pressed={ativo}
            onClick={() => selecionar(o)}
            className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 py-1 text-[13px] font-medium u-motion u-press-sm ${
              ativo
                ? 'border-brand bg-brand/10 text-brand'
                : 'border-border bg-surface text-text-muted hover:border-brand/50 hover:bg-surface-2 hover:text-text'
            }`}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 3: Verificar tipos**

Run: `npx tsc --noEmit -p .`
Expected: sem erros novos (os 2 arquivos ainda não são importados em nenhuma página — só checa que compilam sozinhos).

- [ ] **Step 4: Commit**

```bash
git add lib/periodo-rapido.ts components/ui-kit/ChipsPeriodo.tsx
git commit -m "feat: componente ChipsPeriodo + helper chipsPeriodoPadrao"
```

---

## Task 2: `ChipsPeriodo` em Compras e Movimentação

**Files:**
- Modify: `app/(app)/relatorio-compras/page.tsx`
- Modify: `app/(app)/relatorio-movimentacao/page.tsx`

**Interfaces:**
- Consumes: `ChipsPeriodo` e `chipsPeriodoPadrao` da Task 1.

- [ ] **Step 1: Compras — importar e renderizar**

Em `app/(app)/relatorio-compras/page.tsx`, adicionar o import logo abaixo do import de `DrillBreadcrumb` (linha 31):

```ts
import { DrillBreadcrumb } from '@/components/ui-kit/DrillBreadcrumb'
import { ChipsPeriodo } from '@/components/ui-kit/ChipsPeriodo'
import { chipsPeriodoPadrao } from '@/lib/periodo-rapido'
```

Logo depois da linha `const hojeISO = ...` (linha 99, já existente), adicionar a lista de chips:

```ts
  const hojeISO = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bahia' })
  const chipsPeriodo = chipsPeriodoPadrao({ value: '', label: 'Ano corrente', dataIni: `${hojeISO.slice(0, 4)}-01-01`, dataFim: hojeISO })
```

No JSX, dentro de `<ListaHeader>`, logo depois de `<ChipsFiltrosAtivos .../>` (linha 333) e antes do `</ListaHeader>` (linha 334):

```tsx
        <ChipsFiltrosAtivos basePath="/relatorio-compras" campos={campos} persistirEm="/relatorio-compras" />
        <ChipsPeriodo basePath="/relatorio-compras" opcoes={chipsPeriodo} />
      </ListaHeader>
```

- [ ] **Step 2: Movimentação — importar e renderizar nos 2 modos**

Em `app/(app)/relatorio-movimentacao/page.tsx`, adicionar o import logo abaixo de `import { explicarRotulo } from '@/lib/rotulos-opacos'` (linha 27):

```ts
import { explicarRotulo } from '@/lib/rotulos-opacos'
import { ChipsPeriodo } from '@/components/ui-kit/ChipsPeriodo'
import { chipsPeriodoPadrao } from '@/lib/periodo-rapido'
```

Modo "Por operação" (dentro do `if (modo === 'operacao')`, logo antes do `const header = (` na linha 140), adicionar:

```ts
    const anoCorrenteChip = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bahia' }).slice(0, 4)
    const chipsPeriodoOp = chipsPeriodoPadrao({ value: '', label: 'Ano corrente', dataIni: `${anoCorrenteChip}-01-01`, dataFim: new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bahia' }) })
    const header = (
```

Dentro do JSX de `header` (linha 141-171), depois de `<ChipsFiltrosAtivos ... />` (linha 169) e antes de `</ListaHeader>` (linha 170):

```tsx
        <ChipsFiltrosAtivos basePath="/relatorio-movimentacao" campos={campos} persistirEm="/relatorio-movimentacao-op" />
        <ChipsPeriodo basePath="/relatorio-movimentacao" opcoes={chipsPeriodoOp} />
      </ListaHeader>
    )
```

Modo "Em quantidade" — variável `hojeISO` já existe nesse trecho (linha 488, `const hojeISO = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bahia' })`), mas ela só é declarada DEPOIS do `header` (linha 455-485). Mover a leitura de `hojeISO` para ANTES do `header` (ela não depende de nada declarado no meio):

Trocar o trecho:
```ts
  const header = (
    <ListaHeader>
```
(linha 455-456, dentro do bloco "Em quantidade") por:
```ts
  const hojeISOQtd = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bahia' })
  const chipsPeriodoQtd = chipsPeriodoPadrao({ value: '', label: 'Ano corrente', dataIni: `${hojeISOQtd.slice(0, 4)}-01-01`, dataFim: hojeISOQtd })
  const header = (
    <ListaHeader>
```

E, mais abaixo (linha 488), trocar a declaração duplicada `const hojeISO = ...` por reaproveitar `hojeISOQtd`:

```ts
  const sentido = sp.sentido === 'entradas' ? 'entradas' : 'saidas'
  const ini = /^\d{4}-\d{2}-\d{2}$/.test(sp.data_inicio ?? '') ? sp.data_inicio! : `${hojeISOQtd.slice(0, 4)}-01-01`
  const fim = /^\d{4}-\d{2}-\d{2}$/.test(sp.data_final ?? '') ? sp.data_final! : hojeISOQtd
```

(Remove a linha antiga `const hojeISO = new Date().toLocaleDateString(...)` que ficava logo acima de `ini`/`fim` — ela agora é `hojeISOQtd`, declarada mais cedo.)

No JSX de `header` desse modo (linha 456-485), depois de `<ChipsFiltrosAtivos ... />` (linha 483) e antes de `</ListaHeader>` (linha 484):

```tsx
      <ChipsFiltrosAtivos basePath="/relatorio-movimentacao" campos={campos} persistirEm="/relatorio-movimentacao" />
      <ChipsPeriodo basePath="/relatorio-movimentacao" opcoes={chipsPeriodoQtd} />
    </ListaHeader>
  )
```

- [ ] **Step 3: Verificar tipos e build**

Run: `npx tsc --noEmit -p .` — esperado: sem erros.
Run: `npm run build` — esperado: build limpo, `/relatorio-compras` e `/relatorio-movimentacao` continuam listadas nas rotas geradas.

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/relatorio-compras/page.tsx" "app/(app)/relatorio-movimentacao/page.tsx"
git commit -m "feat: chips de período em Compras e Movimentação"
```

---

## Task 3: `ChipsPeriodo` em Auditoria Fiscal e Indicadores

**Files:**
- Modify: `app/(app)/auditoria-fiscal/page.tsx`
- Modify: `app/(app)/relatorio-indicadores/page.tsx`

**Interfaces:**
- Consumes: `ChipsPeriodo`/`chipsPeriodoPadrao` (Task 1).

- [ ] **Step 1: Auditoria Fiscal — importar e renderizar**

Adicionar o import logo abaixo de `import { btnClass } from '@/components/ui-kit/Button'` (linha 24):

```ts
import { btnClass } from '@/components/ui-kit/Button'
import { ChipsPeriodo } from '@/components/ui-kit/ChipsPeriodo'
import { chipsPeriodoPadrao } from '@/lib/periodo-rapido'
```

Logo depois de `const hojeISO = ...` (linha 49, já existente):

```ts
  const hojeISO = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bahia' })
  const chipsPeriodo = chipsPeriodoPadrao({ value: '', label: 'Ano corrente', dataIni: `${hojeISO.slice(0, 4)}-01-01`, dataFim: hojeISO })
```

No JSX, depois de `<ChipsFiltrosAtivos basePath="/auditoria-fiscal" .../>` (linha 213) e antes de `</ListaHeader>` (linha 214):

```tsx
        <ChipsFiltrosAtivos basePath="/auditoria-fiscal" campos={campos} persistirEm="/auditoria-fiscal" />
        <ChipsPeriodo basePath="/auditoria-fiscal" opcoes={chipsPeriodo} />
      </ListaHeader>
```

- [ ] **Step 2: Indicadores — importar e renderizar**

Adicionar o import logo abaixo de `import { btnClass } from '@/components/ui-kit/Button'` (linha 16):

```ts
import { btnClass } from '@/components/ui-kit/Button'
import { ChipsPeriodo } from '@/components/ui-kit/ChipsPeriodo'
import { chipsPeriodoPadrao } from '@/lib/periodo-rapido'
```

Logo depois de `const filtroAtivo = ...` (linha 58, já existente) — Indicadores não tem piso fixo declarado (comportamento atual quando `filtroIni`/`filtroFim` são `null`: cai no intervalo de anos do próprio faturamento), então o chip default é "Tudo" (value vazio, sem datas):

```ts
  const filtroAtivo = !!(familiasSel.length || produtoTermo)
  const chipsPeriodo = chipsPeriodoPadrao({ value: '', label: 'Tudo', dataIni: '', dataFim: '' })
```

No JSX, depois de `<ChipsFiltrosAtivos basePath="/relatorio-indicadores" .../>` (linha 236) e antes de `</ListaHeader>` (linha 237):

```tsx
        <ChipsFiltrosAtivos basePath="/relatorio-indicadores" campos={campos} persistirEm="/relatorio-indicadores" />
        <ChipsPeriodo basePath="/relatorio-indicadores" opcoes={chipsPeriodo} />
      </ListaHeader>
```

- [ ] **Step 3: Verificar tipos e build**

Run: `npx tsc --noEmit -p .` — esperado: sem erros.
Run: `npm run build` — esperado: build limpo.

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/auditoria-fiscal/page.tsx" "app/(app)/relatorio-indicadores/page.tsx"
git commit -m "feat: chips de período em Auditoria Fiscal e Indicadores"
```

---

## Task 4: `ChipsPeriodo` em Ordens de Produção e Transferências

**Files:**
- Modify: `app/(app)/ordem-producao/page.tsx`
- Modify: `app/(app)/transferencia/page.tsx`

**Interfaces:**
- Consumes: `ChipsPeriodo`/`chipsPeriodoPadrao` (Task 1). Ambas as telas já têm `ChipsStatus` renderizado no mesmo lugar — `ChipsPeriodo` entra IMEDIATAMENTE ABAIXO dele, mesma posição relativa nas duas telas.

- [ ] **Step 1: Ordens de Produção — importar e renderizar**

Adicionar o import logo abaixo de `import { ChipsStatus } from '@/components/ui-kit/ChipsStatus'` (linha 13):

```ts
import { ChipsStatus } from '@/components/ui-kit/ChipsStatus'
import { ChipsPeriodo } from '@/components/ui-kit/ChipsPeriodo'
import { chipsPeriodoPadrao } from '@/lib/periodo-rapido'
```

Logo depois de `const dataFinal = sp.data_final ?? ultimoDiaMes` (linha 83, já existente — `primeiroDiaMes`/`ultimoDiaMes` já são calculados ali em cima):

```ts
  const dataFinal = sp.data_final ?? ultimoDiaMes
  const chipsPeriodo = chipsPeriodoPadrao({ value: '', label: 'Este mês', dataIni: primeiroDiaMes, dataFim: ultimoDiaMes })
```

No JSX, logo depois de `<ChipsStatus .../>` (linha 544-554) e antes de `<ChipsFiltrosAtivos .../>` (linha 555):

```tsx
        <ChipsStatus
          basePath="/ordem-producao"
          param="op_status"
          opcoes={[
            { value: '', label: 'Todas' },
            { value: 'prevista', label: 'Previstas', count: totPrevistasFinal },
            { value: 'pendente', label: 'Pendentes', count: totPendentesFinal },
            { value: 'atrasada', label: 'Atrasadas', count: totAtrasadasFinal },
            { value: 'concluida', label: 'Concluídas', count: totConcluidasFinal },
          ]}
        />
        <ChipsPeriodo basePath="/ordem-producao" opcoes={chipsPeriodo} />
        <ChipsFiltrosAtivos
```

- [ ] **Step 2: Transferências — importar e renderizar**

Adicionar o import logo abaixo de `import { ChipsStatus } from '@/components/ui-kit/ChipsStatus'` (linha 12):

```ts
import { ChipsStatus } from '@/components/ui-kit/ChipsStatus'
import { ChipsPeriodo } from '@/components/ui-kit/ChipsPeriodo'
import { chipsPeriodoPadrao } from '@/lib/periodo-rapido'
```

Logo depois de `const page = Math.max(1, Number(sp.page) || 1)` (linha 50, já existente) — Transferências não tem piso fixo hoje (`if (sp.data_inicio) query.gte(...)`, sem default), chip default "Tudo":

```ts
  const page = Math.max(1, Number(sp.page) || 1)
  const chipsPeriodo = chipsPeriodoPadrao({ value: '', label: 'Tudo', dataIni: '', dataFim: '' })
```

No JSX, logo depois de `<ChipsStatus .../>` (linha 305-313) e antes de `<ChipsFiltrosAtivos .../>` (linha 314):

```tsx
        <ChipsStatus
          basePath="/transferencia"
          param="status"
          opcoes={[
            { value: '', label: 'Todas' },
            { value: 'A', label: 'Em aberto' },
            { value: 'C', label: 'Concluídas' },
          ]}
        />
        <ChipsPeriodo basePath="/transferencia" opcoes={chipsPeriodo} />
        <ChipsFiltrosAtivos basePath="/transferencia" campos={campos} naoMostrar={['status']} persistirEm="/transferencia" />
```

- [ ] **Step 3: Verificar tipos e build**

Run: `npx tsc --noEmit -p .` — esperado: sem erros.
Run: `npm run build` — esperado: build limpo.

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/ordem-producao/page.tsx" "app/(app)/transferencia/page.tsx"
git commit -m "feat: chips de período em Ordens de Produção e Transferências"
```

---

## Task 5: Faturamento — chip "Ano passado"

**Files:**
- Modify: `app/(app)/relatorio-faturamento/page.tsx`

**Interfaces:**
- Consumes: nada de fora (mudança isolada nesta página).
- Produces: nada consumido por outra task.

- [ ] **Step 1: Adicionar a entrada no array `CHIPS_PERIODO`**

Trocar (linhas 30-35):

```ts
const CHIPS_PERIODO = [
  { value: '', label: 'Todos' },
  { value: '1', label: 'Este mês' },
  { value: '3', label: '3 meses' },
  { value: '6', label: '6 meses' },
] as const
```

por:

```ts
const CHIPS_PERIODO = [
  { value: '', label: 'Todos' },
  { value: '1', label: 'Este mês' },
  { value: '3', label: '3 meses' },
  { value: '6', label: '6 meses' },
  { value: 'ano_passado', label: 'Ano passado' },
] as const
```

- [ ] **Step 2: Tratar o novo valor no cálculo de `mesIniChip`/`mesFim`**

Trocar (linhas 103-106):

```ts
  const mesAtual = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bahia' }).slice(0, 7)
  const mesIniChip = periodo && !temPeriodoCustom ? mesOffset(mesAtual, -(Number(periodo) - 1)) : null
  const mesIni = dataIni ? dataIni.slice(0, 7) : mesIniChip
  const mesFim = dataFim ? dataFim.slice(0, 7) : null
```

por:

```ts
  const mesAtual = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bahia' }).slice(0, 7)
  const anoAtualNum = Number(mesAtual.slice(0, 4))
  // "Ano passado" é o único chip que fixa um TETO explícito (os outros 3 vão
  // implicitamente até o mês atual) -- por isso mesFimChip existe só pra este caso.
  const mesIniChip =
    periodo === 'ano_passado' ? `${anoAtualNum - 1}-01`
    : periodo && !temPeriodoCustom ? mesOffset(mesAtual, -(Number(periodo) - 1))
    : null
  const mesFimChip = periodo === 'ano_passado' && !temPeriodoCustom ? `${anoAtualNum - 1}-12` : null
  const mesIni = dataIni ? dataIni.slice(0, 7) : mesIniChip
  const mesFim = dataFim ? dataFim.slice(0, 7) : mesFimChip
```

- [ ] **Step 3: Verificar tipos e build**

Run: `npx tsc --noEmit -p .` — esperado: sem erros (o array `CHIPS_PERIODO` é `as const`, e `sp.periodo` já é comparado contra `.value` por `.some(...)` na linha 87 — nenhuma outra mudança de tipo necessária).
Run: `npm run build` — esperado: build limpo.

- [ ] **Step 4: Teste manual (sem framework automatizado no repo)**

Rodar `npm run dev`, abrir `/relatorio-faturamento?periodo=ano_passado`, e conferir que o total exibido bate com `/relatorio-faturamento?data_inicio=<ano-1>-01-01&data_final=<ano-1>-12-31` (mesma consulta, via filtro livre). Os dois devem mostrar o MESMO valor total.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/relatorio-faturamento/page.tsx"
git commit -m "feat: chip 'Ano passado' em Faturamento"
```

---

## Task 6: `ChipsStatus` em Notas Fiscais

**Files:**
- Modify: `app/(app)/nota-fiscal/page.tsx`

**Interfaces:**
- Consumes: `ChipsStatus` (já existe, `components/ui-kit/ChipsStatus.tsx`) — mesmo padrão já usado em `app/(app)/ordem-producao/page.tsx` e `app/(app)/transferencia/page.tsx`.

- [ ] **Step 1: Importar `ChipsStatus`**

Adicionar o import logo abaixo de `import { ChipsFiltrosAtivos } from '@/components/ui-kit/ChipsFiltrosAtivos'` (linha 6):

```ts
import { ChipsFiltrosAtivos } from '@/components/ui-kit/ChipsFiltrosAtivos'
import { ChipsStatus } from '@/components/ui-kit/ChipsStatus'
```

- [ ] **Step 2: Renderizar entre `PageHeader` e `ChipsFiltrosAtivos`**

Trocar (linhas 446-447):

```tsx
        />
        <ChipsFiltrosAtivos basePath="/nota-fiscal" campos={campos} naoMostrar={['data_inicio', 'data_final']} persistirEm="/nota-fiscal" />
```

por:

```tsx
        />
        <ChipsStatus
          basePath="/nota-fiscal"
          param="status"
          opcoes={[
            { value: '', label: 'Todas' },
            { value: 'CONCLUIDA', label: 'Concluídas' },
            { value: 'PENDENTE', label: 'Pendentes' },
            { value: 'CANCELADA', label: 'Canceladas' },
          ]}
        />
        <ChipsFiltrosAtivos basePath="/nota-fiscal" campos={campos} naoMostrar={['data_inicio', 'data_final', 'status']} persistirEm="/nota-fiscal" />
```

(Note o `'status'` adicionado em `naoMostrar` — sem isso, o chip de "Situação" apareceria duplicado: uma vez no novo `ChipsStatus` e de novo como badge de `ChipsFiltrosAtivos`, igual já é evitado hoje pra `op_status`/`status` em OP/Transferências.)

- [ ] **Step 3: Verificar tipos e build**

Run: `npx tsc --noEmit -p .` — esperado: sem erros.
Run: `npm run build` — esperado: build limpo.

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/nota-fiscal/page.tsx"
git commit -m "feat: chips de status (Concluída/Pendente/Cancelada) em Notas Fiscais"
```

---

## Task 7: Pendências de Classificação — filtro de período

**Files:**
- Modify: `app/(app)/pendencias-classificacao/page.tsx`
- Modify: `app/(app)/pendencias-classificacao/export/route.ts`

**Interfaces:**
- Consumes: `hojeBahiaISO()` de `lib/data-bahia.ts`.
- Produces: `periodoPendencias(sp: { data_inicio?: string; data_final?: string }): { dataIni: string; dataFim: string }`, definida em `lib/pendencias-periodo.ts` (novo arquivo pequeno, usado pelos 2 arquivos desta task).

- [ ] **Step 1: Criar `lib/pendencias-periodo.ts`**

```ts
// lib/pendencias-periodo.ts
// Período de 12 meses da tela de Pendências de Classificação -- antes era
// calculado 3 vezes de forma independente (page.tsx + os 2 blocos do
// export/route.ts), sem nenhum jeito do usuário escolher um período
// diferente. Uma função só, parametrizável, usada nos 2 arquivos.
import { hojeBahiaISO } from '@/lib/data-bahia'

export function periodoPendencias(sp: { data_inicio?: string; data_final?: string }): { dataIni: string; dataFim: string } {
  const hojeISO = hojeBahiaISO()
  const dataFimValida = /^\d{4}-\d{2}-\d{2}$/.test(sp.data_final ?? '') ? sp.data_final! : hojeISO
  const dataIniPadrao = `${Number(dataFimValida.slice(0, 4)) - 1}${dataFimValida.slice(4, 10)}`
  const dataIniValida = /^\d{4}-\d{2}-\d{2}$/.test(sp.data_inicio ?? '') ? sp.data_inicio! : dataIniPadrao
  return { dataIni: dataIniValida, dataFim: dataFimValida }
}
```

- [ ] **Step 2: `page.tsx` — receber `searchParams`, usar `periodoPendencias`, adicionar a gaveta de filtro**

Trocar a assinatura da função (linha 20):

```ts
export default async function PendenciasClassificacaoPage() {
```

por:

```ts
export default async function PendenciasClassificacaoPage({
  searchParams,
}: {
  searchParams: Promise<{ data_inicio?: string; data_final?: string }>
}) {
```

Adicionar os imports (junto aos já existentes, linhas 1-15):

```ts
import { FiltrosGaveta } from '@/components/ui-kit/FiltrosGaveta'
import { ChipsFiltrosAtivos } from '@/components/ui-kit/ChipsFiltrosAtivos'
import type { CampoFiltro } from '@/components/ui-kit/filtros-utils'
import { periodoPendencias } from '@/lib/pendencias-periodo'
```

Trocar (linhas 25-26):

```ts
  const hojeISO = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bahia' })
  const ini12m = `${Number(hojeISO.slice(0, 4)) - 1}${hojeISO.slice(4, 10)}`
```

por:

```ts
  const sp = await searchParams
  const { dataIni: ini12m, dataFim: dataFimPendencias } = periodoPendencias(sp)
```

Nota: `carregarQuentes()` (linha 67) usa `corte` (janela quente fixa de 90 dias, de `limiteJanelaQuente()`) para a fatia QUENTE — isso não muda. A chamada ao complemento FRIO na linha 88 (`buscarItensNFFrio({ lojaId, dataInicio: ini12m, dataFinal: corteExcl })`) já usa a variável `ini12m` certa — como ela agora vem de `periodoPendencias(sp)` (Step acima) em vez de calculada inline, nenhum código nesta chamada precisa mudar; só o valor que `ini12m` carrega mudou.

Trocar o bloco 4 (cupons não identificados, linhas 164-172) para respeitar o mesmo período em vez do `.limit(12)` fixo:

```ts
  // Bloco 4: cupons do Faturamento (PDV) sem produto identificado, por mes.
  const { data: naoIdentRows } = await supabase
    .from('faturamento_importado')
    .select('mes, valor')
    .eq('loja_id', lojaId)
    .eq('dimensao', 'produto')
    .eq('rotulo', 'Produto não identificado')
    .gte('mes', ini12m.slice(0, 7))
    .lte('mes', dataFimPendencias.slice(0, 7))
    .order('mes', { ascending: false })
```

Adicionar a gaveta de filtro no cabeçalho — trocar (linhas 191-198):

```tsx
      <ListaHeader>
        <PageHeader
          title="Pendências de classificação"
          icon={ClipboardX}
          description="O que arrumar no Omie pra sumir com os 'Sem cadastro/família/tipo' dos relatórios"
          voltarHref="/relatorios"
        />
      </ListaHeader>
```

por:

```tsx
      <ListaHeader>
        <PageHeader
          title="Pendências de classificação"
          icon={ClipboardX}
          description="O que arrumar no Omie pra sumir com os 'Sem cadastro/família/tipo' dos relatórios"
          voltarHref="/relatorios"
          actions={
            <FiltrosGaveta
              basePath="/pendencias-classificacao"
              campos={campos}
              defaults={{ data_inicio: sp.data_inicio ?? '', data_final: sp.data_final ?? '' }}
              persistirEm="/pendencias-classificacao"
            />
          }
        />
        <ChipsFiltrosAtivos basePath="/pendencias-classificacao" campos={campos} persistirEm="/pendencias-classificacao" />
      </ListaHeader>
```

Adicionar a definição de `campos` logo antes do `return` (a variável `Bloco` já existe ali, linha 174-187 — inserir `campos` antes dela):

```ts
  const campos: CampoFiltro[] = [
    { tipo: 'data', nome: 'data_inicio', label: 'Data inicial (padrão: 12 meses atrás)' },
    { tipo: 'data', nome: 'data_final', label: 'Data final (padrão: hoje)' },
  ]

  const Bloco = ({ titulo, valor, exportBloco, children }: { titulo: string; valor: number; exportBloco: string; children: ReactNode }) => (
```

Os 4 links de export (`href={\`/pendencias-classificacao/export?bloco=${exportBloco}\`}`, dentro de `Bloco`, linha 181) precisam levar o período escolhido — trocar:

```tsx
        <a href={`/pendencias-classificacao/export?bloco=${exportBloco}`} target="_blank" rel="noopener noreferrer" className={btnClass('outline')}>
```

por (usando as variáveis `ini12m`/`dataFimPendencias` já calculadas no escopo da página, capturadas pelo closure de `Bloco`):

```tsx
        <a href={`/pendencias-classificacao/export?bloco=${exportBloco}&data_inicio=${ini12m}&data_final=${dataFimPendencias}`} target="_blank" rel="noopener noreferrer" className={btnClass('outline')}>
```

- [ ] **Step 3: `export/route.ts` — ler `data_inicio`/`data_final` da URL, usar `periodoPendencias`**

Adicionar o import (junto aos existentes, linhas 1-5):

```ts
import { periodoPendencias } from '@/lib/pendencias-periodo'
```

Trocar (linhas 9-13):

```ts
export async function GET(req: Request) {
  const lojaId = await getCurrentLojaId()
  if (!(await getAtorGestao()).podeGerir) return new Response('Sem permissão', { status: 403 })
  const bloco = new URL(req.url).searchParams.get('bloco') ?? 'sem-cadastro'
  const supabase = createServiceClient()
```

por:

```ts
export async function GET(req: Request) {
  const lojaId = await getCurrentLojaId()
  if (!(await getAtorGestao()).podeGerir) return new Response('Sem permissão', { status: 403 })
  const sp = new URL(req.url).searchParams
  const bloco = sp.get('bloco') ?? 'sem-cadastro'
  const { dataIni: ini12m, dataFim: dataFimPendencias } = periodoPendencias({
    data_inicio: sp.get('data_inicio') ?? undefined,
    data_final: sp.get('data_final') ?? undefined,
  })
  const supabase = createServiceClient()
```

No bloco `sem-familia` (linhas 42-54), trocar:

```ts
  if (bloco === 'sem-familia') {
    // Sugestão do cliente (Ramon): CFOP de entrada mais frequente ajuda a
    // decidir a classificação sem família cadastrada — mesma lógica da página.
    const hojeISO = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bahia' })
    const ini12m = `${Number(hojeISO.slice(0, 4)) - 1}${hojeISO.slice(4, 10)}`
    const corte = limiteJanelaQuente()
    const { data: quentesCfop } = await supabase
      .from('nota_fiscal_items')
      .select('n_id_produto, c_cfop, full_object, notas_fiscais!inner(deleted_at, d_emissao_nfe)')
      .eq('loja_id', lojaId)
      .is('notas_fiscais.deleted_at', null)
      .gte('notas_fiscais.d_emissao_nfe', corte)
      .limit(50000)
```

por:

```ts
  if (bloco === 'sem-familia') {
    // Sugestão do cliente (Ramon): CFOP de entrada mais frequente ajuda a
    // decidir a classificação sem família cadastrada — mesma lógica da página.
    const corte = limiteJanelaQuente()
    const { data: quentesCfop } = await supabase
      .from('nota_fiscal_items')
      .select('n_id_produto, c_cfop, full_object, notas_fiscais!inner(deleted_at, d_emissao_nfe)')
      .eq('loja_id', lojaId)
      .is('notas_fiscais.deleted_at', null)
      .gte('notas_fiscais.d_emissao_nfe', corte)
      .lte('notas_fiscais.d_emissao_nfe', dataFimPendencias)
      .limit(50000)
```

(A linha seguinte, `const corteExcl = new Date(Date.parse(corte) - 86400000)...`, já usa `corte` — sem mudança.)

No bloco `cupom-nao-identificado` (linhas 89-101), trocar:

```ts
  if (bloco === 'cupom-nao-identificado') {
    const { data } = await supabase
      .from('faturamento_importado')
      .select('mes, valor')
      .eq('loja_id', lojaId)
      .eq('dimensao', 'produto')
      .eq('rotulo', 'Produto não identificado')
      .order('mes', { ascending: false })
      .limit(12)
```

por:

```ts
  if (bloco === 'cupom-nao-identificado') {
    const { data } = await supabase
      .from('faturamento_importado')
      .select('mes, valor')
      .eq('loja_id', lojaId)
      .eq('dimensao', 'produto')
      .eq('rotulo', 'Produto não identificado')
      .gte('mes', ini12m.slice(0, 7))
      .lte('mes', dataFimPendencias.slice(0, 7))
      .order('mes', { ascending: false })
```

No bloco `sem-cadastro` (o restante do arquivo, linhas 104-120), trocar:

```ts
  // sem-cadastro: itens de NF (12 meses, quente+frio) sem produto no cadastro.
  const hojeISO = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bahia' })
  const ini12m = `${Number(hojeISO.slice(0, 4)) - 1}${hojeISO.slice(4, 10)}`
  const corte = limiteJanelaQuente()
  type ItemNF = { n_id_produto: number | null; c_descricao_produto: string | null; c_codigo_produto: string | null; n_qtde_nfe: number | null; n_preco_unit: number | null; fornecedor: string | null }
  // Só NF concluída (etapa 60) e não cancelada -- mesmo filtro da página
  // (pendencias-classificacao/page.tsx) e de Compras/Auditoria (migration 083).
  // Achado real (auditoria 2026-07-26): este export somava R$ de NF pendente
  // e cancelada, diferente do que a própria tela mostra.
  const { data: quentesRaw } = await supabase
    .from('nota_fiscal_items')
    .select('n_id_produto, c_descricao_produto, c_codigo_produto, n_qtde_nfe, n_preco_unit, notas_fiscais!inner(deleted_at, d_emissao_nfe, c_razao_social, c_nome, full_object)')
    .eq('loja_id', lojaId)
    .is('notas_fiscais.deleted_at', null)
    .eq('notas_fiscais.c_etapa', '60')
    .gte('notas_fiscais.d_emissao_nfe', corte)
    .limit(50000)
```

por:

```ts
  // sem-cadastro: itens de NF (periodo escolhido, quente+frio) sem produto no cadastro.
  const corte = limiteJanelaQuente()
  type ItemNF = { n_id_produto: number | null; c_descricao_produto: string | null; c_codigo_produto: string | null; n_qtde_nfe: number | null; n_preco_unit: number | null; fornecedor: string | null }
  // Só NF concluída (etapa 60) e não cancelada -- mesmo filtro da página
  // (pendencias-classificacao/page.tsx) e de Compras/Auditoria (migration 083).
  const { data: quentesRaw } = await supabase
    .from('nota_fiscal_items')
    .select('n_id_produto, c_descricao_produto, c_codigo_produto, n_qtde_nfe, n_preco_unit, notas_fiscais!inner(deleted_at, d_emissao_nfe, c_razao_social, c_nome, full_object)')
    .eq('loja_id', lojaId)
    .is('notas_fiscais.deleted_at', null)
    .eq('notas_fiscais.c_etapa', '60')
    .gte('notas_fiscais.d_emissao_nfe', corte)
    .lte('notas_fiscais.d_emissao_nfe', dataFimPendencias)
    .limit(50000)
```

E a linha seguinte `const corteExcl = ...` continua igual (usa `corte`, inalterado).

- [ ] **Step 4: Verificar tipos e build**

Run: `npx tsc --noEmit -p .` — esperado: sem erros.
Run: `npm run build` — esperado: build limpo.

- [ ] **Step 5: Teste manual**

`npm run dev`, abrir `/pendencias-classificacao` (sem filtro — deve mostrar exatamente os mesmos números de antes, 12 meses terminando hoje) e depois `/pendencias-classificacao?data_inicio=<hoje-2anos>&data_final=<hoje-1ano>` (período antigo) — confirmar que os números MUDAM (prova de que o filtro está sendo aplicado, não ignorado).

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/pendencias-classificacao/page.tsx" "app/(app)/pendencias-classificacao/export/route.ts" lib/pendencias-periodo.ts
git commit -m "feat: filtro de período em Pendências de Classificação"
```

---

## Task 8: Indicadores — filtro de local de estoque

**Files:**
- Modify: `app/(app)/relatorio-indicadores/page.tsx`
- Modify: `app/(app)/relatorio-indicadores/export/route.ts`

**Interfaces:**
- Consumes: RPC `relatorio_compras_matriz` (já aceita `p_local bigint`, migration 075/083 — sem mudança de SQL nesta task) e `filtrarItensCompras` de `lib/relatorio-frio-nf.ts` (já aceita `f.local: number | null`, sem mudança nesta task).

- [ ] **Step 1: `page.tsx` — adicionar o campo, ler o valor, propagar pra RPC e pro complemento frio**

Trocar a assinatura de `searchParams` (linha 40):

```ts
  searchParams: Promise<{ data_inicio?: string; data_final?: string; familia?: string; produto?: string }>
```

por:

```ts
  searchParams: Promise<{ data_inicio?: string; data_final?: string; familia?: string; produto?: string; local?: string }>
```

Trocar (linhas 56-66):

```ts
  const sp = await searchParams
  const filtroIni = /^\d{4}-\d{2}-\d{2}$/.test(sp.data_inicio ?? '') ? sp.data_inicio! : null
  const filtroFim = /^\d{4}-\d{2}-\d{2}$/.test(sp.data_final ?? '') ? sp.data_final! : null
  const familiasSel = valoresMulti(sp.familia)
  const produtoTermo = sp.produto?.trim() || null
  const filtroAtivo = !!(familiasSel.length || produtoTermo)

  const familiasOpcoes = await buscarFamilias()
  const campos: CampoFiltro[] = [
    { tipo: 'data', nome: 'data_inicio', label: 'Data inicial' },
    { tipo: 'data', nome: 'data_final', label: 'Data final' },
    { tipo: 'texto', nome: 'produto', label: 'Produto (nome)' },
    { tipo: 'multi-select', nome: 'familia', label: 'Família', opcoes: familiasOpcoes.map((f) => ({ value: f.descricao, label: f.descricao })) },
  ]
```

por:

```ts
  const sp = await searchParams
  const filtroIni = /^\d{4}-\d{2}-\d{2}$/.test(sp.data_inicio ?? '') ? sp.data_inicio! : null
  const filtroFim = /^\d{4}-\d{2}-\d{2}$/.test(sp.data_final ?? '') ? sp.data_final! : null
  const familiasSel = valoresMulti(sp.familia)
  const produtoTermo = sp.produto?.trim() || null
  const localCod = sp.local && !Number.isNaN(Number(sp.local)) ? Number(sp.local) : null
  const filtroAtivo = !!(familiasSel.length || produtoTermo || localCod !== null)

  const [familiasOpcoes, { data: locaisRaw }] = await Promise.all([
    buscarFamilias(),
    supabaseLoja
      .from('local_estoques')
      .select('codigo_local_estoque, descricao')
      .eq('loja_id', lojaId)
      .order('descricao'),
  ])
  const campos: CampoFiltro[] = [
    { tipo: 'data', nome: 'data_inicio', label: 'Data inicial' },
    { tipo: 'data', nome: 'data_final', label: 'Data final' },
    { tipo: 'texto', nome: 'produto', label: 'Produto (nome)' },
    { tipo: 'multi-select', nome: 'familia', label: 'Família', opcoes: familiasOpcoes.map((f) => ({ value: f.descricao, label: f.descricao })) },
    {
      tipo: 'select',
      nome: 'local',
      label: 'Local de estoque',
      opcoes: (locaisRaw ?? []).map((l) => ({ value: String(l.codigo_local_estoque), label: l.descricao ?? String(l.codigo_local_estoque) })),
    },
  ]
```

(`supabaseLoja` já existe no escopo da função, linha 45 — é o mesmo client usado pra ler `lojas` logo acima; reaproveitado aqui pra `local_estoques`.)

Trocar a chamada à RPC de Compras (linhas 133-137):

```ts
  const comp = await rpcTodos<LinhaMatriz>(supabase, 'relatorio_compras_matriz', {
    p_loja_id: lojaId, p_ini: compIniRpc, p_fim: compFim, p_dim: 'cfop',
    p_familias: familiasSel.length ? familiasSel : null,
    p_produto: produtoTermo,
  })
```

por:

```ts
  const comp = await rpcTodos<LinhaMatriz>(supabase, 'relatorio_compras_matriz', {
    p_loja_id: lojaId, p_ini: compIniRpc, p_fim: compFim, p_dim: 'cfop',
    p_familias: familiasSel.length ? familiasSel : null,
    p_produto: produtoTermo,
    p_local: localCod,
  })
```

Trocar a chamada a `filtrarItensCompras` no complemento frio (linhas 166-168):

```ts
    const filtrados = filtrarItensCompras(itensFrios, {
      familias: familiasSel, tipos: [], fornecedor: null, cfops: [], produto: produtoTermo, local: null,
    }, meta)
```

por:

```ts
    const filtrados = filtrarItensCompras(itensFrios, {
      familias: familiasSel, tipos: [], fornecedor: null, cfops: [], produto: produtoTermo, local: localCod,
    }, meta)
```

Trocar a montagem de `defaults` da gaveta (linha 227) e `exportHref` (linhas 209-212):

```ts
              defaults={{ data_inicio: sp.data_inicio ?? '', data_final: sp.data_final ?? '', produto: sp.produto ?? '', familia: sp.familia ?? '' }}
```

por:

```ts
              defaults={{ data_inicio: sp.data_inicio ?? '', data_final: sp.data_final ?? '', produto: sp.produto ?? '', familia: sp.familia ?? '', local: sp.local ?? '' }}
```

```ts
  const exportParams = new URLSearchParams()
  if (filtroIni) exportParams.set('data_inicio', filtroIni)
  if (filtroFim) exportParams.set('data_final', filtroFim)
  const exportHref = `/relatorio-indicadores/export${exportParams.toString() ? `?${exportParams.toString()}` : ''}`
```

por (o export original já não levava `produto`/`familia` — fora de escopo desta task consertar isso; só adiciona `local`, mesmo padrão do que já existia pra `data_inicio`/`data_final`):

```ts
  const exportParams = new URLSearchParams()
  if (filtroIni) exportParams.set('data_inicio', filtroIni)
  if (filtroFim) exportParams.set('data_final', filtroFim)
  if (localCod !== null) exportParams.set('local', String(localCod))
  const exportHref = `/relatorio-indicadores/export${exportParams.toString() ? `?${exportParams.toString()}` : ''}`
```

- [ ] **Step 2: `export/route.ts` — ler `local`, propagar pra RPC**

Trocar (linha 48-50):

```ts
  const compRows = await rpcTodos<Linha>(supabase, 'relatorio_compras_matriz', {
    p_loja_id: lojaId, p_ini: compIni, p_fim: compFim, p_dim: 'cfop',
  })
```

por:

```ts
  const localParam = searchParams.get('local')
  const localCod = localParam && !Number.isNaN(Number(localParam)) ? Number(localParam) : null
  const compRows = await rpcTodos<Linha>(supabase, 'relatorio_compras_matriz', {
    p_loja_id: lojaId, p_ini: compIni, p_fim: compFim, p_dim: 'cfop',
    p_local: localCod,
  })
```

- [ ] **Step 3: Verificar tipos e build**

Run: `npx tsc --noEmit -p .` — esperado: sem erros.
Run: `npm run build` — esperado: build limpo.

- [ ] **Step 4: Teste manual**

`npm run dev`, abrir `/relatorio-indicadores` sem filtro (anotar o total de Compras), depois aplicar um `local` específico na gaveta — o total de Compras deve DIMINUIR (ou ficar igual, se só existir 1 local ativo na loja de teste) e nunca aumentar.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/relatorio-indicadores/page.tsx" "app/(app)/relatorio-indicadores/export/route.ts"
git commit -m "feat: filtro de local de estoque em Indicadores"
```

---

## Task 9: Auditoria Fiscal — família vira multi-select

**Files:**
- Create: `supabase/migrations/088_auditoria_fiscal_familias_array.sql`
- Modify: `lib/relatorio-frio-nf.ts`
- Modify: `app/(app)/auditoria-fiscal/page.tsx`
- Modify: `app/(app)/auditoria-fiscal/export/route.ts`

**Interfaces:**
- Consumes: nenhuma interface de outra task.
- Produces: `FiltrosAuditoriaFrio.familias: string[]` (troca de `familia: string | null`) e `filtrarItensAuditoria` com a nova assinatura — consumido só dentro desta mesma task (nos 2 arquivos `.tsx`/`.ts` de Auditoria Fiscal).

- [ ] **Step 1: Criar a migration SQL**

```sql
-- supabase/migrations/088_auditoria_fiscal_familias_array.sql
-- Família em Auditoria Fiscal era select único (p_familia text); vira
-- multi-select (p_familias text[]), mesmo padrão já usado em
-- relatorio_compras_* desde a migration 083 (`= any(p_familias)`, sentinela
-- '__sem__' preservado). Corpo idêntico ao vigente (081/078), só a condição
-- de família muda de igualdade simples pra `= any(...)`.

drop function if exists relatorio_auditoria_fiscal_cfop(bigint, date, date, text, text, text, bigint);
drop function if exists relatorio_auditoria_fiscal_itens(bigint, date, date, text, text, text, text, text, bigint);

create or replace function relatorio_auditoria_fiscal_cfop(
  p_loja_id bigint, p_ini date, p_fim date,
  p_produto text default null, p_familias text[] default null,
  p_fornecedor text default null, p_local bigint default null
) returns table(
  cfop_doc text, cfop_entrada text, itens bigint, valor numeric,
  credita_icms bigint, move_estoque bigint, icms_creditado numeric
)
language sql stable as $$
  select
    coalesce(i.c_cfop, i.full_object->'itensCabec'->>'cCFOP') as cfop_doc,
    i.full_object->'itensAjustes'->>'cCFOPEntrada' as cfop_entrada,
    count(*)::bigint as itens,
    sum(coalesce(i.n_qtde_nfe, 0) * coalesce(i.n_preco_unit, 0))::numeric as valor,
    count(*) filter (
      where coalesce(i.full_object->'itensAjustes'->'itensSitTribEnt'->>'cNaoCredICMSE', 'N') <> 'S'
    )::bigint as credita_icms,
    count(*) filter (
      where coalesce(i.full_object->'itensAjustes'->>'cNaoGerarMovEstoque', 'N') <> 'S'
    )::bigint as move_estoque,
    sum(
      case when coalesce(i.full_object->'itensAjustes'->'itensSitTribEnt'->>'cNaoCredICMSE', 'N') <> 'S'
        then coalesce((i.full_object->'itensICMS'->>'nValor')::numeric, 0)
        else 0
      end
    )::numeric as icms_creditado
  from nota_fiscal_items i
  join notas_fiscais nf on nf.id = i.nota_fiscal_id and nf.loja_id = i.loja_id and nf.deleted_at is null
  left join produtos p on p.loja_id = i.loja_id and p.codigo_produto = i.n_id_produto
  where i.loja_id = p_loja_id
    and nf.d_emissao_nfe >= p_ini and nf.d_emissao_nfe <= p_fim
    and nf.c_etapa = '60'
    and coalesce(nf.full_object->'infoCadastro'->>'cCancelada', 'N') != 'S'
    and (p_produto is null or i.c_descricao_produto ilike '%' || p_produto || '%' or i.c_codigo_produto ilike '%' || p_produto || '%')
    and (p_familias is null
         or ('__sem__' = any(p_familias) and p.descricao_familia is null)
         or p.descricao_familia = any(p_familias))
    and (p_fornecedor is null
         or (p_fornecedor = '__sem__' and coalesce(nf.c_razao_social, nf.c_nome) is null)
         or coalesce(nf.c_razao_social, nf.c_nome) ilike '%' || p_fornecedor || '%')
    and (p_local is null or (i.full_object->'itensAjustes'->>'codigo_local_estoque')::bigint = p_local)
  group by 1, 2
  order by valor desc, cfop_doc, cfop_entrada;
$$;

create or replace function relatorio_auditoria_fiscal_itens(
  p_loja_id bigint, p_ini date, p_fim date,
  p_cfop_doc text default null, p_cfop_entrada text default null, p_fornecedor text default null,
  p_produto text default null, p_familias text[] default null, p_local bigint default null
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
    (coalesce(i.n_qtde_nfe, 0) * coalesce(i.n_preco_unit, 0))::numeric as valor,
    i.id as item_id
  from nota_fiscal_items i
  join notas_fiscais nf on nf.id = i.nota_fiscal_id and nf.loja_id = i.loja_id and nf.deleted_at is null
  left join produtos p on p.loja_id = i.loja_id and p.codigo_produto = i.n_id_produto
  where i.loja_id = p_loja_id
    and nf.d_emissao_nfe >= p_ini and nf.d_emissao_nfe <= p_fim
    and nf.c_etapa = '60'
    and coalesce(nf.full_object->'infoCadastro'->>'cCancelada', 'N') != 'S'
    and (p_cfop_doc is null or coalesce(i.c_cfop, i.full_object->'itensCabec'->>'cCFOP') = p_cfop_doc)
    and (p_cfop_entrada is null
         or (p_cfop_entrada = '__sem__' and (i.full_object->'itensAjustes'->>'cCFOPEntrada') is null)
         or i.full_object->'itensAjustes'->>'cCFOPEntrada' = p_cfop_entrada)
    and (p_fornecedor is null
         or (p_fornecedor = '__sem__' and coalesce(nf.c_razao_social, nf.c_nome) is null)
         or coalesce(nf.c_razao_social, nf.c_nome) ilike '%' || p_fornecedor || '%')
    and (p_produto is null or i.c_descricao_produto ilike '%' || p_produto || '%' or i.c_codigo_produto ilike '%' || p_produto || '%')
    and (p_familias is null
         or ('__sem__' = any(p_familias) and p.descricao_familia is null)
         or p.descricao_familia = any(p_familias))
    and (p_local is null or (i.full_object->'itensAjustes'->>'codigo_local_estoque')::bigint = p_local)
  order by nf.d_emissao_nfe desc, i.id;
$$;
```

- [ ] **Step 2: Aplicar a migration no Supabase**

Run: `npx supabase db push` (ou o comando já usado neste repo pra aplicar migrations — conferir `package.json`/histórico de commits anteriores desta sessão para o comando exato usado nas migrations 087/083 se `db push` não for o padrão local).
Expected: migration aplicada sem erro, `relatorio_auditoria_fiscal_cfop`/`relatorio_auditoria_fiscal_itens` agora aceitam `p_familias text[]`.

- [ ] **Step 3: `lib/relatorio-frio-nf.ts` — `FiltrosAuditoriaFrio` e `filtrarItensAuditoria`**

Trocar (linhas 270-300):

```ts
export type FiltrosAuditoriaFrio = {
  produto: string | null
  familia: string | null
  fornecedor: string | null
  local: number | null
}

/** Espelha o WHERE das relatorio_auditoria_fiscal_* (etapa 60, não cancelada). */
export function filtrarItensAuditoria(
  itens: ItemNFFrio[],
  f: FiltrosAuditoriaFrio,
  meta: MetaProdutoNF
): ItemNFFrio[] {
  return itens.filter((it) => {
    if (it.nf_c_etapa !== '60') return false
    if (it.nf_cancelada) return false
    if (f.produto && !ilike(it.c_descricao_produto, f.produto) && !ilike(it.c_codigo_produto, f.produto)) return false
    if (f.familia) {
      const m = it.n_id_produto != null ? meta.get(Number(it.n_id_produto)) : undefined
      const fam = m?.familia ?? null
      if (f.familia === SEM) { if (fam !== null) return false }
      else if (fam !== f.familia) return false
    }
    if (f.fornecedor) {
      if (f.fornecedor === SEM) { if (it.nf_fornecedor != null) return false }
      else if (!ilike(it.nf_fornecedor, f.fornecedor)) return false
    }
    if (f.local !== null && localDe(it) !== f.local) return false
    return true
  })
}
```

por:

```ts
export type FiltrosAuditoriaFrio = {
  produto: string | null
  familias: string[]
  fornecedor: string | null
  local: number | null
}

/** Espelha o WHERE das relatorio_auditoria_fiscal_* (etapa 60, não cancelada). */
export function filtrarItensAuditoria(
  itens: ItemNFFrio[],
  f: FiltrosAuditoriaFrio,
  meta: MetaProdutoNF
): ItemNFFrio[] {
  return itens.filter((it) => {
    if (it.nf_c_etapa !== '60') return false
    if (it.nf_cancelada) return false
    if (f.produto && !ilike(it.c_descricao_produto, f.produto) && !ilike(it.c_codigo_produto, f.produto)) return false
    if (f.familias.length) {
      const m = it.n_id_produto != null ? meta.get(Number(it.n_id_produto)) : undefined
      const fam = m?.familia ?? null
      const casa = (fam !== null && f.familias.includes(fam)) || (f.familias.includes(SEM) && fam === null)
      if (!casa) return false
    }
    if (f.fornecedor) {
      if (f.fornecedor === SEM) { if (it.nf_fornecedor != null) return false }
      else if (!ilike(it.nf_fornecedor, f.fornecedor)) return false
    }
    if (f.local !== null && localDe(it) !== f.local) return false
    return true
  })
}
```

- [ ] **Step 4: `app/(app)/auditoria-fiscal/page.tsx` — multi-select + array**

Trocar a assinatura de `searchParams` (linha 43):

```ts
  searchParams: Promise<{ data_inicio?: string; data_final?: string; cfop?: string; fornecedor?: string; produto?: string; familia?: string; local?: string; drill?: string }>
```

(sem mudança — `familia` continua como string única NA URL, formato `?familia=A,B,C` igual a todo multi-select do repo; a diferença é só como o valor é lido/usado dentro da função, via `valoresMulti`.)

Adicionar o import (junto de `import { valoresMulti } from '@/components/ui-kit/filtros-utils'` — hoje `filtros-utils` é importado só como `type CampoFiltro` na linha 11; trocar):

```ts
import type { CampoFiltro } from '@/components/ui-kit/Filtros'
```

por:

```ts
import type { CampoFiltro } from '@/components/ui-kit/Filtros'
import { valoresMulti } from '@/components/ui-kit/filtros-utils'
```

Trocar (linha 48, já existente, sem mudar `ini`/`fim`) e adicionar logo abaixo:

```ts
  const sp = await searchParams
  const hojeISO = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bahia' })
  const ini = /^\d{4}-\d{2}-\d{2}$/.test(sp.data_inicio ?? '') ? sp.data_inicio! : `${hojeISO.slice(0, 4)}-01-01`
  const fim = /^\d{4}-\d{2}-\d{2}$/.test(sp.data_final ?? '') ? sp.data_final! : hojeISO
  const familiasFiltro = valoresMulti(sp.familia)
```

Trocar a chamada à RPC de resumo (linhas 59-63):

```ts
  const { data: cfopRaw } = await supabase.rpc('relatorio_auditoria_fiscal_cfop', {
    p_loja_id: lojaId, p_ini: iniRpc, p_fim: fim,
    p_produto: sp.produto || null, p_familia: sp.familia || null,
    p_fornecedor: sp.fornecedor || null, p_local: localCod,
  })
```

por:

```ts
  const { data: cfopRaw } = await supabase.rpc('relatorio_auditoria_fiscal_cfop', {
    p_loja_id: lojaId, p_ini: iniRpc, p_fim: fim,
    p_produto: sp.produto || null, p_familias: familiasFiltro.length ? familiasFiltro : null,
    p_fornecedor: sp.fornecedor || null, p_local: localCod,
  })
```

Trocar a chamada a `filtrarItensAuditoria` do resumo (linhas 78-80):

```ts
    const filtrados = filtrarItensAuditoria(itensFrios, {
      produto: sp.produto || null, familia: sp.familia || null, fornecedor: sp.fornecedor || null, local: localCod,
    }, meta)
```

por:

```ts
    const filtrados = filtrarItensAuditoria(itensFrios, {
      produto: sp.produto || null, familias: familiasFiltro, fornecedor: sp.fornecedor || null, local: localCod,
    }, meta)
```

Trocar a chamada à RPC de itens/drill (linhas 124-129):

```ts
      .rpc('relatorio_auditoria_fiscal_itens', {
        p_loja_id: lojaId, p_ini: ini, p_fim: fim, p_cfop_doc: cfopDocSel, p_cfop_entrada: cfopEntSel || SEM,
        p_fornecedor: sp.fornecedor || null,
        p_produto: sp.produto || null, p_familia: sp.familia || null, p_local: localCod,
      })
```

por:

```ts
      .rpc('relatorio_auditoria_fiscal_itens', {
        p_loja_id: lojaId, p_ini: ini, p_fim: fim, p_cfop_doc: cfopDocSel, p_cfop_entrada: cfopEntSel || SEM,
        p_fornecedor: sp.fornecedor || null,
        p_produto: sp.produto || null, p_familias: familiasFiltro.length ? familiasFiltro : null, p_local: localCod,
      })
```

Trocar a chamada a `filtrarItensAuditoria` do drill (linhas 143-145):

```ts
      const filtrados = filtrarItensAuditoria(itensFrios, {
        produto: sp.produto || null, familia: sp.familia || null, fornecedor: sp.fornecedor || null, local: localCod,
      }, meta)
```

por:

```ts
      const filtrados = filtrarItensAuditoria(itensFrios, {
        produto: sp.produto || null, familias: familiasFiltro, fornecedor: sp.fornecedor || null, local: localCod,
      }, meta)
```

Trocar o campo `familia` na definição de `campos` (linha 166):

```ts
    { tipo: 'select', nome: 'familia', label: 'Família', opcoes: familiasOpcoes.map((f) => ({ value: f.descricao, label: f.descricao })) },
```

por:

```ts
    { tipo: 'multi-select', nome: 'familia', label: 'Família', opcoes: familiasOpcoes.map((f) => ({ value: f.descricao, label: f.descricao })) },
```

- [ ] **Step 5: `app/(app)/auditoria-fiscal/export/route.ts` — mesma troca**

Trocar (linha 21):

```ts
  const familia = searchParams.get('familia') || null
```

por:

```ts
  const familiasFiltro = (searchParams.get('familia') ?? '').split(',').map((v) => v.trim()).filter(Boolean)
```

Trocar a chamada à RPC (linha 28-30):

```ts
  const { data } = await supabase.rpc('relatorio_auditoria_fiscal_cfop', {
    p_loja_id: lojaId, p_ini: iniRpc, p_fim: fim, p_produto: produto, p_familia: familia, p_fornecedor: fornecedor, p_local: localCod,
  })
```

por:

```ts
  const { data } = await supabase.rpc('relatorio_auditoria_fiscal_cfop', {
    p_loja_id: lojaId, p_ini: iniRpc, p_fim: fim, p_produto: produto, p_familias: familiasFiltro.length ? familiasFiltro : null, p_fornecedor: fornecedor, p_local: localCod,
  })
```

Trocar a chamada a `filtrarItensAuditoria` (linha 54):

```ts
    const filtrados = filtrarItensAuditoria(itensFrios, { produto, familia, fornecedor, local: localCod }, meta)
```

por:

```ts
    const filtrados = filtrarItensAuditoria(itensFrios, { produto, familias: familiasFiltro, fornecedor, local: localCod }, meta)
```

Trocar a linha do subtítulo do Excel (linha 114) para refletir múltiplas famílias:

```ts
    subtitulo: `Período ${ini} a ${fim}${produto ? ` · Produto: ${produto}` : ''}${familia ? ` · Família: ${familia}` : ''}${fornecedor ? ` · Fornecedor: ${fornecedor}` : ''}${localCod !== null ? ` · Local: ${localCod}` : ''}`,
```

por:

```ts
    subtitulo: `Período ${ini} a ${fim}${produto ? ` · Produto: ${produto}` : ''}${familiasFiltro.length ? ` · Família: ${familiasFiltro.join(', ')}` : ''}${fornecedor ? ` · Fornecedor: ${fornecedor}` : ''}${localCod !== null ? ` · Local: ${localCod}` : ''}`,
```

- [ ] **Step 6: Verificar tipos e build**

Run: `npx tsc --noEmit -p .` — esperado: sem erros (nenhum outro arquivo do repo importa `FiltrosAuditoriaFrio`/`filtrarItensAuditoria` além destes 3 — conferir com `grep -rn "filtrarItensAuditoria\|FiltrosAuditoriaFrio" --include="*.ts" --include="*.tsx" .` antes do commit, pra garantir que nenhum outro consumidor ficou com a assinatura antiga).
Run: `npm run build` — esperado: build limpo.

- [ ] **Step 7: Teste manual de regressão numérica**

`npm run dev`. Escolher uma loja com pelo menos 2 famílias diferentes. Comparar:
1. `/auditoria-fiscal?familia=<Família A>` (valor total exibido: X)
2. `/auditoria-fiscal?familia=<Família B>` (valor total exibido: Y)
3. `/auditoria-fiscal?familia=<Família A>,<Família B>` (valor total exibido: deve ser exatamente X + Y — nenhuma dupla-contagem, nenhum item faltando)

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/088_auditoria_fiscal_familias_array.sql lib/relatorio-frio-nf.ts "app/(app)/auditoria-fiscal/page.tsx" "app/(app)/auditoria-fiscal/export/route.ts"
git commit -m "feat: família multi-select em Auditoria Fiscal (migration + frio + telas)"
```

---

## Validação final (whole-branch)

Depois de todas as 9 tasks, antes de merge/deploy:

1. `npx tsc --noEmit -p .` e `npm run build` limpos na branch inteira.
2. `grep -rn "familia: sp.familia\|f\.familia\b" lib/relatorio-frio-nf.ts "app/(app)/auditoria-fiscal"` — confirmar que não sobrou nenhum uso da forma singular antiga (`familia:` em vez de `familias:`) fora do que já foi trocado.
3. Visitar as 8 telas modificadas (Compras, Movimentação nos 2 modos, Auditoria Fiscal, Indicadores, Ordens de Produção, Transferências, Notas Fiscais, Pendências de Classificação) e clicar em cada chip novo — confirmar visualmente que o filtro muda os dados exibidos e o chip clicado fica destacado.
4. Deploy manual: SSH (`ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240`), `cd /opt/ntb-estoque && bash deploy.sh` (rodar via `run_in_background: true`).
