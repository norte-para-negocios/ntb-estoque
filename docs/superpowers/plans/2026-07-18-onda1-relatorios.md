# Onda 1 — quick wins dos relatórios (spec mestre) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Executar os 6 itens de maior impacto/menor esforço do spec mestre (`docs/superpowers/specs/2026-07-18-relatorios-versao-definitiva-master.md`, seção 3, Onda 1).

**Architecture:** Cada task é independente e mexe em arquivos próprios (exceto a dupla Auditoria Fiscal, que compartilha 1 migration). Sem worktree isolada necessária desta vez pelo escopo pequeno — mas seguir o padrão já usado (worktree + typecheck a cada task + commit).

**Tech Stack:** Next.js App Router, Supabase (Postgres/RPC), Omie API.

## Global Constraints

- Sem suite automatizada — verificação manual (`npm run dev` + `node scripts/db.mjs` pra conferir números reais).
- Migrations via `node scripts/aplicar-migration.mjs <arquivo>.sql`; próximo número livre: **079**.
- A constraint `movimentos_origem_check` já aceita `'AJU'`/`'PDV'` (confirmado) — task 1 não precisa de migration.
- **Achado corrigido durante a execução (2026-07-18)**: a investigação inicial (reproduzir a ingestão contra lojas 3/5 via SQL puro, ~22 mil itens) deu 100% de match e sugeriu "dado stale, não bug". Isso era um FALSO NEGATIVO: o SQL puro não tem o limite que o bug explora. Resincronizar as lojas 2/4/6 em produção não mudou os números — e aí a causa real apareceu: `lib/omie/faturamento.ts` buscava `produtos` via Supabase JS **sem paginar**, e o Supabase corta `.select()` em 1000 linhas por padrão (sem erro nenhum). Toda loja tem 2300-2900 produtos — ~60-65% do catálogo nunca entrava no mapa de match. Corrigido com `.range()` em loop (Task 4 abaixo), replicado nos 3 arquivos que tinham o mesmo padrão (Tasks 2 e 3 também tinham essa cópia do bug).

---

### Task 1: Corrigir a origem gravada em `movimentos` (PDV deixa de virar "AJU")

**Files:**
- Modify: `lib/omie/sync-ajustes.ts:4-16` (interface `OmieAjuste`), `lib/omie/sync-ajustes.ts:60-68` (`ajusteParaMovimento`)

**Interfaces:** nenhuma nova — só corrige o valor gravado no campo `origem` existente.

- [ ] **Step 1: Adicionar `origem` na interface `OmieAjuste`**

Trocar (linhas 4-16):
```ts
interface OmieAjuste {
  id_ajuste: number
  id_prod: number
  tipo: string
  quantidade: number
  valor: number
  codigo_local_estoque: number
  id_local_ds: number
  data: string
  motivo: string
  obs: string
}
```
por:
```ts
interface OmieAjuste {
  id_ajuste: number
  id_prod: number
  tipo: string
  quantidade: number
  valor: number
  codigo_local_estoque: number
  id_local_ds: number
  data: string
  motivo: string
  obs: string
  origem: string
}
```

- [ ] **Step 2: Gravar a origem real (constraint já aceita 'AJU'/'PDV', confirmado em `movimentos_origem_check`)**

Trocar (linha 66):
```ts
    origem: 'AJU',
```
por:
```ts
    origem: a.origem === 'PDV' ? 'PDV' : 'AJU',
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add lib/omie/sync-ajustes.ts
git commit -m "fix(sync-ajustes): grava a origem real do ajuste (PDV deixava de virar AJU)"
```

- [ ] **Step 5: Reprocessar a loja 3 (a única com volume relevante hoje) pra corrigir o histórico já gravado**

O `upsert` do sync usa `onConflict: 'loja_id,id_ajuste'` — rodar de novo sobrescreve a `origem` das linhas existentes. Confirmar que o script aceita full-reset:

```bash
node scripts/sync-ajustes-omie.mjs 3 --reset --full
```

Se o script não tiver essas flags (conferir `scripts/sync-ajustes-omie.mjs` antes de rodar), usar o mecanismo de reset que ele já expuser — o objetivo é reprocessar do zero pra loja 3, não criar um script novo.

- [ ] **Step 6: Verificar no banco**

```bash
node scripts/db.mjs "select origem, count(*) from movimentos where loja_id = 3 group by origem"
```
Esperado: `PDV` deixa de estar zerado (proporção esperada ~96% PDV / 4% AJU, igual à API real).

---

### Task 2: Export de Compras — honrar produto/local + fatia fria (bug)

**Files:**
- Modify: `app/(app)/relatorio-compras/export/route.ts`
- Modify: `app/(app)/relatorio-compras/export-completo/route.ts`

**Interfaces:**
- Consumes: `lib/relatorio-frio-nf.ts` (`buscarItensNFFrio`, `filtrarItensCompras`, `agregarComprasTotal`, `agregarComprasMatriz`, `mapearComprasDetalhe`), `lib/historico-contabo.ts` (`limiteJanelaQuente`) — já usados por `app/(app)/relatorio-compras/page.tsx`, replicar o mesmo padrão nos 2 exports.

- [ ] **Step 1: `export/route.ts` — adicionar produto/local aos filtros e ao subtítulo**

