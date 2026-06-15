# Plano de Execução — Pedidos da Reunião 2026-06-14

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (inline). Passos com checkbox.

**Goal:** Implementar as correções e ajustes pedidos pelo Ramon na reunião de 14/06 (contagem em tempo real, NF etapa, nome do local, unidade, X de Y, PDF bonito, cantos sticky, ajustes de produto, mobile, impressões), deixando as 3 features grandes (login, criar OP, sugestão de compra) para planos próprios por dependerem de decisão/dados externos.

**Architecture:** Tudo sobre o sistema atual (Next.js 16 + Supabase + design system `ui-kit`). Correções de contagem usam update otimista nas server actions (retornar o registro). Ajustes de produto e impressões reusam `Lista`/`FiltrosGaveta`. Mobile via safe-areas + PWA. Sem escrita nova no Omie nesta leva.

**Base:** varredura em `docs/superpowers/plans/2026-06-14-varredura-pedidos-reuniao2.md`.

**Restrições:** status do banco sem acento; sem travessão; acentuação correta no visível; nunca acionar finalização/escrita Omie em teste; datas em America/Bahia.

---

## FASE A — Correções (bugs apontados ao vivo)

### Task A1: Contagem em tempo real (sem refresh) — PRIORIDADE

**Files:**
- Modify: `lib/actions/inventario.ts` (`addInventarioItem`), `lib/actions/transferencia.ts` (`addMovimento`)
- Modify: `components/inventario/ContagemInventario.tsx`, `components/transferencia/ContagemTransferencia.tsx`

- [ ] **Step 1: action retorna o item criado.** Em `addInventarioItem`, trocar o insert para retornar o registro:

```ts
const { data } = await supabase
  .from('inventario_items')
  .insert({ loja_id: lojaId, inventario_id: inventarioId, ...produto, status: 'Iniciado' })
  .select('id, produto_codigo, produto_descricao, produto_familia, quan, status')
  .single()
revalidatePath(`/inventario/${inventarioId}/contagem`)
return data
```

Idem `addMovimento` em transferência (retornar o movimento criado com `id`).

- [ ] **Step 2: update otimista no componente.** Em `ContagemInventario.tsx`, `adicionar` insere o item no TOPO do estado com o `id` retornado, sem `router.refresh()`:

```ts
function adicionar(p: ProdutoBusca) {
  if (itens.some((i) => i.produto_codigo === p.codigo)) { toast.info('Produto já está na contagem'); return }
  startTransition(async () => {
    const novo = await addInventarioItem(inventarioId, {
      produto_codigo_produto: p.codigo_produto, produto_codigo: p.codigo,
      produto_descricao: p.descricao, produto_familia: p.descricao_familia,
    })
    if (novo) setItens((prev) => [{ ...novo, produto_familia: p.descricao_familia } as ItemContagem, ...prev])
    toast.success('Produto adicionado')
  })
}
```

Mesmo padrão em `ContagemTransferencia.tsx`.

- [ ] **Step 3: Build + commit**

```bash
npm run build
git add lib/actions/inventario.ts lib/actions/transferencia.ts components/inventario components/transferencia
git commit -m "fix(contagem): produto adicionado aparece na hora no topo (update otimista, sem refresh)"
```

### Task A2: NF — coluna "Etapa" legível

**Files:**
- Modify: `app/(app)/nota-fiscal/page.tsx` ou `components/ui-kit/StatusPill.tsx`

- [ ] **Step 1:** Mapear `c_etapa` para rótulo no StatusPill (ou remover a coluna). Adicionar ao MAP do StatusPill: `'60' -> Concluída (verde)`, e tratar os demais (`40`, etc.) como "Em andamento" (neutro). Decisão: manter a coluna com rótulo (não o número cru). Confirmar os códigos de etapa do Omie antes de fixar os rótulos.

- [ ] **Step 2: Build + commit**

