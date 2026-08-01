# Faturamento — Relatórios Avançados Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development para executar este plano task-by-task.

**Goal:** Fechar 5 gaps reais achados numa auditoria cruzando a planilha
`FAT_SVVM_2026.xlsx` (referência da consultoria financeira do cliente)
contra o app: desconto por produto, desconto por forma de pagamento,
bottom-10 por faturamento, ranking por quantidade vendida, e margem com
evolução mensal.

**Architecture:** Tudo reaproveita dados que já sincronizam (fato
`fat_cupons`/`fat_cupom_itens`/`fat_cupom_pagamentos` no Contabo, tabela
`margem_importada` no Supabase) — sem tabela nova pros itens de desconto
e rankings. O item de margem mensal precisa de 1 tabela nova (snapshot
diário de CMC) porque não existe histórico retroativo pras 5 lojas sem
import manual — combinado com honestidade na UI sobre o que tem dado
real vs. o que começa a acumular agora.

**Tech Stack:** Next.js Server Components, Supabase (RPC + tabelas), API
fria do Contabo (`ntb-frio-api`, endpoints já existentes com paginação).

---

## Global Constraints

- **Sem ambiente de staging separado neste projeto.** Cada task precisa
  ser testada contra produção real (Contabo + Supabase cloud) antes de
  ser considerada pronta — mesmo padrão desta sessão inteira: rodar o
  typecheck/lint local, fazer deploy (`git push` + `ssh ... deploy.sh`),
  depois validar com Playwright real usando a conta
  `claude.qa@ntb-estoque.dev` / `claudeqa123456`. Scripts de teste
  ad-hoc SEMPRE em `scripts/*-tmp.mjs`, apagados (junto com screenshots
  em `/tmp`) imediatamente depois de confirmar.
- **`descricao`/`id_produto` do fato do Contabo não vêm com nome
  resolvido** — o campo `rotulo`/`id_produto` de `/fat_agregado` e
  `/fat_cupom_itens` é o **código numérico cru** do produto na Omie
  (`codigo_produto`). Toda vez que uma task usa esses dados pra exibir
  "top produtos", precisa resolver nome via um mapa `codigo_produto →
  descricao`, paginado (produtos passam de 1000 linhas em 5 das 6
  lojas) — usar o MESMO padrão já existente em
  `lib/dashboard-gerencial.ts:buscarTipoPorDescricao` (adaptar pra
  indexar por `codigo_produto` em vez de `descricao`).
- **`v_desc` e `v_item` em `fat_cupom_itens` podem vir zerados do Omie**
  em casos raros — sempre usar o fallback já estabelecido em
  `lib/faturamento-frio.ts:agregarFaturamentoPorTipoFamilia`
  (`it.v_item || (it.v_unit * it.quant - it.v_desc)`) ao computar
  valor de item; `v_desc` em si não tem fallback (é o valor real do
  desconto, pode legitimamente ser zero).
- **Um cupom pode ter mais de uma forma de pagamento** (split, ex.:
  metade cartão metade PIX) — ao atribuir desconto de um cupom a uma
  forma de pagamento (item 2), se o cupom tiver 2+ linhas em
  `fat_cupom_pagamentos`, ratear o desconto do cupom proporcionalmente
  ao valor de cada forma (não simplesmente atribuir tudo à primeira
  linha).
- **Margem mensal (item 5) só tem dado histórico real pra lojas que
  fazem import manual do FAT_DRV** (hoje, só a loja 3) — `posicao_estoques`
  (usada pro cálculo "ao vivo" das outras 5 lojas) só guarda 2 dias de
  snapshot, não é série temporal (confirmado ao vivo em produção,
  2026-08-01). Decisão do usuário: começar a arquivar CMC diário AGORA
  (tabela nova + cron), sem fingir histórico retroativo que não existe.
  A UI deve deixar claro quando a evolução mensal é dado real importado
  vs. quando é "acumulando desde X" pro cálculo ao vivo.

---

