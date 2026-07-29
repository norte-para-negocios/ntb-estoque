# Dashboard/Home por perfil (item #16) — Operação × Gerência

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/home` (a tela "Início" que todo usuário logado vê) passa a mostrar conteúdo diferente por perfil: quem não é gestão (`perfil = 'Usuario'`, `!podeGerir`) vê só o painel operacional enxuto já existente (com um ajuste: parar de vazar valor de NF, e ganhar o alerta de "notas fiscais pendentes" que hoje só existe no `/resumo` gerencial); quem é gestão (`Admin`/`AdminLoja`, `podeGerir`) ganha, além disso, um bloco novo com gráficos: rejeitos por tipo, top produtos faturados/comprados, produtos parados em estoque, e a relação compras/faturamento por categoria com os limiares de referência reais (30% / 8% / 0%) achados no relatório da consultoria.

**Architecture:** 2 RPCs novas (rejeitos por tipo, produtos parados) — o resto (top faturados/comprados) reaproveita as RPCs `relatorio_faturamento_matriz`/`relatorio_compras_matriz` que já existem, só agregando e cortando pro top-N em JS. `app/(app)/home/page.tsx` passa a ramificar em `podeGerir` — o bloco operacional (hoje já 90% correto) fica isolado numa função/seção só, e um bloco novo (`components/home/PainelGerencial.tsx` + `lib/dashboard-gerencial.ts`) é renderizado só pra gestão. Gráficos reaproveitam `ResumoGrafico` (já existe, genérico o suficiente pra ranking/breakdown) — não precisa de componente novo tipo `ProducaoChart`.

## Global Constraints

- **Achado real antes de mexer em qualquer coisa**: a home ATUAL já mostra `n_valor_nfe` (valor de compra) pra QUALQUER usuário logado, na seção "Últimas notas fiscais" (`app/(app)/home/page.tsx:389-391`, componente `<Money value={nf.n_valor_nfe} />`) — isso viola a regra do item #16 ("Operação não deve ver valores de compra") já HOJE, antes mesmo da reestruturação. Essa seção sai da visão Operação nesta tarefa (não é regressão, é a correção que o item pede).
- Nunca chamar `.select()`/`.rpc()` sem paginação numa tabela que pode passar de 1000 linhas — sempre count-first + `.range()` (bug real já corrigido 3x nesta sessão).
- `movimentos.valor` é custo UNITÁRIO (CMC no momento do movimento), não valor de linha — todo cálculo de valor precisa multiplicar por `quan` (achado da pesquisa: `lib/actions/transferencia.ts:302-318`, `lib/actions/movimentacoes.ts:79-94`).
- Rejeito/perda = `movimentos.motivo = 'TPQ'` (gravado direto na linha, não precisa join com `transferencias`) — não inventar outro critério.
- Limiares de referência (30% Compras/Faturamento, 8% Perda MP, 0% Perda Revenda) são valores fixos exibidos como referência visual — **não** sobrescrevem `lojas.meta_compras_pct` (esse campo continua editável em "Minha loja", sem mudança; Ramon disse "não precisa mudar por enquanto").
- Sem suite de testes automatizada — verificação é `npx eslint <arquivo>` (0 erros novos) + `npm run build` (`EXIT=0`) + QA visual real via chrome-devtools MCP com a conta `claude.qa@ntb-estoque.dev` / `claudeqa123456` contra `npx next dev -p 3008`. A conta QA é `Admin`/`podeGerir` — a visão Gerência é testável ao vivo; a visão Operação é verificada por leitura de código + um teste isolado da função de dados (não dá pra logar como `Usuario` sem criar/alterar uma conta de teste, o que não é o escopo desta tarefa).
- Deploy manual: `ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "cd /opt/ntb-estoque && bash deploy.sh"`, depois `curl` confirmando HTTP 200 em produção.
- Migration numerada 093 (última existente: 092).

---

### Task 1: Migration — RPCs `relatorio_rejeitos_por_tipo` e `relatorio_produtos_parados`

**Files:**
- Create: `supabase/migrations/093_rejeitos_e_produtos_parados.sql`

**Interfaces:**
- Produces: RPC `relatorio_rejeitos_por_tipo(p_loja_id bigint, p_data_ini date, p_data_fim date)` → `(categoria text, valor_total numeric, qtd_movimentos bigint)`. RPC `relatorio_produtos_parados(p_loja_id bigint, p_dias int default 30)` → `(codigo_produto bigint, codigo text, descricao text, n_saldo numeric, dias_sem_movimento int, data_ultimo_movimento date)`. Ambas consumidas pela Task 2.

- [ ] **Step 1: Escrever a migration**

```sql
-- Item #16 da reuniao 2026-07-27 (Andrey/Ramon): dashboard gerencial. Duas RPCs
-- novas -- as demais secoes (top faturados/comprados) reaproveitam RPCs ja
-- existentes (relatorio_faturamento_matriz, relatorio_compras_matriz).
--
-- Achado da pesquisa: rejeito/perda ja existe no sistema como
-- movimentos.motivo = 'TPQ' (gravado direto na linha em
-- lib/actions/transferencia.ts, addMovimento) -- nao precisa join com
-- transferencias. movimentos.valor e CUSTO UNITARIO (CMC), nao valor de
-- linha -- todo total precisa de valor*quan.

