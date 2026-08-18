# Estoque local independente da Omie (lojas de teste) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ordem de Produção das 6 lojas de teste (`is_test=true`) passa a
baixar estoque de verdade num ledger local (ficha técnica + saldo +
movimentos), sem nenhuma chamada de escrita à Omie — lojas reais
continuam 100% inalteradas.

**Architecture:** 3 tabelas novas isoladas no Postgres self-hosted;
uma função central `baixarEstoqueLocal` chamada de dentro do branch
`is_test` já existente em `app/api/integracao/ordem-producao/route.ts`;
duas rotas de sync (ficha técnica via `consultarEstrutura` da Omie —
só leitura —, e saldo inicial via espelho de `posicao_estoques`); uma
tela admin-only pra operar tudo isso; e, por fim, configuração (não
código) pra ligar as 4 lojas Donana reais no `ntb-vendas` à respectiva
gêmea de teste, nos dois bancos desse outro repo.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Supabase self-hosted
(Postgres direto via `docker exec`, não via `scripts/aplicar-migration.mjs`
— ver Constraint abaixo).

**Spec:** `docs/superpowers/specs/2026-08-18-estoque-independente-omie-lojas-teste-design.md`

## Global Constraints

- **Banco alvo de TODA migration/query deste plano: o Postgres self-hosted
  no Contabo, NUNCA o Supabase Cloud que `.env.local`/`scripts/aplicar-migration.mjs`
  apontam por padrão** (aquele projeto está descontinuado/congelado — ver
  spec, seção "Contexto já investigado"). Toda migration deste plano é
  aplicada assim:
  ```bash
  scp -i ~/.ssh/notebook_contabo_key supabase/migrations/121_estoque_local_teste.sql root@185.193.66.240:/tmp/
  ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec -i supabase-db psql -U supabase_admin -d postgres < /tmp/121_estoque_local_teste.sql"
  ```
  Depois de aplicar, o arquivo `.sql` ainda é commitado no repo normalmente
  (histórico/documentação), só a APLICAÇÃO real é feita assim, não via
  `node scripts/aplicar-migration.mjs`.
- **Nunca escrever nem ler `is_test=false` em código novo.** Toda query
  nova (rotas de sync, a função de baixa) inclui `is_test` no `.select()`
  e recusa (400) se a loja resolvida não for `is_test=true` — mesmo
  princípio já documentado em AGENTS.md pro cast `.single<LojaOmie>()`
  não verificar a string do `.select()` em runtime.
- **`ficha_tecnica_local`/`estoque_local_saldos`/`movimentos_locais`
  nunca são lidas/escritas por nenhum código fora deste plano** — zero
  índice, FK ou JOIN com `ordens_producao`, `movimentos`,
  `posicao_estoques` reais.
- Depois de cada task: `npx tsc --noEmit` limpo antes de commitar.
- Não reaproveitar nem apagar `app/api/integracao/ordem-producao-teste/route.ts`,
  `ordens_producao_teste`, `lojas.integracao_teste_api_key` — scaffolding
  morto de uma tentativa anterior abandonada, fora de escopo tocar.

---

### Task 1: Migration — 3 tabelas novas

**Files:**
- Create: `supabase/migrations/121_estoque_local_teste.sql`

**Interfaces:**
- Produces: tabelas `ficha_tecnica_local(id, loja_id, codigo_produto,
  codigo_produto_insumo, descricao_insumo, quantidade, percentual_perda,
  unidade, sincronizado_em)`, `estoque_local_saldos(id, loja_id,
  codigo_produto, saldo, atualizado_em)`, `movimentos_locais(id, loja_id,
  codigo_produto, tipo, quantidade, saldo_apos, origem_n_cod_op,
  pedido_ref, criado_em)` — nomes de coluna exatos que toda task
  seguinte usa.

- [ ] **Step 1: Escrever a migration**

```sql
-- Estoque local independente da Omie, só pras lojas de teste
-- (is_test=true, migration 117). Ver docs/superpowers/specs/
-- 2026-08-18-estoque-independente-omie-lojas-teste-design.md.
-- Zero relação com ordens_producao/movimentos/posicao_estoques reais
-- de propósito -- nenhum relatório/tela existente deve ler estas 3
-- tabelas.

create table if not exists ficha_tecnica_local (
  id bigserial primary key,
  loja_id bigint not null references lojas(id) on delete cascade,
  codigo_produto bigint not null,
  codigo_produto_insumo bigint not null,
  descricao_insumo text,
  quantidade numeric(20,6) not null,
  percentual_perda numeric(6,2) not null default 0,
  unidade varchar(10),
  sincronizado_em timestamptz not null default now(),
  unique(loja_id, codigo_produto, codigo_produto_insumo)
);

create table if not exists estoque_local_saldos (
  id bigserial primary key,
  loja_id bigint not null references lojas(id) on delete cascade,
  codigo_produto bigint not null,
  saldo numeric(20,6) not null default 0,
  atualizado_em timestamptz not null default now(),
  unique(loja_id, codigo_produto)
);

create table if not exists movimentos_locais (
  id bigserial primary key,
  loja_id bigint not null references lojas(id) on delete cascade,
  codigo_produto bigint not null,
  tipo varchar(3) not null check (tipo in ('SAI','ENT')),
  quantidade numeric(20,6) not null,
  saldo_apos numeric(20,6) not null,
  origem_n_cod_op bigint,
  pedido_ref text,
  criado_em timestamptz not null default now()
);
create index if not exists idx_movimentos_locais_loja_produto
  on movimentos_locais(loja_id, codigo_produto, criado_em desc);
```