### Task 1: Resolver nome de produto por código (helper compartilhado)

**Files:**
- Modify: `lib/dashboard-gerencial.ts`

**Step 1: Extrair e generalizar o helper de resolução de nome**

Abra `lib/dashboard-gerencial.ts`, veja `buscarTipoPorDescricao` (linha
~54) — pagina `produtos` inteiro pra montar `descricao -> tipo_item`.
Adicione uma função irmã, exportada, que resolve por CÓDIGO (as tasks 2
e 3 precisam disso pra resolver os `id_produto`/`rotulo` numéricos que
vêm do fato do Contabo):

```ts
// Mapa codigo_produto -> descricao, usado pra resolver nomes de produto
// a partir do id numerico cru que /fat_agregado e /fat_cupom_itens
// devolvem (o fato do Contabo nao duplica a tabela produtos, so guarda
// o codigo). Mesmo padrao paginado de buscarTipoPorDescricao (produtos
// passa de 1000 linhas em 5 das 6 lojas ativas).
export async function buscarNomePorCodigo(
  supabase: ReturnType<typeof createServiceClient>,
  lojaId: number
): Promise<Map<number, string>> {
  const PAGE = 1000
  const mapa = new Map<number, string>()
  for (let p = 0; ; p++) {
    const { data, error } = await supabase
      .from('produtos')
      .select('codigo_produto, descricao, codigo')
      .eq('loja_id', lojaId)
      .range(p * PAGE, p * PAGE + PAGE - 1)
    if (error || !data?.length) break
    for (const row of data as { codigo_produto: number; descricao: string | null; codigo: string | null }[]) {
      mapa.set(Number(row.codigo_produto), row.descricao || row.codigo || String(row.codigo_produto))
    }
    if (data.length < PAGE) break
  }
  return mapa
}
```

**Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erro novo.

**Step 3: Commit**

```bash
git add lib/dashboard-gerencial.ts
git commit -m "feat: helper compartilhado pra resolver nome de produto por código"
```

---

### Task 2: Desconto por produto e por forma de pagamento (dados)

**Files:**
- Modify: `lib/faturamento-frio.ts`
- Create: `lib/faturamento-descontos.ts`

**Interfaces:**
- Consumes: `buscarFrioTudo` (`lib/historico-contabo.ts`, já usado no
  arquivo), `buscarFatCupomItens` (já existe), `buscarNomePorCodigo`
  (Task 1).
- Produces: `buscarFatCupomPagamentosPeriodo`,
  `calcularDescontoPorProduto`, `calcularDescontoPorFormaPgto` —
  usadas pela Task 3 (UI).

**Step 1: Adicionar busca em lote de pagamentos por período**

`/fat_cupom_pagamentos` já aceita `loja_id`+`data_inicio`+`data_final`
sem precisar de `n_id_cupom` (confirmado ao vivo, 2026-08-01: `curl
"https://frio-api.norteparanegocios.com.br/fat_cupom_pagamentos?loja_id=3&data_inicio=2026-07-01&data_final=2026-07-05"`
devolve todas as linhas do período, não só de 1 cupom). Em
`lib/faturamento-frio.ts`, adicione logo depois de `buscarFatCupomItens`:

```ts
// Busca em lote (nao 1 cupom por vez) -- mesmo padrao de buscarFatCupomItens.
export async function buscarFatCupomPagamentosPeriodo(opts: { lojaId: number; dataInicio: string; dataFinal: string }): Promise<PagamentoFat[]> {
  const rows = await buscarFrioTudo<PagamentoFat & { valor: string | number }>(
    '/fat_cupom_pagamentos', { loja_id: opts.lojaId, data_inicio: opts.dataInicio, data_final: opts.dataFinal }, 20000,
  )
  return rows.map((p) => ({ ...p, valor: Number(p.valor) || 0 }))
}
```

**Step 2: Criar o módulo de agregação de desconto**

Crie `lib/faturamento-descontos.ts`:

