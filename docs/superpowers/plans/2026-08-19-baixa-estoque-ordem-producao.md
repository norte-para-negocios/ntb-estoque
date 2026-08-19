# Baixa de Estoque por Consumo de Ordem de Produção — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconstruir "baixa de estoque por consumo de Ordem de Produção" com valor em R$ (hoje inexistente — `lib/movimentacao-operacao-auto.ts` deliberadamente não cobre isso), pra restaurar o slide "Baixas de Estoque" do relatório mensal (`lib/relatorio-mensal-pptx.ts`) removido em 2026-08-19 por falta desse dado.

**Architecture:** Uma tabela de cache (`estrutura_produto_cache`) guarda a ficha técnica de produtos acabados, populada por uma rota de sync manual e paced com o Omie (`ConsultarEstrutura`, só leitura). Uma função nova (`lib/baixa-op.ts`) cruza Ordens de Produção concluídas com essa cache + o CMC mais recente (`posicao_estoques`, mesmo padrão já usado em `relatorio-margem`) pra gerar linhas de movimento no formato já existente (`LinhaOperAuto`). O relatório mensal passa a somar essas linhas com as de "Movimento Manual de Estoque" que já tinha.

**Tech Stack:** Next.js (API routes), Supabase (Postgres + RPC), Omie API (`consultarEstrutura`, `lib/omie/malha.ts`).

**Spec:** Não há doc de spec separado — este plano nasce direto de duas investigações desta sessão (2026-08-19): (1) confirmação de que o gap de "baixas de estoque" é sistêmico em todas as 6 lojas reais, causa raiz = consumo de OP nunca ligado à reconstrução automática; (2) levantamento de schema exato (ver Global Constraints). Contexto completo também em `docs/superpowers/plans/2026-08-18-estoque-independente-omie-lojas-teste.md` (mecanismo irmão pras lojas de teste) e na memória `reference_relatorio_mensal_ramon_spec.md`.

## Global Constraints

- **Risco de rate-limit real**: hoje mais cedo (mesma sessão), um pacing de 3000ms entre chamadas `ConsultarEstrutura` travou em `MISUSE_API_PROCESS` já na 1ª-11ª chamada, numa LOJA DE TESTE. Este plano toca **lojas reais** (Omie de cliente pagante de verdade) — não existe nenhum número "seguro" documentado no projeto (`lib/omie/malha.ts`/`lib/omie/client.ts` não têm constante de pacing). Pacing mínimo desta feature: **10000ms (10s)** entre chamadas, e a sync SÓ roda quando disparada manualmente (botão), nunca automática/cron.
- **Sem CMC histórico**: `posicao_estoques` só guarda o snapshot MAIS RECENTE (não há CMC por data passada). Consumo de OPs de meses anteriores é valorizado ao custo ATUAL, não ao custo da época — isso é uma aproximação conhecida, não um bug; o relatório deve deixar isso explícito em texto.
- **Não é para lojas de teste**: o mecanismo irmão pra lojas de teste (`ficha_tecnica_local`, migration 121) já existe e é uma tabela DIFERENTE, de propósito isolada (comentário na migration 121: "nenhum relatório real deve ler estas 3 tabelas"). Este plano cria uma tabela nova (`estrutura_produto_cache`) que serve LOJA REAL — não reusar `ficha_tecnica_local` pra isso.
- **`ordens_producao` — status/data de conclusão reais**: usar `concluida boolean` e `dt_conclusao_real date` (migration 012). NÃO usar `adicionais_c_etapa`/`adicionais_d_dt_conclusao` (data planejada, já documentado como fonte de falso-positivo).
- **Migration**: próximo número disponível é `125_*.sql` (última hoje: `124_ficha_tecnica_local_checkpoint.sql`).
- Toda migration precisa ser aplicada nos DOIS bancos (Cloud via `node scripts/aplicar-migration.mjs <arquivo>`, self-hosted Contabo via `scp` + `docker exec supabase-db psql -U supabase_admin -d postgres < arquivo.sql`) — DDL não replica sozinho entre eles (ver memória `reference_ntb_dual_databases.md`).
- `npx tsc --noEmit` e `npm run build` devem passar limpos ao fim de cada task.