- [ ] **Step 2: Aplicar no banco self-hosted (nunca no Cloud)**

```bash
cd "/Users/joaquimsalles/Projects/norte para negocios/ntb estoque"
scp -i ~/.ssh/notebook_contabo_key supabase/migrations/121_estoque_local_teste.sql root@185.193.66.240:/tmp/
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec -i supabase-db psql -U supabase_admin -d postgres < /tmp/121_estoque_local_teste.sql"
```

Expected: `CREATE TABLE` × 3, `CREATE INDEX` × 1, sem erro.

- [ ] **Step 3: Verificar as 3 tabelas existem e estão vazias**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec supabase-db psql -U supabase_admin -d postgres -c \"select count(*) from ficha_tecnica_local; select count(*) from estoque_local_saldos; select count(*) from movimentos_locais;\""
```

Expected: 3 linhas, todas `count = 0`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/121_estoque_local_teste.sql
git commit -m "feat(estoque-local): tabelas ficha_tecnica_local, estoque_local_saldos, movimentos_locais"
```

---

### Task 2: Função central de baixa de estoque

**Files:**
- Create: `lib/estoque-local/baixa.ts`

**Interfaces:**
- Consumes: tabelas da Task 1 (nomes/colunas exatos acima), `createServiceClient` de `@/lib/supabase/server` (mesmo import de toda rota existente, ex. `app/api/sync/posicao/route.ts`).
- Produces:
  ```ts
  export interface ResultadoBaixaLocal {
    baixado: boolean
    itens: { codigoProdutoInsumo: number; quantidadeBaixada: number; saldoApos: number }[]
    motivo?: string // preenchido quando baixado=false (ex: "sem ficha técnica local cadastrada")
  }
  export async function baixarEstoqueLocal(
    supabase: ReturnType<typeof import('@/lib/supabase/server').createServiceClient>,
    lojaId: number,
    codigoProduto: number,
    quantidadeVendida: number,
    nCodOP: number,
    pedidoRef: string | null
  ): Promise<ResultadoBaixaLocal>
  ```
  Task 5 (a rota real) chama exatamente esta assinatura.

- [ ] **Step 1: Implementar**

```ts
import type { SupabaseClient } from '@supabase/supabase-js'

// Baixa de estoque local pras lojas de teste (is_test=true) --
// ver docs/superpowers/specs/2026-08-18-estoque-independente-omie-lojas-teste-design.md.
// Nunca chama a Omie. Sem ficha técnica local cadastrada pro produto:
// não é erro fatal, só não baixa nada (mesmo princípio de
// consultarEstrutura devolvendo null pra produto sem estrutura).

export interface ResultadoBaixaLocal {
  baixado: boolean
  itens: { codigoProdutoInsumo: number; quantidadeBaixada: number; saldoApos: number }[]
  motivo?: string
}

interface FichaTecnicaLinha {
  codigo_produto_insumo: number
  quantidade: number
  percentual_perda: number
}

export async function baixarEstoqueLocal(
  supabase: SupabaseClient,
  lojaId: number,
  codigoProduto: number,
  quantidadeVendida: number,
  nCodOP: number,
  pedidoRef: string | null
): Promise<ResultadoBaixaLocal> {
  const { data: ficha, error: fichaError } = await supabase
    .from('ficha_tecnica_local')
    .select('codigo_produto_insumo, quantidade, percentual_perda')
    .eq('loja_id', lojaId)
    .eq('codigo_produto', codigoProduto)
    .returns<FichaTecnicaLinha[]>()

  if (fichaError) {
    return { baixado: false, itens: [], motivo: `Falha ao ler ficha técnica local: ${fichaError.message}` }
  }
  if (!ficha || ficha.length === 0) {
    return { baixado: false, itens: [], motivo: 'Sem ficha técnica local cadastrada pra este produto' }
  }

  const itens: ResultadoBaixaLocal['itens'] = []

  for (const linha of ficha) {
    const quantidadeBaixar = quantidadeVendida * linha.quantidade * (1 + linha.percentual_perda / 100)

    const { data: saldoAtual } = await supabase
      .from('estoque_local_saldos')
      .select('saldo')
      .eq('loja_id', lojaId)
      .eq('codigo_produto', linha.codigo_produto_insumo)
      .maybeSingle<{ saldo: number }>()

    const saldoAnterior = saldoAtual?.saldo ?? 0
    const saldoApos = saldoAnterior - quantidadeBaixar

    await supabase.from('estoque_local_saldos').upsert(
      {
        loja_id: lojaId,
        codigo_produto: linha.codigo_produto_insumo,
        saldo: saldoApos,
        atualizado_em: new Date().toISOString(),
      },
      { onConflict: 'loja_id,codigo_produto' }
    )

    await supabase.from('movimentos_locais').insert({
      loja_id: lojaId,
      codigo_produto: linha.codigo_produto_insumo,
      tipo: 'SAI',
      quantidade: quantidadeBaixar,
      saldo_apos: saldoApos,
      origem_n_cod_op: nCodOP,
      pedido_ref: pedidoRef,
    })

    itens.push({ codigoProdutoInsumo: linha.codigo_produto_insumo, quantidadeBaixada: quantidadeBaixar, saldoApos })
  }

  return { baixado: true, itens }
}
```

