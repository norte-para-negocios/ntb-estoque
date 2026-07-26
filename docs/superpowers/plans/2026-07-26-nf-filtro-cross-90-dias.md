# Notas Fiscais: filtro cruzando 90 dias Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** O filtro de tipo/família/produto/local na tela/export/relatório de Notas Fiscais passa a enxergar NF antigas cujos itens só existem no Contabo, sem misturar o espaço de IDs do Supabase com o do Contabo.

**Architecture:** Uma função nova em `lib/relatorio-frio-nf.ts` (`buscarNotaIdsFrio`) resolve o conjunto de `nota_fiscal_id` (espaço Contabo) que casam com o filtro, reaproveitando `buscarItensNFFrio` já existente. Os 3 arquivos que hoje aplicam um filtro pós-merge único (`idsInSet.has(r.id)`/`notaIdsFiltroSet.has(n.id)`) passam a filtrar a fatia fria pela ANTES de mesclar — 2 deles (export/relatório) já usam o hook `filtrarFrias` de `complementarNotasFiscais`, só precisam compor o novo filtro nele; o terceiro (a tela) faz merge manual e filtra `friasFiltradas` diretamente.

**Tech Stack:** Next.js Server Components/Route Handlers, Supabase (Postgres), API do Contabo (via `lib/historico-contabo.ts`/`lib/relatorio-frio-nf.ts`).

## Global Constraints

- Sem suite automatizada neste repo — verificação manual (`node scripts/db.mjs`, chamada direta à API do Contabo via `fetch`, reconstrução independente com dado real).
- Sem mudança de comportamento no caso comum (sem filtro de tipo/família/produto/local ativo, OU período inteiro dentro dos 90 dias) — as mudanças só afetam quando os dois fatores coincidem.
- `buscarNotaIdsFrio` deve reaproveitar `buscarItensNFFrio` (já existente, já pagina corretamente pelo teto do endpoint do Contabo) — não escrever uma busca paginada nova do zero.
- Falha ao buscar o frio nunca pode quebrar a tela/export/relatório — mesma filosofia de `buscarFrio` (retorna `[]`/conjunto vazio em erro, nunca lança).

---

### Task 1: `buscarNotaIdsFrio` em `lib/relatorio-frio-nf.ts`

**Files:**
- Modify: `lib/relatorio-frio-nf.ts`

**Interfaces:**
- Consumes: `buscarItensNFFrio` (já existe, `lib/relatorio-frio-nf.ts:84`).
- Produces: `export async function buscarNotaIdsFrio(opts: { lojaId: number; dataInicio: string; dataFinal: string; codigosProduto: string[] | null; produtoBusca: string | null; localCod: number | null }): Promise<Set<number>>`. Tasks 2, 3 e 4 chamam essa função.

- [ ] **Step 1: Exportar o helper `localDe` (hoje interno, não exportado)**

Em `lib/relatorio-frio-nf.ts:110-113`, hoje:

```ts
const localDe = (it: ItemNFFrio): number | null => {
  const v = (ajustesDe(it) as { codigo_local_estoque?: number | string } | null)?.codigo_local_estoque
  return v == null ? null : Number(v)
}
```

Trocar `const localDe` por `export const localDe` (só isso, sem mudar o corpo):

```ts
export const localDe = (it: ItemNFFrio): number | null => {
  const v = (ajustesDe(it) as { codigo_local_estoque?: number | string } | null)?.codigo_local_estoque
  return v == null ? null : Number(v)
}
```

- [ ] **Step 2: Adicionar `buscarNotaIdsFrio`**

Adicionar em `lib/relatorio-frio-nf.ts`, logo depois de `buscarItensNFFrio` (depois da linha 102, antes de `const ajustesDe`):

