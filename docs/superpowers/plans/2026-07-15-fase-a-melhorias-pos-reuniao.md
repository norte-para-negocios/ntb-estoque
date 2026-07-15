# Fase A: melhorias pós-reunião 2026-07-14 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar os 7 itens independentes da Fase A definidos no spec (`docs/superpowers/specs/2026-07-15-fase-a-melhorias-pos-reuniao-design.md`): 2 renomeações, 1 tooltip, 1 melhoria visual, previsão de venda com janela editável, e o sistema de produto-substituto (triangulação) com fallback na previsão.

**Architecture:** Mudanças pontuais em componentes/páginas existentes (App Router, Server Components por padrão), seguindo o padrão já estabelecido no repo: colunas de `<Lista>` como array de objetos com `render()`, tabelas de admin (migration + `lib/actions/*.ts` com `requirePermissao` + `<Lista>`/dialog), e o cron `sync-previsao` que grava em `previsao_venda`.

**Tech Stack:** Next.js 16 App Router, TypeScript, Supabase (Postgres + RLS), Tailwind.

## Global Constraints

- Este repo **não tem suite de testes automatizada** (sem Jest/Vitest/Playwright configurado — confirmado via `package.json`). Verificação de cada tarefa é **manual**, via `npm run dev` e navegação real na tela afetada. Não escrever testes automatizados novos que não têm como rodar.
- Migrations aplicadas via `node scripts/aplicar-migration.mjs <arquivo>.sql` (não há CLI do Supabase configurada nesse repo).
- Próximo número de migration livre: **073** (última existente: `072_ordens_producao_retry_conclusao.sql`).
- Seguir a convenção de nomes já usada: tabelas/colunas em `snake_case` português, sem acento.
- Fora de escopo (não tocar): Fase B (relatórios financeiros/migração pro padrão híbrido Contabo) e o fix de OP em lote (já implementado em `a71c168`).

---

### Task 1: Renomear coluna "Comprar" → "Repor"

**Files:**
- Modify: `app/(app)/produto/page.tsx:592`

**Interfaces:** nenhuma — mudança de string isolada, não afeta nenhuma outra task.

- [ ] **Step 1: Editar o label**

Em `app/(app)/produto/page.tsx`, linha 592, trocar:

```tsx
                {
                  label: 'Comprar',
```

por:

```tsx
                {
                  label: 'Repor',
```

- [ ] **Step 2: Verificação manual**

Rodar `npm run dev`, abrir `/produto?vista=compras`, confirmar que o cabeçalho da coluna agora mostra "Repor" em vez de "Comprar".

- [ ] **Step 3: Commit**

```bash
git add "app/(app)/produto/page.tsx"
git commit -m "fix(produto): renomeia coluna 'Comprar' para 'Repor'"
```

---

### Task 2: Renomear campo de quantidade de etiquetas → "QTD Etiqueta"

**Files:**
- Modify: `components/ordem-producao/OrdemProducaoRow.tsx:656`

**Interfaces:** nenhuma — mudança de string isolada.

- [ ] **Step 1: Editar o label**

Em `components/ordem-producao/OrdemProducaoRow.tsx`, linha 655-656, trocar:

```tsx
            <label className="mb-1.5 block text-[13px] font-medium text-text-muted">
              Quantidade de etiquetas a imprimir
            </label>
```

por:

```tsx
            <label className="mb-1.5 block text-[13px] font-medium text-text-muted">
              QTD Etiqueta
            </label>
```

- [ ] **Step 2: Verificação manual**

Rodar `npm run dev`, abrir uma Ordem de Produção em modo mobile/dialog de edição ("Editar OP"), confirmar que o campo antes chamado "Quantidade de etiquetas a imprimir" agora mostra "QTD Etiqueta".

- [ ] **Step 3: Commit**

```bash
git add components/ordem-producao/OrdemProducaoRow.tsx
git commit -m "fix(ordem-producao): renomeia campo pra 'QTD Etiqueta'"
```

---

### Task 3: Tooltip no nome de produto truncado (OrdemProducaoRow)

**Files:**
- Modify: `components/ordem-producao/OrdemProducaoRow.tsx:631,786,865`

**Interfaces:** nenhuma.

- [ ] **Step 1: Adicionar `title` nos 3 pontos**

Linha 631, trocar:
```tsx
          <div className="truncate text-[13px] text-text-muted">{op.produto}</div>
```
por:
```tsx
          <div className="truncate text-[13px] text-text-muted" title={op.produto}>{op.produto}</div>
```

Linha 786, trocar:
```tsx
          <div className="truncate font-medium text-text">
            {op.produto}
            <span className="ml-1.5 text-[11px] font-normal text-text-muted">{op.unidade}</span>
          </div>
```
por:
```tsx
          <div className="truncate font-medium text-text" title={op.produto}>
            {op.produto}
            <span className="ml-1.5 text-[11px] font-normal text-text-muted">{op.unidade}</span>
          </div>
```

Linha 865, trocar:
```tsx
          <div className="truncate text-[13px] font-medium leading-snug text-text">{op.produto}</div>
```
por:
```tsx
          <div className="truncate text-[13px] font-medium leading-snug text-text" title={op.produto}>{op.produto}</div>
```

