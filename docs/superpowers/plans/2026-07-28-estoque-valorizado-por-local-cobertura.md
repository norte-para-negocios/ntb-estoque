# Estoque Valorizado — visão "Por local" com cobertura de inventário

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No relatório Estoque Valorizado, adicionar uma segunda visão ("Por local") que mostra saldo por produto+local junto com a data da última contagem de inventário daquele produto naquele local, para o usuário identificar o que está há muito tempo sem ser contado.

**Architecture:** Nova RPC `relatorio_estoque_valorizado_local` (mesmo padrão SQL da `relatorio_estoque_valorizado` existente, migration 087, mas sem agregar por local — 1 linha por produto+local — e com `left join` num CTE que calcula `max(inventarios.data)` por produto+local). A página `relatorio-estoque-valorizado/page.tsx` ganha uma aba `SegmentLinks` (`?ver=local`) que troca a RPC chamada e a tabela renderizada; a visão default (agregada) não muda em nada.

**Tech Stack:** Next.js 16 App Router (Server Component), Supabase Postgres RPC (SQL puro), `rpcTodos` para paginação anti-corte-1000-linhas, `SegmentLinks` (componente client já existente) para a troca de aba via query param.

## Global Constraints

- Nunca chamar `db.rpc()` direto para uma RPC que pode retornar >1000 linhas — sempre `rpcTodos` (bug real já corrigido nesta sessão em Estoque Valorizado e Programação de Produção).
- Não alterar a RPC `relatorio_estoque_valorizado` existente nem a visão default da página — este trabalho é aditivo.
- Migration numerada 091 (última existente: 090).
- Sem suite de testes automatizada neste repo — verificação é `npx eslint <arquivo>` (0 erros novos) + `npm run build` (`EXIT=0`) + QA visual real via chrome-devtools MCP contra `npx next dev -p 3008` com a conta `claude.qa@ntb-estoque.dev` / `claudeqa123456`.
- Deploy em produção é manual: `ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "cd /opt/ntb-estoque && bash deploy.sh"`, depois confirmar `curl -s -o /dev/null -w "HTTP %{http_code}\n" https://app-estoque.norteparanegocios.com.br/login` (esperar 200). `git push` sozinho NÃO atualiza produção.

---

### Task 1: Migration — RPC `relatorio_estoque_valorizado_local` + índices

**Files:**
- Create: `supabase/migrations/091_estoque_valorizado_local_cobertura.sql`

**Interfaces:**
- Produces: RPC `relatorio_estoque_valorizado_local(p_loja_id bigint, p_familia text[], p_tipo text[], p_local bigint[], p_busca text)` retornando `(codigo_produto bigint, codigo text, descricao text, descricao_familia text, tipo_item text, unidade text, codigo_local_estoque bigint, local_descricao text, n_saldo numeric, n_cmc numeric, valor_total numeric, data_foto date, data_ultimo_inventario date)`, mesma assinatura de filtros da RPC existente `relatorio_estoque_valorizado` (Task 2 consome essas colunas).

- [ ] **Step 1: Escrever a migration**