```ts
// Resolve o conjunto de `nota_fiscal_id` (espaço de ID do CONTABO, nao do
// Supabase) que casam com o filtro de tipo/familia/produto/local -- usado
// pra completar esse filtro na fatia fria de notas_fiscais/nota_fiscal_items
// (nota-fiscal/page.tsx e os 2 arquivos irmaos). `codigosProduto` ja vem
// resolvido localmente (join com `produtos`, que nunca e duplicado no
// Contabo) -- aqui so cruza com os itens crus do Contabo. Achado real
// (2026-07-26): reaproveitar um Set de ids derivado do Supabase pra filtrar
// linhas do Contabo e o MESMO bug de espaco de ID ja corrigido pra
// movimentos/NF/OP (commits 3f02341/46b6279/2ea39ce) -- o Contabo gera seu
// proprio id (dual-write ja em producao), entao o filtro precisa devolver
// ids no espaco CERTO pra fatia que vai usa-lo.
export async function buscarNotaIdsFrio(opts: {
  lojaId: number
  dataInicio: string
  dataFinal: string
  codigosProduto: string[] | null
  produtoBusca: string | null
  localCod: number | null
}): Promise<Set<number>> {
  const itens = await buscarItensNFFrio({ lojaId: opts.lojaId, dataInicio: opts.dataInicio, dataFinal: opts.dataFinal })
  const termo = opts.produtoBusca?.toLowerCase() || null
  const ids = new Set<number>()
  for (const it of itens) {
    if (opts.codigosProduto && !opts.codigosProduto.includes(String(it.n_id_produto))) continue
    if (termo && !ilike(it.c_descricao_produto, termo) && !ilike(it.c_codigo_produto, termo)) continue
    if (opts.localCod !== null && localDe(it) !== opts.localCod) continue
    ids.add(it.nota_fiscal_id)
  }
  return ids
}
```

Nota: `ilike` já existe no arquivo (`lib/relatorio-frio-nf.ts:123-124`), reaproveitado aqui sem mudança.

- [ ] **Step 3: Rodar `npx tsc --noEmit -p .` e confirmar zero erros**

```bash
npx tsc --noEmit -p .
```

- [ ] **Step 4: Testar contra dado real (loja 2, sem filtro nenhum ainda quebra nada; com filtro de tipo confirma que devolve ids)**

```bash
node -e "
const fs = require('fs');
const env = {};
for (const line of fs.readFileSync('.env.local','utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\$/);
  if (m) env[m[1]] = m[2].trim().replace(/^[\"']|[\"']\$/g, '');
}
Object.assign(process.env, env);
require('tsx/cjs');
(async () => {
  const { buscarNotaIdsFrio } = require('./lib/relatorio-frio-nf.ts');
  const ids = await buscarNotaIdsFrio({ lojaId: 2, dataInicio: '2025-07-01', dataFinal: '2025-12-31', codigosProduto: null, produtoBusca: null, localCod: null });
  console.log('ids sem filtro (deve ser > 0):', ids.size);
})();
"
```
Esperado: um número maior que 0 (confirma que a função busca e resolve ids de verdade).

- [ ] **Step 5: Commit**

```bash
git add lib/relatorio-frio-nf.ts
git commit -m "feat: buscarNotaIdsFrio -- resolve filtro tipo/familia/produto/local no Contabo"
```

---

### Task 2: `app/(app)/nota-fiscal/page.tsx`

**Files:**
- Modify: `app/(app)/nota-fiscal/page.tsx`

**Interfaces:**
- Consumes: `buscarNotaIdsFrio` (Task 1).
- Produces: nenhuma interface nova exportada — só muda o comportamento interno da página.

- [ ] **Step 1: Hoistar `codigos` pra fora do bloco condicional, pra reusar depois**

Em `app/(app)/nota-fiscal/page.tsx:132-134`, hoje:

```ts
  let notaIds: number[] | null = null
  if (tiposArr.length || familiasArr.length || params.produto || localCod !== null) {
    let codigos: string[] | null = null
```

Trocar por (só move a declaração de `codigos` uma linha pra cima, fora do `if`):

```ts
  let notaIds: number[] | null = null
  let codigos: string[] | null = null
  if (tiposArr.length || familiasArr.length || params.produto || localCod !== null) {
```

(o resto do corpo do `if` continua igual — `codigos = prodCodigos.map(...)` já é uma atribuição, não uma redeclaração, então não precisa mudar mais nada ali.)