```bash
npm run build
git add app/(app)/nota-fiscal/page.tsx components/ui-kit/StatusPill.tsx
git commit -m "fix(nota-fiscal): coluna Etapa mostra rotulo em vez do codigo cru"
```

### Task A3: Nome do depósito em vez do código

**Files:**
- Modify: `app/(app)/inventario/[id]/contagem/page.tsx`, `app/(app)/transferencia/[id]/contagem/page.tsx`, listagens, `components/.../NovoInventario.tsx`

- [ ] **Step 1:** Onde hoje cai no fallback `localMap.get(cod) || cod`, garantir o nome: confirmar que `local_estoques` está sincronizado e que o `localMap` cobre os códigos. Onde o local não existe, exibir "Local {cod}" (rótulo amigável) em vez do número solto. Conferir `NovoInventario` (se o select mostra código → trocar por `descricao`).

- [ ] **Step 2: Build + commit**

```bash
npm run build
git add app/(app)/inventario app/(app)/transferencia components/inventario components/transferencia
git commit -m "fix(local): exibir nome do deposito no lugar do codigo nas telas de contagem/criacao"
```

### Task A4: Unidade de medida na contagem

**Files:**
- Modify: `lib/actions/inventario.ts`/`transferencia.ts` (incluir `unidade` no add), tipo `ItemContagem`/`ItemMovimento`, componentes de contagem

- [ ] **Step 1:** A busca já retorna `unidade` (`ProdutoBusca.unidade`). Passar `unidade` no payload de `adicionar` e no tipo `ItemContagem`; exibir junto da quantidade (ex.: o número + " kg"). Se `inventario_items`/`movimentos` não tiver coluna de unidade, manter só no estado/render (via produto) sem persistir. Verificar o schema antes.

- [ ] **Step 2: Build + commit**

```bash
npm run build
git add lib/actions components/inventario components/transferencia
git commit -m "feat(contagem): exibir unidade de medida (kg/litro) por item"
```

### Task A5: Indicador "X de Y integrados" + erros

**Files:**
- Modify: `app/(app)/inventario/page.tsx`, `app/(app)/transferencia/page.tsx` (e/ou cabeçalho da contagem)

- [ ] **Step 1:** Para cada inventário/transferência, contar itens por status (`Concluido` vs total) e exibir "X de Y" na listagem; destacar os com `Erro`/`Sem CMC` e oferecer "Reprocessar" (action `forceSync` já existe). Os dados (status por item) já existem.

- [ ] **Step 2: Build + commit**

```bash
npm run build
git add app/(app)/inventario app/(app)/transferencia
git commit -m "feat(inventario/transferencia): indicador X de Y integrados + destaque de erros"
```

### Task A6: Verificar botão Editar/Contar na transferência

- [ ] **Step 1:** Confirmar no deploy: a listagem de transferência já tem "Contar/Ver" (l.188-189). Se o que faltava era editar a quantidade de um item já contado na tela de contagem, expor "Editar" por item (action `editQuantidadeMovimento` já existe). Caso já esteja coberto pela Task A1, fechar sem mudança.

- [ ] **Step 2:** Se houver mudança: build + commit `fix(transferencia): editar quantidade de item na contagem`.

### Task A16: Cantos do cabeçalho fixo no dark

**Files:**
- Modify: `components/ui-kit/DataTable.tsx`, `components/ui-kit/Lista.tsx`

- [ ] **Step 1:** Corrigir o vazamento do canto: arredondar os cantos superiores do `thead` sticky (ex.: primeira/última `th` com `rounded-tl/rounded-tr`) ou um wrapper que recorte sem quebrar o `position: sticky`. Validar no dark mode.

- [ ] **Step 2: Build + commit**

```bash
npm run build
git add components/ui-kit/DataTable.tsx components/ui-kit/Lista.tsx
git commit -m "fix(ui): cantos do cabecalho fixo sem vazar no dark mode"
```

---

## FASE B — Tela de Produtos

