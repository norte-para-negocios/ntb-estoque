# Ajustes feitos direto na Omie (item #8a) — visão somente-leitura

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mostrar, dentro de `/transferencia` e `/inventario`, os lançamentos (`movimentos`, tipo TRF/SLD) que foram feitos **direto na Omie** (não pelo NTB Estoque) — agrupados por dia+local, sem "responsável" (a API da Omie não tem esse campo, confirmado 2026-07-29).

**Architecture:** Decisão de escopo importante, tomada nesta tarefa: **NÃO** sintetizar linhas de cabeçalho nas tabelas `transferencias`/`inventarios` (como um "transferência #123 fake"). Pesquisa 2026-07-29 achou um risco de dado real: `movimentos` (populado por `syncAjustes`, todos os ajustes da Omie) e `inventario_items` (populado só pelo NTB) compartilham o mesmo `id_ajuste` pra 858 linhas hoje — ou seja, todo inventário criado pelo próprio NTB reaparece em `movimentos` "sem dono". Sintetizar cabeçalho ali criaria inventário/transferência **duplicado** pra tudo que o NTB já rastreia certo. A solução é uma visão só-de-leitura, com filtros de exclusão explícitos, sem nunca escrever em `transferencias`/`inventarios`.

**Tech Stack:** Next.js 16 (Server Component), Supabase (query direta, paginada — sem RPC nova, a lógica de agrupamento fica em JS pra poder validar caso a caso contra dado real antes de committar a uma SQL).

## Global Constraints

- **NUNCA** tratar `movimentos.transferencia_id IS NULL` (ou ausência de match em `inventario_items`) como prova suficiente de "veio da Omie" sem as 3 exclusões abaixo — confirmado com dado real que isso gera falso positivo.
- Exclusões obrigatórias antes de considerar uma linha de `movimentos` como "feita direto na Omie":
  1. `motivo != 'TPQ'` — Omie nunca devolve esse motivo (o NTB sempre converte TPQ→TRF antes de mandar pra Omie); presença de 'TPQ' em `movimentos.motivo` só existe se foi o NTB que escreveu a linha localmente.
  2. `obs NOT ILIKE '%NTB%'` — carimbo (`carimboUsuario()`) que o NTB grava em toda observação que ele mesmo cria.
  3. `transferencia_id IS NULL` — se já tem link pra uma transferência do NTB, não é órfã de verdade.
  4. Pra `tipo = 'SLD'` (inventário) especificamente: `id_ajuste NOT IN (select id_ajuste from inventario_items where loja_id = ... and id_ajuste is not null)` — sem essa exclusão, TODO inventário do NTB apareceria duplicado (confirmado: 858 linhas hoje, 3 lojas ativas).
- Sem suite de testes automatizada — verificação é `npx eslint <arquivo>` (0 erros novos) + `npm run build` (`EXIT=0`) + QA com dado real: antes de considerar a query certa, rodar contra produção e confirmar que os casos JÁ CONHECIDOS de falso positivo (858 SLD + 106+ TRF com `obs`/`motivo` batendo) saem zerados.
- Deploy manual: `ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "cd /opt/ntb-estoque && bash deploy.sh"`, depois `curl` confirmando HTTP 200.

---

### Task 1: Camada de dados — `lib/ajustes-omie.ts`

**Files:**
- Create: `lib/ajustes-omie.ts`

**Interfaces:**
- Produces:
  ```ts
  export type AjusteOmieDetectado = {
    chave: string
    tipo: 'TRF' | 'SLD'
    codigoLocalOrigem: number
    codigoLocalDestino: number | null
    localOrigemNome: string
    localDestinoNome: string | null
    data: string
    qtdProdutos: number
    qtdTotal: number
  }
  export async function carregarAjustesOmieDetectados(lojaId: number, tipo: 'TRF' | 'SLD', dataIni: string, dataFim: string): Promise<AjusteOmieDetectado[]>
  ```
  Consumida pela Task 2.