- [ ] **Step 2: Verificar tipos**

```bash
cd "/Users/joaquimsalles/Projects/norte para negocios/ntb estoque" && npx tsc --noEmit
```

Expected: sem erro relacionado a `lib/estoque-local/baixa.ts`.

- [ ] **Step 3: Testar diretamente com dado real de uma loja de teste**

Usar a loja `12` ([TESTE] O Sertão Vai Virar Mar) e qualquer
`codigo_produto` que já exista em `produtos` pra essa loja (pegar um
com `node scripts/db.mjs` **não** — `.env.local` aponta pro Cloud
descontinuado, usar direto via SSH):

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec supabase-db psql -U supabase_admin -d postgres -c \"select codigo_produto, descricao from produtos where loja_id=12 limit 1\""
```

Anotar o `codigo_produto` retornado (chamar de `<COD>` abaixo). Inserir uma
ficha técnica de teste manual e rodar a função via um script Node ad-hoc:

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec supabase-db psql -U supabase_admin -d postgres -c \"insert into ficha_tecnica_local (loja_id, codigo_produto, codigo_produto_insumo, quantidade, percentual_perda) values (12, <COD>, 999999, 2, 10) on conflict do nothing\""
```

Criar `/tmp/teste-baixa.mjs` local (fora do repo, descartável) que
importa a função compilada... **mais simples**: testar via `curl`
direto na Task 5 depois de integrada (esta verificação aqui é só
tipo-checagem + a query manual acima confirmando que a tabela aceita
o insert). Rodar:

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec supabase-db psql -U supabase_admin -d postgres -c \"select * from ficha_tecnica_local where loja_id=12\""
```

Expected: 1 linha, confirma a tabela grava corretamente (a chamada
real da função acontece de ponta a ponta na Task 5/8 via a rota HTTP).

- [ ] **Step 4: Limpar a linha de teste manual**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec supabase-db psql -U supabase_admin -d postgres -c \"delete from ficha_tecnica_local where loja_id=12 and codigo_produto_insumo=999999\""
```

- [ ] **Step 5: Commit**

```bash
git add lib/estoque-local/baixa.ts
git commit -m "feat(estoque-local): baixarEstoqueLocal - deduz saldo local via ficha técnica"
```

---

### Task 3: Rota de sync — ficha técnica local

**Files:**
- Create: `app/api/sync/ficha-tecnica-local/route.ts`

**Interfaces:**
- Consumes: `getCurrentLojaId`/`isAdmin` de `@/lib/auth` (mesmo padrão de
  `app/api/sync/posicao/route.ts`), `consultarEstrutura` de
  `@/lib/omie/malha.ts` (assinatura já existente:
  `consultarEstrutura(loja: LojaOmie, codigoProduto: number): Promise<EstruturaResp | null>`,
  `EstruturaResp.itens: { idProdMalha, descrProdMalha, quantProdMalha, percPerdaProdMalha, unidProdMalha }[]`),
  tabela `produtos` (colunas `codigo_produto`, `loja_id`, já existentes).
- Produces: popula `ficha_tecnica_local` (Task 1).

- [ ] **Step 1: Implementar a rota**

```ts
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId, isAdmin } from '@/lib/auth'
import { consultarEstrutura } from '@/lib/omie/malha'
import type { LojaOmie } from '@/lib/omie/client'

export const maxDuration = 300

// Sincroniza a ficha técnica local a partir da Omie (só leitura,
// ConsultarEstrutura -- nunca escreve na malha da Omie). Só pra lojas
// is_test=true -- ver docs/superpowers/specs/
// 2026-08-18-estoque-independente-omie-lojas-teste-design.md.
export async function POST() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Apenas administradores' }, { status: 403 })
  }
  const lojaId = await getCurrentLojaId()
  const supabase = createServiceClient()
  const { data: loja } = await supabase
    .from('lojas')
    .select('id, omie_app_key, omie_app_secret, is_test')
    .eq('id', lojaId)
    .single<LojaOmie>()

  if (!loja?.omie_app_key) {
    return NextResponse.json({ error: 'Loja sem integração Omie' }, { status: 400 })
  }
  if (!loja.is_test) {
    return NextResponse.json({ error: 'Esta ação só é permitida em loja de teste' }, { status: 400 })
  }

  const { data: produtos } = await supabase
    .from('produtos')
    .select('codigo_produto')
    .eq('loja_id', loja.id)
    .returns<{ codigo_produto: number }[]>()

  let sincronizados = 0
  let semEstrutura = 0

  for (const produto of produtos ?? []) {
    const estrutura = await consultarEstrutura(loja, produto.codigo_produto)
    if (!estrutura?.itens?.length) {
      semEstrutura++
      continue
    }
    for (const item of estrutura.itens) {
      await supabase.from('ficha_tecnica_local').upsert(
        {
          loja_id: loja.id,
          codigo_produto: produto.codigo_produto,
          codigo_produto_insumo: item.idProdMalha,
          descricao_insumo: item.descrProdMalha,
          quantidade: item.quantProdMalha,
          percentual_perda: item.percPerdaProdMalha ?? 0,
          unidade: item.unidProdMalha,
          sincronizado_em: new Date().toISOString(),
        },
        { onConflict: 'loja_id,codigo_produto,codigo_produto_insumo' }
      )
    }
    sincronizados++
  }

  return NextResponse.json({ ok: true, sincronizados, semEstrutura, totalProdutos: (produtos ?? []).length })
}
```