### Task B8: Margem alvo editável

**Files:**
- Modify: `app/(app)/produto/page.tsx`
- Create: `components/produtos/MargemAlvo.tsx` (client, input que serializa `?margem=` em searchParams)

- [ ] **Step 1:** Substituir os chips por um pequeno client component com input numérico de % (aceita 40-90), aplicando `?margem=` na URL (debounce/Enter). Manter o cálculo `precoSugerido(custo, alvo)` na page. Default 50%.

- [ ] **Step 2: Build + commit**

```bash
npm run build
git add app/(app)/produto/page.tsx components/produtos/MargemAlvo.tsx
git commit -m "feat(produto): margem alvo editavel (input %) para o preco sugerido"
```

### Task B9: Coluna Código no produto

**Files:**
- Modify: `app/(app)/produto/page.tsx`

- [ ] **Step 1:** Reintroduzir a coluna "Código" na `Lista` (campo `codigo` já está no select). Posicionar após a Descrição.

- [ ] **Step 2: Build + commit** `feat(produto): coluna Codigo na listagem`.

### Task B10: Filtro ativo/inativo + só ativos por padrão

**Files:**
- Modify: `lib/omie/produto.ts` (mapear `inativo`), `app/(app)/produto/page.tsx` (filtro)
- Backfill: script Node pontual (como os anteriores) lendo `full_object.inativo`

- [ ] **Step 1: Sync grava `inativo`.** No map de `syncProdutos`, adicionar `inativo: p.inativo` (campo `inativo` do `full_object`; confirmar 'S'/'N'). Ajustar o tipo `OmieProduto`.

- [ ] **Step 2: Backfill** dos produtos existentes a partir de `full_object.inativo` (script Node, mesmo padrão dos backfills de tipo_item/cChaveNFe).

- [ ] **Step 3: Filtro** na gaveta: select "Situação" (Ativos/Inativos/Todos); default = só ativos (`inativo != 'S'`).

- [ ] **Step 4: Build + commit**

```bash
npm run build
git add lib/omie/produto.ts app/(app)/produto/page.tsx
git commit -m "feat(produto): sincroniza ativo/inativo, filtro de situacao e exibe so ativos por padrao"
```

---

## FASE C — PDF de contagem (bonito + logo)

### Task C7: Melhorar os PDFs de contagem

**Files:**
- Modify: `components/relatorio/ContagemInventarioPDF.tsx`, `ContagemTransferenciaPDF.tsx`
- Usa: `lib/etiqueta-logo.ts` (`NTB_LOGO_DATA_URL`)

- [ ] **Step 1:** Cabeçalho com a logo NTB + título, mantendo os dados (loja, data, local/origem-destino, tipo) e a tabela. Aplicar o mesmo capricho dos relatórios de NF/OP (tipografia, espaçamento, cabeçalho de tabela). Conferir que números/datas ficam alinhados.

- [ ] **Step 2: Build + commit + validar PDF**

```bash
npm run build
git add components/relatorio/ContagemInventarioPDF.tsx components/relatorio/ContagemTransferenciaPDF.tsx
git commit -m "feat(pdf): folhas de contagem com logo NTB e layout caprichado"
```

---

## FASE D — Mobile iOS/Android

### Task D15: Polimento mobile + PWA

**Files:**
- Modify: `app/layout.tsx` (viewport-fit + metadata PWA), `components/shell/MobileNav.tsx`, `components/shell/AppShell.tsx`
- Create: `app/manifest.ts` (ou `public/manifest.json`), ícones em `public/`
- Revisar: inputs (teclado numérico) nas telas de contagem/quantidade

- [ ] **Step 1: Safe areas iOS.** No `app/layout.tsx`, `viewport` com `viewportFit: 'cover'`; aplicar `env(safe-area-inset-bottom/top)` na bottom-bar mobile e no header (padding) para não cortar no notch/barra inferior.