```ts
// lib/faturamento-descontos.ts
// Desconto por produto e por forma de pagamento -- achado real 2026-08-01
// (auditoria cruzando FAT_SVVM_2026.xlsx): v_desc ja existe em
// fat_cupom_itens, mas nunca era somado/rankeado como metrica propria.
import { createServiceClient } from '@/lib/supabase/server'
import { buscarFatCupomItens, buscarFatCupomPagamentosPeriodo, type ItemFat, type PagamentoFat } from '@/lib/faturamento-frio'
import { buscarNomePorCodigo } from '@/lib/dashboard-gerencial'

export type DescontoRanking = { rotulo: string; valorDesconto: number }

export async function calcularDescontoPorProduto(opts: {
  lojaId: number
  dataInicio: string
  dataFinal: string
  topN: number
}): Promise<DescontoRanking[]> {
  const supabase = createServiceClient()
  const [itens, nomePorCodigo] = await Promise.all([
    buscarFatCupomItens(opts),
    buscarNomePorCodigo(supabase, opts.lojaId),
  ])
  const porProduto = new Map<string, number>()
  for (const it of itens) {
    if (!it.v_desc || it.id_produto == null) continue
    const nome = nomePorCodigo.get(Number(it.id_produto)) ?? it.x_prod ?? `Produto ${it.id_produto}`
    porProduto.set(nome, (porProduto.get(nome) ?? 0) + it.v_desc)
  }
  return [...porProduto.entries()]
    .map(([rotulo, valorDesconto]) => ({ rotulo, valorDesconto }))
    .sort((a, b) => b.valorDesconto - a.valorDesconto)
    .slice(0, opts.topN)
}

export async function calcularDescontoPorFormaPgto(opts: {
  lojaId: number
  dataInicio: string
  dataFinal: string
}): Promise<DescontoRanking[]> {
  const [itens, pagamentos] = await Promise.all([
    buscarFatCupomItens(opts),
    buscarFatCupomPagamentosPeriodo(opts),
  ])
  // Desconto total por cupom.
  const descontoPorCupom = new Map<number, number>()
  for (const it of itens) {
    if (!it.v_desc) continue
    descontoPorCupom.set(it.n_id_cupom, (descontoPorCupom.get(it.n_id_cupom) ?? 0) + it.v_desc)
  }
  // Pagamentos agrupados por cupom (um cupom pode ter split entre formas).
  const pagamentosPorCupom = new Map<number, PagamentoFat[]>()
  for (const p of pagamentos) {
    const lista = pagamentosPorCupom.get(p.n_id_cupom) ?? []
    lista.push(p)
    pagamentosPorCupom.set(p.n_id_cupom, lista)
  }
  const porForma = new Map<string, number>()
  for (const [nIdCupom, descontoTotal] of descontoPorCupom) {
    const pagsDoCupom = pagamentosPorCupom.get(nIdCupom) ?? []
    if (!pagsDoCupom.length) continue
    const totalPago = pagsDoCupom.reduce((s, p) => s + p.valor, 0)
    if (totalPago <= 0) continue
    // Rateia proporcional ao valor de cada forma (cupom com split
    // cartao+pix, por exemplo -- nao atribui tudo pra primeira linha).
    for (const p of pagsDoCupom) {
      const forma = p.tipo_doc || 'Não informado'
      const fatia = descontoTotal * (p.valor / totalPago)
      porForma.set(forma, (porForma.get(forma) ?? 0) + fatia)
    }
  }
  return [...porForma.entries()]
    .map(([rotulo, valorDesconto]) => ({ rotulo, valorDesconto }))
    .sort((a, b) => b.valorDesconto - a.valorDesconto)
}
```

**Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: sem erro novo. Se `PagamentoFat`/`ItemFat`/`createServiceClient`
não importarem limpo, confira os nomes exatos exportados em
`lib/faturamento-frio.ts` e `lib/supabase/server.ts`.

**Step 4: Teste real contra produção (sem framework de testes no projeto)**