create or replace function relatorio_rejeitos_por_tipo(
  p_loja_id  bigint,
  p_data_ini date,
  p_data_fim date
)
returns table (
  categoria      text,
  valor_total    numeric,
  qtd_movimentos bigint
)
language sql
stable
security invoker
as $$
  select
    case
      when p.tipo_item = '01' then 'Matéria-prima'
      when p.tipo_item = '00' then 'Revenda'
      when p.tipo_item in ('03', '06') then 'Produto em processo'
      else 'Outros'
    end as categoria,
    sum(coalesce(m.valor, 0) * coalesce(m.quan, 0)) as valor_total,
    count(*) as qtd_movimentos
  from movimentos m
  join produtos p on p.codigo_produto = m.id_prod and p.loja_id = m.loja_id
  where m.loja_id = p_loja_id
    and m.motivo = 'TPQ'
    and m.status = 'Concluido'
    and m.data >= p_data_ini
    and m.data < (p_data_fim + 1)
  group by categoria
  order by valor_total desc nulls last
$$;

create or replace function relatorio_produtos_parados(
  p_loja_id bigint,
  p_dias    int default 30
)
returns table (
  codigo_produto        bigint,
  codigo                text,
  descricao             text,
  n_saldo               numeric,
  dias_sem_movimento    int,
  data_ultimo_movimento date
)
language sql
stable
security invoker
as $$
  with foto as (
    select max(data_posicao) as d
    from posicao_estoques
    where loja_id = p_loja_id
  ),
  saldo as (
    select pe.n_cod_prod, sum(pe.n_saldo) as n_saldo
    from posicao_estoques pe
    join foto on pe.data_posicao = foto.d
    where pe.loja_id = p_loja_id
    group by pe.n_cod_prod
  ),
  ultimos as (
    select id_prod, max(data)::date as data_ultimo_movimento
    from movimentos
    where loja_id = p_loja_id
    group by id_prod
  )
  select
    p.codigo_produto,
    p.codigo::text,
    p.descricao::text,
    s.n_saldo,
    coalesce((current_date - u.data_ultimo_movimento), 9999) as dias_sem_movimento,
    u.data_ultimo_movimento
  from saldo s
  join produtos p on p.codigo_produto = s.n_cod_prod and p.loja_id = p_loja_id
  left join ultimos u on u.id_prod = s.n_cod_prod
  where s.n_saldo > 0
    and (u.data_ultimo_movimento is null or u.data_ultimo_movimento < current_date - p_dias)
  order by dias_sem_movimento desc, s.n_saldo desc
  limit 50
$$;

revoke execute on function relatorio_rejeitos_por_tipo(bigint, date, date) from public, anon;
grant  execute on function relatorio_rejeitos_por_tipo(bigint, date, date) to authenticated, service_role;