- [ ] **Step 2: Verificação manual**

Rodar `npm run dev`, abrir a lista de Ordens de Produção (desktop e mobile), passar o mouse sobre um produto com nome cortado e confirmar que aparece o tooltip nativo do navegador com o nome completo. Pedir pro Ramon confirmar depois se o "abrir link novo" relatado na reunião ainda acontece — se sim, é bug separado, não coberto por esta task.

- [ ] **Step 3: Commit**

```bash
git add components/ordem-producao/OrdemProducaoRow.tsx
git commit -m "fix(ordem-producao): adiciona tooltip no nome de produto truncado"
```

---

### Task 4: Clareza visual origem → destino (Transferências)

**Files:**
- Modify: `app/(app)/transferencia/page.tsx:266-274`

**Interfaces:** nenhuma.

- [ ] **Step 1: Editar o render da coluna "Estoque"**

Trocar (linhas 266-274):

```tsx
            render: (t) => {
              const origem = localMap.get(t.codigo_local_origem) || t.codigo_local_origem
              const destino = localMap.get(t.codigo_local_destino) || t.codigo_local_destino
              return (
                <span>
                  <span className="num text-text-muted">#{t.id}</span> {origem} {' → '} {destino}
                </span>
              )
            },
```

por:

```tsx
            render: (t) => {
              const origem = localMap.get(t.codigo_local_origem) || t.codigo_local_origem
              const destino = localMap.get(t.codigo_local_destino) || t.codigo_local_destino
              return (
                <span className="inline-flex flex-wrap items-center gap-1.5">
                  <span className="num text-text-muted">#{t.id}</span>
                  <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[12px] text-text-muted">{origem}</span>
                  <span className="text-text-muted">→</span>
                  <span className="rounded bg-ok/15 px-1.5 py-0.5 text-[12px] font-medium text-ok">{destino}</span>
                </span>
              )
            },
```

- [ ] **Step 2: Verificação manual**

Rodar `npm run dev`, abrir `/transferencia`, confirmar que origem aparece num badge cinza e destino num badge verde, com seta entre os dois, mais legível que o texto corrido anterior.

- [ ] **Step 3: Commit**

```bash
git add "app/(app)/transferencia/page.tsx"
git commit -m "feat(transferencia): diferencia visualmente origem e destino"
```

---

### Task 5: Migration — janela editável na previsão de venda

**Files:**
- Create: `supabase/migrations/073_previsao_venda_janela.sql`

**Interfaces:**
- Produces: coluna `previsao_venda.janela_dias integer not null default 7`; unique constraint nova `previsao_venda_loja_produto_janela_key` em `(loja_id, n_cod_prod, janela_dias)` — Task 6 e Task 7 dependem dessa coluna/constraint existir.

- [ ] **Step 1: Escrever a migration**

```sql
-- 073_previsao_venda_janela.sql
-- Permite ter mais de uma janela de previsao (7/15/30 dias) por produto,
-- em vez de uma unica linha fixa de 7 dias. Cron passa a gravar as 3 janelas
-- de uma vez; a tela de Repor deixa o usuario escolher qual exibir.

alter table previsao_venda
  add column if not exists janela_dias integer not null default 7;

-- A constraint antiga so cobria (loja_id, n_cod_prod) -- com 3 janelas por
-- produto isso colidiria. Substitui pela constraint que inclui janela_dias.
alter table previsao_venda
  drop constraint if exists previsao_venda_loja_id_n_cod_prod_key;

alter table previsao_venda
  add constraint previsao_venda_loja_produto_janela_key
  unique (loja_id, n_cod_prod, janela_dias);

-- produtos_repor() precisa continuar enxergando so a janela padrao de 7 dias,
-- senao um produto apareceria repetido (uma vez por janela). Corpo identico
-- ao de 013_produtos_repor.sql, so com "and pv.janela_dias = 7" adicionado
-- no join de previsao_venda.
create or replace function produtos_repor(p_loja_id bigint)
returns setof bigint
language sql
stable
as $$
  with ultima as (
    select max(data_posicao) as d from posicao_estoques where loja_id = p_loja_id
  ),
  pos as (
    select n_cod_prod, sum(n_saldo) as saldo, sum(estoque_minimo) as min_omie
    from posicao_estoques, ultima
    where loja_id = p_loja_id and data_posicao = ultima.d
    group by n_cod_prod
  )
  select p.codigo_produto
  from produtos p
  join pos on pos.n_cod_prod = p.codigo_produto
  left join previsao_venda pv on pv.loja_id = p.loja_id
    and pv.n_cod_prod = p.codigo_produto
    and pv.janela_dias = 7
  where p.loja_id = p_loja_id
    and coalesce(p.estoque_minimo, pos.min_omie) > 0
    and greatest(0, coalesce(p.estoque_minimo, pos.min_omie) + coalesce(pv.qtde, 0) - pos.saldo) > 0;
$$;

grant execute on function produtos_repor(bigint) to anon, authenticated, service_role;
```

- [ ] **Step 2: Aplicar a migration**

```bash
node scripts/aplicar-migration.mjs 073_previsao_venda_janela.sql
```