- [ ] **Step 2: PWA instalável.** Criar `app/manifest.ts` (nome "NTB Estoque", `display: standalone`, `theme_color`, ícones 192/512), metadata apple (`apple-mobile-web-app-capable`, `apple-touch-icon`). Ícones a partir da logo.

- [ ] **Step 3: Toque e teclado.** Garantir `inputMode="numeric"` / `type="number"` em todos os campos de quantidade (contagem já tem; conferir QuantidadeInput da NF e OP). Alvos de toque ≥ 40px nos botões +/− e ações.

- [ ] **Step 4: Validar em viewport real** (390px iOS / Android) no deploy: contagem, etiquetas, navegação, sem corte e tocável.

- [ ] **Step 5: Build + commit**

```bash
npm run build
git add app/layout.tsx app/manifest.ts public components/shell
git commit -m "feat(mobile): safe-areas iOS, PWA instalavel e ajustes de toque/teclado"
```

---

## FASE E — Impressões

### Task E13: Filtros + quem imprimiu

**Files:**
- Modify: `app/(app)/impressoes/page.tsx`

- [ ] **Step 1:** Adicionar `FiltrosGaveta` (período via data, origem NF/OP) lendo searchParams. Adicionar coluna "Usuário" resolvendo o nome via join `profiles` pelo `user_id` (montar um Map dos user_ids da página).

- [ ] **Step 2: Build + commit**

```bash
npm run build
git add app/(app)/impressoes/page.tsx
git commit -m "feat(impressoes): filtros (periodo/origem) e coluna de quem imprimiu"
```

---

## Self-Review (Fases A-E)

**Cobertura:** itens 1-10, 13, 15, 16 da reunião têm tarefa. Item 6 = verificação. Não há placeholders de implementação nos passos de código mostrados.

**Não quebra o fluxo:** correções são pontuais; produtos/impressões reusam componentes; mobile é UI/PWA. Nenhuma escrita nova no Omie nesta leva.

**Dependências:** item 10 depende do valor real de `inativo` no Omie ('S'/'N') — confirmar no 1º sync. Item 2 depende do significado das etapas do Omie.

---

## APÊNDICE — Features grandes (planos próprios; NÃO incluídas nas Fases A-E)

Estas dependem de decisão e/ou dados externos. Cada uma merece um plano detalhado quando destravar.

### F (item 14) — Login auto-cadastro com aprovação 🔴
- **Pré-requisitos:** decidir o GATE (recomendado: só e-mail `@norteparanegocios.com.br`); migration `profiles.status` ('pendente'/'aprovado').
- **Escopo:** tela `/cadastro` pública (Supabase `signUp`), estado "aguardando aprovação" (bloqueio no proxy/home), fila de aprovação na tela de Usuários (aprovar/recusar + atribuir loja e permissões), liberar `/cadastro` no `proxy.ts`.

### G (item 11) — Criar Ordem de Produção pela tela 🔴 ⚠️ (escreve no Omie)
- **Pré-requisitos:** confirmar params de `IncluirOrdemProducao` (`v1/produtos/op`); Ramon presente para testar.
- **Escopo:** action de criação (produto + 3 datas iguais início/conclusão/previsão), guardar validade só local, **puxar a data de inclusão** da OP; form na tela de OP; refletir via webhook/sync.

### H (item 12) — Sugestão de compra 🔴
- **Pré-requisitos:** estoque mínimo real no Omie (hoje 0 — cliente precisa preencher); integrar API de vendas (`ListarPedidos`/movimentos) com cache.
- **Escopo:** `lib/omie/vendas.ts` (vendas do mesmo período do ano anterior por produto), cálculo `compra = mínimo + previsão de venda − atual`, exibição na tela de produtos (mín/atual/prev venda/prev compra) + alerta de reposição.

### Futuro (alinhar com Andrei): integração Norte Vendas (cardápio), entrada de NF pela tela, lojas fora do Omie.