revoke execute on function relatorio_produtos_parados(bigint, int) from public, anon;
grant  execute on function relatorio_produtos_parados(bigint, int) to authenticated, service_role;
```

- [ ] **Step 2: Aplicar a migration**

```bash
cd "/Users/joaquimsalles/Projects/norte para negocios/ntb estoque"
cat > apply-migration.mjs << 'EOF'
import { Client } from 'pg'
import { readFileSync } from 'fs'
import 'dotenv/config'
const sql = readFileSync(process.argv[2], 'utf8')
const client = new Client({ connectionString: process.env.SUPABASE_DB_URL })
await client.connect()
try { await client.query(sql); console.log('OK') } finally { await client.end() }
EOF
node --env-file=.env.local apply-migration.mjs supabase/migrations/093_rejeitos_e_produtos_parados.sql
rm apply-migration.mjs
```

- [ ] **Step 3: Smoke-test das 2 RPCs com dado real**

```bash
cat > check.mjs << 'EOF'
import { Client } from 'pg'
import 'dotenv/config'
const client = new Client({ connectionString: process.env.SUPABASE_DB_URL })
await client.connect()
const rej = await client.query(`select * from relatorio_rejeitos_por_tipo(2, '2026-01-01', '2026-07-28')`)
console.log('rejeitos:', rej.rows)
const par = await client.query(`select * from relatorio_produtos_parados(2, 30) limit 5`)
console.log('parados (5):', par.rows)
await client.end()
EOF
node --env-file=.env.local check.mjs
rm check.mjs
```
Expected: sem erro de sintaxe/tipo. `rejeitos` pode vir vazio (se a loja não tiver TPQ no período — legítimo, não é bug). `parados` deve trazer produtos reais com `n_saldo > 0`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/093_rejeitos_e_produtos_parados.sql
git commit -m "feat: RPCs relatorio_rejeitos_por_tipo e relatorio_produtos_parados"
```

---

### Task 2: Camada de dados do painel gerencial

**Files:**
- Create: `lib/dashboard-gerencial.ts`

**Interfaces:**
- Consumes: `createServiceClient` (`@/lib/supabase/server`), `rpcTodos` (`@/lib/supabase/rpc-todos`).
- Produces:
  ```ts
  export type RankingItem = { label: string; valor: number }
  export type RejeitoCategoria = { categoria: string; valorTotal: number; qtdMovimentos: number; pctDoFaturamento: number | null }
  export type ProdutoParado = { codigoProduto: number; codigo: string; descricao: string; saldo: number; diasSemMovimento: number }
  export type RatioCategoria = { categoria: string; compras: number; faturamento: number; pct: number | null }
  export type DashboardGerencial = {
    rejeitos: RejeitoCategoria[]
    topFaturados: RankingItem[]
    topComprados: RankingItem[]
    maiorFornecedor: RankingItem | null
    produtosParados: ProdutoParado[]
    ratioCompraFaturamento: RatioCategoria[]
  }
  export async function carregarDashboardGerencial(lojaId: number, dataIni: string, dataFim: string, topN: number): Promise<DashboardGerencial>
  ```
  Consumida pela Task 4 (`home/page.tsx` + `PainelGerencial.tsx`).

- [ ] **Step 1: Escrever `lib/dashboard-gerencial.ts`**