Escreva um script ad-hoc `scripts/teste-desconto-tmp.mjs` que importe as
2 funções e rode contra a loja 3, período de um mês recente com
faturamento real, imprima os top 5 de cada ranking, confirme que os
valores batem com uma soma manual via `psql` direto no Contabo
(`select sum(v_desc) from fat_cupom_itens where loja_id=3 and ...`).
Apague o script depois.

**Step 5: Commit**

```bash
git add lib/faturamento-frio.ts lib/faturamento-descontos.ts
git commit -m "feat: agregação de desconto por produto e por forma de pagamento"
```

---

### Task 3: Aba "Descontos" em Faturamento + bottom-10/top-por-quantidade na Home

**Files:**
- Modify: `app/(app)/relatorio-faturamento/page.tsx`
- Modify: `lib/dashboard-gerencial.ts`
- Modify: `components/home/PainelGerencial.tsx`

**Step 1: Nova aba "Descontos" em relatorio-faturamento**

Em `app/(app)/relatorio-faturamento/page.tsx`, adicione um link extra
ao lado do já existente `Link` de "Ver cupons" (linha ~474), reaproveitando
o mesmo `chipAtivo`/`chipInativo`:

```tsx
<Link href={sp.ver === 'descontos' ? '/relatorio-faturamento' : '?ver=descontos'} className={sp.ver === 'descontos' ? chipAtivo : chipInativo}>
  Descontos
</Link>
```

No topo da função, importe e chame as duas funções da Task 2 quando
`sp.ver === 'descontos'` (mesmo padrão condicional já usado pra
`verCupons`/`usarFato` — só busca quando a aba está ativa, evita custo
em toda carga normal da página):

```ts
import { calcularDescontoPorProduto, calcularDescontoPorFormaPgto } from '@/lib/faturamento-descontos'
```

```ts
const verDescontos = sp.ver === 'descontos'
const [descontoPorProduto, descontoPorForma] = verDescontos
  ? await Promise.all([
      calcularDescontoPorProduto({ lojaId, dataInicio: dataInicioFato, dataFinal: dataFinalFato, topN: 10 }),
      calcularDescontoPorFormaPgto({ lojaId, dataInicio: dataInicioFato, dataFinal: dataFinalFato }),
    ])
  : [[], []]
```
(reaproveita `dataInicioFato`/`dataFinalFato`, já calculados mais acima
no arquivo pro modo "Ver cupons").

Adicione o bloco de renderização (mesmo `if/else` de `verCupons` mais
abaixo, como um terceiro ramo `verDescontos ? (...) : verCupons ? (...) : (...)`),
duas tabelas simples lado a lado (uma pra produto, uma pra forma de
pagamento), reaproveitando a classe `th` já definida no arquivo:

```tsx
<div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
  <div className="overflow-x-auto rounded-lg border border-border bg-surface">
    <table className="w-full border-collapse text-sm">
      <thead><tr className="bg-surface-2"><th className={`text-left ${th}`}>Produto</th><th className={`text-right ${th}`}>Desconto</th></tr></thead>
      <tbody>
        {descontoPorProduto.map((d) => (
          <tr key={d.rotulo} className="border-t border-border/60"><td className="px-3 py-2 text-text">{d.rotulo}</td><td className="num px-3 py-2 text-right text-text-muted">{fmtMoeda(d.valorDesconto)}</td></tr>
        ))}
      </tbody>
    </table>
  </div>
  <div className="overflow-x-auto rounded-lg border border-border bg-surface">
    <table className="w-full border-collapse text-sm">
      <thead><tr className="bg-surface-2"><th className={`text-left ${th}`}>Forma de pagamento</th><th className={`text-right ${th}`}>Desconto</th></tr></thead>
      <tbody>
        {descontoPorForma.map((d) => (
          <tr key={d.rotulo} className="border-t border-border/60"><td className="px-3 py-2 text-text">{d.rotulo}</td><td className="num px-3 py-2 text-right text-text-muted">{fmtMoeda(d.valorDesconto)}</td></tr>
        ))}
      </tbody>
    </table>
  </div>
</div>
```