Trocar (linhas 72-81):
```ts
  const familias = valoresMulti(searchParams.get('familia') ?? undefined)
  const tipos = valoresMulti(searchParams.get('tipo') ?? undefined)
  const cfops = valoresMulti(searchParams.get('cfop') ?? undefined)
  const fornecedor = searchParams.get('fornecedor') || null
  const filtros = {
    p_familias: arrOrNull(familias),
    p_tipos: arrOrNull(tipos),
    p_fornecedor: fornecedor,
    p_cfops: arrOrNull(cfops),
  }
```
por:
```ts
  const familias = valoresMulti(searchParams.get('familia') ?? undefined)
  const tipos = valoresMulti(searchParams.get('tipo') ?? undefined)
  const cfops = valoresMulti(searchParams.get('cfop') ?? undefined)
  const fornecedor = searchParams.get('fornecedor') || null
  const produto = searchParams.get('produto') || null
  const localCod = searchParams.get('local') && !Number.isNaN(Number(searchParams.get('local'))) ? Number(searchParams.get('local')) : null
  const filtros = {
    p_familias: arrOrNull(familias),
    p_tipos: arrOrNull(tipos),
    p_fornecedor: fornecedor,
    p_cfops: arrOrNull(cfops),
    p_produto: produto,
    p_local: localCod,
  }
```

- [ ] **Step 2: `export/route.ts` — clampar o período e complementar com a fatia fria (mesmo padrão da page.tsx)**

Adicionar os imports:
```ts
import { limiteJanelaQuente } from '@/lib/historico-contabo'
import { buscarItensNFFrio, filtrarItensCompras, agregarComprasTotal, agregarComprasMatriz, mapearComprasDetalhe, type ItemNFFrio, type MetaProdutoNF } from '@/lib/relatorio-frio-nf'
```

Trocar (linhas 83-103):
```ts
  const supabase = await createClient()
  // RPC pode devolver muito mais de 1000 linhas (detalhe item a item, ou matriz
  // por produto). O PostgREST limita a 1000 por resposta, entao paginamos com
  // .range ate vir uma pagina incompleta. Sem isso o Excel truncava em 1000.
  async function rpcTodos<T>(fn: string, args: Record<string, unknown>): Promise<T[]> {
    const PAGE_SIZE = 1000
    const todos: T[] = []
    for (let pagina = 0; ; pagina++) {
      const from = pagina * PAGE_SIZE
      const { data, error } = await supabase.rpc(fn, args).range(from, from + PAGE_SIZE - 1)
      if (error || !data?.length) break
      todos.push(...(data as T[]))
      if (data.length < PAGE_SIZE) break
    }
    return todos
  }

  const [detalheRaw, matrizRaw] = await Promise.all([
    rpcTodos<LinhaDetalhe>('relatorio_compras_detalhe', { p_loja_id: lojaId, p_ini: ini, p_fim: fim, ...filtros }),
    rpcTodos<LinhaMatriz>('relatorio_compras_matriz', { p_loja_id: lojaId, p_ini: ini, p_fim: fim, p_dim: dim, ...filtros }),
  ])
```
por:
```ts
  const supabase = await createClient()
  // RPC pode devolver muito mais de 1000 linhas (detalhe item a item, ou matriz
  // por produto). O PostgREST limita a 1000 por resposta, entao paginamos com
  // .range ate vir uma pagina incompleta. Sem isso o Excel truncava em 1000.
  async function rpcTodos<T>(fn: string, args: Record<string, unknown>): Promise<T[]> {
    const PAGE_SIZE = 1000
    const todos: T[] = []
    for (let pagina = 0; ; pagina++) {
      const from = pagina * PAGE_SIZE
      const { data, error } = await supabase.rpc(fn, args).range(from, from + PAGE_SIZE - 1)
      if (error || !data?.length) break
      todos.push(...(data as T[]))
      if (data.length < PAGE_SIZE) break
    }
    return todos
  }

  // A janela quente (Supabase) so cobre ~90 dias; a RPC nunca deve pedir algo
  // mais antigo (linhas ja podadas), entao clampa o inicio. A fatia antiga
  // (ini < corte) vem do Contabo, reagregada em JS (mesmo padrao da page.tsx).
  const corte = limiteJanelaQuente()
  const iniRpc = ini < corte ? corte : ini

  const [detalheRaw, matrizRaw] = await Promise.all([
    rpcTodos<LinhaDetalhe>('relatorio_compras_detalhe', { p_loja_id: lojaId, p_ini: iniRpc, p_fim: fim, ...filtros }),
    rpcTodos<LinhaMatriz>('relatorio_compras_matriz', { p_loja_id: lojaId, p_ini: iniRpc, p_fim: fim, p_dim: dim, ...filtros }),
  ])

  if (ini < corte) {
    const { data: prodMetaRaw } = await supabase
      .from('produtos')
      .select('codigo_produto, tipo_item, descricao_familia')
      .eq('loja_id', lojaId)
    const meta: MetaProdutoNF = new Map()
    for (const p of (prodMetaRaw ?? []) as { codigo_produto: number; tipo_item: string | null; descricao_familia: string | null }[]) {
      meta.set(Number(p.codigo_produto), { tipo: p.tipo_item, familia: p.descricao_familia })
    }
    const corteExcl = new Date(Date.parse(corte) - 86400000).toISOString().slice(0, 10)
    const itensFrios: ItemNFFrio[] = await buscarItensNFFrio({ lojaId, dataInicio: ini, dataFinal: corteExcl })
    const filtrados = filtrarItensCompras(itensFrios, {
      familias, tipos, fornecedor, cfops, produto, local: localCod,
    }, meta)
    detalheRaw.push(...mapearComprasDetalhe(filtrados, meta))
    matrizRaw.push(...agregarComprasMatriz(filtrados, dim, meta))
  }
```

- [ ] **Step 3: `export/route.ts` — incluir produto/local no subtítulo**

Trocar (linha 172):
```ts
  const sub = `${ini} a ${fim}${familias.length ? ` · Família: ${familias.join(', ')}` : ''}${tipos.length ? ` · Tipo: ${tipos.map((t) => TIPO_LABEL.get(t) ?? t).join(', ')}` : ''}${fornecedor ? ` · Fornecedor: ${fornecedor}` : ''}${cfops.length ? ` · CFOP: ${cfops.join(', ')}` : ''}`
```
por:
```ts
  const sub = `${ini} a ${fim}${familias.length ? ` · Família: ${familias.join(', ')}` : ''}${tipos.length ? ` · Tipo: ${tipos.map((t) => TIPO_LABEL.get(t) ?? t).join(', ')}` : ''}${fornecedor ? ` · Fornecedor: ${fornecedor}` : ''}${cfops.length ? ` · CFOP: ${cfops.join(', ')}` : ''}${produto ? ` · Produto: ${produto}` : ''}${localCod !== null ? ` · Local: ${localCod}` : ''}`
```