```ts
import { createServiceClient } from '@/lib/supabase/server'
import { rpcTodos } from '@/lib/supabase/rpc-todos'

export type RankingItem = { label: string; valor: number }
export type RejeitoCategoria = { categoria: string; valorTotal: number; qtdMovimentos: number; pctDoFaturamento: number | null }
export type ProdutoParado = { codigoProduto: number; codigo: string; descricao: string; saldo: number; diasSemMovimento: number }
export type RatioCategoria = { categoria: string; compras: number; faturamento: number; pct: number | null }
export type DashboardGerencial = {
  rejeitos: RejeitoCategoria[]
  topFaturados: RankingItem[]
  topComprados: RankingItem[]
  maiorFornecedor: RankingItem | null
  produtosParados: ProdutoParado[]
  ratioCompraFaturamento: RatioCategoria[]
}

type MatrizRow = { rotulo: string; mes: string; valor: number }

function somarPorRotulo(rows: MatrizRow[]): Map<string, number> {
  const mapa = new Map<string, number>()
  for (const r of rows) mapa.set(r.rotulo, (mapa.get(r.rotulo) ?? 0) + Number(r.valor))
  return mapa
}

function topNDoMapa(mapa: Map<string, number>, n: number): RankingItem[] {
  return Array.from(mapa.entries())
    .map(([label, valor]) => ({ label, valor }))
    .sort((a, b) => b.valor - a.valor)
    .slice(0, n)
}

export async function carregarDashboardGerencial(
  lojaId: number,
  dataIni: string,
  dataFim: string,
  topN: number
): Promise<DashboardGerencial> {
  const supabase = createServiceClient()
  const mesIni = dataIni.slice(0, 7)
  const mesFim = dataFim.slice(0, 7)

  const [
    rejeitosRows,
    parados,
    faturamentoPorProduto,
    comprasPorProduto,
    comprasPorFornecedor,
    faturamentoPorTipo,
    comprasMateriaPrima,
    comprasRevenda,
  ] = await Promise.all([
    rpcTodos<{ categoria: string; valor_total: number | null; qtd_movimentos: number }>(supabase, 'relatorio_rejeitos_por_tipo', {
      p_loja_id: lojaId,
      p_data_ini: dataIni,
      p_data_fim: dataFim,
    }),
    supabase.rpc('relatorio_produtos_parados', { p_loja_id: lojaId, p_dias: 30 }),
    rpcTodos<MatrizRow>(supabase, 'relatorio_faturamento_matriz', {
      p_loja_id: lojaId,
      p_dim: 'produto',
      p_mes_ini: mesIni,
      p_mes_fim: mesFim,
      p_rotulos: null,
    }),
    rpcTodos<MatrizRow>(supabase, 'relatorio_compras_matriz', {
      p_loja_id: lojaId,
      p_ini: dataIni,
      p_fim: dataFim,
      p_dim: 'produto',
      p_familias: null,
      p_tipos: null,
      p_fornecedor: null,
      p_cfops: null,
      p_produto: null,
      p_local: null,
    }),
    rpcTodos<MatrizRow>(supabase, 'relatorio_compras_matriz', {
      p_loja_id: lojaId,
      p_ini: dataIni,
      p_fim: dataFim,
      p_dim: 'fornecedor',
      p_familias: null,
      p_tipos: null,
      p_fornecedor: null,
      p_cfops: null,
      p_produto: null,
      p_local: null,
    }),
    rpcTodos<MatrizRow>(supabase, 'relatorio_faturamento_matriz', {
      p_loja_id: lojaId,
      p_dim: 'tipo',
      p_mes_ini: mesIni,
      p_mes_fim: mesFim,
      p_rotulos: null,
    }),
    rpcTodos<MatrizRow>(supabase, 'relatorio_compras_matriz', {
      p_loja_id: lojaId,
      p_ini: dataIni,
      p_fim: dataFim,
      p_dim: 'cfop',
      p_familias: null,
      p_tipos: ['01'],
      p_fornecedor: null,
      p_cfops: null,
      p_produto: null,
      p_local: null,
    }),
    rpcTodos<MatrizRow>(supabase, 'relatorio_compras_matriz', {
      p_loja_id: lojaId,
      p_ini: dataIni,
      p_fim: dataFim,
      p_dim: 'cfop',
      p_familias: null,
      p_tipos: ['00'],
      p_fornecedor: null,
      p_cfops: null,
      p_produto: null,
      p_local: null,
    }),
  ])

  const faturamentoPorTipoMap = somarPorRotulo(faturamentoPorTipo)
  const faturamentoAcabado = faturamentoPorTipoMap.get('Produto Acabado') ?? 0
  const faturamentoRevenda = faturamentoPorTipoMap.get('Mercadoria para Revenda') ?? 0
  const comprasMP = comprasMateriaPrima.reduce((s, r) => s + Number(r.valor), 0)
  const comprasRev = comprasRevenda.reduce((s, r) => s + Number(r.valor), 0)

  const rejeitos: RejeitoCategoria[] = rejeitosRows.map((r) => {
    const base = r.categoria === 'Matéria-prima' ? faturamentoAcabado : r.categoria === 'Revenda' ? faturamentoRevenda : null
    return {
      categoria: r.categoria,
      valorTotal: Number(r.valor_total ?? 0),
      qtdMovimentos: Number(r.qtd_movimentos),
      pctDoFaturamento: base && base > 0 ? Math.round(((Number(r.valor_total ?? 0)) / base) * 1000) / 10 : null,
    }
  })

  const produtosParados: ProdutoParado[] = (parados.data ?? []).map((p) => ({
    codigoProduto: Number(p.codigo_produto),
    codigo: p.codigo,
    descricao: p.descricao,
    saldo: Number(p.n_saldo),
    diasSemMovimento: Number(p.dias_sem_movimento),
  }))

  const fornecedorTop = topNDoMapa(somarPorRotulo(comprasPorFornecedor), 1)

  return {
    rejeitos,
    topFaturados: topNDoMapa(somarPorRotulo(faturamentoPorProduto), topN),
    topComprados: topNDoMapa(somarPorRotulo(comprasPorProduto), topN),
    maiorFornecedor: fornecedorTop[0] ?? null,
    produtosParados,
    ratioCompraFaturamento: [
      {
        categoria: 'Produto acabado (vs. compra de matéria-prima)',
        compras: comprasMP,
        faturamento: faturamentoAcabado,
        pct: faturamentoAcabado > 0 ? Math.round((comprasMP / faturamentoAcabado) * 1000) / 10 : null,
      },
      {
        categoria: 'Revenda (vs. compra de revenda)',
        compras: comprasRev,
        faturamento: faturamentoRevenda,
        pct: faturamentoRevenda > 0 ? Math.round((comprasRev / faturamentoRevenda) * 1000) / 10 : null,
      },
    ],
  }
}
```