Trate o caso vazio (`!descontoPorProduto.length && !descontoPorForma.length`)
com o mesmo componente `EmptyState` já usado no resto do arquivo.

**Step 2: Bottom-10 e top-por-quantidade no dashboard gerencial**

Em `lib/dashboard-gerencial.ts`:

1. Adicione, perto de `topNDoMapa`:
```ts
function bottomNDoMapa(mapa: Map<string, number>, n: number): RankingItem[] {
  return Array.from(mapa.entries())
    .filter(([, valor]) => valor > 0) // exclui produto sem venda no periodo, nao e "pior desempenho"
    .map(([label, valor]) => ({ label, valor }))
    .sort((a, b) => a.valor - b.valor)
    .slice(0, n)
}
```

2. No `Promise.all` de `carregarDashboardGerencial`, adicione uma busca
   ao fato do Contabo pra pegar quantidade por produto (reaproveite
   `dataIni`/`dataFim` já disponíveis na função):
```ts
import { buscarFatAgregado } from '@/lib/faturamento-frio'
```
```ts
    buscarFatAgregado({ lojaId, dataInicio: dataIni, dataFinal: dataFim, group: 'produto' }),
```
(adicione esse item ao array do `Promise.all` e capture o retorno,
ex. `qtdePorProdutoRows`).

3. Depois do `Promise.all`, resolva os códigos pra nome (reaproveitando
   `buscarNomePorCodigo` da Task 1) e monte o ranking por quantidade:
```ts
  const nomePorCodigo = await buscarNomePorCodigo(supabase, lojaId)
  const qtdePorProdutoMapa = new Map<string, number>()
  for (const r of qtdePorProdutoRows) {
    const cod = Number(r.rotulo)
    const nome = nomePorCodigo.get(cod) ?? `Produto ${cod}`
    qtdePorProdutoMapa.set(nome, (qtdePorProdutoMapa.get(nome) ?? 0) + r.qtde_itens)
  }
```

4. Adicione os 2 novos campos no tipo `DashboardGerencial` e no
   `resultado` retornado:
```ts
  bottomFaturados: RankingItem[]
  topPorQuantidade: RankingItem[]
```
```ts
    bottomFaturados: bottomNDoMapa(faturamentoPorProdutoMapa, topN),
    topPorQuantidade: topNDoMapa(qtdePorProdutoMapa, topN),
```

**Step 3: Renderizar os 2 novos widgets em PainelGerencial.tsx**

Depois do bloco "Top faturados / comprados" existente (grid de 2
colunas), adicione outro grid de 2 colunas no mesmo padrão visual
(`ResumoGrafico`), pra "Bottom 10" e "Top por quantidade":

```tsx
<div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
  <div>
    <h3 className="mb-2 text-sm font-bold uppercase tracking-[0.12em] text-text">10 menos faturados</h3>
    {d.bottomFaturados.length === 0 ? (
      <EmptyState icon={AlertTriangle} title="Sem dado suficiente no período" hint="" />
    ) : (
      <ResumoGrafico grafico={{ titulo: '', unidade: 'reais', itens: d.bottomFaturados }} />
    )}
  </div>
  <div>
    <h3 className="mb-2 text-sm font-bold uppercase tracking-[0.12em] text-text">Top 10 mais vendidos (quantidade)</h3>
    {d.topPorQuantidade.length === 0 ? (
      <EmptyState icon={AlertTriangle} title="Sem dado suficiente no período" hint="" />
    ) : (
      <ResumoGrafico grafico={{ titulo: '', unidade: 'unidades', itens: d.topPorQuantidade }} />
    )}
  </div>
</div>
```

Confira se `ResumoGrafico` (`components/resumo/ResumoGrafico.tsx`) aceita
`unidade: 'unidades'` (provavelmente só formata `valor` como número puro
em vez de moeda quando a unidade não é `'reais'` — leia o componente pra
confirmar o contrato exato antes de usar).