- [ ] **Step 2: Verificar tipos**

```bash
npx tsc --noEmit
```

Expected: limpo.

- [ ] **Step 3: Testar via curl contra o ambiente self-hosted**

Precisa de sessão de admin autenticada com `current_loja_id = 12`
([TESTE] Sertão) — testar via login real na UI (`https://app-estoque.norteparanegocios.com.br`,
conta admin) é mais confiável que curl sem sessão aqui, já que a rota
depende de cookie de sessão (`getCurrentLojaId`). Logar, trocar pra
loja `[TESTE] O Sertão Vai Virar Mar`, disparar
`POST /api/sync/ficha-tecnica-local` via `fetch` no console do
DevTools:

```js
fetch('/api/sync/ficha-tecnica-local', { method: 'POST' }).then(r => r.json()).then(console.log)
```

Expected: `{ ok: true, sincronizados: N, semEstrutura: M, totalProdutos: N+M }`
com `N > 0` (pelo menos alguns produtos da loja real "O Sertão Vai
Virar Mar" têm estrutura cadastrada na Omie, confirmado em sessão
anterior — AGENTS.md: "Batata Frita 350g TINHA estrutura configurada").

- [ ] **Step 4: Confirmar no banco**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec supabase-db psql -U supabase_admin -d postgres -c \"select count(*), count(distinct codigo_produto) from ficha_tecnica_local where loja_id=12\""
```

Expected: `count > 0`.

- [ ] **Step 5: Commit**

```bash
git add app/api/sync/ficha-tecnica-local/route.ts
git commit -m "feat(estoque-local): rota de sync da ficha técnica (leitura Omie, nunca escreve)"
```

---

### Task 4: Rota de sync — saldo inicial (espelho de posicao_estoques)

**Files:**
- Create: `app/api/sync/estoque-local/route.ts`

**Interfaces:**
- Consumes: `getCurrentLojaId`/`isAdmin`, tabela `posicao_estoques`
  (colunas existentes: `loja_id`, `n_cod_prod`, `n_saldo`, `data_posicao`).
- Produces: popula `estoque_local_saldos` (Task 1).

- [ ] **Step 1: Implementar a rota**

```ts
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId, isAdmin } from '@/lib/auth'

// Espelha o saldo mais recente de posicao_estoques (já sincronizado
// via /api/sync/posicao, não chama a Omie de novo aqui) pra
// estoque_local_saldos -- ponto de partida do ledger local. Ação
// explícita: sobrescreve qualquer saldo local já divergido. Ver
// docs/superpowers/specs/2026-08-18-estoque-independente-omie-lojas-teste-design.md.
export async function POST() {
  if (!(await isAdmin())) {
    return NextResponse.json({ error: 'Apenas administradores' }, { status: 403 })
  }
  const lojaId = await getCurrentLojaId()
  const supabase = createServiceClient()
  const { data: loja } = await supabase
    .from('lojas')
    .select('id, is_test')
    .eq('id', lojaId)
    .single<{ id: number; is_test: boolean }>()

  if (!loja) {
    return NextResponse.json({ error: 'Loja não encontrada' }, { status: 400 })
  }
  if (!loja.is_test) {
    return NextResponse.json({ error: 'Esta ação só é permitida em loja de teste' }, { status: 400 })
  }

  // posicao_estoques tem 1 linha por (local_estoque, produto, dia) --
  // pega só a data mais recente por produto, somando os saldos de
  // todos os locais de estoque daquele dia.
  const { data: posicoes } = await supabase
    .from('posicao_estoques')
    .select('n_cod_prod, n_saldo, data_posicao')
    .eq('loja_id', loja.id)
    .order('data_posicao', { ascending: false })
    .returns<{ n_cod_prod: number; n_saldo: number; data_posicao: string }[]>()

  if (!posicoes?.length) {
    return NextResponse.json(
      { error: 'Nenhuma posição de estoque sincronizada ainda -- rode /api/sync/posicao nesta loja primeiro' },
      { status: 400 }
    )
  }

  const dataMaisRecente = posicoes[0].data_posicao
  const somaPorProduto = new Map<number, number>()
  for (const p of posicoes) {
    if (p.data_posicao !== dataMaisRecente) continue
    somaPorProduto.set(p.n_cod_prod, (somaPorProduto.get(p.n_cod_prod) ?? 0) + p.n_saldo)
  }

  let copiados = 0
  for (const [codigoProduto, saldo] of somaPorProduto) {
    await supabase.from('estoque_local_saldos').upsert(
      {
        loja_id: loja.id,
        codigo_produto: codigoProduto,
        saldo,
        atualizado_em: new Date().toISOString(),
      },
      { onConflict: 'loja_id,codigo_produto' }
    )
    copiados++
  }

  return NextResponse.json({ ok: true, copiados, dataPosicao: dataMaisRecente })
}
```

- [ ] **Step 2: Verificar tipos**

```bash
npx tsc --noEmit
```

- [ ] **Step 3: Testar via console do navegador (mesma sessão admin da Task 3)**

Se a loja de teste ainda não tem `posicao_estoques`, rodar primeiro
(mesmo console): `fetch('/api/sync/posicao', { method: 'POST' }).then(r => r.json()).then(console.log)` —
Expected `{ ok: true, registros: N }` com N > 0. Depois:

```js
fetch('/api/sync/estoque-local', { method: 'POST' }).then(r => r.json()).then(console.log)
```

Expected: `{ ok: true, copiados: N, dataPosicao: "YYYY-MM-DD" }`.

- [ ] **Step 4: Confirmar no banco**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec supabase-db psql -U supabase_admin -d postgres -c \"select count(*), sum(saldo) from estoque_local_saldos where loja_id=12\""
```