- [ ] **Step 2: Lint**

Run: `npx eslint lib/dashboard-gerencial.ts`
Expected: 0 erros novos.

- [ ] **Step 3: Smoke-test manual via script**

```bash
cd "/Users/joaquimsalles/Projects/norte para negocios/ntb estoque"
cat > test-gerencial.mjs << 'EOF'
import { carregarDashboardGerencial } from './lib/dashboard-gerencial.ts'
const r = await carregarDashboardGerencial(2, '2026-01-01', '2026-07-28', 10)
console.log(JSON.stringify(r, null, 2))
EOF
npx tsx --env-file=.env.local test-gerencial.mjs
rm test-gerencial.mjs
```
Expected: JSON com as 6 chaves preenchidas, valores plausíveis (compare `topFaturados[0].valor` contra o que `/relatorio-faturamento` já mostra pra mesma loja/período, devem ser da mesma ordem de grandeza).

- [ ] **Step 4: Commit**

```bash
git add lib/dashboard-gerencial.ts
git commit -m "feat: camada de dados do painel gerencial (rejeitos, top produtos, parados, ratio compra/faturamento)"
```

---

### Task 3: Componente `MeterRatio` (relação compras/faturamento com limiar)

**Files:**
- Create: `components/home/MeterRatio.tsx`

**Interfaces:**
- Consumes: nada externo.
- Produces: `<MeterRatio label={string} pct={number|null} limite={number} formato="pct" />`, consumido pela Task 4.

- [ ] **Step 1: Escrever o componente**

Segue o spec de "Meter" da skill `dataviz` (`references/marks-and-anatomy.md`): trilho na cor mais clara da mesma rampa, preenchimento na cor cheia, severidade por posição relativa ao limite (bom = `--ok`, acima do limite = `--err`).

```tsx
export function MeterRatio({
  label,
  pct,
  limite,
}: {
  label: string
  pct: number | null
  limite: number
}) {
  if (pct == null) {
    return (
      <div className="rounded-lg border border-border bg-surface px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">{label}</p>
        <p className="mt-1 text-sm text-text-muted">Sem faturamento no período</p>
      </div>
    )
  }
  const acimaDoLimite = pct > limite
  const larguraPct = Math.min(100, (pct / Math.max(limite * 2, pct)) * 100)
  const larguraLimite = Math.min(100, (limite / Math.max(limite * 2, pct)) * 100)
  return (
    <div className="rounded-lg border border-border bg-surface px-4 py-3">
      <div className="flex items-baseline justify-between">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">{label}</p>
        <span className={`num text-sm font-bold ${acimaDoLimite ? 'text-err' : 'text-ok'}`}>{pct.toFixed(1)}%</span>
      </div>
      <div className="relative mt-2 h-2 overflow-hidden rounded-full bg-surface-2">
        <div
          className={`h-full rounded-full u-motion ${acimaDoLimite ? 'bg-err' : 'bg-ok'}`}
          style={{ width: `${larguraPct}%` }}
        />
        <div className="absolute top-0 h-full w-px bg-text/40" style={{ left: `${larguraLimite}%` }} />
      </div>
      <p className="mt-1 text-[11px] text-text-muted">Referência: até {limite}%</p>
    </div>
  )
}
```

- [ ] **Step 2: Lint**

Run: `npx eslint components/home/MeterRatio.tsx`
Expected: 0 erros novos.

- [ ] **Step 3: Commit**

```bash
git add components/home/MeterRatio.tsx
git commit -m "feat: componente MeterRatio (medidor com linha de referencia)"
```

---

### Task 4: Ramificar `/home` por perfil