**Step 4: Também adicionar o link do item 6 (top faturados mês a mês)**

No mesmo bloco "Top 10 mais faturados" já existente em
`PainelGerencial.tsx`, adicione (embaixo de cada `ResumoGrafico`) um
link pro detalhe mensal completo, que já existe em
`/relatorio-faturamento` (`dim=produto` já mostra a matriz mês a mês,
ordenada por total — não precisa de tela nova):

```tsx
<Link href="/relatorio-faturamento?dim=produto" className="mt-1 inline-block text-[12px] text-brand hover:underline">
  ver evolução mensal →
</Link>
```
(em ambos os blocos, produto acabado e revenda).

**Step 5: Typecheck + lint**

Run: `npx tsc --noEmit && npx eslint app/(app)/relatorio-faturamento/page.tsx lib/dashboard-gerencial.ts components/home/PainelGerencial.tsx lib/faturamento-descontos.ts`
Expected: zero erros.

**Step 6: Teste visual real**

Deploy (`git push` + `ssh ... deploy.sh`), depois screenshot real via
Playwright (`scripts/qa-*-tmp.mjs`, apagar depois): tela Home mostrando
os 2 novos widgets + link "ver evolução mensal", e
`/relatorio-faturamento?ver=descontos` mostrando as 2 tabelas de
desconto com dado real. Confirme visualmente que os números não são
zero/vazios pra pelo menos uma loja com movimento real (loja 3 ou 5).

**Step 7: Commit**

```bash
git add app/(app)/relatorio-faturamento/page.tsx lib/dashboard-gerencial.ts components/home/PainelGerencial.tsx
git commit -m "feat: aba Descontos em Faturamento + bottom-10 e top-por-quantidade na Home"
```

---

### Task 4: Snapshot diário de CMC (infraestrutura pra margem mensal futura)

**Files:**
- Create: `supabase/migrations/101_margem_snapshot_diario.sql`
- Create: `app/api/cron/snapshot-margem-diario/route.ts`
- Modify: `scripts/sync-cron.sh`

**Step 1: Migration da tabela**

```sql
-- supabase/migrations/101_margem_snapshot_diario.sql
-- Item 5 da auditoria FAT_SVVM_2026.xlsx (2026-08-01): margem mensal so tem
-- dado historico real pra lojas com import manual do FAT_DRV (hoje so a
-- loja 3) -- posicao_estoques (usada no calculo "ao vivo" das outras 5
-- lojas) so guarda 2 dias de snapshot, nao e serie temporal. Decisao do
-- usuario: comecar a arquivar CMC diario AGORA (sem retroativo possivel).

create table if not exists margem_snapshot_diario (
  loja_id        bigint not null references lojas(id) on delete cascade,
  data_snapshot  date not null,
  codigo_produto bigint not null,
  codigo         text,
  descricao      text,
  descricao_familia text,
  pdv            numeric,
  cmc            numeric,
  margem         numeric,
  primary key (loja_id, data_snapshot, codigo_produto)
);

alter table margem_snapshot_diario enable row level security;
create policy "margem_snapshot_diario_select_por_loja"
  on margem_snapshot_diario for select
  using (exists (select 1 from loja_user lu where lu.loja_id = margem_snapshot_diario.loja_id and lu.user_id = auth.uid()));

-- Matriz mes a mes (media do CMC/PDV no mes, ponderada simples por dia) --
-- espelha relatorio_faturamento_matriz em formato de saida.
create or replace function relatorio_margem_snapshot_matriz(p_loja_id bigint)
returns table (codigo text, descricao text, familia text, mes text, pdv numeric, cmc numeric, margem numeric)
language sql stable as $$
  select
    codigo,
    max(descricao) as descricao,
    max(descricao_familia) as familia,
    to_char(data_snapshot, 'YYYY-MM') as mes,
    avg(pdv) as pdv,
    avg(cmc) as cmc,
    avg(margem) as margem
  from margem_snapshot_diario
  where loja_id = p_loja_id
  group by codigo, to_char(data_snapshot, 'YYYY-MM')
  order by codigo, mes
$$;
```