Expected: `count > 0`.

- [ ] **Step 5: Commit**

```bash
git add app/api/sync/estoque-local/route.ts
git commit -m "feat(estoque-local): rota de sync do saldo inicial (espelho de posicao_estoques)"
```

---

### Task 5: Ligar a baixa na rota real de Ordem de Produção

**Files:**
- Modify: `app/api/integracao/ordem-producao/route.ts` (bloco `finally`, ramo `if (loja.is_test)`, dentro do laço `for` de itens — ver arquivo completo já lido, a estrutura exata está documentada na spec, seção "Contexto já investigado")

**Interfaces:**
- Consumes: `baixarEstoqueLocal` da Task 2 (assinatura exata acima).

- [ ] **Step 1: Import novo no topo do arquivo**

Adicionar ao lado dos imports existentes de `lib/omie/ordem-producao`:

```ts
import { baixarEstoqueLocal } from '@/lib/estoque-local/baixa'
```

- [ ] **Step 2: Chamar a função dentro do ramo `if (loja.is_test)` do `finally`**

Local exato: dentro do `for` de itens, no bloco `finally`, ramo
`if (loja.is_test) { ... }`, logo **depois** do `.then(({ error }) => {...})`
que grava a `ordens_producao` simulada (o `nCodOP`/`produto.codigo_produto`/
`item.quantidade`/`cCodIntOP` já estão em escopo nesse ponto — não
precisa buscar de novo). Envolver em try/catch próprio pra nunca
derrubar a resposta HTTP:

```ts
          try {
            const baixa = await baixarEstoqueLocal(
              supabase,
              loja.id,
              produto.codigo_produto,
              item.quantidade,
              nCodOP,
              body.pedidoRef ?? null
            )
            if (!baixa.baixado) {
              console.warn(`integracao/ordem-producao (teste): ${baixa.motivo} (loja ${loja.id}, produto ${produto.codigo_produto})`)
            }
          } catch (e) {
            console.error('integracao/ordem-producao (teste): falha ao baixar estoque local:', e instanceof Error ? e.message : e)
          }
```

- [ ] **Step 3: Verificar tipos**

```bash
npx tsc --noEmit
```

Expected: limpo.

- [ ] **Step 4: Build de produção**

```bash
npm run build
```

Expected: compila sem erro.

- [ ] **Step 5: Teste de ponta a ponta via curl, direto na rota real**

Usar a chave de integração real da loja `[TESTE] O Sertão Vai Virar
Mar` — essa chave já existe (a mesma que `testvendase`/`ntb-vendas`
usa hoje, confirmada na investigação da spec). Não pode ser lida do
banco (é write-only por design da UI que a gera) — pedir pro usuário
ou usar a mesma sessão de admin pra REGENERAR a chave só pra este
teste (`components/loja/LojaCard.tsx` → loja `[TESTE] O Sertão Vai
Virar Mar` → "Integração com NTB Vendas" → regenerar), anotando o
valor mostrado uma única vez. Usar o `<COD>` de produto anotado na
Task 2 (precisa ter ficha técnica sincronizada pela Task 3 — se não
tiver, rodar a Task 3 pra esse produto específico primeiro, ou usar
outro `codigo_produto` que a Task 3 confirmou ter `semEstrutura=false`).

```bash
curl -s -X POST https://app-estoque.norteparanegocios.com.br/api/integracao/ordem-producao \
  -H "Authorization: Bearer <CHAVE_REGENERADA>" \
  -H "Content-Type: application/json" \
  -d '{"itens":[{"codigo":"<CODIGO_SKU_DO_PRODUTO>","quantidade":1}],"pedidoRef":"teste-plano-2026-08-18"}'
```

Expected: `{"lojaId":12,"resultados":[{"codigo":"...","ok":true,"nCodOP":<negativo>}]}`.