**Files:**
- Modify: `app/(app)/home/page.tsx`
- Create: `components/home/PainelGerencial.tsx`

**Interfaces:**
- Consumes: `carregarDashboardGerencial` (Task 2), `MeterRatio` (Task 3), `ResumoGrafico` (`@/components/resumo/ResumoGrafico`, já existe — props `{ grafico: { titulo, unidade: 'num'|'reais', itens: {label,valor}[] } }`), `getAtorGestao` (`@/lib/auth`).

- [ ] **Step 1: Remover a seção "Últimas notas fiscais" (mostra valor de compra pra todo mundo) da visão padrão**

Em `app/(app)/home/page.tsx`, remover o bloco (linhas 370-400 atuais):
```tsx
{/* Últimas notas */}
{pode('Notas Fiscais') && (
  <section>
    ...
  </section>
)}
```
e a query `ultimasNotas` (linha 97) e o import `Money` (linha 20) se não sobrarem outros usos — checar com `grep -n "Money\|ultimasNotas" "app/(app)/home/page.tsx"` antes de remover o import.

- [ ] **Step 2: Adicionar alerta de "notas fiscais pendentes" (reaproveitando a lógica de `carregarPainelAcao`)**

`lib/resumo-dia.ts` já tem a lógica de "NF travada" (item #3, corrigido nesta sessão — restrita ao mês atual). Ler a função `carregarPainelAcao` (por volta da linha 658-758) e extrair só a contagem de NF pendente pra reusar aqui — não importar a função inteira (ela é multi-loja e faz mais coisa que `/home` não precisa). Adicionar em `app/(app)/home/page.tsx`, dentro do `Promise.all` principal, uma query equivalente:
```ts
supabase.from('notas_fiscais').select('id', head).eq('loja_id', lojaId).eq('c_situacao', 'Pendente').gte('d_emissao_nfe', primeiroDiaMesISO).is('deleted_at', null),
```
(confirmar o nome exato da coluna de status/situação da NF antes de escrever — ler `lib/resumo-dia.ts` ao redor da lógica de `nfTravada` pra copiar o filtro EXATO, não reinventar.) Adicionar `primeiroDiaMesISO` (mesmo padrão de `lib/resumo-dia.ts`, mês corrente) e um novo item em `alertas`:
```ts
if ((nfPendentes.count ?? 0) > 0 && pode('Notas Fiscais'))
  alertas.push({ icon: FileText, token: 'warn', texto: `${nfPendentes.count} nota(s) fiscal(is) pendente(s) este mês`, href: '/nota-fiscal?status=pendente' })
```
(confirmar a URL de filtro correta em `/nota-fiscal` antes de usar — ler `app/(app)/nota-fiscal/page.tsx` pra achar o nome do query param de status.)

- [ ] **Step 3: Envolver o retorno da página numa checagem de `podeGerir`**

No topo da função `HomePage`, adicionar:
```ts
import { getAtorGestao } from '@/lib/auth'
// ...
const ator = await getAtorGestao()
```
E no fim do JSX (depois da seção "Repor estoque", antes do `</div>` final), adicionar:
```tsx
{ator.podeGerir && (
  <PainelGerencial lojaId={lojaId} />
)}
```

- [ ] **Step 4: Criar `components/home/PainelGerencial.tsx`**

Server Component assíncrono (não precisa `'use client'` — só os dados, sem interação):

```tsx
import Link from 'next/link'
import { carregarDashboardGerencial } from '@/lib/dashboard-gerencial'
import { ResumoGrafico } from '@/components/resumo/ResumoGrafico'
import { MeterRatio } from '@/components/home/MeterRatio'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { AlertTriangle } from 'lucide-react'

function fmtMoeda(n: number) {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export async function PainelGerencial({ lojaId }: { lojaId: number }) {
  const hoje = new Date()
  const anoAtual = hoje.getFullYear()
  const dataIni = `${anoAtual}-01-01`
  const dataFim = hoje.toISOString().slice(0, 10)

  const d = await carregarDashboardGerencial(lojaId, dataIni, dataFim, 10)

  return (
    <section className="space-y-6 border-t border-border pt-6">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-muted">Visão gerencial (ano corrente)</h2>
        <Link href="/relatorios" className="text-[13px] text-brand hover:underline">
          ver todos os relatórios →
        </Link>
      </div>

      {/* Rejeitos por tipo */}
      <div>
        <h3 className="mb-2 text-sm font-bold uppercase tracking-[0.12em] text-text">Rejeitos / perdas por tipo</h3>
        {d.rejeitos.length === 0 ? (
          <EmptyState icon={AlertTriangle} title="Sem rejeitos registrados no período" hint="" />
        ) : (
          <>
            <ResumoGrafico
              grafico={{
                titulo: 'Valor perdido por categoria',
                unidade: 'reais',
                itens: d.rejeitos.map((r) => ({ label: r.categoria, valor: r.valorTotal })),
              }}
            />
            <div className="mt-2 flex flex-wrap gap-3 text-[12px] text-text-muted">
              {d.rejeitos.map((r) => (
                <span key={r.categoria}>
                  {r.categoria}: {fmtMoeda(r.valorTotal)}
                  {r.pctDoFaturamento != null && (
                    <span className={r.categoria === 'Revenda' ? (r.pctDoFaturamento > 0 ? 'text-err font-semibold' : '') : r.pctDoFaturamento > 8 ? 'text-err font-semibold' : ''}>
                      {' '}({r.pctDoFaturamento}% do faturamento{r.categoria === 'Revenda' ? ' — tolerância 0%' : ', ref. 8%'})
                    </span>
                  )}
                </span>
              ))}
            </div>
            <Link href="/transferencia?motivo=TPQ" className="mt-1 inline-block text-[12px] text-brand hover:underline">
              ver lançamentos de perda →
            </Link>
          </>
        )}
      </div>

      {/* Relação compras/faturamento */}
      <div>
        <h3 className="mb-2 text-sm font-bold uppercase tracking-[0.12em] text-text">Relação compras/faturamento</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {d.ratioCompraFaturamento.map((r) => (
            <MeterRatio key={r.categoria} label={r.categoria} pct={r.pct} limite={30} />
          ))}
        </div>
      </div>

      {/* Top faturados / comprados */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm font-bold uppercase tracking-[0.12em] text-text">Top 10 mais faturados</h3>
          {d.topFaturados.length === 0 ? (
            <EmptyState icon={AlertTriangle} title="Sem faturamento no período" hint="" />
          ) : (
            <ResumoGrafico grafico={{ titulo: '', unidade: 'reais', itens: d.topFaturados }} />
          )}
        </div>
        <div>
          <h3 className="mb-2 text-sm font-bold uppercase tracking-[0.12em] text-text">Top 10 mais comprados</h3>
          {d.topComprados.length === 0 ? (
            <EmptyState icon={AlertTriangle} title="Sem compras no período" hint="" />
          ) : (
            <ResumoGrafico grafico={{ titulo: '', unidade: 'reais', itens: d.topComprados }} />
          )}
          {d.maiorFornecedor && (
            <p className="mt-2 text-[12px] text-text-muted">
              Maior fornecedor: <span className="font-medium text-text">{d.maiorFornecedor.label}</span> ({fmtMoeda(d.maiorFornecedor.valor)})
            </p>
          )}
        </div>
      </div>

      {/* Produtos parados */}
      <div>
        <div className="flex items-baseline justify-between border-b-2 border-text pb-2 mb-1">
          <h3 className="text-sm font-bold uppercase tracking-[0.12em] text-text">Produtos parados (30+ dias sem movimento)</h3>
        </div>
        {d.produtosParados.length === 0 ? (
          <EmptyState icon={AlertTriangle} title="Nenhum produto parado" hint="Todos os produtos com saldo tiveram movimento recente." />
        ) : (
          <ul className="divide-y divide-border">
            {d.produtosParados.slice(0, 8).map((p) => (
              <li key={p.codigoProduto} className="flex items-center gap-3 py-2.5 text-sm">
                <span className="min-w-0 flex-1 truncate text-text">{p.descricao}</span>
                <span className="num text-[12px] text-text-muted">{p.diasSemMovimento >= 9999 ? 'sem registro' : `${p.diasSemMovimento}d parado`}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
```

- [ ] **Step 5: Lint**

Run: `npx eslint "app/(app)/home/page.tsx" components/home/PainelGerencial.tsx`
Expected: 0 erros novos.

- [ ] **Step 6: Build**

Run: `npm run build`
Expected: `EXIT=0`.

- [ ] **Step 7: QA visual real**

Com `npx next dev -p 3008` rodando e login QA (Admin, então vê a visão Gerência) via chrome-devtools MCP:
1. Abrir `/home` — confirmar que a seção "Últimas notas fiscais" NÃO aparece mais (nem pra Admin — foi removida da visão padrão, não movida pro painel gerencial; se fizer sentido trazer de volta só pra gestão, avaliar nesse momento, mas não é obrigatório pro escopo do item #16).
2. Confirmar que o alerta de "notas fiscais pendentes" aparece quando há notas pendentes no mês.
3. Rolar até "Visão gerencial" — confirmar que renderiza: rejeitos (ou empty state), 2 medidores de compras/faturamento, top 10 faturados/comprados, produtos parados.
4. Comparar 1-2 números contra os relatórios já existentes (ex.: abrir `/relatorio-faturamento?dim=produto` e conferir se o produto #1 do ranking bate com o topo do `topFaturados`).
5. Tirar screenshot da página inteira, olhar visualmente por overlap/corte (skill dataviz, passo 7).
6. `pkill -f "next dev -p 3008"` ao terminar.

- [ ] **Step 8: Commit**

```bash
git add "app/(app)/home/page.tsx" components/home/PainelGerencial.tsx
git commit -m "feat: home ramificada por perfil -- painel gerencial pra Admin/AdminLoja (item #16)"
```

---

### Task 5: Deploy e atualização do catálogo

**Files:**
- Modify: `docs/reuniao-2026-07-27-pedidos.md`

- [ ] **Step 1: Deploy em produção**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "cd /opt/ntb-estoque && bash deploy.sh"
curl -s -o /dev/null -w "HTTP %{http_code}\n" https://app-estoque.norteparanegocios.com.br/login
```
Expected: HTTP 200.

- [ ] **Step 2: Verificação final em produção**

Repetir os checks visuais do Step 7 da Task 4 contra a URL de produção.

- [ ] **Step 3: Atualizar o catálogo da reunião**

Marcar o item #16 como concluído (ou "1ª fase concluída", já que o pedido original é maior — categorias contábeis, régua de compra dinâmica e alertas automáticos ficam de fora, ver nota abaixo) em `docs/reuniao-2026-07-27-pedidos.md`.

**Escopo deliberadamente fora desta 1ª fase** (registrar explicitamente, não silenciar): régua de compra dinâmica por média móvel, alertas automáticos de Compras/Perdas antes do fechamento do mês, exigência de foto em toda perda — essas 3 são "recomendações que viram pedidos implícitos de feature" (linhas 256-260 do catálogo), maiores que o escopo direto do item #16 (que é "mostrar o dashboard certo pra cada perfil"), tratá-las como itens novos a priorizar depois, não como parte pendente deste item.

- [ ] **Step 4: Commit**

```bash
git add docs/reuniao-2026-07-27-pedidos.md
git commit -m "docs: marcar item #16 (dashboard por perfil, 1a fase) como concluido"
git push
```

## Self-Review Notes

- Cobertura do spec: perfil Operação enxuto sem valores ✓ (e corrige um vazamento real que já existia); perfil Gerência com gráficos (não tabelas) ✓; rejeitos por tipo com valor + drill-down ✓ (drill-down é um link filtrado, não uma tela nova — suficiente pro pedido, mais barato que construir uma tela de drill-down dedicada); top 10/20 faturados/comprados + maior fornecedor ✓; produtos parados ✓; relação compras/faturamento por categoria com limiares reais (30/8/0%) ✓.
- Fora do escopo desta 1ª fase, registrado explicitamente na Task 5: régua de compra dinâmica, alertas automáticos, foto obrigatória em perda — são pedidos maiores, novos itens de catálogo, não uma "parte esquecida" do #16.
- `meta_compras_pct` (40% hardcoded/default) não é alterado — os limiares novos são só visuais/de referência, decisão já tomada no plano (não decidir sozinho se o padrão de 40% devia virar 30%, é uma mudança de política de negócio, não desta tarefa).
- Tipos consistentes entre Task 2 (`DashboardGerencial`) e Task 4 (`PainelGerencial` consome exatamente esses campos).
- Risco aceito e registrado: a visão Operação não é testável ao vivo com a conta QA atual (que é Admin) — verificação nessa parte é por leitura de código + smoke-test isolado da query, não por screenshot. Se o usuário quiser certeza visual, precisaria de uma 2ª conta de teste com `perfil = 'Usuario'`.