**Step 2: Endpoint de cron**

Leia primeiro `app/api/cron/sync-preco-movimentacao/route.ts` (ou outro
cron simples equivalente, ex. `sync-reconciliar-op`) pra confirmar o
padrão exato de `assertCronAuth`/`getLojasAtivas` usado nos crons deste
projeto, e reaproveite a MESMA lógica de cálculo de CMC/PDV/margem já
escrita em `app/(app)/relatorio-margem/page.tsx` (linhas ~123-218, bloco
`if (!rows.length) { ... }`) — não reinvente a fórmula, extraia/copie
exatamente essa lógica (ponderação por local, filtro `n_cmc>0 and
n_saldo>0`, fórmula de margem `((pdv-cmc)/pdv)*100`).

```ts
// app/api/cron/snapshot-margem-diario/route.ts
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { getLojasAtivas, assertCronAuth } from '@/lib/omie/sync-all'

export const maxDuration = 120

// Roda 1x/dia -- arquiva CMC/PDV/margem calculados "ao vivo" (mesma formula
// de app/(app)/relatorio-margem/page.tsx) numa tabela append-only, pra
// construir uma serie temporal real dali pra frente (achado 2026-08-01:
// posicao_estoques so guarda 2 dias, nao sustenta tendencia mensal).
export async function GET(request: Request) {
  if (!assertCronAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  const supabase = createServiceClient()
  const lojas = await getLojasAtivas()
  const hoje = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bahia' })

  const resumo = []
  for (const loja of lojas) {
    // [implementador: reaproveitar aqui a MESMA query/calculo de
    // relatorio-margem/page.tsx -- produtos tipo_item in ('04','00'),
    // posicao_estoques mais recente, ponderacao por local, filtro
    // n_cmc>0 and n_saldo>0]
    // ... monta `linhas: {codigo_produto, codigo, descricao, descricao_familia, pdv, cmc, margem}[]`
    if (linhas.length) {
      const { error } = await supabase.from('margem_snapshot_diario').upsert(
        linhas.map((l) => ({ loja_id: loja.id, data_snapshot: hoje, ...l })),
        { onConflict: 'loja_id,data_snapshot,codigo_produto' }
      )
      resumo.push({ loja_id: loja.id, linhas: linhas.length, erro: error?.message ?? null })
    } else {
      resumo.push({ loja_id: loja.id, linhas: 0, erro: null })
    }
  }
  return NextResponse.json({ total_lojas: lojas.length, resumo })
}
```

**Step 3: Agendar no cron real (1x/dia, não a cada 10min)**

Em `scripts/sync-cron.sh`, adicione (junto dos outros jobs de bloco
único, ex. `bloco -eq 4`, mas condicionado também à HORA do dia pra
rodar só 1x/dia — ver como outros crons diários deste projeto resolvem
isso, ex. o backup noturno via systemd timer separado; se não houver
precedente de "1x/dia" dentro deste MESMO script, adicione um `hora=$(date
-u +%H)` e condicione a `[ "$hora" = "06" ] && [ "$bloco" -eq 0 ]` pra
rodar uma vez só, de manhã cedo, hora UTC).

**Step 4: Aplicar migration nos 2 bancos + deploy**

```bash
node scripts/aplicar-migration.mjs 101_margem_snapshot_diario.sql
```
E via scp+psql no Contabo (mesmo padrão das migrations anteriores desta
sessão). Deploy do app via `git push` + `ssh ... deploy.sh`.

**Step 5: Rodar manualmente uma vez e confirmar**

```bash
ssh ... "cd /opt/ntb-estoque && SECRET=\$(grep '^CRON_SECRET=' .env.local | cut -d'=' -f2- | tr -d '\"') && curl -s -H \"Authorization: Bearer \$SECRET\" http://127.0.0.1:3002/api/cron/snapshot-margem-diario"
```
Confirme via `psql` direto no Contabo que `margem_snapshot_diario` tem
linhas reais pra pelo menos 1 loja.