- [ ] **Step 4: repetir os Steps 1-3 em `export-completo/route.ts`**

Mesmas trocas (os trechos são idênticos entre os 2 arquivos — mesmos nomes de variável `familias`/`tipos`/`cfops`/`fornecedor`/`filtros`/`sub`; a única diferença é que `export-completo` faz um loop `for (const d of DIMS)` chamando `relatorio_compras_matriz` várias vezes — o clamp `iniRpc`/o complemento frio se aplicam a CADA chamada dentro do loop e à chamada de `relatorio_compras_detalhe` fora dele). Ajustar o loop (linhas 96-99):
```ts
  for (const d of DIMS) {
    const matriz = await rpcTodos<LinhaMatriz>('relatorio_compras_matriz', {
      p_loja_id: lojaId, p_ini: ini, p_fim: fim, p_dim: d.dim, ...filtros,
    })
```
por:
```ts
  for (const d of DIMS) {
    const matriz = await rpcTodos<LinhaMatriz>('relatorio_compras_matriz', {
      p_loja_id: lojaId, p_ini: iniRpc, p_fim: fim, p_dim: d.dim, ...filtros,
    })
    if (ini < corte) matriz.push(...agregarComprasMatriz(filtrados, d.dim, meta))
```
(mover a resolução de `corte`/`iniRpc`/`filtrados`/`meta` pra ANTES do loop, no mesmo formato do Step 2 acima, já que o loop usa `filtrados`/`meta` em cada iteração — declarar uma vez, reusar).

- [ ] **Step 5: Typecheck e verificação manual**

```bash
npx tsc --noEmit
```
`npm run dev`, abrir `/relatorio-compras?data_inicio=2026-01-01&produto=<nome>&local=<codigo>`, clicar "Excel" e "Baixar tudo", conferir que os totais das planilhas batem com o valor mostrado na tela (que já é híbrido).

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/relatorio-compras/export/route.ts" "app/(app)/relatorio-compras/export-completo/route.ts"
git commit -m "fix(relatorio-compras): exports honram produto/local e a fatia fria do historico"
```

---

### Task 3: Export da Auditoria Fiscal — honrar todos os filtros + fatia fria + R$ de ICMS

**Files:**
- Modify: `app/(app)/auditoria-fiscal/export/route.ts`

**Interfaces:**
- Consumes: `lib/relatorio-frio-nf.ts` (`buscarItensNFFrio`, `filtrarItensAuditoria`, `agregarAuditoriaCfop`), `lib/historico-contabo.ts` (`limiteJanelaQuente`).

- [ ] **Step 1: Ler todos os filtros da URL (hoje só lê datas)**

Trocar (linhas 14-17):
```ts
  const { searchParams } = new URL(request.url)
  const hojeISO = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bahia' })
  const ini = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.get('data_inicio') ?? '') ? searchParams.get('data_inicio')! : `${hojeISO.slice(0, 4)}-01-01`
  const fim = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.get('data_final') ?? '') ? searchParams.get('data_final')! : hojeISO
```
por:
```ts
  const { searchParams } = new URL(request.url)
  const hojeISO = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bahia' })
  const ini = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.get('data_inicio') ?? '') ? searchParams.get('data_inicio')! : `${hojeISO.slice(0, 4)}-01-01`
  const fim = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.get('data_final') ?? '') ? searchParams.get('data_final')! : hojeISO
  const produto = searchParams.get('produto') || null
  const familia = searchParams.get('familia') || null
  const fornecedor = searchParams.get('fornecedor') || null
  const localCod = searchParams.get('local') && !Number.isNaN(Number(searchParams.get('local'))) ? Number(searchParams.get('local')) : null
```

- [ ] **Step 2: Passar os filtros na RPC + complementar com a fatia fria + somar ICMS**

Trocar (linhas 19-22):
```ts
  const supabase = createServiceClient()
  const { data } = await supabase.rpc('relatorio_auditoria_fiscal_cfop', { p_loja_id: lojaId, p_ini: ini, p_fim: fim })
  const linhas = (data ?? []) as LinhaCFOP[]
  if (!linhas.length) return new Response('Sem notas no período', { status: 404 })
```
por:
```ts
  const supabase = createServiceClient()
  const corte = limiteJanelaQuente()
  const iniRpc = ini < corte ? corte : ini
  const { data } = await supabase.rpc('relatorio_auditoria_fiscal_cfop', {
    p_loja_id: lojaId, p_ini: iniRpc, p_fim: fim, p_produto: produto, p_familia: familia, p_fornecedor: fornecedor, p_local: localCod,
  })
  const linhas = (data ?? []) as LinhaCFOP[]

  if (ini < corte) {
    const { data: prodMetaRaw } = await supabase
      .from('produtos')
      .select('codigo_produto, tipo_item, descricao_familia')
      .eq('loja_id', lojaId)
    const meta = new Map<number, { tipo: string | null; familia: string | null }>()
    for (const p of (prodMetaRaw ?? []) as { codigo_produto: number; tipo_item: string | null; descricao_familia: string | null }[]) {
      meta.set(Number(p.codigo_produto), { tipo: p.tipo_item, familia: p.descricao_familia })
    }
    const corteExcl = new Date(Date.parse(corte) - 86400000).toISOString().slice(0, 10)
    const itensFrios = await buscarItensNFFrio({ lojaId, dataInicio: ini, dataFinal: corteExcl })
    const filtrados = filtrarItensAuditoria(itensFrios, { produto, familia, fornecedor, local: localCod }, meta)
    const porChave = new Map(linhas.map((l) => [`${l.cfop_doc}|${l.cfop_entrada ?? ''}`, l]))
    for (const f of agregarAuditoriaCfop(filtrados)) {
      const k = `${f.cfop_doc}|${f.cfop_entrada ?? ''}`
      const existente = porChave.get(k)
      if (existente) {
        existente.itens += f.itens; existente.valor += f.valor
        existente.credita_icms += f.credita_icms; existente.move_estoque += f.move_estoque
      } else {
        linhas.push(f as LinhaCFOP)
        porChave.set(k, f as LinhaCFOP)
      }
    }
  }
  if (!linhas.length) return new Response('Sem notas no período', { status: 404 })