---

### Task 1: Migration da tabela de cache de estrutura

**Files:**
- Create: `supabase/migrations/125_estrutura_produto_cache.sql`

**Interfaces:**
- Produces: tabela `estrutura_produto_cache(id, loja_id, codigo_produto, codigo_produto_insumo, descricao_insumo, quantidade, percentual_perda, unidade, tipo_insumo, sincronizado_em)`, unique constraint `(loja_id, codigo_produto, codigo_produto_insumo)`.

- [ ] **Step 1: Escrever a migration**

```sql
-- Cache de ficha técnica (estrutura/malha) de produtos acabados, pra lojas
-- REAIS (não confundir com ficha_tecnica_local, migration 121, que é só
-- pras 6 lojas de teste e propositalmente isolada de relatórios reais).
-- Populada por app/api/sync/estrutura-produto/route.ts, leitura pausada do
-- Omie (ConsultarEstrutura) -- nunca escreve na malha do cliente.
-- Consumida por lib/baixa-op.ts pra valorizar consumo de Ordem de Produção.

create table if not exists estrutura_produto_cache (
  id bigserial primary key,
  loja_id bigint not null references lojas(id) on delete cascade,
  codigo_produto bigint not null,
  codigo_produto_insumo bigint not null,
  descricao_insumo text,
  quantidade numeric(20,6) not null,
  percentual_perda numeric(6,2) not null default 0,
  unidade varchar(10),
  tipo_insumo varchar(2),
  sincronizado_em timestamptz not null default now(),
  unique(loja_id, codigo_produto, codigo_produto_insumo)
);

create index if not exists idx_estrutura_produto_cache_loja_produto
  on estrutura_produto_cache(loja_id, codigo_produto);
```

- [ ] **Step 2: Aplicar na Cloud**

Run: `cd "/Users/joaquimsalles/Projects/norte para negocios/ntb estoque" && node scripts/aplicar-migration.mjs 125_estrutura_produto_cache.sql`
Expected: `MIGRATION APLICADA.`

- [ ] **Step 3: Aplicar no self-hosted (Contabo)**

Run:
```bash
scp -i ~/.ssh/notebook_contabo_key "supabase/migrations/125_estrutura_produto_cache.sql" root@185.193.66.240:/tmp/125.sql
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec -i supabase-db psql -U supabase_admin -d postgres < /tmp/125.sql && rm /tmp/125.sql"
```
Expected: `CREATE TABLE` / `CREATE INDEX` (sem erro).

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/125_estrutura_produto_cache.sql
git commit -m "feat: tabela de cache de estrutura de produto pra baixa de OP em lojas reais"
```

---

### Task 2: Rota de sync manual (pausada) da estrutura

**Files:**
- Create: `app/api/sync/estrutura-produto/route.ts`

**Interfaces:**
- Consumes: `estrutura_produto_cache` (Task 1), `consultarEstrutura(loja, idProduto)` de `lib/omie/malha.ts` (assinatura: `Promise<{ident?, itens?: {idProdMalha, descrProdMalha, quantProdMalha, percPerdaProdMalha, unidProdMalha}[]} | null>`), `getCurrentLojaId`/`isAdmin` de `lib/auth`, `createServiceClient` de `lib/supabase/server`.
- Produces: `POST /api/sync/estrutura-produto` — body `{ codigosProduto: number[] }` (lista de `codigo_produto` a sincronizar, já resolvida pelo caller a partir das OPs do período — esta rota NÃO decide o período, só executa a lista que recebe). Resposta: `{ ok: true, sincronizados, semEstrutura, falhas, abortadoPorBloqueioOmie, pendentes: number[] }` (pendentes = itens da lista que não foram alcançados, pro caller re-tentar depois).

- [ ] **Step 1: Escrever a rota**

```typescript
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId, isAdmin } from '@/lib/auth'
import { consultarEstrutura } from '@/lib/omie/malha'
import { OmieError, type LojaOmie } from '@/lib/omie/client'