**Step 6: Commit**

```bash
git add supabase/migrations/101_margem_snapshot_diario.sql app/api/cron/snapshot-margem-diario/route.ts scripts/sync-cron.sh
git commit -m "feat: snapshot diário de CMC/margem (base pra evolução mensal futura)"
```

---

### Task 5: Evolução mensal de margem na tela (loja com import real + link pro snapshot novo)

**Files:**
- Modify: `app/(app)/relatorio-margem/page.tsx`

**Step 1: Matriz mensal quando há import real (não `calculadaAoVivo`)**

Hoje, `porCod` (linha ~267) descarta todos os meses exceto o mais
recente por produto. Quando `!calculadaAoVivo` (import manual real
existe — hoje só loja 3), troque a lógica: monte também uma matriz
mês-a-mês (mesmo formato de `linhas`/`meses` já usado em
`relatorio-faturamento/page.tsx`) a partir de `rows` (que já tem `mes`
por linha, sem precisar de nova query) — SEM remover a visão atual
"mais recente por produto" (ela continua sendo a visão padrão da
tabela principal), mas adicionando uma segunda seção abaixo, colapsável
por produto ou uma tabela separada "Evolução mensal", só visível
quando `!calculadaAoVivo && meses.length > 1`.

Reaproveite a estrutura de tabela matriz já usada em
`relatorio-faturamento/page.tsx` (linhas ~534-580) como referência
exata de markup (sticky header, coluna por mês, total).

**Step 2: Quando `calculadaAoVivo` — link pro snapshot acumulando**

Quando `calculadaAoVivo === true` (5 das 6 lojas hoje), adicione um
aviso claro (mesmo padrão visual do aviso já existente de "Import
manual desatualizado"):

```tsx
{calculadaAoVivo && (
  <p className="text-[12px] text-text-muted">
    Evolução mensal real ainda não disponível pra esta loja — o sistema
    passou a arquivar o custo diário a partir de {/* data do primeiro snapshot, ou "hoje" */}.
    Volte em algumas semanas pra ver a tendência.
  </p>
)}
```

Busque `relatorio_margem_snapshot_matriz` (RPC da Task 4) e, se já
tiver 2+ meses distintos de dado acumulado, mostre a matriz também
(mesma UI da Step 1) em vez do aviso — condicional simples: `const
temSnapshotSuficiente = mesesSnapshot.length >= 2`.

**Step 2: Typecheck + lint**

Run: `npx tsc --noEmit && npx eslint "app/(app)/relatorio-margem/page.tsx"`

**Step 3: Teste real**

Deploy + Playwright real na loja 3 (import manual, deve mostrar matriz
mensal de verdade) e em outra loja (deve mostrar o aviso de
"acumulando"). Screenshot de ambos os casos.

**Step 4: Commit**

```bash
git add "app/(app)/relatorio-margem/page.tsx"
git commit -m "feat: evolução mensal de margem (dado real onde existe, aviso onde está acumulando)"
```

---

### Task 6: Deploy final e validação de ponta a ponta

**Files:** nenhum arquivo novo.

**Step 1:** Confirmar as 2 migrations (100 já aplicada em sessão
anterior — 101 desta) nos 2 bancos.

**Step 2:** `curl` de health-check em `https://app-estoque.norteparanegocios.com.br`.

**Step 3:** Roteiro de teste manual (Playwright, `scripts/*-tmp.mjs`,
apagar depois):
1. Home → confirmar 4 widgets novos/atualizados (bottom-10, top
   quantidade, link evolução mensal x2).
2. `/relatorio-faturamento?ver=descontos` → 2 tabelas com dado real.
3. `/relatorio-margem` → loja 3 mostra matriz mensal real; outra loja
   mostra aviso de acumulação.

**Step 4:** Reportar ao usuário com screenshots reais de cada tela.