- [ ] **Step 2: Calcular `notaIdsFrioSet` logo depois de `idsInSet`**

Em `app/(app)/nota-fiscal/page.tsx:176-177`, hoje:

```ts
  const idsIn = notaIds !== null ? (notaIds.length ? notaIds : [-1]) : null
  const idsInSet = idsIn ? new Set(idsIn) : null
```

Adicionar logo depois (mesmo bloco, sem mexer nas 2 linhas acima):

```ts
  const idsIn = notaIds !== null ? (notaIds.length ? notaIds : [-1]) : null
  const idsInSet = idsIn ? new Set(idsIn) : null
  // notaIdsFrioSet: mesma resolucao de filtro, mas no espaco de ID do
  // Contabo -- ver Task 1 e a spec docs/superpowers/specs/2026-07-26-nf-filtro-cross-90-dias-design.md.
  // So calculado quando o periodo de fato cruza os 90 dias (senao a fatia
  // fria nem e buscada) E algum filtro que dependa de produto/local esta ativo.
  const temFiltroProdLocal = tiposArr.length > 0 || familiasArr.length > 0 || !!params.produto || localCod !== null
  const notaIdsFrioSet = temFiltroProdLocal && dataInicio < limiteJanelaQuente()
    ? await buscarNotaIdsFrio({ lojaId, dataInicio, dataFinal, codigosProduto: codigos, produtoBusca: params.produto || null, localCod })
    : null
```

- [ ] **Step 3: Dobrar o filtro de frio dentro de `friasFiltradas` e remover os 2 pós-filtros**

Em `app/(app)/nota-fiscal/page.tsx`, hoje (por volta da linha 267-268):

```ts
    const statusAtivo = params.status
    const friasFiltradas = statusAtivo ? friasRaw.filter((nf) => statusBateFiltro(nf, statusAtivo)) : friasRaw
```

Trocar por:

```ts
    const statusAtivo = params.status
    const friasFiltradas = friasRaw
      .filter((nf) => !statusAtivo || statusBateFiltro(nf, statusAtivo))
      .filter((nf) => !notaIdsFrioSet || notaIdsFrioSet.has(nf.id))
```

Depois, em (por volta da linha 269-282), hoje:

```ts
    const vistosQuentes = new Set(totaisRaw.map((r) => r.n_id_receb))
    const totaisCompletosBrutos = [...totaisRaw, ...friasFiltradas.filter((r) => !vistosQuentes.has(r.n_id_receb))]
    // complementarNotasFiscais (e o buscarFrioTudo acima, que a substitui aqui)
    // busca a fatia fria so por loja/data/busca -- nao conhece o filtro de
    // tipo/familia/produto/local (limitacao ja documentada no AGENTS.md: "o
    // cruzamento com o Contabo nao foi implementado para esse caso
    // especifico"). Sem filtrar aqui, TODA nota fria do periodo entra no
    // merge, inflando o total quando esse filtro esta ativo e o periodo cruza
    // os 90 dias (achado real: loja 6, tipo=99, badge mostrando 1907 em vez de
    // 2). idsInSet ja veio das notas que casam no lado quente; aplicar o mesmo
    // filtro na fatia fria evita a inflacao (ainda pode faltar nota cuja unica
    // referencia de item exista so no Contabo -- limitacao que continua aberta).
    const totaisCompletos = idsInSet ? totaisCompletosBrutos.filter((r) => idsInSet.has(r.id)) : totaisCompletosBrutos
    qtdNotas = totaisCompletos.length
    totalValor = totaisCompletos.reduce((a, r) => a + (Number(r.n_valor_nfe) || 0), 0)
```

Trocar por (`friasFiltradas` já vem filtrada por `notaIdsFrioSet` desde o Step 3 acima, então não precisa de pós-filtro nenhum):

```ts
    const vistosQuentes = new Set(totaisRaw.map((r) => r.n_id_receb))
    const totaisCompletos = [...totaisRaw, ...friasFiltradas.filter((r) => !vistosQuentes.has(r.n_id_receb))]
    qtdNotas = totaisCompletos.length
    totalValor = totaisCompletos.reduce((a, r) => a + (Number(r.n_valor_nfe) || 0), 0)
```