Esperado: sem erro, `ALTER TABLE`/`CREATE OR REPLACE FUNCTION` confirmados no output do script.

- [ ] **Step 3: Verificação manual**

Rodar `node scripts/db.mjs "select column_name from information_schema.columns where table_name = 'previsao_venda'"` (ou script equivalente de SQL ad-hoc do repo) e confirmar que `janela_dias` aparece.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/073_previsao_venda_janela.sql
git commit -m "feat(db): adiciona janela_dias em previsao_venda pra suportar 3 janelas de previsao"
```

---

### Task 6: Cron calcula as 3 janelas (7/15/30 dias)

**Files:**
- Modify: `lib/omie/previsao-venda.ts`

**Interfaces:**
- Consumes: coluna `janela_dias` da Task 5.
- Produces: `syncPrevisaoVenda(loja)` continua com a mesma assinatura pública (Task 9/11 e a rota do cron não mudam a chamada), mas agora grava 3 linhas por produto (uma por `janela_dias` em `[7, 15, 30]`).

- [ ] **Step 1: Reescrever `syncPrevisaoVenda` pra calcular as 3 janelas**

Substituir o conteúdo de `lib/omie/previsao-venda.ts` inteiro por:

```ts
import { buscarSaidasPeriodo } from './movimento'
import { createServiceClient } from '@/lib/supabase/server'
import { logIntegrationAttempt, type LojaOmie } from './client'

const JANELAS_DIAS = [7, 15, 30] as const