```sql
-- Item #14 da reuniao 2026-07-27: Ramon pediu uma visao de "posicao de estoque"
-- que mostre saldo por local + data do ultimo inventario, pra identificar
-- produtos sem contagem ha muito tempo. Extensao aditiva do Estoque Valorizado
-- (RPC nova, a existente nao muda) -- ver
-- docs/superpowers/plans/2026-07-28-estoque-valorizado-por-local-cobertura.md.
--
-- Diferenca chave pra relatorio_estoque_valorizado (087): aqui NAO agrega por
-- produto (1 linha por produto+local, nao soma entre locais), e junta um CTE
-- que calcula max(inventarios.data) por produto+local via inventario_items.

create index if not exists idx_inventario_items_produto
  on inventario_items (produto_codigo_produto);

create index if not exists idx_inventarios_loja_local
  on inventarios (loja_id, codigo_local_estoque);

create or replace function relatorio_estoque_valorizado_local(
  p_loja_id     bigint,
  p_familia     text[] default null,
  p_tipo        text[] default null,
  p_local       bigint[] default null,
  p_busca       text default null
)
returns table (
  codigo_produto        bigint,
  codigo                text,
  descricao             text,
  descricao_familia     text,
  tipo_item             text,
  unidade               text,
  codigo_local_estoque  bigint,
  local_descricao       text,
  n_saldo               numeric,
  n_cmc                 numeric,
  valor_total           numeric,
  data_foto             date,
  data_ultimo_inventario date
)
language sql
stable
security invoker
as $$
  with foto as (
    select max(data_posicao) as d
    from posicao_estoques
    where loja_id = p_loja_id
      and (p_local is null or codigo_local_estoque = any(p_local))
  ),
  pos as (
    select
      pe.n_cod_prod,
      pe.codigo_local_estoque,
      pe.n_saldo,
      pe.n_cmc,
      pe.n_cmc * pe.n_saldo as valor_total
    from posicao_estoques pe
    join foto on pe.data_posicao = foto.d
    where pe.loja_id = p_loja_id
      and (p_local is null or pe.codigo_local_estoque = any(p_local))
  ),
  ultimos as (
    select
      ii.produto_codigo_produto as n_cod_prod,
      i.codigo_local_estoque,
      max(i.data)::date as data_ultimo_inventario
    from inventario_items ii
    join inventarios i on i.id = ii.inventario_id
    where i.loja_id = p_loja_id
    group by ii.produto_codigo_produto, i.codigo_local_estoque
  )
  select
    p.codigo_produto,
    p.codigo::text,
    p.descricao::text,
    p.descricao_familia::text,
    p.tipo_item::text,
    p.unidade::text,
    pos.codigo_local_estoque,
    le.descricao::text as local_descricao,
    pos.n_saldo,
    pos.n_cmc,
    pos.valor_total,
    foto.d as data_foto,
    u.data_ultimo_inventario
  from pos
  join produtos p on p.codigo_produto = pos.n_cod_prod and p.loja_id = p_loja_id
  left join local_estoques le
    on le.codigo_local_estoque = pos.codigo_local_estoque and le.loja_id = p_loja_id
  left join ultimos u
    on u.n_cod_prod = pos.n_cod_prod and u.codigo_local_estoque = pos.codigo_local_estoque
  cross join foto
  where pos.n_saldo > 0
    and pos.valor_total > 0
    and (p_familia is null or p.descricao_familia = any(p_familia))
    and (p_tipo    is null or p.tipo_item          = any(p_tipo))
    and (p_busca   is null or p_busca = ''
         or p.descricao ilike '%' || p_busca || '%'
         or p.codigo    ilike '%' || p_busca || '%')
  order by pos.valor_total desc, p.codigo_produto asc, pos.codigo_local_estoque asc
$$;

revoke execute on function relatorio_estoque_valorizado_local(bigint, text[], text[], bigint[], text) from public;
revoke execute on function relatorio_estoque_valorizado_local(bigint, text[], text[], bigint[], text) from anon;
grant  execute on function relatorio_estoque_valorizado_local(bigint, text[], text[], bigint[], text) to authenticated, service_role;
```

- [ ] **Step 2: Aplicar a migration no Supabase do projeto (produção — este projeto não tem staging)**

Rodar via `psql` usando `SUPABASE_DB_URL` de `.env.local` (mesmo padrão já usado nesta sessão para inspeção direta):

```bash
psql "$SUPABASE_DB_URL" -f supabase/migrations/091_estoque_valorizado_local_cobertura.sql
```

Expected: `CREATE INDEX` (x2), `CREATE FUNCTION`, `REVOKE`/`GRANT` sem erro.

- [ ] **Step 3: Smoke-test da RPC direto no banco**

```bash
psql "$SUPABASE_DB_URL" -c "select codigo_produto, codigo_local_estoque, local_descricao, n_saldo, data_ultimo_inventario from relatorio_estoque_valorizado_local(2, null, null, null, null) limit 5;"
```