E logo depois (por volta da linha 296-316), hoje:

```ts
    // Reusa a mesma fatia fria (friasRaw) buscada acima -- mesmos filtros
    // loja/data/busca, evita uma segunda ida identica ao Contabo.
    const vistosQuentesLista = new Set(paginaCompletaRaw.map((r) => r.n_id_receb))
    const todasBrutas = [...paginaCompletaRaw, ...friasFiltradas.filter((r) => !vistosQuentesLista.has(r.n_id_receb))]
    // Mesma razao do totaisCompletos acima: a fatia fria nao respeita o filtro
    // de tipo/familia/produto/local sozinha.
    const todas = idsInSet ? todasBrutas.filter((r) => idsInSet.has(r.id)) : todasBrutas
```

Trocar por:

```ts
    // Reusa a mesma fatia fria (friasFiltradas), ja filtrada por status e por
    // notaIdsFrioSet acima -- evita uma segunda ida identica ao Contabo.
    const vistosQuentesLista = new Set(paginaCompletaRaw.map((r) => r.n_id_receb))
    const todas = [...paginaCompletaRaw, ...friasFiltradas.filter((r) => !vistosQuentesLista.has(r.n_id_receb))]
```

- [ ] **Step 4: Importar `buscarNotaIdsFrio`**

No topo do arquivo, achar o import existente de `lib/relatorio-frio-nf` (se não existir ainda, adicionar) e incluir `buscarNotaIdsFrio`. Se o arquivo não importa nada de lá hoje, adicionar:

```ts
import { buscarNotaIdsFrio } from '@/lib/relatorio-frio-nf'
```

- [ ] **Step 5: Rodar `npx tsc --noEmit -p .` e `npm run build`, confirmar zero erros**

```bash
npx tsc --noEmit -p .
npm run build
```

- [ ] **Step 6: Testar com dado real — comparar antes/depois do fix**

Escolher uma loja e um período que cruze os 90 dias, com um filtro de tipo ativo (ex.: `?tipo=99&data_inicio=2025-07-01`), e confirmar que o total de notas antigas com aquele tipo agora aparece (antes do fix, sumiam se os itens só existissem no Contabo). Comparar contra uma reconstrução independente via `node scripts/db.mjs` (contagem de `produtos`+`nota_fiscal_items` no Supabase) + chamada direta a `buscarNotaIdsFrio` pro período frio.

- [ ] **Step 7: Commit**

```bash
git add "app/(app)/nota-fiscal/page.tsx"
git commit -m "fix: filtro tipo/familia/produto/local em NF completa com o Contabo (espaco de ID correto)"
```

---

### Task 3: `app/(app)/nota-fiscal/export/route.ts`

**Files:**
- Modify: `app/(app)/nota-fiscal/export/route.ts`

**Interfaces:**
- Consumes: `buscarNotaIdsFrio` (Task 1).
- Produces: nenhuma.

- [ ] **Step 1: Hoistar `codigos` pra fora do bloco `if (tiposArr.length)`**

Em `app/(app)/nota-fiscal/export/route.ts:48-64`, hoje:

```ts
  let notaIdsFiltro: number[] | null = null
  if (tiposArr.length || params.produto) {
    if (tiposArr.length) {
      // Paginado: produtos.tipo_item pode passar de 1000 linhas numa unica loja
      // (ex: loja 6, tipo "99" tem 1143) -- sem .range() o PostgREST trunca em
      // silencio e a exportacao some com notas validas.
      const prodCodigos = await buscarTudoPaginado<{ codigo_produto: string | number }>((from, to) =>
        supabase
          .from('produtos')
          .select('codigo_produto')
          .eq('loja_id', lojaId)
          .in('tipo_item', tiposArr)
          .order('id', { ascending: true })
          .range(from, to),
      )

      const codigos = prodCodigos.map((p) => String(p.codigo_produto))
```