function fmtBR(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return `${dd}/${mm}/${d.getFullYear()}`
}
function isoDate(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

/**
 * Calcula a previsao de venda das proximas janelas (7/15/30 dias) por produto,
 * a partir das saidas de estoque no mesmo periodo do ANO ANTERIOR
 * (ListarMovimentos). Grava uma linha por (produto, janela) em previsao_venda.
 */
export async function syncPrevisaoVenda(loja: LojaOmie) {
  const hoje = new Date()
  hoje.setHours(0, 0, 0, 0)

  const supabase = createServiceClient()
  const rows: {
    loja_id: number
    n_cod_prod: number
    qtde: number
    janela_dias: number
    periodo_ini: string
    periodo_fim: string
    updated_at: string
  }[] = []

  try {
    for (const janela of JANELAS_DIAS) {
      const fim = new Date(hoje)
      fim.setDate(fim.getDate() + janela)

      const iniAnt = new Date(hoje)
      iniAnt.setFullYear(iniAnt.getFullYear() - 1)
      const fimAnt = new Date(fim)
      fimAnt.setFullYear(fimAnt.getFullYear() - 1)

      const saidas = await buscarSaidasPeriodo(loja, fmtBR(iniAnt), fmtBR(fimAnt))

      const periodoIni = isoDate(iniAnt)
      const periodoFim = isoDate(fimAnt)
      for (const [nCodProd, qtde] of saidas.entries()) {
        rows.push({
          loja_id: loja.id,
          n_cod_prod: nCodProd,
          qtde,
          janela_dias: janela,
          periodo_ini: periodoIni,
          periodo_fim: periodoFim,
          updated_at: new Date().toISOString(),
        })
      }
    }

    // Substitui as previsoes da loja pelas novas (produto sem saida fica sem registro = 0)
    await supabase.from('previsao_venda').delete().eq('loja_id', loja.id)
    if (rows.length) {
      await supabase.from('previsao_venda').upsert(rows, { onConflict: 'loja_id,n_cod_prod,janela_dias' })
    }

    await logIntegrationAttempt({
      loja_id: loja.id,
      model: 'PrevisaoVenda',
      request: JSON.stringify({ janelas: JANELAS_DIAS }),
      response: JSON.stringify({ produtos: rows.length }),
      code: '200',
    })

    return rows.length
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await logIntegrationAttempt({
      loja_id: loja.id,
      model: 'PrevisaoVenda',
      request: 'syncPrevisaoVenda',
      error: true,
      error_message: msg,
    })
    throw e
  }
}
```

- [ ] **Step 2: Verificação manual**

Rodar `npm run dev`, chamar manualmente a rota do cron localmente (`curl` com o header de auth esperado por `assertCronAuth`, ver `lib/omie/sync-all.ts`) ou rodar `syncPrevisaoVenda` via um script ad-hoc apontando pra uma loja de teste, e confirmar via `node scripts/db.mjs "select n_cod_prod, janela_dias, qtde from previsao_venda where loja_id = <id> limit 10"` que agora existem até 3 linhas por produto (`janela_dias` 7, 15, 30).

- [ ] **Step 3: Commit**

```bash
git add lib/omie/previsao-venda.ts
git commit -m "feat(previsao): calcula as 3 janelas (7/15/30 dias) no mesmo sync"
```

---

### Task 7: Seletor de janela na tela de Repor

**Files:**
- Modify: `app/(app)/produto/page.tsx`

**Interfaces:**
- Consumes: `previsao_venda.janela_dias` (Task 5), dados já gravados por `syncPrevisaoVenda` (Task 6).
- Produces: novo searchParam `janela` (`'7' | '15' | '30'`, default `'7'`) — só consumido dentro desta página, nenhuma outra task depende disso.

- [ ] **Step 1: Adicionar `janela` ao tipo de `searchParams` e ler o valor**

A assinatura da página (linha 82-87) é:
```ts
export default async function ProdutoPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; familia?: string; tipo?: string; situacao?: string; margem?: string; vista?: string; repor?: string; ord?: string; page?: string; fornecedor?: string; pdv?: string }>
}) {
```
Adicionar `janela?: string` ao tipo, trocando pra:
```ts
  searchParams: Promise<{ q?: string; familia?: string; tipo?: string; situacao?: string; margem?: string; vista?: string; repor?: string; ord?: string; page?: string; fornecedor?: string; pdv?: string; janela?: string }>
```

Logo depois da linha `const vista = params.vista === 'compras' ? 'compras' : 'precos'`, adicionar:
```ts
  const janelaAtual = params.janela === '15' || params.janela === '30' ? Number(params.janela) : 7
```

- [ ] **Step 2: Filtrar a query de `previsao_venda` pela janela escolhida**

Na query de `previsao_venda` (linhas 272-276 do arquivo original), trocar:
```ts
      ? supabase.from('previsao_venda').select('n_cod_prod, qtde').eq('loja_id', lojaId).in('n_cod_prod', codigos)
```
por:
```ts
      ? supabase
          .from('previsao_venda')
          .select('n_cod_prod, qtde')
          .eq('loja_id', lojaId)
          .eq('janela_dias', janelaAtual)
          .in('n_cod_prod', codigos)
```

- [ ] **Step 3: Adicionar o seletor visual, mesmo padrão da pill Preços/Compras**

Logo depois do bloco de tabs Preços/Compras existente (o `<div className="inline-flex ...">{(['precos', 'compras'] as const).map(...)}</div>`, por volta da linha 444-461), adicionar um segundo grupo de pills, visível só na vista "compras" (onde a coluna "Repor"/"Prev. venda" aparece), seguindo o mesmo padrão de montar a URL a partir de `exportParams`:

```tsx
          {vista === 'compras' && (
            <div className="inline-flex rounded-md border border-border bg-surface p-0.5 text-[13px]">
              {([7, 15, 30] as const).map((dias) => {
                const spJanela = new URLSearchParams(exportParams.toString())
                if (params.margem) spJanela.set('margem', params.margem)
                spJanela.set('vista', 'compras')
                spJanela.set('janela', String(dias))
                const ativo = janelaAtual === dias
                return (
                  <Link
                    key={dias}
                    href={`/produto?${spJanela.toString()}`}
                    className={`rounded px-3 py-1 font-medium transition-colors ${ativo ? 'bg-brand text-white' : 'text-text-muted hover:text-text'}`}
                  >
                    {dias === 7 ? '1 semana' : dias === 15 ? '15 dias' : '1 mês'}
                  </Link>
                )
              })}
            </div>
          )}
```

`Link` e `exportParams` já estão em escopo/importados nesse ponto do arquivo (mesmo bloco onde o toggle Preços/Compras já usa os dois).

- [ ] **Step 4: Verificação manual**

Rodar `npm run dev`, abrir `/produto?vista=compras`, confirmar que aparece o seletor "1 semana / 15 dias / 1 mês", que o valor de "Prev. venda" muda ao trocar de opção, e que a URL reflete `?vista=compras&janela=15` etc.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/produto/page.tsx"
git commit -m "feat(produto): seletor de janela de previsao (semana/15 dias/mes)"
```

---

### Task 8: Migration — tabela `produto_substituicoes`

**Files:**
- Create: `supabase/migrations/074_produto_substituicoes.sql`

**Interfaces:**
- Produces: tabela `produto_substituicoes(id, loja_id, n_cod_prod, substitui_n_cod_prod, created_at)`, unique em `(loja_id, n_cod_prod)`. Permissões `'Produto Substituicoes'` / `'... - Criar'` / `'... - Excluir'`. Task 9, 10 e 11 dependem desta tabela/permissões.

- [ ] **Step 1: Escrever a migration**

Seguir exatamente o padrão de `069_categorias_contabeis.sql` (schema + seed de permissões). Conteúdo:

```sql
-- 074_produto_substituicoes.sql
-- Mapeamento manual "produto sem historico usa a previsao de outro produto"
-- (ex: Heineken descontinuado, substituido por Spaten -- Spaten nao tem
-- historico proprio ainda, entao usa o historico do Heineken). 1:1 por loja.
-- Puramente local (igual categorias_contabeis, migration 069): sem RLS,
-- controle de acesso feito na camada de aplicacao via requirePermissao +
-- createServiceClient() nas server actions.

create table if not exists produto_substituicoes (
  id bigint generated always as identity primary key,
  loja_id bigint not null references lojas(id) on delete cascade,
  n_cod_prod bigint not null,
  substitui_n_cod_prod bigint not null,
  created_at timestamptz not null default now(),
  unique (loja_id, n_cod_prod)
);

create index if not exists produto_substituicoes_loja_idx on produto_substituicoes(loja_id);

insert into permissoes (nome) values
  ('Produto Substituicoes'),
  ('Produto Substituicoes - Criar'),
  ('Produto Substituicoes - Excluir')
on conflict (nome) do nothing;
```

- [ ] **Step 2: Aplicar a migration**

```bash
node scripts/aplicar-migration.mjs 074_produto_substituicoes.sql
```

- [ ] **Step 3: Verificação manual**

`node scripts/db.mjs "select * from produto_substituicoes limit 1"` — esperado: erro "nenhuma linha" ou array vazio (tabela existe e está vazia), não erro de "tabela não existe".

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/074_produto_substituicoes.sql
git commit -m "feat(db): cria tabela produto_substituicoes pra triangulacao de previsao"
```

---

### Task 9: Server actions de `produto_substituicoes`

**Files:**
- Create: `lib/actions/produto-substituicao.ts`

**Interfaces:**
- Consumes: tabela da Task 8; `getCurrentLojaId`/`requirePermissao` (`lib/auth.ts`), `createServiceClient` (`lib/supabase/server.ts`), `registrarAuditoria` (`lib/auditoria.ts`) — mesmos helpers usados em `lib/actions/categoria-contabil.ts`.
- Produces: `criarProdutoSubstituicao(dados: ProdutoSubstituicaoInput): Promise<{ error: string } | { ok: true }>`, `excluirProdutoSubstituicao(id: number): Promise<{ error: string } | { ok: true }>` — Task 10 consome as duas, checando `res?.error`.

- [ ] **Step 1: Escrever o arquivo, espelhando exatamente `lib/actions/categoria-contabil.ts`**

```ts
'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import { registrarAuditoria } from '@/lib/auditoria'

export type ProdutoSubstituicaoInput = {
  n_cod_prod: number
  substitui_n_cod_prod: number
}

// Puramente local: nao existe conceito de "produto substituto" no Omie.
export async function criarProdutoSubstituicao(dados: ProdutoSubstituicaoInput) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Produto Substituicoes - Criar'))) return { error: 'Sem permissão' }
  if (dados.n_cod_prod === dados.substitui_n_cod_prod) {
    return { error: 'Um produto não pode substituir a si mesmo' }
  }

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from('produto_substituicoes')
    .insert({ loja_id: lojaId, n_cod_prod: dados.n_cod_prod, substitui_n_cod_prod: dados.substitui_n_cod_prod })
    .select('id')
    .single()
  if (error) return { error: error.code === '23505' ? 'Esse produto já tem um substituto vinculado' : error.message }

  await registrarAuditoria('criar', 'produto substituição', data.id, `${dados.n_cod_prod} -> ${dados.substitui_n_cod_prod}`)
  revalidatePath('/produto-substituicao')
  return { ok: true }
}