Expected: 5 linhas, sem erro de sintaxe/tipo. `data_ultimo_inventario` pode ser `null` legitimamente (produto+local nunca contado) — isso é esperado, não é bug.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/091_estoque_valorizado_local_cobertura.sql
git commit -m "feat: RPC relatorio_estoque_valorizado_local (saldo + ultimo inventario por produto+local)"
```

---

### Task 2: Página — aba "Por local" no Estoque Valorizado

**Files:**
- Modify: `app/(app)/relatorio-estoque-valorizado/page.tsx`

**Interfaces:**
- Consumes: RPC `relatorio_estoque_valorizado_local` (Task 1) via `rpcTodos<LinhaLocal>(supabase, 'relatorio_estoque_valorizado_local', {...})`; `SegmentLinks` de `@/components/ui-kit/SegmentLinks` (props `basePath`, `param`, `opcoes: {value,label}[]`, `aria-label`).
- Produces: nada consumido por outra task.

- [ ] **Step 1: Adicionar o tipo `LinhaLocal` e o helper de dias**

Logo após o tipo `Linha` existente (depois da linha 48):

```ts
type LinhaLocal = {
  codigo_produto: number
  codigo: string | null
  descricao: string | null
  codigo_local_estoque: number
  local_descricao: string | null
  n_saldo: number
  n_cmc: number
  valor_total: number
  data_foto: string
  data_ultimo_inventario: string | null
}

function diasDesde(dataISO: string): number {
  const [a, m, d] = dataISO.split('-').map(Number)
  const dt = new Date(a, m - 1, d)
  return Math.floor((Date.now() - dt.getTime()) / 86400000)
}
```

- [ ] **Step 2: Ler o param `ver` e trocar a query conforme a aba**

`searchParams` (linha 55) ganha `ver?: string`:

```ts
searchParams: Promise<{ familia?: string; tipo?: string; local?: string; busca?: string; ver?: string }>
```

Depois de `const busca = sp.busca?.trim() || null` (linha 65), adicionar:

```ts
const verLocal = sp.ver === 'local'
```

Substituir o `Promise.all` (linhas 69-88) por uma versão que só chama a RPC nova quando `verLocal`, mantendo `linhasTodas`/`familiasOpcoes`/`locaisOpcoes` como hoje mais um `linhasLocal`:

```ts
const [linhasTodas, linhasLocalTodas, familiasOpcoes, locaisOpcoes] = await Promise.all([
  verLocal
    ? Promise.resolve<Linha[]>([])
    : rpcTodos<Linha>(supabase, 'relatorio_estoque_valorizado', {
        p_loja_id: lojaId,
        p_familia: familias.length ? familias : null,
        p_tipo: tipos.length ? tipos : null,
        p_local: locais.length ? locais : null,
        p_busca: busca,
      }),
  verLocal
    ? rpcTodos<LinhaLocal>(supabase, 'relatorio_estoque_valorizado_local', {
        p_loja_id: lojaId,
        p_familia: familias.length ? familias : null,
        p_tipo: tipos.length ? tipos : null,
        p_local: locais.length ? locais : null,
        p_busca: busca,
      })
    : Promise.resolve<LinhaLocal[]>([]),
  buscarFamilias(),
  supabase
    .from('local_estoques')
    .select('codigo_local_estoque, descricao')
    .eq('loja_id', lojaId)
    .neq('inativo', 'S')
    .order('descricao'),
])
```

- [ ] **Step 3: Derivar os totais/linhas da aba ativa**

Depois de `const linhas = linhasTodas.slice(0, LIMITE)` (linha 95), adicionar:

```ts
const linhasLocal = linhasLocalTodas.slice(0, LIMITE)
const totalProdutosLocal = linhasLocalTodas.length
const totalValorLocal = linhasLocalTodas.reduce((s, l) => s + Number(l.valor_total), 0)
```

- [ ] **Step 4: Adicionar a aba `SegmentLinks` no header**

Import no topo do arquivo (junto aos outros imports de `ui-kit`):

```ts
import { SegmentLinks } from '@/components/ui-kit/SegmentLinks'
```

Dentro de `<ListaHeader>`, logo após o `<ChipsFiltrosAtivos ... />` (depois da linha 154), adicionar:

```tsx
<SegmentLinks
  basePath="/relatorio-estoque-valorizado"
  param="ver"
  aria-label="Ver estoque valorizado por"
  opcoes={[
    { value: '', label: 'Total' },
    { value: 'local', label: 'Por local' },
  ]}