export const maxDuration = 300

// Sync manual (nunca automática/cron -- ver Global Constraints do plano
// 2026-08-19-baixa-estoque-ordem-producao.md) da ficha técnica de produtos
// REAIS, só leitura (ConsultarEstrutura, nunca escreve na malha do
// cliente). Pacing de 10s -- bem mais conservador que os 3s que já
// travaram em MISUSE_API_PROCESS numa loja de teste no mesmo dia.
export async function POST(request: Request) {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Apenas administradores' }, { status: 403 })
  }
  const lojaId = await getCurrentLojaId()
  const body = (await request.json().catch(() => null)) as { codigosProduto?: number[] } | null
  const codigosProduto = Array.isArray(body?.codigosProduto) ? body.codigosProduto : []
  if (!codigosProduto.length) {
    return NextResponse.json({ error: 'codigosProduto vazio' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const { data: loja } = await supabase
    .from('lojas')
    .select('id, omie_app_key, omie_app_secret, is_test')
    .eq('id', lojaId)
    .single<LojaOmie>()
  if (!loja?.omie_app_key) {
    return NextResponse.json({ error: 'Loja sem integração Omie' }, { status: 400 })
  }

  const PACING_MS = 10_000

  // Pula quem já está em cache (independente de idade -- ficha técnica
  // muda pouco; refresh manual é só apagar a linha na tabela se precisar).
  const { data: jaSincronizados } = await supabase
    .from('estrutura_produto_cache')
    .select('codigo_produto')
    .eq('loja_id', loja.id)
    .in('codigo_produto', codigosProduto)
  const jaFeitos = new Set((jaSincronizados ?? []).map((r) => Number(r.codigo_produto)))
  const pendentesInicio = codigosProduto.filter((c) => !jaFeitos.has(c))

  // Mapa código_produto -> tipo_item, pra gravar o tipo do INSUMO junto
  // (a estrutura da Omie não devolve tipo_item do insumo, só descrição).
  const { data: produtosRows } = await supabase
    .from('produtos')
    .select('codigo_produto, tipo_item')
    .eq('loja_id', loja.id)
  const tipoPorCodigo = new Map((produtosRows ?? []).map((p) => [Number(p.codigo_produto), p.tipo_item as string | null]))

  let sincronizados = 0
  let semEstrutura = 0
  let falhas = 0
  let abortadoPorBloqueioOmie = false
  const pendentes: number[] = []

  for (let i = 0; i < pendentesInicio.length; i++) {
    const codigoProduto = pendentesInicio[i]
    let estrutura
    try {
      estrutura = await consultarEstrutura(loja, codigoProduto)
    } catch (e) {
      if (e instanceof OmieError && e.faultCode === 'MISUSE_API_PROCESS') {
        abortadoPorBloqueioOmie = true
        pendentes.push(...pendentesInicio.slice(i))
        break
      }
      falhas++
      pendentes.push(codigoProduto)
      await new Promise((r) => setTimeout(r, PACING_MS))
      continue
    }
    if (!estrutura?.itens?.length) {
      semEstrutura++
      // Sem estrutura é resposta definitiva -- não marca em cache (nada
      // pra gravar), mas também não fica pendente pra sempre: se quiser
      // reconfirmar depois, o caller reenvia esse código explicitamente.
      await new Promise((r) => setTimeout(r, PACING_MS))
      continue
    }
    let falhouAlgum = false
    for (const item of estrutura.itens) {
      const { error } = await supabase.from('estrutura_produto_cache').upsert(
        {
          loja_id: loja.id,
          codigo_produto: codigoProduto,
          codigo_produto_insumo: item.idProdMalha,
          descricao_insumo: item.descrProdMalha,
          quantidade: item.quantProdMalha,
          percentual_perda: item.percPerdaProdMalha ?? 0,
          unidade: item.unidProdMalha,
          tipo_insumo: tipoPorCodigo.get(item.idProdMalha) ?? null,
          sincronizado_em: new Date().toISOString(),
        },
        { onConflict: 'loja_id,codigo_produto,codigo_produto_insumo' }
      )
      if (error) {
        console.error('sync estrutura-produto: upsert falhou', codigoProduto, item.idProdMalha, error.message)
        falhouAlgum = true
      }
    }
    if (falhouAlgum) {
      falhas++
      pendentes.push(codigoProduto)
    } else {
      sincronizados++
    }
    await new Promise((r) => setTimeout(r, PACING_MS))
  }

  return NextResponse.json({
    ok: true,
    sincronizados,
    semEstrutura,
    falhas,
    abortadoPorBloqueioOmie,
    pendentes,
  })
}
```

- [ ] **Step 2: Rodar `npx tsc --noEmit`**

Run: `cd "/Users/joaquimsalles/Projects/norte para negocios/ntb estoque" && npx tsc --noEmit`
Expected: sem erro.

- [ ] **Step 3: Commit**

```bash
git add "app/api/sync/estrutura-produto/route.ts"
git commit -m "feat: rota manual de sync da ficha técnica de produto (lojas reais, pacing 10s)"
```

---

### Task 3: `lib/baixa-op.ts` — reconstrução da baixa por consumo de OP

**Files:**
- Create: `lib/baixa-op.ts`

**Interfaces:**
- Consumes: `LinhaOperAuto` type de `lib/movimentacao-operacao-auto.ts` (`{origem, sentido: 'E'|'S', local, tipo_sped, familia, produto, mes, inventario, qtde, valor}`), `labelTipoItem` de `lib/constants-omie`, `createServiceClient` de `lib/supabase/server`.
- Produces: `gerarBaixasDeOrdemProducao(lojaId: number, dataIni: string, dataFim: string): Promise<{ linhas: LinhaOperAuto[]; opsSemEstrutura: number; totalOps: number }>` — `opsSemEstrutura`/`totalOps` pro caller decidir se avisa o usuário que a cobertura tá baixa.

- [ ] **Step 1: Escrever o arquivo**

```typescript
// Reconstrói a baixa de estoque por CONSUMO DE ORDEM DE PRODUÇÃO -- gap
// documentado desde sempre em lib/movimentacao-operacao-auto.ts ("Consumo/
// Entrada de Ordem de Produção -- precisa de investigação separada...
// Fora do escopo por enquanto"). Cruza OPs concluídas com a ficha técnica
// em cache (estrutura_produto_cache, populada por
// app/api/sync/estrutura-produto/route.ts) e valoriza pelo CMC mais
// recente (posicao_estoques -- só existe o snapshot atual, não há CMC
// histórico por data de OP; consumo de meses passados é valorizado ao
// custo ATUAL, aproximação conhecida, ver plano
// docs/superpowers/plans/2026-08-19-baixa-estoque-ordem-producao.md).
import { createServiceClient } from '@/lib/supabase/server'
import { labelTipoItem } from '@/lib/constants-omie'
import type { LinhaOperAuto } from './movimentacao-operacao-auto'

type OpRow = {
  identificacao_n_cod_produto: number
  identificacao_n_qtde: number
  dt_conclusao_real: string
  produto_descricao: string | null
}
type EstruturaRow = {
  codigo_produto: number
  codigo_produto_insumo: number
  descricao_insumo: string | null
  quantidade: number
  percentual_perda: number
  tipo_insumo: string | null
}
type PosicaoRow = { n_cod_prod: number; n_cmc: number; n_saldo: number }

async function paginarTodos<T>(
  montar: (from: number, to: number) => PromiseLike<{ data: T[] | null }>
): Promise<T[]> {
  const PAGE = 1000
  const todos: T[] = []
  for (let p = 0; ; p++) {
    const { data } = await montar(p * PAGE, p * PAGE + PAGE - 1)
    if (!data?.length) break
    todos.push(...data)
    if (data.length < PAGE) break
  }
  return todos
}

export async function gerarBaixasDeOrdemProducao(
  lojaId: number,
  dataIni: string,
  dataFim: string
): Promise<{ linhas: LinhaOperAuto[]; opsSemEstrutura: number; totalOps: number }> {
  const supabase = createServiceClient()

  const ops = await paginarTodos<OpRow>((from, to) =>
    supabase
      .from('ordens_producao')
      .select('identificacao_n_cod_produto, identificacao_n_qtde, dt_conclusao_real, produto_descricao')
      .eq('loja_id', lojaId)
      .eq('concluida', true)
      .gte('dt_conclusao_real', dataIni)
      .lte('dt_conclusao_real', dataFim)
      .order('id')
      .range(from, to)
  )
  if (!ops.length) return { linhas: [], opsSemEstrutura: 0, totalOps: 0 }

  const codigosProduto = [...new Set(ops.map((o) => Number(o.identificacao_n_cod_produto)))]
  const estrutura = await paginarTodos<EstruturaRow>((from, to) =>
    supabase
      .from('estrutura_produto_cache')
      .select('codigo_produto, codigo_produto_insumo, descricao_insumo, quantidade, percentual_perda, tipo_insumo')
      .eq('loja_id', lojaId)
      .in('codigo_produto', codigosProduto)
      .order('id')
      .range(from, to)
  )
  const estruturaPorProduto = new Map<number, EstruturaRow[]>()
  for (const e of estrutura) {
    const lista = estruturaPorProduto.get(e.codigo_produto) ?? []
    lista.push(e)
    estruturaPorProduto.set(e.codigo_produto, lista)
  }

  // CMC mais recente por insumo -- mesmo padrão ponderado por saldo entre
  // locais já usado em app/(app)/relatorio-margem/page.tsx (evita pegar só
  // o maior valor entre locais, bug já corrigido lá na migration 082).
  const { data: fotoRow } = await supabase
    .from('posicao_estoques')
    .select('data_posicao')
    .eq('loja_id', lojaId)
    .order('data_posicao', { ascending: false })
    .limit(1)
    .single()
  const dataPosicao = (fotoRow as { data_posicao: string } | null)?.data_posicao ?? null
  const cmcPorInsumo = new Map<number, number>()
  if (dataPosicao) {
    const posicoes = await paginarTodos<PosicaoRow>((from, to) =>
      supabase
        .from('posicao_estoques')
        .select('n_cod_prod, n_cmc, n_saldo')
        .eq('loja_id', lojaId)
        .eq('data_posicao', dataPosicao)
        .gt('n_saldo', 0)
        .order('id')
        .range(from, to)
    )
    const acumPorCod = new Map<number, { somaValor: number; somaSaldo: number }>()
    for (const p of posicoes) {
      const acc = acumPorCod.get(p.n_cod_prod) ?? { somaValor: 0, somaSaldo: 0 }
      acc.somaValor += Number(p.n_cmc) * Number(p.n_saldo)
      acc.somaSaldo += Number(p.n_saldo)
      acumPorCod.set(p.n_cod_prod, acc)
    }
    for (const [cod, acc] of acumPorCod) {
      if (acc.somaSaldo > 0) cmcPorInsumo.set(cod, acc.somaValor / acc.somaSaldo)
    }
  }

  const linhas: LinhaOperAuto[] = []
  let opsSemEstrutura = 0
  for (const op of ops) {
    const codigoProduto = Number(op.identificacao_n_cod_produto)
    const itensEstrutura = estruturaPorProduto.get(codigoProduto)
    if (!itensEstrutura?.length) {
      opsSemEstrutura++
      continue
    }
    const qtdeProduzida = Number(op.identificacao_n_qtde)
    const mes = op.dt_conclusao_real.slice(0, 7)
    for (const item of itensEstrutura) {
      const qtdeConsumida = qtdeProduzida * Number(item.quantidade) * (1 + Number(item.percentual_perda) / 100)
      const cmc = cmcPorInsumo.get(item.codigo_produto_insumo) ?? 0
      if (cmc <= 0) continue // sem custo conhecido, não dá pra valorizar -- fica de fora, não vira R$0 enganoso
      linhas.push({
        origem: 'Consumo de Ordem de Produção',
        sentido: 'S',
        local: 'N/D',
        tipo_sped: item.tipo_insumo ? `${item.tipo_insumo}-${labelTipoItem(item.tipo_insumo)}` : 'N/D',
        familia: 'N/D',
        produto: item.descricao_insumo || `Insumo ${item.codigo_produto_insumo}`,
        mes,
        inventario: false,
        qtde: qtdeConsumida,
        valor: qtdeConsumida * cmc,
      })
    }
  }

  return { linhas, opsSemEstrutura, totalOps: ops.length }
}
```

- [ ] **Step 2: Rodar `npx tsc --noEmit`**

Run: `cd "/Users/joaquimsalles/Projects/norte para negocios/ntb estoque" && npx tsc --noEmit`
Expected: sem erro. Se `ordens_producao` não tiver as colunas `concluida`/`dt_conclusao_real`/`produto_descricao` exatamente com esses nomes, ajustar pro nome real confirmado em `supabase/migrations/012_cobertura_sync.sql` antes de prosseguir — não adivinhar.

- [ ] **Step 3: Teste manual com dado real**

Criar um script temporário `scripts/_tmp-test-baixa-op.ts`:
```typescript
import { gerarBaixasDeOrdemProducao } from '../lib/baixa-op'
async function main() {
  const r = await gerarBaixasDeOrdemProducao(2, '2026-01-01', '2026-07-31')
  console.log(JSON.stringify(r, null, 2))
}
main().catch((e) => { console.error(e); process.exit(1) })
```
Run: `npx tsx --env-file=.env.local scripts/_tmp-test-baixa-op.ts`
Expected: roda sem erro. Se `opsSemEstrutura` vier igual a `totalOps` (nenhuma linha gerada), é esperado ANTES de rodar a sync da Task 2 pros produtos da loja 2 -- não é bug, é falta de cache ainda. Depois de rodar o teste, apagar o script: `rm scripts/_tmp-test-baixa-op.ts`.

- [ ] **Step 4: Commit**

```bash
git add lib/baixa-op.ts
git commit -m "feat: reconstrói baixa de estoque por consumo de Ordem de Produção"
```

---

### Task 4: Ligar no relatório mensal + botão de sync na tela

**Files:**
- Modify: `lib/relatorio-mensal.ts`
- Modify: `lib/relatorio-mensal-pptx.ts`
- Modify: `app/(app)/relatorio-mensal/page.tsx`
- Create: `app/(app)/relatorio-mensal/sincronizar-estrutura-botao.tsx`

**Interfaces:**
- Consumes: `gerarBaixasDeOrdemProducao` (Task 3), `POST /api/relatorio-mensal/estrutura-pendente` (rota nova, ver Step 1) que devolve os `codigo_produto` com OP concluída no período mas sem cache — usada pelo botão pra montar a lista que manda pra `/api/sync/estrutura-produto` (Task 2).
- Produces: `RelatorioMensal.baixasEstoque: { revendaTop5: RankingItem[]; materiaPrimaTop5: RankingItem[]; opsSemEstrutura: number; totalOps: number }` de volta no tipo (removido em 2026-08-19, reintroduzido aqui com os 2 campos de cobertura a mais).

- [ ] **Step 1: Rota que lista produtos pendentes de estrutura, pro botão saber o que sincronizar**

Create `app/api/relatorio-mensal/estrutura-pendente/route.ts`:
```typescript
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId, getAtorGestao } from '@/lib/auth'

export const dynamic = 'force-dynamic'

// Produtos com OP concluída no período pedido que AINDA não têm ficha
// técnica em cache -- o botão da tela usa essa lista pra saber o que
// mandar pra app/api/sync/estrutura-produto (não sincroniza o catálogo
// inteiro, só quem teve OP de verdade no mês do relatório).
export async function GET(request: Request) {
  const lojaId = await getCurrentLojaId()
  if (!(await getAtorGestao()).podeGerir) {
    return NextResponse.json({ error: 'Sem permissão' }, { status: 403 })
  }
  const { searchParams } = new URL(request.url)
  const dataIni = searchParams.get('dataIni')
  const dataFim = searchParams.get('dataFim')
  if (!dataIni || !dataFim) {
    return NextResponse.json({ error: 'dataIni e dataFim obrigatórios' }, { status: 400 })
  }

  const supabase = createServiceClient()
  const { data: ops } = await supabase
    .from('ordens_producao')
    .select('identificacao_n_cod_produto')
    .eq('loja_id', lojaId)
    .eq('concluida', true)
    .gte('dt_conclusao_real', dataIni)
    .lte('dt_conclusao_real', dataFim)
  const codigosNoPeriodo = [...new Set((ops ?? []).map((o) => Number(o.identificacao_n_cod_produto)))]
  if (!codigosNoPeriodo.length) return NextResponse.json({ pendentes: [] })

  const { data: jaCacheados } = await supabase
    .from('estrutura_produto_cache')
    .select('codigo_produto')
    .eq('loja_id', lojaId)
    .in('codigo_produto', codigosNoPeriodo)
  const cacheados = new Set((jaCacheados ?? []).map((r) => Number(r.codigo_produto)))
  const pendentes = codigosNoPeriodo.filter((c) => !cacheados.has(c))

  return NextResponse.json({ pendentes })
}
```

- [ ] **Step 2: Estender `RelatorioMensal` e `carregarRelatorioMensal` em `lib/relatorio-mensal.ts`**

Adicionar ao tipo `RelatorioMensal` (depois de `comprasPerdas`):
```typescript
  baixasEstoque: {
    revendaTop5: RankingItem[]
    materiaPrimaTop5: RankingItem[]
    opsSemEstrutura: number
    totalOps: number
  }
```

No corpo de `carregarRelatorioMensal`, depois do bloco `return` ser montado (ou seja, calcular antes do `return`):
```typescript
  const { linhas: baixasOp, opsSemEstrutura, totalOps } = await gerarBaixasDeOrdemProducao(lojaId, dataIniAno, dataFimGrafico)
  const revendaBaixaMapa = new Map<string, number>()
  const mpBaixaMapa = new Map<string, number>()
  for (const linha of baixasOp) {
    if (linha.tipo_sped.startsWith('00-')) revendaBaixaMapa.set(linha.produto, (revendaBaixaMapa.get(linha.produto) ?? 0) + linha.valor)
    else if (linha.tipo_sped.startsWith('01-')) mpBaixaMapa.set(linha.produto, (mpBaixaMapa.get(linha.produto) ?? 0) + linha.valor)
  }
```
E adicionar `import { gerarBaixasDeOrdemProducao } from './baixa-op'` no topo, e no objeto de retorno:
```typescript
    baixasEstoque: {
      revendaTop5: topNDoMapa(revendaBaixaMapa, 5),
      materiaPrimaTop5: topNDoMapa(mpBaixaMapa, 5),
      opsSemEstrutura,
      totalOps,
    },
```

- [ ] **Step 3: Restaurar o slide em `lib/relatorio-mensal-pptx.ts`**

Depois do slide 6 (Compras e Perdas), antes do `n++` que antecede os slides de pontos de melhoria, adicionar:
```typescript
  // --- Slide 7: Baixas de Estoque (consumo de Ordem de Produção) ---
  {
    const slide = pptx.addSlide()
    tituloSlide(
      slide,
      'Dashboard — Baixas de Estoque: Revenda vs. Matéria-Prima',
      `Consumo de Ordem de Produção · ${periodoLabel} · top 5 de cada tipo · valorizado ao custo atual`
    )
    const b = dados.baixasEstoque
    graficoBarraRanking(slide, b.revendaTop5, LARANJA, { x: 0.4, y: 1.25, w: 6.1, h: 4.6, titulo: 'Material de Revenda' })
    graficoBarraRanking(slide, b.materiaPrimaTop5, NAVY_CLARO, { x: 6.8, y: 1.25, w: 6.1, h: 4.6, titulo: 'Matéria-Prima' })
    if (b.totalOps > 0 && b.opsSemEstrutura > 0) {
      slide.addText(
        `${b.opsSemEstrutura} de ${b.totalOps} Ordens de Produção do período sem ficha técnica sincronizada -- valores abaixo do real. Sincronize antes de enviar o relatório.`,
        { x: 0.4, y: 6.1, w: 12.5, h: 0.5, fontSize: 10, color: 'B5342A', italic: true }
      )
    }
    rodape(slide, loja, mesLabel, n)
  }
  n++

```
Precisa ficar ANTES do bloco `// --- Slides 7-8: Pontos de Melhoria` -- renomear os comentários desses dois slides pra `Slides 8-9` (e o slide final de Recomendações vira slide 10), já que agora são 10 slides de novo, igual ao R07.

- [ ] **Step 4: Botão de sincronizar estrutura na tela**

Create `app/(app)/relatorio-mensal/sincronizar-estrutura-botao.tsx`:
```typescript
'use client'
import { useState } from 'react'
import { Button } from '@/components/ui-kit/Button'

// Sincroniza SÓ os produtos com OP concluída no período que ainda não têm
// ficha técnica em cache (não o catálogo inteiro) -- pacing de 10s no
// servidor (app/api/sync/estrutura-produto/route.ts), pode demorar minutos
// se houver muitos produtos pendentes na primeira vez.
export function SincronizarEstruturaBotao({ dataIni, dataFim }: { dataIni: string; dataFim: string }) {
  const [status, setStatus] = useState<string | null>(null)
  const [carregando, setCarregando] = useState(false)

  async function sincronizar() {
    setCarregando(true)
    setStatus('Buscando produtos pendentes...')
    try {
      const resPendentes = await fetch(`/api/relatorio-mensal/estrutura-pendente?dataIni=${dataIni}&dataFim=${dataFim}`)
      const { pendentes } = await resPendentes.json()
      if (!pendentes?.length) {
        setStatus('Nada pendente -- ficha técnica já sincronizada pra este período.')
        return
      }
      setStatus(`Sincronizando ${pendentes.length} produto(s) -- pode levar alguns minutos...`)
      const res = await fetch('/api/sync/estrutura-produto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigosProduto: pendentes }),
      })
      const dados = await res.json()
      setStatus(
        `Sincronizados: ${dados.sincronizados} · Sem estrutura: ${dados.semEstrutura} · Falhas: ${dados.falhas}` +
          (dados.abortadoPorBloqueioOmie ? ' · BLOQUEADO PELA OMIE, tente de novo mais tarde.' : '')
      )
    } finally {
      setCarregando(false)
    }
  }

  return (
    <div className="space-y-2">
      <Button variant="outline" onClick={sincronizar} disabled={carregando}>
        {carregando ? 'Sincronizando...' : 'Sincronizar ficha técnica (Baixas de Estoque)'}
      </Button>
      {status && <p className="text-sm text-text-muted">{status}</p>}
    </div>
  )
}
```

- [ ] **Step 5: Incluir o botão em `app/(app)/relatorio-mensal/page.tsx`**

Dentro do card do formulário (depois do `<form>`, mesmo `<div className="rounded-xl border ...">`), adicionar `<SincronizarEstruturaBotao dataIni={...} dataFim={...} />` calculando `dataIni`/`dataFim` a partir de `opcoes[0]` (primeiro mês da lista, igual ao `defaultValue` do select) no formato `YYYY-MM-01`/último dia do mês -- reaproveitar a mesma lógica de `ultimoDiaMes` já usada em `lib/relatorio-mensal.ts` (duplicar as ~3 linhas da função aqui, é um componente client, não pode importar de um arquivo que usa `next/server`).

- [ ] **Step 6: `npx tsc --noEmit` e `npm run build`**

Run: `cd "/Users/joaquimsalles/Projects/norte para negocios/ntb estoque" && npx tsc --noEmit && npm run build`
Expected: sem erro.

- [ ] **Step 7: Commit**

```bash
git add lib/relatorio-mensal.ts lib/relatorio-mensal-pptx.ts "app/(app)/relatorio-mensal/page.tsx" "app/(app)/relatorio-mensal/sincronizar-estrutura-botao.tsx" app/api/relatorio-mensal/estrutura-pendente/route.ts
git commit -m "feat: religa baixa de estoque (consumo de OP) no relatório mensal + botão de sync"
```