Trocar por (move a declaração de `codigos` pra antes do `if (tiposArr.length || params.produto)`, e a linha dentro do `if` vira atribuição):

```ts
  let notaIdsFiltro: number[] | null = null
  let codigos: string[] | null = null
  if (tiposArr.length || params.produto) {
    if (tiposArr.length) {
      // Paginado: produtos.tipo_item pode passar de 1000 linhas numa unica loja
      // (ex: loja 6, tipo "99" tem 1143) -- sem .range() o PostgREST trunca em
      // silencio e a exportacao some com notas validas.
      const prodCodigos = await buscarTudoPaginado<{ codigo_produto: string | number }>((from, to) =>
        supabase
          .from('produtos')
          .select('codigo_produto')
          .eq('loja_id', lojaId)
          .in('tipo_item', tiposArr)
          .order('id', { ascending: true })
          .range(from, to),
      )

      codigos = prodCodigos.map((p) => String(p.codigo_produto))
```

- [ ] **Step 2: Calcular `notaIdsFrioSet` e compor no `filtrarFrias`, remover o pós-filtro**

Em `app/(app)/nota-fiscal/export/route.ts:158-174`, hoje:

```ts
  // complementarNotasFiscais busca a fatia fria so por loja/data/busca -- nao
  // conhece o filtro de tipo/produto (limitacao documentada no AGENTS.md).
  // Sem filtrar aqui, toda nota fria do periodo entraria na exportacao mesmo
  // sem casar com o filtro, quando o periodo cruza os 90 dias.
  const notasCompletasBrutas = dataInicio < limiteJanelaQuente()
    ? await complementarNotasFiscais(notas, {
        lojaId,
        dataInicio,
        dataFinal,
        busca: params.num_nfe || params.fornecedor,
        filtrarFrias: params.status ? (n) => statusBateFiltro(n, params.status!) : undefined,
      })
    : notas
  const notaIdsFiltroSet = notaIdsFiltro ? new Set(notaIdsFiltro) : null
  const notasCompletas = notaIdsFiltroSet
    ? notasCompletasBrutas.filter((n) => notaIdsFiltroSet.has(n.id))
    : notasCompletasBrutas
```

Trocar por:

```ts
  // Achado real (2026-07-26): antes disso, o filtro de tipo/produto na fatia
  // fria reusava notaIdsFiltro (ids do SUPABASE) pra filtrar linhas do
  // CONTABO -- espaco de ID errado desde que o dual-write de NF entrou em
  // producao (o Contabo gera seu proprio id). notaIdsFrioSet resolve o
  // mesmo filtro no espaco certo (ver lib/relatorio-frio-nf.ts).
  const temFiltro = tiposArr.length > 0 || !!params.produto
  const notaIdsFrioSet = temFiltro && dataInicio < limiteJanelaQuente()
    ? await buscarNotaIdsFrio({ lojaId, dataInicio, dataFinal, codigosProduto: codigos, produtoBusca: params.produto || null, localCod: null })
    : null
  const notasCompletas = dataInicio < limiteJanelaQuente()
    ? await complementarNotasFiscais(notas, {
        lojaId,
        dataInicio,
        dataFinal,
        busca: params.num_nfe || params.fornecedor,
        filtrarFrias: (n) =>
          (!params.status || statusBateFiltro(n, params.status!)) &&
          (!notaIdsFrioSet || notaIdsFrioSet.has(n.id)),
      })
    : notas
```

- [ ] **Step 3: Importar `buscarNotaIdsFrio`**

```ts
import { buscarNotaIdsFrio } from '@/lib/relatorio-frio-nf'
```

- [ ] **Step 4: Rodar `npx tsc --noEmit -p .` e `npm run build`**

```bash
npx tsc --noEmit -p .
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/nota-fiscal/export/route.ts"
git commit -m "fix: filtro tipo/produto na exportacao de NF completa com o Contabo (espaco de ID correto)"
```

---

### Task 4: `app/(app)/nota-fiscal/relatorio/route.ts`

**Files:**
- Modify: `app/(app)/nota-fiscal/relatorio/route.ts`