- [ ] **Step 6: Confirmar a baixa aconteceu**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec supabase-db psql -U supabase_admin -d postgres -c \"select * from movimentos_locais where loja_id=12 and pedido_ref='teste-plano-2026-08-18'\""
```

Expected: pelo menos 1 linha, `tipo='SAI'`, `saldo_apos` menor que o
saldo anterior confirmado na Task 4.

- [ ] **Step 7: Confirmar a loja REAL (id 4) não foi tocada**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec supabase-db psql -U supabase_admin -d postgres -c \"select count(*) from integration_attempts where loja_id=4 and created_at > now() - interval '5 minutes' and model ilike '%OrdemProducao%'\""
```

Expected: `count = 0` (nenhuma tentativa nova na loja real durante este teste).

- [ ] **Step 8: Regenerar a chave de teste de volta (não deixar a de teste exposta em log do plano) e commit**

```bash
git add app/api/integracao/ordem-producao/route.ts
git commit -m "feat(estoque-local): baixa local de estoque ligada na rota real de Ordem de Produção (só is_test)"
```

---

### Task 6: Tela admin — visualizar e operar o estoque local

**Files:**
- Create: `app/(app)/estoque-local-teste/page.tsx`

**Interfaces:**
- Consumes: `isAdmin` de `@/lib/auth`, `createServiceClient`, tabelas
  `lojas` (filtro `is_test=true`), `estoque_local_saldos`,
  `movimentos_locais` (Task 1).

- [ ] **Step 1: Implementar a página (Server Component com client bits pros botões)**

```tsx
import { redirect } from 'next/navigation'
import { isAdmin } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { SincronizarBotoes } from './sincronizar-botoes'

interface SaldoRow {
  codigo_produto: number
  saldo: number
  atualizado_em: string
}
interface MovimentoRow {
  id: number
  codigo_produto: number
  tipo: string
  quantidade: number
  saldo_apos: number
  origem_n_cod_op: number | null
  pedido_ref: string | null
  criado_em: string
}
interface LojaRow {
  id: number
  nome_fantasia: string
}

export default async function EstoqueLocalTestePage({
  searchParams,
}: {
  searchParams: Promise<{ loja?: string }>
}) {
  if (!(await isAdmin())) redirect('/')

  const supabase = createServiceClient()
  const { data: lojas } = await supabase
    .from('lojas')
    .select('id, nome_fantasia')
    .eq('is_test', true)
    .order('nome_fantasia')
    .returns<LojaRow[]>()

  const { loja: lojaParam } = await searchParams
  const lojaSelecionada = lojaParam ? Number(lojaParam) : lojas?.[0]?.id

  let saldos: SaldoRow[] = []
  let movimentos: MovimentoRow[] = []
  if (lojaSelecionada) {
    const [{ data: saldosData }, { data: movimentosData }] = await Promise.all([
      supabase
        .from('estoque_local_saldos')
        .select('codigo_produto, saldo, atualizado_em')
        .eq('loja_id', lojaSelecionada)
        .order('codigo_produto')
        .returns<SaldoRow[]>(),
      supabase
        .from('movimentos_locais')
        .select('id, codigo_produto, tipo, quantidade, saldo_apos, origem_n_cod_op, pedido_ref, criado_em')
        .eq('loja_id', lojaSelecionada)
        .order('criado_em', { ascending: false })
        .limit(50)
        .returns<MovimentoRow[]>(),
    ])
    saldos = saldosData ?? []
    movimentos = movimentosData ?? []
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-bold">Estoque local de teste</h1>
      <p className="text-sm text-muted-foreground">
        Só admin. Sem link na navegação principal. Dados aqui nunca aparecem em nenhum relatório real.
      </p>

      <form method="get" className="flex gap-2 items-center">
        <select name="loja" defaultValue={lojaSelecionada} className="border rounded px-2 py-1">
          {(lojas ?? []).map((l) => (
            <option key={l.id} value={l.id}>
              {l.nome_fantasia}
            </option>
          ))}
        </select>
        <button type="submit" className="border rounded px-3 py-1">
          Trocar loja
        </button>
      </form>

      {lojaSelecionada && <SincronizarBotoes />}

      <section>
        <h2 className="font-semibold mb-2">Saldo atual ({saldos.length} produtos)</h2>
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left border-b">
              <th className="py-1">Código produto</th>
              <th className="py-1">Saldo</th>
              <th className="py-1">Atualizado em</th>
            </tr>
          </thead>
          <tbody>
            {saldos.map((s) => (
              <tr key={s.codigo_produto} className="border-b">
                <td className="py-1">{s.codigo_produto}</td>
                <td className={`py-1 ${s.saldo < 0 ? 'text-red-600 font-semibold' : ''}`}>{s.saldo}</td>
                <td className="py-1">{new Date(s.atualizado_em).toLocaleString('pt-BR')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2 className="font-semibold mb-2">Movimentos recentes</h2>
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="text-left border-b">
              <th className="py-1">Quando</th>
              <th className="py-1">Produto</th>
              <th className="py-1">Tipo</th>
              <th className="py-1">Qtde</th>
              <th className="py-1">Saldo após</th>
              <th className="py-1">OP origem</th>
              <th className="py-1">Pedido</th>
            </tr>
          </thead>
          <tbody>
            {movimentos.map((m) => (
              <tr key={m.id} className="border-b">
                <td className="py-1">{new Date(m.criado_em).toLocaleString('pt-BR')}</td>
                <td className="py-1">{m.codigo_produto}</td>
                <td className="py-1">{m.tipo}</td>
                <td className="py-1">{m.quantidade}</td>
                <td className="py-1">{m.saldo_apos}</td>
                <td className="py-1">{m.origem_n_cod_op}</td>
                <td className="py-1">{m.pedido_ref}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}
```