export async function excluirProdutoSubstituicao(id: number) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Produto Substituicoes - Excluir'))) return { error: 'Sem permissão' }

  const supabase = createServiceClient()
  const { error } = await supabase.from('produto_substituicoes').delete().eq('id', id).eq('loja_id', lojaId)
  if (error) return { error: error.message }

  await registrarAuditoria('excluir', 'produto substituição', id, null)
  revalidatePath('/produto-substituicao')
  return { ok: true }
}
```

- [ ] **Step 2: Registrar as permissões no catálogo**

Em `lib/permissoes-catalogo.ts`, adicionar um bloco novo ao array `CATALOGO_PERMISSOES` (mesma forma do bloco `'Categorias Contábeis'` já existente), e uma entrada nova em `MENU_PERMISSAO`:

No array `CATALOGO_PERMISSOES`, logo depois do bloco `{ modulo: 'Categorias Contábeis', ... }`, adicionar:

```ts
  {
    modulo: 'Produtos Substitutos',
    grupo: 'Cadastros',
    permissoes: [
      { nome: 'Produto Substituicoes', label: 'Acessar' },
      { nome: 'Produto Substituicoes - Criar', label: 'Criar' },
      { nome: 'Produto Substituicoes - Excluir', label: 'Excluir' },
    ],
  },
```

No objeto `MENU_PERMISSAO`, logo depois de `'/categoria-contabil': 'Categorias Contabeis',`, adicionar:

```ts
  '/produto-substituicao': 'Produto Substituicoes',