- [ ] **Step 1: Escrever `lib/ajustes-omie.ts`**

```ts
import { createServiceClient } from '@/lib/supabase/server'

export type AjusteOmieDetectado = {
  chave: string
  tipo: 'TRF' | 'SLD'
  codigoLocalOrigem: number
  codigoLocalDestino: number | null
  localOrigemNome: string
  localDestinoNome: string | null
  data: string
  qtdProdutos: number
  qtdTotal: number
}

type MovimentoRow = {
  id_prod: number | null
  quan: number | null
  data: string
  codigo_local_estoque: number | null
  codigo_local_estoque_destino: number | null
  id_ajuste: number | null
}

async function buscarPaginado<T>(
  query: () => ReturnType<ReturnType<typeof createServiceClient>['from']>,
  select: string
): Promise<T[]> {
  const supabase = createServiceClient()
  const PAGE = 1000
  const todas: T[] = []
  for (let p = 0; ; p++) {
    const { data, error } = await (query() as any).select(select).range(p * PAGE, p * PAGE + PAGE - 1)
    if (error || !data?.length) break
    todas.push(...(data as T[]))
    if (data.length < PAGE) break
  }
  return todas
}

export async function carregarAjustesOmieDetectados(
  lojaId: number,
  tipo: 'TRF' | 'SLD',
  dataIni: string,
  dataFim: string
): Promise<AjusteOmieDetectado[]> {
  const supabase = createServiceClient()

  // Exclusao 4 (so pra SLD/inventario): ids de ajuste que o proprio NTB ja
  // rastreia via inventario_items -- sem isso, TODO inventario do NTB
  // reaparece "sem dono" (confirmado: 858 linhas hoje, achado real 2026-07-29).
  let idsInventarioNTB = new Set<number>()
  if (tipo === 'SLD') {
    const PAGE = 1000
    for (let p = 0; ; p++) {
      const { data, error } = await supabase
        .from('inventario_items')
        .select('id_ajuste')
        .eq('loja_id', lojaId)
        .not('id_ajuste', 'is', null)
        .range(p * PAGE, p * PAGE + PAGE - 1)
      if (error || !data?.length) break
      for (const r of data as { id_ajuste: number }[]) idsInventarioNTB.add(Number(r.id_ajuste))
      if (data.length < PAGE) break
    }
  }

  const movimentos: MovimentoRow[] = []
  const PAGE = 1000
  for (let p = 0; ; p++) {
    const { data, error } = await supabase
      .from('movimentos')
      .select('id_prod, quan, data, codigo_local_estoque, codigo_local_estoque_destino, id_ajuste')
      .eq('loja_id', lojaId)
      .eq('tipo', tipo)
      .is('transferencia_id', null) // exclusao 3
      .neq('motivo', 'TPQ') // exclusao 1 -- Omie nunca devolve esse motivo
      .not('obs', 'ilike', '%NTB%') // exclusao 2 -- carimbo do NTB
      .gte('data', dataIni)
      .lte('data', `${dataFim}T23:59:59`)
      .range(p * PAGE, p * PAGE + PAGE - 1)
    if (error || !data?.length) break
    movimentos.push(...(data as MovimentoRow[]))
    if (data.length < PAGE) break
  }

  const filtrados = tipo === 'SLD'
    ? movimentos.filter((m) => !m.id_ajuste || !idsInventarioNTB.has(Number(m.id_ajuste)))
    : movimentos

  if (!filtrados.length) return []

  const { data: locais } = await supabase
    .from('local_estoques')
    .select('codigo_local_estoque, descricao')
    .eq('loja_id', lojaId)
  const nomeLocal = new Map((locais ?? []).map((l) => [Number(l.codigo_local_estoque), l.descricao as string]))

  const grupos = new Map<string, { itens: Set<number>; qtd: number; row: MovimentoRow }>()
  for (const m of filtrados) {
    const dia = m.data.slice(0, 10)
    const chave = `${dia}|${m.codigo_local_estoque}|${m.codigo_local_estoque_destino ?? ''}`
    const g = grupos.get(chave) ?? { itens: new Set<number>(), qtd: 0, row: m }
    if (m.id_prod) g.itens.add(m.id_prod)
    g.qtd += Number(m.quan) || 0
    grupos.set(chave, g)
  }

  return Array.from(grupos.entries())
    .map(([chave, g]) => ({
      chave,
      tipo,
      codigoLocalOrigem: Number(g.row.codigo_local_estoque),
      codigoLocalDestino: g.row.codigo_local_estoque_destino ? Number(g.row.codigo_local_estoque_destino) : null,
      localOrigemNome: nomeLocal.get(Number(g.row.codigo_local_estoque)) ?? String(g.row.codigo_local_estoque),
      localDestinoNome: g.row.codigo_local_estoque_destino
        ? nomeLocal.get(Number(g.row.codigo_local_estoque_destino)) ?? String(g.row.codigo_local_estoque_destino)
        : null,
      data: g.row.data.slice(0, 10),
      qtdProdutos: g.itens.size,
      qtdTotal: Math.round(g.qtd * 1000) / 1000,
    }))
    .sort((a, b) => (a.data < b.data ? 1 : -1))
}
```

