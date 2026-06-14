# Produtos: Custo, Margem e Preço Sugerido Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline). Passos com checkbox.

**Goal:** Enriquecer a tela de Produtos com **custo médio (CMC)**, **valor de venda**, **margem real** e **preço sugerido** — exatamente o que o Ramon pediu na reunião. Só leitura do Omie; nenhuma escrita.

**Architecture:** Um sync de posição de estoque popula a tabela `posicao_estoques` (hoje vazia) com CMC e saldo por produto/local, via `ListarPosEstoque` (já parcialmente implementado). A tela de Produtos junta o cadastro (`valor_unitario` = venda) com o CMC consolidado por produto e calcula margem e preço sugerido. Sync roda no cron de fundo (GitHub Actions) + botão manual.

**Tech Stack:** Next.js 16, Supabase, API Omie (`v1/estoque/consulta` / `ListarPosEstoque`), design system existente.

**Dados confirmados:** `produtos.valor_unitario` existe (preço de venda do cadastro). `posicao_estoques` tem colunas `n_cmc`, `n_saldo`, `codigo_local_estoque`, `n_cod_prod`, `data_posicao` (unique loja+local+prod+data). A função `getPosicaoProduto` já chama a API; falta um sync em lote.

---

### Task 1: Sync de posição de estoque (CMC em lote)

**Files:**
- Modify: `lib/omie/posicao-estoque.ts` (adicionar `syncPosicaoEstoque`)

- [ ] **Step 1: Implementar `syncPosicaoEstoque(loja)`** — para cada local de estoque ativo da loja, percorrer `ListarPosEstoque` paginado (data = hoje, `nRegPorPagina: 500`, `cExibeTodos: 'S'`) e fazer `upsert` em `posicao_estoques` (onConflict `loja_id,codigo_local_estoque,n_cod_prod,data_posicao`). Honrar rate-limit (o `omieRequest` já trata). Gravar `n_cmc`, `n_saldo`, `n_preco_unitario`, `n_pendente`, `c_codigo`, `c_descricao`, `data_posicao`.

```ts
export async function syncPosicaoEstoque(loja: LojaOmie) {
  const supabase = createServiceClient()
  const hoje = new Date().toLocaleDateString('pt-BR') // d/m/Y
  const dataISO = new Date().toISOString().split('T')[0]
  // locais ativos da loja
  const { data: locais } = await supabase
    .from('local_estoques')
    .select('codigo_local_estoque')
    .eq('loja_id', loja.id)
    .neq('inativo', 'S')
  for (const local of locais ?? []) {
    let pagina = 1, total = 1
    do {
      const res = await omieRequest<OmiePosResponse>({
        loja_id: loja.id, omie_app_key: loja.omie_app_key, omie_app_secret: loja.omie_app_secret,
        endpoint: 'v1/estoque/consulta', call: 'ListarPosEstoque',
        data: { nPagina: pagina, nRegPorPagina: 500, dDataPosicao: hoje, codigo_local_estoque: local.codigo_local_estoque, cExibeTodos: 'S' },
      })
      total = res.nTotPaginas || 1
      const rows = (res.produtos ?? []).map((p) => ({
        loja_id: loja.id, codigo_local_estoque: local.codigo_local_estoque, n_cod_prod: p.nCodProd,
        data_posicao: dataISO, c_codigo: p.cCodigo, c_descricao: p.cDescricao,
        n_preco_unitario: p.nPrecoUnitario, n_saldo: p.nSaldo, n_cmc: p.nCMC, n_pendente: p.nPendente,
      }))
      if (rows.length) await supabase.from('posicao_estoques').upsert(rows, { onConflict: 'loja_id,codigo_local_estoque,n_cod_prod,data_posicao' })
      pagina++
    } while (pagina <= total)
  }
}
```

Necessita importar `createServiceClient`. O tipo de retorno do Omie ("Não existem registros") já vira `{}` no `omieRequest`; tratar `res.produtos` como opcional.

- [ ] **Step 2: Commit**

```bash
git add lib/omie/posicao-estoque.ts
git commit -m "feat(omie): sync em lote da posicao de estoque (CMC/saldo por produto)"
```

### Task 2: Rota de sync + cron + botão manual