```

- [ ] **Step 3: Verificação manual**

Não há UI ainda (Task 10) — verificar só que o arquivo compila: `npm run build` (ou `npx tsc --noEmit`) sem erro de tipo nas duas funções novas.

- [ ] **Step 4: Commit**

```bash
git add lib/actions/produto-substituicao.ts lib/permissoes-catalogo.ts
git commit -m "feat(produto-substituicao): server actions de criar/excluir"
```

---

### Task 10: Tela admin de produto-substituto

**Files:**
- Create: `app/(app)/produto-substituicao/page.tsx`
- Create: `components/produto-substituicao/ProdutoSubstituicaoForm.tsx`
- Create: `components/produto-substituicao/ExcluirProdutoSubstituicao.tsx`

**Interfaces:**
- Consumes: `criarProdutoSubstituicao`/`excluirProdutoSubstituicao` (Task 9); `PageHeader`, `Lista`/`Coluna<T>`, `EmptyState` (`@/components/ui-kit/*`); `Dialog`/`DialogContent`/`DialogTrigger` (`@/components/ui/dialog`); `btnClass`/`btnLinhaClass`/`RotuloAcao` (`@/components/ui-kit/Button`); `getCurrentLojaId`/`requirePermissao` (`@/lib/auth`); `createClient` (`@/lib/supabase/server`).
- Produces: tela em `/produto-substituicao`, sem consumidores além do usuário final.

- [ ] **Step 1: Página de listagem, espelhando exatamente `app/(app)/categoria-contabil/page.tsx`**

```tsx
import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { ListaHeader } from '@/components/ui-kit/ListaHeader'
import { Lista } from '@/components/ui-kit/Lista'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { ProdutoSubstituicaoForm } from '@/components/produto-substituicao/ProdutoSubstituicaoForm'
import { ExcluirProdutoSubstituicao } from '@/components/produto-substituicao/ExcluirProdutoSubstituicao'
import { Shuffle } from 'lucide-react'

type VinculoRow = { id: number; n_cod_prod: number; substitui_n_cod_prod: number }
type Produto = { n_cod_prod: number; descricao: string | null }

export default async function ProdutoSubstituicaoPage() {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Produto Substituicoes'))) notFound()

  const supabase = await createClient()
  const podeCriar = await requirePermissao(lojaId, 'Produto Substituicoes - Criar')
  const podeExcluir = await requirePermissao(lojaId, 'Produto Substituicoes - Excluir')

  const { data: vinculos } = await supabase
    .from('produto_substituicoes')
    .select('id, n_cod_prod, substitui_n_cod_prod')
    .eq('loja_id', lojaId)
    .order('id')

  const { data: todosProdutos } = await supabase
    .from('produtos')
    .select('n_cod_prod, descricao')
    .eq('loja_id', lojaId)
    .order('descricao')

  const nomeDe = (cod: number) =>
    (todosProdutos as Produto[] | null)?.find((p) => p.n_cod_prod === cod)?.descricao ?? `#${cod}`

  return (
    <div className="space-y-4">
      <ListaHeader>
        <PageHeader
          title="Produtos Substitutos"
          icon={Shuffle}
          description="Quando um produto não tem histórico de venda próprio (ex.: troca de marca/fornecedor), a previsão usa o histórico do produto vinculado aqui."
          voltarHref="/produto"
          actions={podeCriar ? <ProdutoSubstituicaoForm produtos={(todosProdutos ?? []) as Produto[]} /> : undefined}
        />
      </ListaHeader>

      <Lista<VinculoRow>
        linhas={(vinculos ?? []) as VinculoRow[]}
        chaveLinha={(v) => v.id}
        colunas={[
          { label: 'Produto sem histórico', primaria: true, flexivel: true, render: (v) => nomeDe(v.n_cod_prod) },
          { label: 'Usa o histórico de', flexivel: true, render: (v) => nomeDe(v.substitui_n_cod_prod) },
        ]}
        acao={(v) => (podeExcluir ? <ExcluirProdutoSubstituicao id={v.id} descricao={nomeDe(v.n_cod_prod)} /> : null)}
        vazio={
          <EmptyState
            icon={Shuffle}
            title="Nenhum vínculo cadastrado"
            hint="Vincule um produto sem histórico próprio a outro cujo histórico deva ser usado na previsão de venda."
          />
        }
      />
    </div>
  )
}
```

- [ ] **Step 2: Form de criação (dialog), espelhando exatamente `CategoriaContabilForm.tsx`, com `<select>` de produto**

```tsx
'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { criarProdutoSubstituicao, type ProdutoSubstituicaoInput } from '@/lib/actions/produto-substituicao'
import { btnClass } from '@/components/ui-kit/Button'

const selectClass =
  'w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-text outline-none transition-colors focus:border-brand'
const labelClass = 'mb-1 block text-[13px] font-medium text-text-muted'

type Produto = { n_cod_prod: number; descricao: string | null }

export function ProdutoSubstituicaoForm({ produtos }: { produtos: Produto[] }) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<Partial<ProdutoSubstituicaoInput>>({})
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function salvar() {
    if (!form.n_cod_prod || !form.substitui_n_cod_prod) {
      toast.error('Selecione os dois produtos')
      return
    }
    startTransition(async () => {
      const res = await criarProdutoSubstituicao(form as ProdutoSubstituicaoInput)
      if (res?.error) {
        toast.error('Erro', { description: res.error })
        return
      }
      toast.success('Vínculo criado')
      setOpen(false)
      setForm({})
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <button type="button" className={btnClass('primary')}>
            <Plus className="size-4" /> Vincular substituto
          </button>
        }
      />
      <DialogContent className="overflow-hidden bg-surface p-0 sm:max-w-md" showCloseButton={false}>
        <div className="border-b border-border px-4 py-3 text-base font-semibold text-text">
          Vincular produto substituto
        </div>
        <div className="space-y-3 px-4 py-3">
          <div>
            <label className={labelClass}>Produto sem histórico</label>
            <select
              className={selectClass}
              value={form.n_cod_prod ?? ''}
              onChange={(e) => setForm((prev) => ({ ...prev, n_cod_prod: e.target.value ? Number(e.target.value) : undefined }))}
            >
              <option value="">Selecione...</option>
              {produtos.map((p) => (
                <option key={p.n_cod_prod} value={p.n_cod_prod}>{p.descricao ?? p.n_cod_prod}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Usar o histórico de</label>
            <select
              className={selectClass}
              value={form.substitui_n_cod_prod ?? ''}
              onChange={(e) => setForm((prev) => ({ ...prev, substitui_n_cod_prod: e.target.value ? Number(e.target.value) : undefined }))}
            >
              <option value="">Selecione...</option>
              {produtos.map((p) => (
                <option key={p.n_cod_prod} value={p.n_cod_prod}>{p.descricao ?? p.n_cod_prod}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button type="button" onClick={salvar} disabled={pending} className={btnClass('primary')}>
            {pending ? 'Salvando...' : 'Vincular'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
```

> Se a base de produtos por loja for grande (centenas+), o `<select>` fica pouco usável — trocar por um campo de busca/`<datalist>` é uma melhoria futura, fora do escopo desta task (decisão de UX a confirmar com o Ramon depois de ver o volume real de produtos).

- [ ] **Step 3: Botão de excluir, espelhando exatamente `ExcluirCategoriaContabil.tsx`**

```tsx
'use client'

import { useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { excluirProdutoSubstituicao } from '@/lib/actions/produto-substituicao'
import { btnLinhaClass, RotuloAcao } from '@/components/ui-kit/Button'

export function ExcluirProdutoSubstituicao({ id, descricao }: { id: number; descricao: string }) {
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function excluir() {
    if (!window.confirm(`Remover o vínculo de substituição de "${descricao}"?`)) return
    startTransition(async () => {
      const res = await excluirProdutoSubstituicao(id)
      if (res?.error) { toast.error('Erro', { description: res.error }); return }
      toast.success('Vínculo removido')
      router.refresh()
    })
  }

  return (
    <button
      type="button"
      onClick={excluir}
      disabled={pending}
      className={btnLinhaClass('ghost')}
      aria-label="Remover"
      title="Remover"
    >
      <Trash2 className="size-4" /> <RotuloAcao>Remover</RotuloAcao>
    </button>
  )
}
```

- [ ] **Step 4: Verificação manual**

Rodar `npm run dev`, abrir `/produto-substituicao`, vincular um produto de teste a outro, confirmar que aparece na lista, remover e confirmar que some.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/produto-substituicao/page.tsx" components/produto-substituicao/
git commit -m "feat(produto-substituicao): tela de administração de vínculos"
```

---

### Task 11: Fallback de triangulação no cálculo de previsão

**Files:**
- Modify: `lib/omie/previsao-venda.ts`

**Interfaces:**
- Consumes: tabela `produto_substituicoes` (Task 8), a função `syncPrevisaoVenda` reescrita na Task 6.
- Produces: nenhuma nova interface pública — só altera o comportamento interno de `syncPrevisaoVenda`.

- [ ] **Step 1: Buscar os vínculos de substituição e aplicar o fallback**

Em `lib/omie/previsao-venda.ts` (versão da Task 6), depois do loop que preenche `saidas` pra cada janela mas antes de montar `rows`, adicionar a leitura dos vínculos e o fallback. Dentro do loop `for (const janela of JANELAS_DIAS) { ... }`, logo após `const saidas = await buscarSaidasPeriodo(...)`, adicionar:

```ts
      const { data: substituicoes } = await supabase
        .from('produto_substituicoes')
        .select('n_cod_prod, substitui_n_cod_prod')
        .eq('loja_id', loja.id)

      for (const sub of substituicoes ?? []) {
        const proprio = saidas.get(sub.n_cod_prod)
        if (proprio == null || proprio === 0) {
          const doSubstituto = saidas.get(sub.substitui_n_cod_prod)
          if (doSubstituto != null) saidas.set(sub.n_cod_prod, doSubstituto)
        }
      }
```

(a busca de `substituicoes` roda 1x por janela — como são só 3 janelas por sync e a tabela é pequena, não vale a pena otimizar movendo pra fora do loop nesta primeira versão; revisar se virar gargalo real.)

- [ ] **Step 2: Verificação manual**

Criar um vínculo de teste em `/produto-substituicao` entre um produto sem venda recente e um com histórico, rodar `syncPrevisaoVenda` (mesmo processo manual da Task 6, Step 2), e confirmar via `node scripts/db.mjs "select qtde from previsao_venda where loja_id = <id> and n_cod_prod = <produto sem historico> and janela_dias = 7"` que a quantidade agora reflete o histórico do produto substituto, não fica em branco/zero.

- [ ] **Step 3: Commit**

```bash
git add lib/omie/previsao-venda.ts
git commit -m "feat(previsao): usa produto substituto quando o proprio nao tem historico"
```

---

### Task 12: Link produto → Movimentos (Relatório de Margem)

**Files:**
- Modify: `app/(app)/relatorio-margem/page.tsx:183`

**Interfaces:** nenhuma.

- [ ] **Step 1: Envolver o nome do produto num link**

Trocar (linha 183):
```tsx
                  <td className="max-w-[280px] truncate px-3 py-2 text-text" title={p.descricao ?? ''}>{p.descricao ?? p.codigo}</td>
```
por:
```tsx
                  <td className="max-w-[280px] truncate px-3 py-2 text-text" title={p.descricao ?? ''}>
                    <Link href={`/movimentacoes?produto=${encodeURIComponent(p.descricao ?? String(p.codigo))}`} className="hover:underline">
                      {p.descricao ?? p.codigo}
                    </Link>
                  </td>
```

Adicionar `import Link from 'next/link'` no topo do arquivo, se ainda não existir.

- [ ] **Step 2: Verificação manual**

Rodar `npm run dev`, abrir o relatório de Margem, clicar num nome de produto, confirmar que abre `/movimentacoes?produto=<nome>` já filtrado pra aquele produto.

- [ ] **Step 3: Commit**

```bash
git add "app/(app)/relatorio-margem/page.tsx"
git commit -m "feat(relatorio-margem): link do produto pra tela de Movimentos"
```

---

### Task 13: Link produto → Movimentos (Auditoria Fiscal)

**Files:**
- Modify: `app/(app)/auditoria-fiscal/page.tsx:224`

**Interfaces:** nenhuma.

- [ ] **Step 1: Envolver o nome do produto num link, usando o texto CRU (não o formatado)**

Trocar (linha 224):
```tsx
                        <td className="max-w-[220px] truncate px-3 py-1.5 text-text" title={it.produto}>{formatarNomeProduto(it.produto) || it.produto}</td>
```
por:
```tsx
                        <td className="max-w-[220px] truncate px-3 py-1.5 text-text" title={it.produto}>
                          <Link href={`/movimentacoes?produto=${encodeURIComponent(it.produto)}`} className="hover:underline">
                            {formatarNomeProduto(it.produto) || it.produto}
                          </Link>
                        </td>
```

Usar `it.produto` (o texto cru vindo do SPED) no `href`, não o resultado de `formatarNomeProduto`, já que o filtro de `/movimentacoes` faz busca textual e o nome formatado pode ter sido alterado o suficiente pra não bater — só o texto exibido continua formatado.

- [ ] **Step 2: Verificação manual**

Rodar `npm run dev`, abrir Auditoria Fiscal, abrir o drill-down de uma nota, clicar num produto, confirmar que `/movimentacoes?produto=...` mostra resultado (ou, se a busca textual não achar nada por divergência de nome, documentar esse caso específico pro Ramon em vez de forçar um "match perfeito" que o dado não permite).

- [ ] **Step 3: Commit**

```bash
git add "app/(app)/auditoria-fiscal/page.tsx"
git commit -m "feat(auditoria-fiscal): link do produto pra tela de Movimentos"
```

---

### Task 14: Link produto → Movimentos (Relatório de Compras, só quando `dim=produto`)

**Files:**
- Modify: `app/(app)/relatorio-compras/page.tsx:253-257`

**Interfaces:** nenhuma.

- [ ] **Step 1: Linkar só quando a dimensão ativa for "produto"**

Trocar (linhas 254-257):
```tsx
                  <tr key={l.rotulo} className="border-t border-border/60 hover:bg-surface-2/40">
                    <td className="sticky left-0 z-10 bg-surface px-3 py-2 text-text" title={l.rotulo}>
                      <div className="max-w-[140px] truncate">{l.rotulo}</div>
                    </td>
```
por:
```tsx
                  <tr key={l.rotulo} className="border-t border-border/60 hover:bg-surface-2/40">
                    <td className="sticky left-0 z-10 bg-surface px-3 py-2 text-text" title={l.rotulo}>
                      <div className="max-w-[140px] truncate">
                        {dim === 'produto' ? (
                          <Link href={`/movimentacoes?produto=${encodeURIComponent(l.rotulo)}`} className="hover:underline">
                            {l.rotulo}
                          </Link>
                        ) : (
                          l.rotulo
                        )}
                      </div>
                    </td>
```

`dim` já está em escopo nesse ponto do arquivo — definida na linha 72 (`const dim = DIMS.some((d) => d.value === sp.dim) ? sp.dim! : 'familia'`), dentro da mesma função de página que renderiza a tabela (linha 252 em diante), sem necessidade de passar como parâmetro.

- [ ] **Step 2: Verificação manual**

Rodar `npm run dev`, abrir Relatório de Compras com `dim=produto`, clicar num rótulo, confirmar que linka pra Movimentos. Trocar pra `dim=fornecedor` (ou `tipo`/`cfop`) e confirmar que o rótulo NÃO vira link nesses casos.

- [ ] **Step 3: Commit**

```bash
git add "app/(app)/relatorio-compras/page.tsx"
git commit -m "feat(relatorio-compras): link do produto pra Movimentos quando dim=produto"
```

---

## Ordem sugerida de execução

Tasks 1-4 são triviais e independentes — podem ir em qualquer ordem, inclusive em paralelo. Tasks 5→6→7 são sequenciais (schema → cálculo → UI). Tasks 8→9→10 são sequenciais (schema → actions → UI); Task 11 depende de 8 e do resultado de 6. Tasks 12-14 são independentes entre si e podem ir a qualquer momento após a Task 5 (não têm dependência real nela, mas fazem mais sentido depois já que tocam área relacionada).