**Interfaces:**
- Consumes: `buscarNotaIdsFrio` (Task 1).
- Produces: nenhuma.

- [ ] **Step 1: Hoistar `codigos` pra fora do bloco `if (tiposArr.length)`**

Em `app/(app)/nota-fiscal/relatorio/route.ts:57-71`, hoje:

```ts
  let notaIdsFiltro: number[] | null = null
  if (tiposArr.length || produto) {
    if (tiposArr.length) {
      // Paginado: produtos.tipo_item pode passar de 1000 linhas numa unica loja
      // (ex: loja 6, tipo "99" tem 1143) -- sem .range() o PostgREST trunca em
      // silencio e o relatorio some com notas validas.
      const prodCodigos = await buscarTudoPaginado<{ codigo_produto: string | number }>((from, to) =>
        supabase
          .from('produtos')
          .select('codigo_produto')
          .eq('loja_id', lojaId)
          .in('tipo_item', tiposArr)
          .range(from, to),
      )
      const codigos = prodCodigos.map((p) => String(p.codigo_produto))
```

Trocar por:

```ts
  let notaIdsFiltro: number[] | null = null
  let codigos: string[] | null = null
  if (tiposArr.length || produto) {
    if (tiposArr.length) {
      // Paginado: produtos.tipo_item pode passar de 1000 linhas numa unica loja
      // (ex: loja 6, tipo "99" tem 1143) -- sem .range() o PostgREST trunca em
      // silencio e o relatorio some com notas validas.
      const prodCodigos = await buscarTudoPaginado<{ codigo_produto: string | number }>((from, to) =>
        supabase
          .from('produtos')
          .select('codigo_produto')
          .eq('loja_id', lojaId)
          .in('tipo_item', tiposArr)
          .range(from, to),
      )
      codigos = prodCodigos.map((p) => String(p.codigo_produto))
```

- [ ] **Step 2: Calcular `notaIdsFrioSet` e compor no `filtrarFrias`, remover o pós-filtro**

Em `app/(app)/nota-fiscal/relatorio/route.ts:157-173`, hoje:

```ts
  // complementarNotasFiscais busca a fatia fria so por loja/data/busca -- nao
  // conhece o filtro de tipo/produto (limitacao documentada no AGENTS.md).
  // Sem filtrar aqui, toda nota fria do periodo entraria no relatorio mesmo
  // sem casar com o filtro, quando o periodo cruza os 90 dias.
  const notasCompletasBrutas = dataInicio < limiteJanelaQuente()
    ? await complementarNotasFiscais(notas, {
        lojaId,
        dataInicio,
        dataFinal,
        busca: numNfe || fornecedor,
        filtrarFrias: status ? (n) => statusBateFiltro(n, status) : undefined,
      })
    : notas
  const notaIdsFiltroSet = notaIdsFiltro ? new Set(notaIdsFiltro) : null
  const notasCompletas = notaIdsFiltroSet
    ? notasCompletasBrutas.filter((n) => notaIdsFiltroSet.has(n.id))
    : notasCompletasBrutas
```

Trocar por:

```ts
  // Mesmo achado de app/(app)/nota-fiscal/export/route.ts (2026-07-26):
  // notaIdsFiltro (ids do Supabase) nao pode filtrar linhas do Contabo.
  const temFiltro = tiposArr.length > 0 || !!produto
  const notaIdsFrioSet = temFiltro && dataInicio < limiteJanelaQuente()
    ? await buscarNotaIdsFrio({ lojaId, dataInicio, dataFinal, codigosProduto: codigos, produtoBusca: produto || null, localCod: null })
    : null
  const notasCompletas = dataInicio < limiteJanelaQuente()
    ? await complementarNotasFiscais(notas, {
        lojaId,
        dataInicio,
        dataFinal,
        busca: numNfe || fornecedor,
        filtrarFrias: (n) =>
          (!status || statusBateFiltro(n, status)) &&
          (!notaIdsFrioSet || notaIdsFrioSet.has(n.id)),
      })
    : notas
```