/>
```

- [ ] **Step 5: Renderizar a tabela "Por local" quando `verLocal`**

Envolver o bloco de cards + tabela existente (linhas 157-271) numa condicional: quando `!verLocal`, renderizar exatamente o que já existe hoje (sem nenhuma mudança de comportamento); quando `verLocal`, renderizar o bloco novo abaixo. Estrutura final do `return` a partir da linha 157:

```tsx
{!verLocal ? (
  <>
    {/* Cards de resumo — bloco existente, sem mudanças (linhas 158-173 originais) */}
    <div className="flex flex-wrap gap-3">
      <div className="rounded-xl border border-border bg-surface px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Total valorizado</p>
        <p className="num mt-0.5 text-xl font-semibold text-text">{fmtMoeda(totalValor)}</p>
      </div>
      <div className="rounded-xl border border-border bg-surface px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Produtos no estoque</p>
        <p className="num mt-0.5 text-xl font-semibold text-text">{totalProdutos}</p>
      </div>
      {dataFoto && (
        <div className="rounded-xl border border-border bg-surface px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Foto do estoque</p>
          <p className="mt-0.5 text-sm font-semibold text-text">{fmtData(dataFoto)}</p>
        </div>
      )}
    </div>

    {/* Tabela agregada existente — igual ao que já está no arquivo hoje (linhas 175-271 originais), sem mudanças */}
    {linhas.length === 0 ? (
      <EmptyState icon={Boxes} title="Sem dados de posicao" hint="Aguarde a sincronizacao de posicao de estoques ou ajuste o filtro." />
    ) : (
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        {/* ... tabela original, copiar exatamente como está hoje (linhas 183-264) ... */}
      </div>
    )}

    {totalProdutos > LIMITE && (
      <p className="px-1 text-[11px] text-text-muted">
        Mostrando os {LIMITE} produtos de maior valor (de {totalProdutos} no total). Use os filtros para refinar.
      </p>
    )}
  </>
) : (
  <>
    <div className="flex flex-wrap gap-3">
      <div className="rounded-xl border border-border bg-surface px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Total valorizado</p>
        <p className="num mt-0.5 text-xl font-semibold text-text">{fmtMoeda(totalValorLocal)}</p>
      </div>
      <div className="rounded-xl border border-border bg-surface px-4 py-3">
        <p className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">Linhas (produto x local)</p>
        <p className="num mt-0.5 text-xl font-semibold text-text">{totalProdutosLocal}</p>
      </div>
    </div>

    {linhasLocal.length === 0 ? (
      <EmptyState icon={Boxes} title="Sem dados de posicao" hint="Aguarde a sincronizacao de posicao de estoques ou ajuste o filtro." />
    ) : (
      <div className="overflow-x-auto rounded-lg border border-border bg-surface">
        <table className="w-full min-w-[700px] border-collapse text-sm">
          <thead>
            <tr className="bg-surface-2">
              <th className={`sticky left-0 z-20 bg-surface-2 text-left ${th}`}>Produto</th>
              <th className={`text-left ${th}`}>Local</th>
              <th className={`text-right ${th}`}>Saldo</th>
              <th className={`text-right ${th} hidden sm:table-cell`}>CMC</th>
              <th className={`text-right ${th}`}>Valor total</th>
              <th className={`text-left ${th}`}>Último inventário</th>
            </tr>
          </thead>
          <tbody>
            {linhasLocal.map((l) => {
              const dias = l.data_ultimo_inventario ? diasDesde(l.data_ultimo_inventario) : null
              const critico = dias == null || dias >= 30
              return (
                <tr key={`${l.codigo_produto}-${l.codigo_local_estoque}`} className="border-t border-border/60 hover:bg-surface-2/40">
                  <td className="sticky left-0 z-10 bg-surface px-3 py-2">
                    <Link
                      href={`/relatorio-movimentacao?produto=${encodeURIComponent(l.codigo ?? l.descricao ?? '')}`}
                      className="block max-w-[220px] hover:underline"
                      title="Ver movimentações deste produto"
                    >
                      <div className="truncate text-text" title={l.descricao ?? ''}>
                        {formatarNomeProduto(l.descricao ?? '')}
                      </div>
                      {l.codigo && <div className="num text-[11px] text-text-muted">{l.codigo}</div>}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-text-muted">{l.local_descricao ?? l.codigo_local_estoque}</td>
                  <td className="num whitespace-nowrap px-3 py-2 text-right text-text-muted">{fmtNum(Number(l.n_saldo), 3)}</td>
                  <td className="num hidden whitespace-nowrap px-3 py-2 text-right text-text-muted sm:table-cell">{fmtMoeda(Number(l.n_cmc))}</td>
                  <td className="num whitespace-nowrap px-3 py-2 text-right font-medium text-text">{fmtMoeda(Number(l.valor_total))}</td>
                  <td className={`whitespace-nowrap px-3 py-2 ${critico ? 'text-err' : 'text-text-muted'}`}>
                    {l.data_ultimo_inventario
                      ? `${fmtData(l.data_ultimo_inventario)} (há ${dias}d)`
                      : 'Nunca contado'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    )}

    {totalProdutosLocal > LIMITE && (
      <p className="px-1 text-[11px] text-text-muted">
        Mostrando as {LIMITE} linhas de maior valor (de {totalProdutosLocal} no total). Use os filtros para refinar.
      </p>
    )}
  </>
)}
```

- [ ] **Step 6: Lint**

Run: `npx eslint "app/(app)/relatorio-estoque-valorizado/page.tsx"`
Expected: 0 erros novos.

- [ ] **Step 7: Build**

Run: `npm run build`
Expected: `EXIT=0`, sem "Failed to type check".

- [ ] **Step 8: QA visual real**

Com `npx next dev -p 3008` rodando e login com `claude.qa@ntb-estoque.dev` / `claudeqa123456` via chrome-devtools MCP:
1. Abrir `/relatorio-estoque-valorizado` — confirmar que a visão default está IGUAL a antes (nenhuma regressão visual).
2. Clicar na aba "Por local" — confirmar que a tabela troca para colunas Produto/Local/Saldo/CMC/Valor total/Último inventário.
3. Confirmar que pelo menos uma linha mostra "Nunca contado" ou uma data com "(há Nd)" em vermelho quando N >= 30.
4. Aplicar o filtro "Local de estoque" e confirmar que a aba "Por local" respeita o filtro.
5. `pkill -f "next dev -p 3008"` ao terminar.

- [ ] **Step 9: Commit**

```bash
git add "app/(app)/relatorio-estoque-valorizado/page.tsx"
git commit -m "feat: aba \"Por local\" no Estoque Valorizado com cobertura de inventário (item #14)"
```

---

### Task 3: Deploy e atualização do catálogo

**Files:**
- Modify: `docs/reuniao-2026-07-27-pedidos.md`

- [ ] **Step 1: Deploy em produção**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "cd /opt/ntb-estoque && bash deploy.sh"
curl -s -o /dev/null -w "HTTP %{http_code}\n" https://app-estoque.norteparanegocios.com.br/login
```

Expected: HTTP 200.

- [ ] **Step 2: Verificação final em produção**

Repetir o Step 8 da Task 2 (login QA + checar as duas abas) contra a URL de produção em vez do dev server local.

- [ ] **Step 3: Atualizar o catálogo da reunião**

Marcar o item #14 como concluído em `docs/reuniao-2026-07-27-pedidos.md`, com uma nota curta descrevendo a solução (aba "Por local" no Estoque Valorizado em vez de relatório novo separado — reaproveitando o relatório que Ramon sugeriu estender).

- [ ] **Step 4: Commit**

```bash
git add docs/reuniao-2026-07-27-pedidos.md
git commit -m "docs: marcar item #14 (posicao de estoque com cobertura) como concluido"
git push
```

## Self-Review Notes

- Cobertura do spec: saldo por local (sim, `n_saldo` por linha), última contagem por produto+local (sim, `data_ultimo_inventario`), evitar tabela poluída (sim, aba separada em vez de colunas extras na visão default). O pedido de "30 dias" como referência de "não contado recentemente" replica o mesmo limiar já usado em `lib/resumo-dia.ts` (`carregarPainelAcao`, card "Locais sem contagem de inventário há 30 dias") — consistência com o resto do app.
- Sem placeholders: todo SQL e todo JSX dos steps é código real, não pseudocódigo (exceto o comentário explícito no Step 5/Task 2 marcando onde copiar a tabela original inalterada, que é intencional — evita re-listar 80 linhas idênticas ao arquivo atual).
- Tipos consistentes entre Task 1 (RPC) e Task 2 (`LinhaLocal`): mesmos nomes de coluna (`codigo_local_estoque`, `local_descricao`, `data_ultimo_inventario`, etc.) em ambas.