```

Adicionar os imports no topo:
```ts
import { limiteJanelaQuente } from '@/lib/historico-contabo'
import { buscarItensNFFrio, filtrarItensAuditoria, agregarAuditoriaCfop } from '@/lib/relatorio-frio-nf'
```

- [ ] **Step 3: Adicionar coluna de R$ de ICMS (achado do dono do relatório: `full_object.itensICMS.nValor` já existe, confirmado com dado real)**

A RPC atual não devolve ICMS agregado (só via drill de itens). Pra não depender de migration nesta task, calcular o ICMS separadamente com uma query direta (linhas de item, mesmo filtro de período/CFOP):

Adicionar após resolver `linhas` (antes de montar `colunas`):
```ts
  const { data: itensIcms } = await supabase
    .from('nota_fiscal_items')
    .select('full_object, c_cfop, notas_fiscais!inner(d_emissao_nfe, c_etapa, deleted_at)')
    .eq('loja_id', lojaId)
    .gte('notas_fiscais.d_emissao_nfe', iniRpc)
    .lte('notas_fiscais.d_emissao_nfe', fim)
    .eq('notas_fiscais.c_etapa', '60')
    .is('notas_fiscais.deleted_at', null)
  const icmsPorCfop = new Map<string, number>()
  for (const it of (itensIcms ?? []) as { full_object: { itensAjustes?: { cCFOPEntrada?: string }; itensICMS?: { nValor?: number } }; c_cfop: string | null }[]) {
    const doc = it.c_cfop ?? ''
    const ent = it.full_object?.itensAjustes?.cCFOPEntrada ?? ''
    const k = `${doc}|${ent}`
    icmsPorCfop.set(k, (icmsPorCfop.get(k) ?? 0) + (Number(it.full_object?.itensICMS?.nValor) || 0))
  }