- [ ] **Step 2: Componente client dos botões de sync**

Create: `app/(app)/estoque-local-teste/sincronizar-botoes.tsx`

```tsx
'use client'

import { useState } from 'react'

export function SincronizarBotoes() {
  const [mensagem, setMensagem] = useState<string | null>(null)
  const [carregando, setCarregando] = useState<string | null>(null)

  async function chamar(rota: string, label: string) {
    setCarregando(label)
    setMensagem(null)
    try {
      const res = await fetch(rota, { method: 'POST' })
      const json = await res.json()
      setMensagem(res.ok ? `${label}: ${JSON.stringify(json)}` : `Erro em ${label}: ${json.error}`)
    } catch (e) {
      setMensagem(`Erro em ${label}: ${e instanceof Error ? e.message : 'falha desconhecida'}`)
    } finally {
      setCarregando(null)
      window.location.reload()
    }
  }

  return (
    <div className="flex gap-2 items-center flex-wrap">
      <button
        type="button"
        disabled={carregando !== null}
        onClick={() => chamar('/api/sync/ficha-tecnica-local', 'Sincronizar ficha técnica')}
        className="border rounded px-3 py-1 disabled:opacity-50"
      >
        {carregando === 'Sincronizar ficha técnica' ? 'Sincronizando...' : 'Sincronizar ficha técnica'}
      </button>
      <button
        type="button"
        disabled={carregando !== null}
        onClick={() => chamar('/api/sync/estoque-local', 'Sincronizar saldo inicial')}
        className="border rounded px-3 py-1 disabled:opacity-50"
      >
        {carregando === 'Sincronizar saldo inicial' ? 'Sincronizando...' : 'Sincronizar saldo inicial'}
      </button>
      {mensagem && <span className="text-sm">{mensagem}</span>}
    </div>
  )
}
```

**Nota:** os botões chamam as rotas de sync usando a loja da SESSÃO
atual (`getCurrentLojaId()`), não a loja escolhida no seletor da URL —
documentar isso na própria página se causar confusão no QA (Step 3
abaixo cobre esse caso: trocar de loja de verdade via login/seletor de
loja do app, não só pelo dropdown desta tela).

- [ ] **Step 3: Verificar tipos e build**

```bash
npx tsc --noEmit && npm run build
```

Expected: ambos limpos.

- [ ] **Step 4: QA visual (chrome-devtools MCP), sessão admin real**

Login em `https://app-estoque.norteparanegocios.com.br` com conta
admin, navegar direto pra `/estoque-local-teste` (sem link na
navegação, confirmar isso também — não deve aparecer em nenhum menu).
Confirmar: seletor de loja só lista as 6 lojas `[TESTE]`, troca de
loja no dropdown atualiza a URL e a tabela, saldo negativo (se houver,
da Task 5) aparece em vermelho, tabela de movimentos mostra a linha do
teste da Task 5 com o `pedido_ref` correto.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/estoque-local-teste/"
git commit -m "feat(estoque-local): tela admin-only pra ver saldo/movimentos e disparar sync"
```

---

### Task 7: Ligar as 4 lojas Donana reais (config nos dois bancos do ntb-vendas)

**Files:** nenhum arquivo de código — só dado, nos dois bancos do
outro repo (`ntb-vendas`). Sem worktree/branch próprio necessário
(operação SQL direta via SSH, não faz sentido isolar em git).

**Interfaces:**
- Consumes: mecanismo de geração de chave já existente em
  `lib/actions/integracao-ntb-vendas.ts` (`gerarChave()`: 32 bytes
  aleatórios em hex) — replicado aqui via SQL puro
  (`encode(gen_random_bytes(32), 'hex')`, equivalente).

- [ ] **Step 1: Confirmar quais das 4 lojas Donana `[TESTE]` já têm `integracao_api_key`**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec supabase-db psql -U supabase_admin -d postgres -c \"select id, nome_fantasia, integracao_api_key is not null as tem_chave from lojas where is_test=true and nome_fantasia ilike '%donana%' order by id\""
```

- [ ] **Step 2: Gerar chave pra cada uma que não tiver (rodar por loja, guardando o valor de cada uma)**

Repetir pra cada `id` sem chave (do Step 1) — **anotar cada chave
retornada, é a única vez que ela é mostrada**:

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec supabase-db psql -U supabase_admin -d postgres -c \"update lojas set integracao_api_key = encode(gen_random_bytes(32), 'hex') where id = <ID_DA_LOJA_TESTE> returning id, nome_fantasia, integracao_api_key\""
```

- [ ] **Step 3: Descobrir o `store_id` de cada loja Donana REAL no `ntb-vendas` (self-hosted, `testvendase`)**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec supabase-db psql -U supabase_admin -d ntb_vendas -c \"select id, name, slug from stores where name ilike '%donana%' order by name\""
```