- [ ] **Step 3: Importar `buscarNotaIdsFrio`**

```ts
import { buscarNotaIdsFrio } from '@/lib/relatorio-frio-nf'
```

- [ ] **Step 4: Rodar `npx tsc --noEmit -p .` e `npm run build`**

```bash
npx tsc --noEmit -p .
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/nota-fiscal/relatorio/route.ts"
git commit -m "fix: filtro tipo/produto no relatorio PDF de NF completa com o Contabo (espaco de ID correto)"
```

---

### Task 5: Validação end-to-end

**Files:** nenhum (só verificação manual).

**Interfaces:**
- Consumes: Tasks 1-4 já commitadas (merge+deploy feito antes desta task, mesmo padrão das outras tarefas desta sessão).

- [ ] **Step 1: Confirmar o caso real a usar**

Já confirmado nesta investigação: loja 6, `tipo_item='99'`, 1143 produtos cadastrados (`select tipo_item, count(*) from produtos where loja_id=6 group by tipo_item order by count(*) desc` — "99" é o maior grupo).

- [ ] **Step 2: Confirmar quantas NF distintas (no período 2025-07-01 a 2026-04-26, antes do corte de 90 dias) têm item desse tipo — a contagem independente que o Step 3 precisa bater**

```bash
node scripts/db.mjs "select count(distinct nfi.nota_fiscal_id) from nota_fiscal_items nfi join produtos p on p.codigo_produto::text = nfi.produto_codigo and p.loja_id = nfi.loja_id join notas_fiscais nf on nf.id = nfi.nota_fiscal_id where nfi.loja_id=6 and p.tipo_item='99' and nf.d_emissao_nfe >= '2025-07-01' and nf.d_emissao_nfe <= '2026-04-26'"
```

- [ ] **Step 3: Chamar `buscarNotaIdsFrio` de verdade contra o Contabo, pro mesmo filtro/período, e comparar**

```bash
node -e "
const fs = require('fs');
const env = {};
for (const line of fs.readFileSync('.env.local','utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\$/);
  if (m) env[m[1]] = m[2].trim().replace(/^[\"']|[\"']\$/g, '');
}
Object.assign(process.env, env);
require('tsx/cjs');
(async () => {
  const { buscarNotaIdsFrio } = require('./lib/relatorio-frio-nf.ts');
  const pg = require('pg');
  const dbUrl = new URL(process.env.SUPABASE_DB_URL);
  const senha = decodeURIComponent(dbUrl.password);
  const ref = dbUrl.hostname.replace(/^db\\./, '').replace(/\\.supabase\\.co\$/, '');
  let host = 'aws-1-sa-east-1.pooler.supabase.com', port = 5432;
  try { const s = fs.readFileSync('scripts/.pooler-host','utf8').trim(); const [h,p]=s.split(':'); if(h) host=h; if(p) port=Number(p); } catch {}
  const client = new pg.Client({ host, port, user: 'postgres.'+ref, password: senha, database: 'postgres', ssl: { rejectUnauthorized: false } });
  await client.connect();
  const { rows } = await client.query(\"select codigo_produto from produtos where loja_id=6 and tipo_item='99'\");
  await client.end();
  const codigos = rows.map(r => String(r.codigo_produto));
  const ids = await buscarNotaIdsFrio({ lojaId: 6, dataInicio: '2025-07-01', dataFinal: '2026-04-26', codigosProduto: codigos, produtoBusca: null, localCod: null });
  console.log('notas frias que casam com o filtro:', ids.size);
})();
"
```
Confirmar que o número bate (ou é consistente, considerando que o Contabo pode ter um subconjunto diferente das mesmas notas) com a contagem independente do Step 2.

- [ ] **Step 4: Merge e deploy**

```bash
git fetch origin main
git push origin HEAD:main
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "cd /opt/ntb-estoque && bash deploy.sh"
```

- [ ] **Step 5: Reportar o resultado final**

Resumo do que foi confirmado (a função resolve ids reais do Contabo, os 3 arquivos filtram cada fonte no espaço de ID certo, build/tsc limpos, deploy feito).