**Files:**
- Create: `app/api/cron/sync-posicao/route.ts`
- Create: `app/api/sync/posicao/route.ts` (manual, para o botão)
- Modify: `.github/workflows/sync-omie.yml` (chamar a posição 1x/h)

- [ ] **Step 1: Rota cron** — espelhar `app/api/cron/sync-produtos/route.ts`: `assertCronAuth`, `getLojasAtivas`, `Promise.allSettled(lojas.map(syncPosicaoEstoque))`, `maxDuration = 300`.

- [ ] **Step 2: Rota manual** — POST que roda `syncPosicaoEstoque` para a loja atual (auth de usuário + permissão Produtos). Retorna `{ registros }`.

- [ ] **Step 3: GitHub Actions** — em `.github/workflows/sync-omie.yml`, adicionar no bloco horário (minuto 05, junto com produtos) uma chamada a `/api/cron/sync-posicao`.

- [ ] **Step 4: Build + commit**

```bash
npm run build
git add app/api/cron/sync-posicao app/api/sync/posicao .github/workflows/sync-omie.yml
git commit -m "feat(sync): rota cron + manual da posicao de estoque (CMC)"
```

### Task 3: Tela de Produtos com custo, margem e preço sugerido

**Files:**
- Modify: `app/(app)/produto/page.tsx`

- [ ] **Step 1: Buscar CMC consolidado por produto** — após buscar os produtos da página, coletar os `codigo_produto`, consultar `posicao_estoques` (loja atual, `n_cod_prod in (...)`, data mais recente) e montar um `Map<codigo, cmc>`. Consolidação: usar o CMC do registro com maior `n_saldo` (ou o primeiro não-zero) por produto.

- [ ] **Step 2: Colunas novas na `Lista`** — além de Código/Descrição/Família/Tipo/Unidade:
  - **Custo** (CMC) via `Money`; "-" se não houver.
  - **Venda** (`valor_unitario`) via `Money`.
  - **Margem** = `(venda - custo) / venda`, em %; cor: vermelho se ≤ 0, âmbar se < 20%, verde se ≥ 20%. "-" se faltar custo ou venda.
  - **Preço sugerido** = `custo / (1 - alvo)`, onde `alvo` vem de `searchParams.margem` (default 0.5 = 50%). Mostra no header da página o controle de margem alvo (chips 40/50/60%).

```ts
function margem(venda: number, custo: number): number | null {
  if (!venda || !custo) return null
  return (venda - custo) / venda
}
function precoSugerido(custo: number, alvo: number): number | null {
  if (!custo || alvo >= 1) return null
  return custo / (1 - alvo)
}
```

- [ ] **Step 3: Resumo no topo (opcional, leve)** — um StatCard "Margem média" dos produtos com custo+venda na página.

- [ ] **Step 4: Build + commit**

```bash
npm run build
git add "app/(app)/produto/page.tsx"
git commit -m "feat(produto): custo (CMC), venda, margem real e preco sugerido (pedido do Ramon)"
```

### Task 4: Backfill — rodar o sync uma vez

- [ ] **Step 1:** Disparar o sync de posição para todas as lojas (via o cron com o secret, ou script Node pontual) e confirmar que `posicao_estoques` foi populada (count > 0) e que a tela de Produtos passa a mostrar custo/margem.

- [ ] **Step 2: Verificação no deploy** — abrir `/produto`, conferir colunas Custo/Venda/Margem/Sugerido com dados reais; conferir que produto sem CMC mostra "-" sem quebrar.

---

## Self-Review

**Cobertura:** sync de CMC (T1-T2), tela enriquecida (T3), backfill (T4). Atende o pedido literal do Ramon: "custo médio unitário, valor de venda, CMV, margem real, sugerir preço de venda".

**Sem tirar o Omie / sem escrita:** tudo é leitura (`ListarPosEstoque`). Nenhuma escrita no Omie. Não afeta inventário/transferência/etiqueta.

**Limitações honestas:** produto sem preço cadastrado (`valor_unitario = 0`) ou sem movimento (sem CMC) aparece com margem "-". Isso é dado faltando no Omie, sinalizado na UI, não erro.

**Consistência:** `syncPosicaoEstoque` (T1) usado por ambas as rotas (T2); `posicao_estoques` populada (T1/T4) antes de a tela ler (T3). Margem/preço calculados com as helpers definidas em T3.