- [ ] **Step 4: Inserir `store_ntb_estoque_secrets` pra cada uma das 4, no banco self-hosted do `ntb-vendas`**

Repetir por loja, casando o `store_id` do Step 3 com a chave gerada no
Step 2 pra loja Donana correspondente (mesma marca — ex: "Donana Rio
Vermelho" real usa a chave da loja `[TESTE] DONANA RIO VERMELHO`):

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec supabase-db psql -U supabase_admin -d ntb_vendas -c \"insert into store_ntb_estoque_secrets (store_id, ntb_estoque_url, ntb_estoque_api_key) values ('<STORE_ID>', 'https://app-estoque.norteparanegocios.com.br', '<CHAVE_GERADA>') on conflict (store_id) do update set ntb_estoque_url = excluded.ntb_estoque_url, ntb_estoque_api_key = excluded.ntb_estoque_api_key\""
```

- [ ] **Step 5: Repetir Steps 3-4 no banco Supabase Cloud do `ntb-vendas`**

Mesmo princípio (lição da sessão de hoje: sempre os dois bancos). Do
diretório do repo `ntb-vendas`:

```bash
cd "/Users/joaquimsalles/Projects/norte para negocios/ntb vendas"
node scripts/db.mjs "select id, name, slug from stores where name ilike '%donana%' order by name"
node scripts/db.mjs "insert into store_ntb_estoque_secrets (store_id, ntb_estoque_url, ntb_estoque_api_key) values ('<STORE_ID>', 'https://app-estoque.norteparanegocios.com.br', '<CHAVE_GERADA>') on conflict (store_id) do update set ntb_estoque_url = excluded.ntb_estoque_url, ntb_estoque_api_key = excluded.ntb_estoque_api_key"
```

- [ ] **Step 6: Verificar as 4 lojas Donana agora têm a integração, nos dois bancos**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec supabase-db psql -U supabase_admin -d ntb_vendas -c \"select s.name from stores s join store_ntb_estoque_secrets sec on sec.store_id = s.id where s.name ilike '%donana%'\""
cd "/Users/joaquimsalles/Projects/norte para negocios/ntb vendas" && node scripts/db.mjs "select s.name from stores s join store_ntb_estoque_secrets sec on sec.store_id = s.id where s.name ilike '%donana%'"
```

Expected: 4 linhas em cada consulta.

- [ ] **Step 7: Nenhum commit de código nesta task** — é só dado. Se
  quiser deixar rastro, adicionar uma linha no `AGENTS.md` do
  `ntb-estoque` (seção nova, curta) documentando que as 4 Donana Teste
  ganharam a integração — opcional, não bloqueante.

---

### Task 8: Verificação final — as 6 lojas de teste, ponta a ponta

**Files:** nenhum (só verificação).

- [ ] **Step 1: Rodar Task 3 + Task 4 (sync ficha técnica + saldo inicial) pras outras 5 lojas de teste**

Repetir o fluxo do Step 3 da Task 3 e Step 3 da Task 4 (login admin,
trocar de loja, disparar os 2 syncs) pra: `[TESTE] VINHAS & VINHETOS`,
`[TESTE] DONANA VILAS DO ATLANTICO`, `[TESTE] DONANA RIO VERMELHO`,
`[TESTE] DONANA PRAIA DO FORTE`, `[TESTE] DONANA BROTAS`.

- [ ] **Step 2: Confirmar as 6 lojas de teste têm saldo local**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec supabase-db psql -U supabase_admin -d postgres -c \"select l.nome_fantasia, count(e.id) as produtos_com_saldo from lojas l left join estoque_local_saldos e on e.loja_id = l.id where l.is_test=true group by l.nome_fantasia order by l.nome_fantasia\""
```

Expected: 6 linhas, todas com `produtos_com_saldo > 0`.

- [ ] **Step 3: `tsc`/`build` finais**

```bash
cd "/Users/joaquimsalles/Projects/norte para negocios/ntb estoque" && npx tsc --noEmit && npm run build
```

Expected: ambos limpos.

- [ ] **Step 4: Confirmar zero impacto nas lojas reais desde o início deste plano**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec supabase-db psql -U supabase_admin -d postgres -c \"select loja_id, count(*) from integration_attempts where loja_id in (2,3,4,5,6,7) and model in ('IncluirOrdemProducao','ConcluirOrdemProducao') and created_at > (select min(created_at) from ficha_tecnica_local) group by loja_id\""
```

Expected: 0 linhas (nenhuma chamada de escrita real de OP em loja real
desde o início deste plano — `IncluirOrdemProducao`/`ConcluirOrdemProducao`
sem prefixo `[SIMULADO]` só existem, pra loja real, dentro de
`lib/omie/ordem-producao.ts` mesmo, nunca bloqueadas — este check
confirma que nenhuma delas foi disparada pra loja real durante o
trabalho deste plano).

- [ ] **Step 5: Deploy**

Confirmar como este projeto deploya pro self-hosted (mesmo padrão do
`ntb-vendas`, `deploy.sh` — AGENTS.md documenta "Deploy: manual,
`deploy.sh` não versionado" pro `ntb-estoque`; achar e rodar o
equivalente, ou perguntar ao usuário o comando exato se não achar
documentado, antes de assumir).