- [ ] **Step 2: Lint**

Run: `npx eslint lib/ajustes-omie.ts`
Expected: 0 erros novos.

- [ ] **Step 3: Validar contra os falsos-positivos JÁ CONHECIDOS (passo crítico, não pular)**

```bash
cd "/Users/joaquimsalles/Projects/norte para negocios/ntb estoque"
cat > test-ajustes.mjs << 'EOF'
import { carregarAjustesOmieDetectados } from './lib/ajustes-omie.ts'
for (const lojaId of [2, 3, 6]) {
  const inv = await carregarAjustesOmieDetectados(lojaId, 'SLD', '2020-01-01', '2026-12-31')
  const trf = await carregarAjustesOmieDetectados(lojaId, 'TRF', '2020-01-01', '2026-12-31')
  console.log(`loja ${lojaId}: SLD detectados=${inv.length}, TRF detectados=${trf.length}`)
}
EOF
npx tsx --env-file=.env.local test-ajustes.mjs
rm test-ajustes.mjs
```
Expected: números bem menores que os totais brutos de `movimentos` órfãos (1.836 TRF / 858+ SLD antes do filtro) — se vier perto desses números, os filtros não estão excluindo direito, INVESTIGAR antes de continuar (não seguir pra Task 2 com o filtro errado).

- [ ] **Step 4: Commit**

```bash
git add lib/ajustes-omie.ts
git commit -m "feat: deteccao de ajustes de estoque feitos direto na Omie (item #8a)"
```

---

### Task 2: UI — seção nas páginas de Transferência e Inventário

**Files:**
- Create: `components/ajustes-omie/AjustesOmieDetectados.tsx`
- Modify: `app/(app)/transferencia/page.tsx`
- Modify: `app/(app)/inventario/page.tsx`

**Interfaces:**
- Consumes: `carregarAjustesOmieDetectados` (Task 1).

- [ ] **Step 1: Criar `components/ajustes-omie/AjustesOmieDetectados.tsx`**