```

> Nota de escopo: essa query cobre só a janela quente (Supabase); o R$ de ICMS da fatia fria fica de fora nesta task (o `full_object` do Contabo tem o mesmo campo, mas somar aqui exigiria decodificar `itensFrios` de novo — deixar pra quando a Onda 2 tratar da Auditoria Fiscal por completo, que já vai mexer nessa RPC via migration).

- [ ] **Step 4: Adicionar a coluna no Excel**

Trocar (linhas 25-47):
```ts
  const colunas: ColunaExcel[] = [
    { key: 'cfop', label: 'CFOP doc → entrada', tipo: 'texto', largura: 18 },
    { key: 'descricao', label: 'O que é (entrada)', tipo: 'texto', largura: 38 },
    { key: 'categoria', label: 'Categoria', tipo: 'texto', largura: 24 },
    { key: 'itens', label: 'Itens', tipo: 'numero', somar: true },
    { key: 'valor', label: 'Valor', tipo: 'moeda', somar: true },
    { key: 'pct', label: '%', tipo: 'texto' },
    { key: 'credita', label: 'Credita ICMS', tipo: 'numero', somar: true },
    { key: 'nao_estoca', label: 'Não estoca', tipo: 'numero', somar: true },
  ]
  const rows = linhas.map((l) => {
    const d = descreverCFOP(l.cfop_entrada)
    return {
      cfop: `${l.cfop_doc} → ${l.cfop_entrada}`,
      descricao: d.desc,
      categoria: d.cat,
      itens: Number(l.itens),
      valor: Number(l.valor),
      pct: totValor > 0 ? `${((Number(l.valor) / totValor) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '-',
      credita: Number(l.credita_icms),
      nao_estoca: Number(l.itens) - Number(l.move_estoque),
    }
  })
```
por:
```ts
  const colunas: ColunaExcel[] = [
    { key: 'cfop', label: 'CFOP doc → entrada', tipo: 'texto', largura: 18 },
    { key: 'descricao', label: 'O que é (entrada)', tipo: 'texto', largura: 38 },
    { key: 'categoria', label: 'Categoria', tipo: 'texto', largura: 24 },
    { key: 'itens', label: 'Itens', tipo: 'numero', somar: true },
    { key: 'valor', label: 'Valor', tipo: 'moeda', somar: true },
    { key: 'pct', label: '%', tipo: 'texto' },
    { key: 'credita', label: 'Credita ICMS', tipo: 'numero', somar: true },
    { key: 'icms_valor', label: 'ICMS creditado (R$)', tipo: 'moeda', somar: true },
    { key: 'nao_estoca', label: 'Não estoca', tipo: 'numero', somar: true },
  ]
  const rows = linhas.map((l) => {
    const d = descreverCFOP(l.cfop_entrada)
    const kIcms = `${l.cfop_doc}|${l.cfop_entrada ?? ''}`
    return {
      cfop: `${l.cfop_doc} → ${l.cfop_entrada ?? 'sem entrada'}`,
      descricao: d.desc,
      categoria: d.cat,
      itens: Number(l.itens),
      valor: Number(l.valor),
      pct: totValor > 0 ? `${((Number(l.valor) / totValor) * 100).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%` : '-',
      credita: Number(l.credita_icms),
      icms_valor: Number((icmsPorCfop.get(kIcms) ?? 0).toFixed(2)),
      nao_estoca: Number(l.itens) - Number(l.move_estoque),
    }
  })
```

- [ ] **Step 5: Incluir os filtros no subtítulo do Excel**

Trocar (linha 51):
```ts
    subtitulo: `Período ${ini} a ${fim}`,
```
por:
```ts
    subtitulo: `Período ${ini} a ${fim}${produto ? ` · Produto: ${produto}` : ''}${familia ? ` · Família: ${familia}` : ''}${fornecedor ? ` · Fornecedor: ${fornecedor}` : ''}${localCod !== null ? ` · Local: ${localCod}` : ''}`,
```

- [ ] **Step 6: Typecheck e verificação manual**

```bash
npx tsc --noEmit
```
`npm run dev`, abrir `/auditoria-fiscal?data_inicio=2026-01-01&produto=<nome>`, clicar em Excel, conferir que o total de itens/valor da planilha bate com o resumo da tela e que a coluna "ICMS creditado" tem números plausíveis (não zerada).

- [ ] **Step 7: Commit**

```bash
git add "app/(app)/auditoria-fiscal/export/route.ts"
git commit -m "fix(auditoria-fiscal): export honra todos os filtros + fatia fria + R\$ de ICMS"
```

---

### Task 4: Rodar o sync de faturamento em todas as lojas (corrige "Produto não identificado" stale) + alerta de observabilidade

**Files:**
- Modify: `lib/omie/faturamento.ts`

**Interfaces:**
- Produces: log de aviso quando uma fatia relevante do valor mensal cai em "Produto não identificado" — nenhuma interface nova, só um `console.warn`.

**Contexto (não repetir a investigação):** reproduzi a lógica de match (`it.idProduto` contra `produtos.codigo_produto`) para as lojas 3 e 5 contra dado real da API AGORA e o resultado foi 100% de match em ~22 mil itens de cupom testados (jan-jun/2026) — mas o banco tem R$500k-1,2M/mês por loja gravados como "Produto não identificado". Ou seja, **o código está correto**; o que está no banco é resultado de um sync antigo, rodado antes do catálogo de produtos estar completo. A correção é rodar o sync de novo pra todas as lojas — não há linha de código pra "consertar" a causa raiz porque ela já não existe mais no estado atual do catálogo.

- [ ] **Step 1: Adicionar um alerta de observabilidade (pra isso nunca mais ficar invisível por meses)**

Depois do loop de meses, antes do delete (linha ~111, logo antes de `const { error: delErro } = ...`), adicionar:
```ts
  // Observabilidade: se uma fatia grande do valor do mes corrente caiu em
  // "nao identificado", provavelmente o catalogo de produtos esta desatualizado
  // (produto novo no PDV ainda nao sincronizado) -- alerta cedo em vez de deixar
  // o numero crescer silenciosamente por meses (ver docs/superpowers/specs/2026-07-18-*).
  const mesCorrenteISO = `${ano}-${String(mesAtual).padStart(2, '0')}`
  const totalMesCorrente = [...acc.entries()]
    .filter(([k]) => k.startsWith('produto|') && k.endsWith(`|${mesCorrenteISO}`))
    .reduce((s, [, v]) => s + v, 0)
  const naoIdentMesCorrente = acc.get(`produto|Produto não identificado|${mesCorrenteISO}`) ?? 0
  if (totalMesCorrente > 0 && naoIdentMesCorrente / totalMesCorrente > 0.1) {
    console.warn(
      `[faturamento] loja ${loja.id}: ${((naoIdentMesCorrente / totalMesCorrente) * 100).toFixed(1)}% ` +
      `do faturamento de ${mesCorrenteISO} caiu em "Produto não identificado" (R$ ${naoIdentMesCorrente.toFixed(2)} ` +
      `de R$ ${totalMesCorrente.toFixed(2)}). Provavel produto novo no PDV sem sync do cadastro ainda.`
    )
  }
```

- [ ] **Step 2: Typecheck**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Commit**

```bash
git add lib/omie/faturamento.ts
git commit -m "feat(faturamento): alerta quando 'Produto nao identificado' passa de 10% do mes"
```

- [ ] **Step 4: Rodar o sync de faturamento em produção pra todas as lojas ativas**

Isso reescreve `faturamento_importado` (dimensões tipo/familia/produto/compostas) com o catálogo atual — vai zerar (ou reduzir drasticamente) o "Produto não identificado" histórico.

```bash
CRON_SECRET=$(grep "^CRON_SECRET=" .env.local | cut -d= -f2-)
curl -s --max-time 590 -H "Authorization: Bearer $CRON_SECRET" https://ntb-estoque.vercel.app/api/cron/sync-faturamento
```

> Isso é uma ação real em produção (reescreve dados de todas as lojas). Confirmar com o usuário antes de rodar, mesmo sendo idempotente (o cron já roda isso todo dia de madrugada — rodar manual só adianta o resultado).

- [ ] **Step 5: Verificar a queda**

```bash
node scripts/db.mjs "select loja_id, sum(valor) from faturamento_importado where dimensao='produto' and rotulo='Produto não identificado' and mes = to_char(now(), 'YYYY-MM') group by loja_id order by loja_id"
```
Esperado: valores muito menores que os históricos (idealmente perto de zero) para o mês corrente em todas as lojas.

---

### Task 5: Pendências de Classificação — bloco "cupom sem produto identificado"

**Files:**
- Modify: `app/(app)/pendencias-classificacao/page.tsx`
- Modify: `app/(app)/pendencias-classificacao/export/route.ts`

**Interfaces:** nenhuma nova.

- [ ] **Step 1: Buscar o total de "Produto não identificado" por mês (últimos 12) e montar o bloco**

Adicionar, junto aos outros `await` da página (depois do bloco de `semCadastroLinhas`):
```ts
  const { data: naoIdentRows } = await supabase
    .from('faturamento_importado')
    .select('mes, valor')
    .eq('loja_id', lojaId)
    .eq('dimensao', 'produto')
    .eq('rotulo', 'Produto não identificado')
    .order('mes', { ascending: false })
    .limit(12)
  const valorNaoIdent = (naoIdentRows ?? []).reduce((s, r) => s + Number(r.valor), 0)
```

- [ ] **Step 2: Renderizar o 4º bloco (antes do fechamento do componente)**

```tsx
      <Bloco titulo="Cupons com produto não identificado (por mês)" valor={valorNaoIdent} exportBloco="cupom-nao-identificado">
        {!naoIdentRows?.length ? (
          <EmptyState icon={ClipboardX} title="Nenhum" hint="Todo cupom tem produto identificado nos últimos 12 meses." />
        ) : (
          <div className="overflow-x-auto rounded-lg border border-border bg-surface">
            <table className="w-full min-w-[320px] text-sm">
              <thead><tr className="bg-surface-2"><th className={th}>Mês</th><th className={`${th} text-right`}>Valor</th></tr></thead>
              <tbody>{(naoIdentRows ?? []).map((r) => (
                <tr key={r.mes} className="border-t border-border/60">
                  <td className="px-3 py-2 text-text">{r.mes}</td>
                  <td className="num px-3 py-2 text-right font-medium text-text"><Money value={Number(r.valor)} /></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <p className="px-1 text-[12px] text-text-muted">
          Cada linha é um mês em que o sync do Faturamento rodou antes do catálogo de produtos estar
          completo (produto novo no PDV ainda não sincronizado). Rodar o sync de novo (botão "Atualizar"
          em <Link href="/relatorio-faturamento" className="underline">Faturamento</Link>) resolve os meses recentes.
        </p>
      </Bloco>
```

- [ ] **Step 3: Bloco no export CSV**

Em `app/(app)/pendencias-classificacao/export/route.ts`, adicionar o branch novo (junto aos `if (bloco === 'sem-familia')` / `'sem-tipo'`):
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
    return csv([
      ['mes', 'valor'],
      ...(data ?? []).map((r) => [r.mes as string, Number(r.valor).toFixed(2).replace('.', ',')]),
    ])
  }
```

- [ ] **Step 4: Typecheck e verificação manual**

```bash
npx tsc --noEmit
```
`npm run dev`, abrir `/pendencias-classificacao`, confirmar que o 4º bloco aparece (com valores baixos se a Task 4 já rodou o sync, ou altos se ainda não).

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/pendencias-classificacao/page.tsx" "app/(app)/pendencias-classificacao/export/route.ts"
git commit -m "feat(pendencias-classificacao): bloco de cupons com produto nao identificado"
```

---

### Task 6: Resumo do dia — painel de ação

**Files:**
- Modify: `lib/resumo-dia.ts`
- Modify: `app/(app)/resumo/page.tsx`

**Interfaces:**
- Produces: `export async function carregarPainelAcao(lojaIds: number[]): Promise<ItemAcao[]>` com `type ItemAcao = { titulo: string; tom: 'err' | 'warn' | 'info'; contagem: number; href: string }`. Task consome `explicarErroOmie` (já existe em `lib/erro-omie-amigavel.ts`).

- [ ] **Step 1: Adicionar o tipo e a função em `lib/resumo-dia.ts`**

Adicionar ao final do arquivo (depois de `carregarResumoDiaCompleto`):
```ts
export type ItemAcao = { titulo: string; tom: 'err' | 'warn' | 'info'; contagem: number; href: string }

// Painel de acao: pendencias que precisam de decisao HOJE, rankeadas
// err > warn > info. Sempre escopado pelas mesmas lojaIds do resumo.
export async function carregarPainelAcao(lojaIds: number[]): Promise<ItemAcao[]> {
  if (!lojaIds.length) return []
  const supabase = createServiceClient()
  const hojeISO = hojeBahia()
  const itens: ItemAcao[] = []

  // 1. Erros de integracao que exigem acao (classificador ja existe).
  const { data: errosRaw } = await supabase
    .from('integration_attempts')
    .select('error_message')
    .in('loja_id', lojaIds)
    .eq('error', true)
    .gte('created_at', `${hojeISO}T00:00:00.000Z`)
  const errosAcao = (errosRaw ?? []).filter((e) => explicarErroOmie(e.error_message as string | null)?.tipo === 'acao')
  if (errosAcao.length) itens.push({ titulo: 'Erros que precisam de ação', tom: 'err', contagem: errosAcao.length, href: '/log' })

  // 2. NF travada (etapa < 60 ha mais de 24h).
  const ontemISO = new Date(Date.now() - 86400000).toISOString().slice(0, 10)
  const { count: nfTravada } = await supabase
    .from('notas_fiscais')
    .select('id', { count: 'exact', head: true })
    .in('loja_id', lojaIds)
    .is('deleted_at', null)
    .neq('c_etapa', '60')
    .lte('d_emissao_nfe', ontemISO)
  if (nfTravada) itens.push({ titulo: 'Notas fiscais travadas (etapa não concluída)', tom: 'warn', contagem: nfTravada, href: '/nota-fiscal?status=40' })

  // 3. OP atrasada (previsao passou, nao concluida).
  const { count: opAtrasada } = await supabase
    .from('ordens_producao')
    .select('id', { count: 'exact', head: true })
    .in('loja_id', lojaIds)
    .lt('identificacao_d_dt_previsao', hojeISO)
    .eq('concluida', false)
  if (opAtrasada) itens.push({ titulo: 'Ordens de produção atrasadas', tom: 'warn', contagem: opAtrasada, href: '/ordem-producao?status=atrasada' })

  // 4. Vencendo em 7 dias / vencido (mesma logica de /validade).
  const em7dias = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10)
  const { count: vencendo } = await supabase
    .from('ordens_producao')
    .select('id', { count: 'exact', head: true })
    .in('loja_id', lojaIds)
    .not('validade', 'is', null)
    .lte('validade', em7dias)
    .gt('quantidade', 0)
  if (vencendo) itens.push({ titulo: 'Produtos vencendo em até 7 dias (ou vencidos)', tom: 'warn', contagem: vencendo, href: '/validade?dias=7' })

  // 5. Contagem de inventario pendente (30 dias, mesma janela do painel de auditoria).
  const { data: locaisRows } = await supabase.from('local_estoques').select('codigo_local_estoque').in('loja_id', lojaIds).neq('inativo', 'S')
  const trintaDiasAtras = new Date(Date.now() - 30 * 86400000).toISOString()
  const { data: inventRecentes } = await supabase
    .from('inventarios')
    .select('codigo_local_estoque')
    .in('loja_id', lojaIds)
    .gte('created_at', trintaDiasAtras)
  const locaisComContagem = new Set((inventRecentes ?? []).map((i) => i.codigo_local_estoque))
  const semContagem = (locaisRows ?? []).filter((l) => !locaisComContagem.has(l.codigo_local_estoque)).length
  if (semContagem) itens.push({ titulo: 'Locais sem contagem de inventário há 30 dias', tom: 'info', contagem: semContagem, href: '/resumo?cat=auditoria' })

  // 6. Pendencias de classificacao (produtos sem familia/tipo).
  const { count: semFamilia } = await supabase.from('produtos').select('codigo_produto', { count: 'exact', head: true }).in('loja_id', lojaIds).or('descricao_familia.is.null,descricao_familia.eq.')
  if (semFamilia) itens.push({ titulo: 'Produtos sem família cadastrada', tom: 'info', contagem: semFamilia, href: '/pendencias-classificacao' })

  const ORDEM_TOM: Record<ItemAcao['tom'], number> = { err: 0, warn: 1, info: 2 }
  return itens.sort((a, b) => ORDEM_TOM[a.tom] - ORDEM_TOM[b.tom])
}
```

Adicionar o import de `explicarErroOmie` no topo do arquivo (já existe na linha 3 — confirmar que já está importado; se não, adicionar `import { explicarErroOmie } from '@/lib/erro-omie-amigavel'`).

- [ ] **Step 2: Renderizar o painel no topo da página**

Em `app/(app)/resumo/page.tsx`, importar `carregarPainelAcao` e `type ItemAcao` de `@/lib/resumo-dia`, chamar junto com `carregarResumoDia` (mesmo array de `lojaIds` já resolvido na página), e renderizar um bloco novo ANTES dos tiles existentes:

```tsx
  const painelAcao = await carregarPainelAcao(lojaIds)
```
(inserir logo após a resolução de `lojaIds` existente na página — usar o Read do arquivo real pra achar a variável exata antes de inserir).

```tsx
      {painelAcao.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-[15px] font-semibold text-text">Precisa de ação</h2>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {painelAcao.map((it) => (
              <Link
                key={it.titulo}
                href={it.href}
                className={`flex items-center justify-between rounded-lg border p-3 text-sm hover:opacity-80 ${
                  it.tom === 'err' ? 'border-err/30 bg-err/10 text-err' : it.tom === 'warn' ? 'border-warn/30 bg-warn/10 text-warn' : 'border-info/30 bg-info/10 text-info'
                }`}
              >
                <span>{it.titulo}</span>
                <span className="num text-lg font-bold">{it.contagem}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
```

> Ajustar os nomes de classe de cor (`err`/`warn`/`info`) pro que o design system do projeto já usa — conferir em outro componente que já use tom de cor (ex.: `StatusPill` ou `ChipsStatus`) antes de finalizar, pra não inventar classe Tailwind que não existe no tema.

- [ ] **Step 3: Typecheck e verificação manual**

```bash
npx tsc --noEmit
```
`npm run dev`, abrir `/resumo`, confirmar que o painel aparece no topo quando há pendências e some quando não há (nenhum card com contagem 0 deve aparecer — os `if (count)` já filtram isso).

- [ ] **Step 4: Commit**

```bash
git add lib/resumo-dia.ts "app/(app)/resumo/page.tsx"
git commit -m "feat(resumo): painel de acao com pendencias rankeadas (erros, NF travada, OP atrasada, vencendo, contagem, classificacao)"
```

---

### Task 7: Margem automática para lojas sem import Excel

**Files:**
- Modify: `app/(app)/relatorio-margem/page.tsx`

**Interfaces:** nenhuma nova — usa a mesma fórmula já validada na RPC
`relatorio_estoque_valorizado` (migration 063): `margem_pct = round(((valor_unitario - cmc) / valor_unitario) * 100, 1)`, `valor_unitario > 0 and cmc > 0`.

**Contexto:** hoje a tela depende 100% de `margem_importada` (só a loja 3 tem,
via Excel manual). O dono do relatório validou que essa fórmula bate com o
Excel do Ramon (diferença 0,00-0,37 p.p. nas 155 linhas reais). Em vez de
substituir a fonte da loja 3 (que já funciona e serve de conferência), esta
task adiciona um **fallback automático** pras lojas sem import: quando
`margem_importada` não tem linha nenhuma pra loja, calcular ao vivo a partir
de `produtos.valor_unitario` × `posicao_estoques` (última foto), tipos
`'04'` (Acabado) e `'00'` (Revenda).

- [ ] **Step 1: Buscar a margem calculada quando não há import**

Trocar (linhas 40-49):
```ts
  const supabase = createServiceClient()
  const [{ data: rowsRaw }, { data: metaRow }, { data: produtosRaw }, { data: locaisRaw }] = await Promise.all([
    supabase.from('margem_importada').select('codigo, descricao, familia, mes, pdv, cmc, margem').eq('loja_id', lojaId),
    supabase.from('margem_import_meta').select('importado_em').eq('loja_id', lojaId).maybeSingle(),
    // margem_importada não tem "tipo" (só vem no export do Omie): cruza por código
    // com produtos pra poder filtrar por tipo de item (e por local, via posicao_estoques).
    supabase.from('produtos').select('codigo, tipo_item, codigo_produto').eq('loja_id', lojaId),
    supabase.from('local_estoques').select('codigo_local_estoque, descricao').eq('loja_id', lojaId).order('descricao'),
  ])
  const rows = (rowsRaw ?? []) as Row[]
```
por:
```ts
  const supabase = createServiceClient()
  const [{ data: rowsRaw }, { data: metaRow }, { data: produtosRaw }, { data: locaisRaw }] = await Promise.all([
    supabase.from('margem_importada').select('codigo, descricao, familia, mes, pdv, cmc, margem').eq('loja_id', lojaId),
    supabase.from('margem_import_meta').select('importado_em').eq('loja_id', lojaId).maybeSingle(),
    // margem_importada não tem "tipo" (só vem no export do Omie): cruza por código
    // com produtos pra poder filtrar por tipo de item (e por local, via posicao_estoques).
    supabase.from('produtos').select('codigo, tipo_item, codigo_produto').eq('loja_id', lojaId),
    supabase.from('local_estoques').select('codigo_local_estoque, descricao').eq('loja_id', lojaId).order('descricao'),
  ])
  let rows = (rowsRaw ?? []) as Row[]
  let calculadaAoVivo = false

  // Sem import manual (todas as lojas exceto a que faz upload do FAT_DRV):
  // calcula a margem ao vivo com a MESMA fórmula da RPC relatorio_estoque_valorizado
  // (migration 063), validada contra o Excel do Ramon (diff 0,00-0,37 p.p.).
  if (!rows.length) {
    const mesAtualISO = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bahia' }).slice(0, 7)
    const { data: produtosCalc } = await supabase
      .from('produtos')
      .select('codigo, codigo_produto, descricao, descricao_familia, tipo_item, valor_unitario')
      .eq('loja_id', lojaId)
      .in('tipo_item', ['04', '00'])
    const { data: fotoRow } = await supabase
      .from('posicao_estoques')
      .select('data_posicao')
      .eq('loja_id', lojaId)
      .order('data_posicao', { ascending: false })
      .limit(1)
      .maybeSingle()
    if (fotoRow?.data_posicao && produtosCalc?.length) {
      const { data: posRows } = await supabase
        .from('posicao_estoques')
        .select('n_cod_prod, n_cmc')
        .eq('loja_id', lojaId)
        .eq('data_posicao', fotoRow.data_posicao)
        .gt('n_cmc', 0)
      const cmcPorCod = new Map<number, number>()
      for (const p of posRows ?? []) {
        const atual = cmcPorCod.get(Number(p.n_cod_prod))
        if (atual == null || Number(p.n_cmc) > atual) cmcPorCod.set(Number(p.n_cod_prod), Number(p.n_cmc))
      }
      rows = (produtosCalc as { codigo: string | null; codigo_produto: number; descricao: string | null; descricao_familia: string | null; valor_unitario: number | null }[])
        .map((p) => {
          const cmc = cmcPorCod.get(Number(p.codigo_produto)) ?? null
          const pdv = Number(p.valor_unitario) || null
          const margem = pdv && cmc && pdv > 0 && cmc > 0 ? Number((((pdv - cmc) / pdv) * 100).toFixed(1)) : null
          return { codigo: p.codigo ?? String(p.codigo_produto), descricao: p.descricao, familia: p.descricao_familia, mes: mesAtualISO, pdv, cmc, margem }
        })
        .filter((r) => r.cmc != null && r.pdv != null)
      calculadaAoVivo = true
    }
  }
```

- [ ] **Step 2: Ajustar o EmptyState e a legenda de rodapé pra refletir a origem do dado**

Trocar (linhas 77-90, o bloco `if (!rows.length)`) mantendo-o, mas SÓ como fallback final (agora `rows` já pode ter sido preenchido pelo cálculo ao vivo no Step 1 — o `if (!rows.length)` original continua funcionando sem alteração, porque só cai nele se NEM o import NEM o cálculo ao vivo encontrarem produto, ex.: loja sem `posicao_estoques`).

Trocar (linha 246):
```tsx
      <p className="px-1 text-[11px] text-text-muted">
        Margem mais recente por produto, importada da aba MARGEM do FAT_DRV (produto acabado / venda PDV). A % é a que o Omie calcula.
      </p>
```
por:
```tsx
      <p className="px-1 text-[11px] text-text-muted">
        {calculadaAoVivo
          ? 'Margem calculada automaticamente (preço de venda × custo médio da última posição de estoque) para produtos acabados e de revenda — sem import manual.'
          : 'Margem mais recente por produto, importada da aba MARGEM do FAT_DRV (produto acabado / venda PDV). A % é a que o Omie calcula.'}
      </p>
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Verificação manual — comparar com o Excel da loja que já tem import (não deve regredir) e checar uma loja sem import**

```bash
node scripts/db.mjs "select count(*) from margem_importada where loja_id = 3"
```
Confirmar que a loja com import (3) continua mostrando "importada" no rodapé (o `if (!rows.length)` não deve disparar lá). Depois, `npm run dev`, trocar `current_loja_id` da conta QA pra uma loja sem `margem_importada` (ex.: loja 2) e abrir `/relatorio-margem` — deve mostrar produtos com margem calculada e o rodapé "calculada automaticamente".

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/relatorio-margem/page.tsx"
git commit -m "feat(relatorio-margem): margem automatica (sem excel) para lojas sem import manual"
```

---

## Ordem de execução

Tasks 1, 2, 3, 5, 6, 7 são independentes entre si. Task 4 (rodar o sync) deve
vir ANTES da Task 5 ser testada visualmente (senão o bloco novo mostra
números antigos ainda) — mas o código da Task 5 não depende do código da
Task 4, só o dado exibido depende do sync ter rodado.