```tsx
import { carregarAjustesOmieDetectados, type AjusteOmieDetectado } from '@/lib/ajustes-omie'

function fmtData(d: string) {
  const [a, m, dia] = d.split('-')
  return `${dia}/${m}/${a}`
}

export async function AjustesOmieDetectados({ lojaId, tipo }: { lojaId: number; tipo: 'TRF' | 'SLD' }) {
  const itens = await carregarAjustesOmieDetectados(lojaId, tipo, '2025-07-01', new Date().toISOString().slice(0, 10))
  if (itens.length === 0) return null

  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between border-b-2 border-text pb-2 mb-1">
        <h2 className="text-sm font-bold uppercase tracking-[0.12em] text-text">
          Feito direto na Omie ({itens.length})
        </h2>
      </div>
      <p className="text-[12px] text-text-muted">
        Detectado automaticamente a partir dos ajustes de estoque sincronizados da Omie. A Omie não informa quem fez o lançamento — responsável aparece como "Não identificado".
      </p>
      <ul className="divide-y divide-border">
        {itens.slice(0, 20).map((it: AjusteOmieDetectado) => (
          <li key={it.chave} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5 text-sm">
            <span className="num text-text-muted">{fmtData(it.data)}</span>
            <span className="text-text">
              {it.localOrigemNome}
              {it.localDestinoNome ? ` → ${it.localDestinoNome}` : ''}
            </span>
            <span className="text-[12px] text-text-muted">{it.qtdProdutos} produto(s)</span>
            <span className="ml-auto text-[12px] text-text-muted">Responsável: Não identificado</span>
          </li>
        ))}
      </ul>
      {itens.length > 20 && (
        <p className="text-[11px] text-text-muted">Mostrando os 20 mais recentes de {itens.length}.</p>
      )}
    </section>
  )
}
```

- [ ] **Step 2: Adicionar em `/transferencia`**

Em `app/(app)/transferencia/page.tsx`, importar o componente e adicionar no fim do JSX (depois da lista principal, antes do fechamento da `<div>` raiz):
```tsx
import { AjustesOmieDetectados } from '@/components/ajustes-omie/AjustesOmieDetectados'
// ...
<AjustesOmieDetectados lojaId={lojaId} tipo="TRF" />
```
(confirmar o nome exato da variável de loja atual na página antes de usar — ler o topo do arquivo.)

- [ ] **Step 3: Adicionar em `/inventario`**

Mesma coisa em `app/(app)/inventario/page.tsx`, com `tipo="SLD"`.

- [ ] **Step 4: Lint**

Run: `npx eslint components/ajustes-omie/AjustesOmieDetectados.tsx "app/(app)/transferencia/page.tsx" "app/(app)/inventario/page.tsx"`
Expected: 0 erros novos.

- [ ] **Step 5: Build**

Run: `npm run build`
Expected: `EXIT=0`.

- [ ] **Step 6: QA visual real**

Com `npx next dev -p 3008` e login QA via chrome-devtools MCP: abrir `/transferencia` e `/inventario`, confirmar que a seção nova só aparece quando há itens detectados (senão fica invisível, `return null`), e que os números batem com o que o script de validação da Task 1 mostrou pra loja de teste.

- [ ] **Step 7: Commit**

```bash
git add components/ajustes-omie/AjustesOmieDetectados.tsx "app/(app)/transferencia/page.tsx" "app/(app)/inventario/page.tsx"
git commit -m "feat: secao 'feito direto na Omie' em Transferencias e Inventarios (item #8a)"
```

---

### Task 3: Deploy e atualização do catálogo

- [ ] **Step 1: Deploy em produção**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "cd /opt/ntb-estoque && bash deploy.sh"
curl -s -o /dev/null -w "HTTP %{http_code}\n" https://app-estoque.norteparanegocios.com.br/login
```

- [ ] **Step 2: Atualizar `docs/reuniao-2026-07-27-pedidos.md`**

Marcar #8a como concluído (visão somente-leitura, sem responsável, decisão de escopo registrada).

- [ ] **Step 3: Commit + push**

## Self-Review Notes

- Decisão central desta tarefa: visão somente-leitura em vez de sintetizar linhas em `transferencias`/`inventarios` — evita duplicar os 858 inventários que o NTB já rastreia certo. Registrado explicitamente pro usuário entender a diferença do que foi pedido originalmente ("trazer de volta" virou "mostrar que existe", não "criar um registro igual ao nativo").
- "Gerar número de sequência local" (pedido original) fica sem sentido nessa forma — não é uma linha de cabeçalho de verdade, não precisa de número. Registrar essa diferença no catálogo.
- Todo filtro de exclusão tem justificativa com evidência real (não é suposição) — ver Global Constraints.
