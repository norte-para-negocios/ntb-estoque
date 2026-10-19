# Fase D item 6 — os demais relatórios do Omie (Compras, Estoque, Produção) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans (execução inline, sem subagentes). Passos com checkbox (`- [x]`).

**Goal:** dar às lojas Omie e às de estoque próprio os relatórios de Compras/Estoque/Produção do Omie que ainda faltam ou estão parciais (matriz do omie-rea §N), na ordem de impacto para um restaurante, com prova numérica.

**Architecture:** regras em módulos puros (`lib/relatorios/*-puro.ts`, sem `@/`, `node --test`), RPCs `security invoker` com despacho por `lojas.modo_estoque` dentro do SQL (migrations 210 e 211), telas no padrão de `/relatorio-curva-abc` e `/nota-fiscal` (PeriodoBar, CartaoResumo, FiltrosFaturamento, chips). Quando o relatório do Omie é só um filtro/agrupamento de tela existente, ele vira opção dessa tela (Estoque mínimo → Sugestão de compra; Recebimentos por transportadora → Notas Fiscais; Estrutura → Excel das Fichas).

**Tech Stack:** Next 16.2 (App Router, server components), supabase-js, Postgres 17, exceljs (`lib/excel.ts`), `node --test`.

**Spec:** `docs/superpowers/plans/2026-10-18-plano-mestre-paridade-omie.md` (Fase D item 6, "Os dois modos") + `~/Projects/omie-rea/gaps/matriz-compras-estoque-producao.md` §N (N2, N3, N5, N15–N31) + `~/Projects/omie-rea/gaps/matriz-financeiro-vendas-config-relatorios.md` (Reports 1–40) + capturas em `~/Projects/omie-rea/relatorios/COM/`.

## Levantamento: relatórios de Compras/Estoque/Produção do Omie × Norte Estoque (19/10/2026)

| Omie | Matriz | Situação no Norte Estoque | Decisão |
|---|---|---|---|
| Produtos por Fornecedor (`ERP_PRD_FOR_FORNECEDOR`, 5.817 linhas) | N3 PARTIAL | só filtro de fornecedor em `/produto` | **Task 1** (tela nova, migration 210) |
| Estoque Mínimo (`ERP_PRD_EST_MINIMO`, 294 linhas) | N5 PARTIAL/HAS | `/reposicao` (só próprio); lojas Omie só filtro "a repor" | **Task 2** (opção da Sugestão de compra, os dois modos) |
| Recebimentos por Transportadora (`COM_RCBTO_TRANSP`) | N28 MISSING | — | **Task 3** (visão nova em `/nota-fiscal`) |
| Estrutura dos Produtos (`ERP_ESTRUTURA_TODOS`, 9.539 linhas, multinível) | N2 PARTIAL | `/estoque/fichas` sem exportação, só 1 nível | **Task 4** (Excel multinível) |
| OP por Produto / por Matéria-prima / Concluídas (capturas do Omie deram timeout) | N17, N18, N20 PARTIAL | `/relatorio-producao` conta OPs, sem quantidade nem insumo consumido | **Task 5** (tela nova, migration 211) |
| Recebimentos por Período / Mês / Fornecedor / Produto | N24, N25, N27, N30 | `/nota-fiscal` e `/relatorio-compras` | já existe |
| Recebimentos por Categoria | N26 PARTIAL | categoria contábil do app quase vazia (2 de 99 mil itens); a categoria do Omie (`infoAdicionais.cCategCompra`) vem só como código (2.01.85) | fora: o nome da categoria exige ler `ListarCategorias` do Omie (proibido aqui) |
| Recebimentos por Departamento / Projeto, OP por Projeto, Requisições (3) | N14, N19, N29, N31 | sem entidade | fora (decisão do dono) |
| Pedidos de Compra (3) | N22 | pedido de compra só no estoque próprio (Fase C, `/pedido-compra`); leitura do Omie desligada | fora (depende de ligar a leitura dos pedidos do Omie) |
| Outras Notas de Entrada (3) | N23 | não espelhado | fora |
| Rastreabilidade de Lotes | N8 | próprio: `/validade`; Omie: lote não é espelhado (4 linhas no Omie) | fora |
| OP Sugestão de Compra, OP Em andamento, OP por Etapa | N15, N16, N21 | `/ordem-producao/necessidade-mp`, `/sugestao-compra`, `/ordem-producao/abertas` | já existe |
| Kardex, Resumido por produto, Posição, Posição SPED, CMV, Curva ABC | N6, N7, N9–N13 | Fase D (itens 1–4) | já feito |
| Kit e Componentes, Relação de Produtos | N1, N4 | N/A / `/produto` + Excel | já existe |

## Global Constraints

- Nada em produção: sem deploy, sem migration aplicada, sem escrita, sem chamada ao Omie. Leitura só `begin read only; … rollback;` pelo `docker exec -i supabase-db psql`. Sem CPF/CNPJ em tela, Excel ou entregável (chave de fornecedor do estoque próprio = md5 do CNPJ).
- Migrations a partir de **210**; funções `security invoker`, `stable`, `search_path = public`, `order by` total; `revoke … from public, anon` + `grant execute … to authenticated`.
- Toda leitura paginada com `.order(<único>)` + `.range()` (ou `rpcTodos` sobre RPC com ordem total).
- Módulo puro sem `@/` e sem importar valor de outro módulo com `.ts`; teste com `node --test`.
- Despacho por `modo_estoque`: mudar um modo não altera o outro; telas existentes não mudam de padrão (opção nova só por parâmetro).
- Não tocar em `/estoque/correcoes`, `lib/correcoes/*`, `lib/movimentacao-operacao-auto.ts`.
- `npx tsc --noEmit -p .` limpo e testes verdes antes de cada commit; commits com as linhas de coautoria pedidas.
- Testes SQL no banco local `d6` (`create database d6 template fb` + 187, 188, 192, 195, 200, 201), com dados reais das lojas 5 e 15 copiados por `copy (select …) to stdout` dentro de `begin read only`.

## Review Focus

1. Produto comprado de vários fornecedores, ou o mesmo fornecedor com nota cancelada mais nova → "última compra" é a mais recente **não cancelada**; nota cancelada nunca aparece. Teste SQL em `scripts/testes-sql/210_*.sql`.
2. Fornecedor sem cadastro (nota sem `n_id_fornecedor`) ou loja própria sem CNPJ na compra → linha continua, agrupada pelo nome. Teste SQL 210 e puro (`montarProdutosFornecedor`).
3. Estoque mínimo com saldo negativo ou sem foto → diferença negativa e "abaixo do mínimo" (nunca some). Teste em `sugestao-puro.test.ts`.
4. Ficha com ciclo (A usa B, B usa A) ou mais de 10 níveis → a explosão para e marca, nunca trava. Teste em `estrutura-puro.test.ts`.
5. OP concluída sem ficha gravada (`itensDetalhes` vazio) ou OP do estoque próprio revertida → produção conta, consumo some só daquela OP; revertida não entra. Teste SQL 211 e puro.

---

### Task 1: Produtos por fornecedor (N3)

**Files:** Create `supabase/migrations/210_relatorio_produtos_fornecedor.sql`, `scripts/testes-sql/210_relatorio_produtos_fornecedor.sql`, `lib/relatorios/produtos-fornecedor-puro.ts` (+ `.test.ts`), `lib/relatorios/produtos-fornecedor-loader.ts`, `app/(app)/relatorio-produtos-fornecedor/page.tsx`, `.../export/route.ts`. Modify `app/(app)/relatorios/page.tsx` (card em "Compras e custo").

**Interfaces (produz):**
- SQL `relatorio_produtos_fornecedor(p_loja_id bigint) returns table(n_cod_prod bigint, fornecedor_chave text, fornecedor text, fornecedor_fantasia text, codigo_fornecedor text, ultima_data date, ultima_nota text, ultima_nota_id bigint, qtde numeric, unidade text, preco_unit numeric, total numeric, custo_unit numeric, compras integer, total_comprado numeric, primeira_data date)`, ordem `n_cod_prod, fornecedor_chave`. Loja Omie: itens de `notas_fiscais`/`nota_fiscal_items` (não excluída, não cancelada, item com produto e não ignorado; etapas conforme a prova contra o Omie), última compra por `d_emissao_nfe desc, id desc`, custo unitário = `custo_estoque_item_omie(...) ÷ quantidade na unidade de estoque (nQtdeRecebida)`. Próprio: `compras_proprio` (não cancelada) × `compras_proprio_itens` com produto; custo = `custo_unitario_base`.
- `type BrutoPF` (= colunas da RPC), `type MetaPF = { codigo, descricao, familia, tipo, unidade, inativo, custoMedio: number | null, estoque: number }`.
- `montarProdutosFornecedor(brutas: BrutoPF[], meta: Map<number, MetaPF>, op: { ver: 'produto' | 'fornecedor'; q: string; fornecedor: string; tipos: string[]; familias: string[]; inativos: boolean }): { linhas: LinhaPF[]; resumo: { produtos, fornecedores, pares, multiFornecedor } }` — `LinhaPF` = bruto + meta + `nFornecedores` (do produto) + `maisBarato` (menor `custo_unit` entre os fornecedores do produto, só quando > 1) + `variacaoPct` (custo da última compra × custo médio atual). Ordem `produto`: descrição, depois última data desc; `fornecedor`: nome, depois descrição.

- [x] Testes puros (empate, sem meta, filtro por fornecedor sem acento, inativo, maisBarato só com 2+, variação nula sem custo médio) → falhar → implementar → passar.
- [x] Migration + teste SQL (cancelada fora, última pela data e id, sem fornecedor cadastrado, loja própria) no `d6` → passar.
- [x] Loader (RPC por `rpcTodos` + `carregarPosicao` para cadastro, saldo e custo médio), tela (chips Por produto / Por fornecedor, busca, filtro de fornecedor, tipo/família, "Incluir inativos"), Excel com as colunas do Omie.
- [x] Prova: loja 5 (dados reais no `d6`) × captura do Omie de 17/10 (pares com última compra desde 07/2025: data, nota, quantidade, preço). tsc; commit.

### Task 2: Estoque mínimo / abaixo do mínimo (N5) na Sugestão de compra

**Files:** Modify `lib/compras/sugestao-puro.ts` (+ teste), `app/(app)/sugestao-compra/page.tsx`, `app/(app)/sugestao-compra/excel/route.ts`, `app/(app)/relatorios/page.tsx`.

**Interfaces:** `filtrarSugestao` aceita `ver: 'minimo' | 'abaixo'` (mínimo > 0; abaixo = atual < mínimo); nessas visões o filtro padrão de tipo não se aplica (o relatório do Omie lista todos os tipos) e a ordem é `diferencaMinimo` crescente. `diferencaMinimo(l) = estoqueAtual − estoqueMinimo`; `resumoMinimo(linhas) → { comMinimo, abaixo, faltaValor }` (falta × custo médio, senão último custo).

- [x] Testes puros → falhar → implementar → passar.
- [x] Tela: opções no "Mostrar", cartões próprios nas duas visões, coluna Diferença no Excel; card "Estoque mínimo" no hub → `/sugestao-compra?ver=abaixo`.
- [x] Prova: mínimo e lista de produtos com mínimo (loja 5, `d6`) × captura `rel-com-estoque-minimo` (268 ativos). tsc; commit.

### Task 3: Recebimentos por transportadora (N28) em Notas Fiscais

**Files:** Modify `lib/notas-compras.ts` (+ teste), `lib/notas-compras-loader.ts`, `app/(app)/nota-fiscal/page.tsx`, `app/(app)/nota-fiscal/export/route.ts` (coluna Transportadora).

**Interfaces:** `NotaLeve.transportadora: string` (`transporte.cNomeTransp`, senão `cRazaoTransp`, senão `SEM_TRANSPORTADORA = 'Sem transportadora'`); `transportadoraDe(nome, razao)`; visão `'transportadoras'`; `notaParaLinha(n, por: 'fornecedor' | 'transportadora' = 'fornecedor')`; `FiltrosMemoria.transportadora` (exato).

- [x] Testes puros → falhar → implementar → passar. Tela + Excel.
- [x] Prova: as 12 notas da captura (`rel-com-recebimentos-por-trasnportadora`, 17/10) × banco (transportadora por nota). tsc; commit.

### Task 4: Estrutura dos produtos multinível em Excel (N2)

**Files:** Create `lib/relatorios/estrutura-puro.ts` (+ teste), `app/(app)/estoque/fichas/dados.ts` (fichasOmie/fichasProprio saem da page), `app/(app)/estoque/fichas/excel/route.ts`. Modify `app/(app)/estoque/fichas/page.tsx` (botão Excel).

**Interfaces:** `type ItemFicha = { insumo: number; quantidade: number; perda: number; unidade: string | null }`; `explodirEstrutura(fichas: Map<number, ItemFicha[]>, produto: number, maxNivel = 10): LinhaEstrutura[]`, `LinhaEstrutura = { produto, nivel, caminho, ordem, insumo, quantidade, perda, unidade, temFicha, ciclo }` — ordem sequencial em profundidade (o item intermediário vem antes dos itens dele, como no Omie), quantidade do nível n = quantidade do pai no prato × quantidade por unidade do pai (perda só informada, não multiplica: regra vista na captura, vinagrete 0,053333 × cebola 0,145278 = 0,007748).

- [x] Testes puros (2 níveis com a conta do Omie, ciclo, limite, ficha vazia) → falhar → implementar → passar.
- [x] Excel (os dois modos; custo unitário = custo médio atual da posição; custo total = quantidade × custo).
- [x] Prova: loja 5 (`estrutura_produto_cache` no `d6`) × captura `rel-com-estrutura` (quantidades por produto × item, níveis 1 e 2). tsc; commit.

### Task 5: Produção por produto e matéria-prima consumida (N17, N18, N20)

**Files:** Create `supabase/migrations/211_relatorio_ops_periodo.sql`, `scripts/testes-sql/211_relatorio_ops_periodo.sql`, `lib/relatorios/ops-periodo-puro.ts` (+ teste), `lib/relatorios/ops-periodo-loader.ts`, `app/(app)/relatorio-ops/page.tsx`, `.../export/route.ts`. Modify `app/(app)/relatorios/page.tsx` (grupo Produção).

**Interfaces:**
- SQL `relatorio_ops_periodo(p_loja_id bigint, p_ini date, p_fim date, p_fonte text default 'ops') returns table(papel text, dia date, n_cod_prod bigint, ops integer, qtde numeric, custo numeric)` (`p_fonte = 'kardex'` = OPE/OPS do `kardex_omie`, decidido na execução: o espelho de OPs da loja 5 tem só 7.044 das 15.449 produções do kardex), `papel in ('produzido','consumido')`, ordem `papel, dia, n_cod_prod`. OPs concluídas com `dt_conclusao_real` no período. Omie: produzido = `identificacao_n_qtde`; consumido = `full_object.itensDetalhes[].nQtde` (mesma regra da `movimentacoes_loja`, 170); custo nulo. Próprio: produzido com `custo_total`; consumido = `ordens_producao_proprio_itens` da produção atual (`ordens_producao_proprio.ref = producao_ref`), custo = quantidade × custo unitário.
- `agregarOps(linhas, meta: Map<number, {rotulo, familia, tipo, unidade}>, papel): LinhaOp[]` (`{ chave, rotulo, familia, tipo, unidade, qtde, ops, custo, dias }`, ordem qtde desc, rótulo) e `serieOps(linhas, ini, fim)` (OPs e quantidade produzida por dia, dias sem produção = 0).

- [x] Testes puros → falhar → implementar → passar. Migration + teste SQL no `d6`.
- [x] Tela (PeriodoBar padrão Este mês; visões Produzidos / Matéria-prima consumida / Por dia; filtros tipo/família; cartões OPs concluídas, produtos, insumos, custo da produção quando há) e Excel.
- [x] Prova: loja 5 (`d6`) × kardex do Omie (`kardex_omie` OPE/OPS) no mesmo período. tsc; commit.

### Task 6: Documentação e fechamento

- [x] AGENTS.md: seção "Fase D item 6" (telas, regras, migrations 210 → 211, deploy, o que ficou fora). Sem server action nova (`inserir-via-desktop.mjs` não roda).
- [x] Todos os testes da fase + tsc; commit final.

## Resultado (19/10/2026)

| Relatório do Omie | Tela / arquivo | Migration | Prova (loja 5, dados reais) |
|---|---|---|---|
| Produtos por Fornecedor | `/relatorio-produtos-fornecedor` + Excel | 210 | × captura de 17/10 (1.415 pares): nota 98,0 %, quantidade 97,7 %, preço 97,5 %, custo 95,1 %, data 93,4 %; × SQL direto em produção: 1.483 pares e R$ 5.102.095,42 iguais |
| Estoque Mínimo | `/sugestao-compra?ver=abaixo` / `?ver=minimo` + Excel | — (usa a 201) | × captura: 267 de 268 ativos com mínimo; mínimo igual em 267/267 |
| Recebimentos por Transportadora | `/nota-fiscal?aba=transportadoras` (+ filtro no Excel e no PDF) | — | × captura: 12/12 notas com a mesma transportadora |
| Estrutura dos Produtos | `/estoque/fichas/excel` | — | × captura: nível 1 5.077/5.077; níveis 2+ 3.925/4.355 (o Omie não abre algumas PIs com ficha) |
| OP por Produto / por Matéria-prima / Concluídas | `/relatorio-ops` + Excel | 211 | captura do Omie deu timeout; RPC = SQL direto (7.044 OPs, 15.630,209; kardex 15.449 / 14.184,878 e 60.062 / 1.006.648,930) |

Ordem das migrations: 210 → 211 (210 depende da 175).

Revisão independente (19/10): I1 cartões do mínimo sobre todos com mínimo (`resumoMinimoDaTela`); I2 210 em jsonb, nota lida uma vez, item só na última compra: produção, usuário comum, loja 5: 3,8–4,3 s × 2 páginas → 0,65–0,84 s, mesmo resultado (1.483 pares, R$ 5.102.095,42, linha a linha); I3 211 em jsonb agregado (produtos + dias), filtro por `p_produtos`: 1 ano da loja 5, 57 chamadas de ~1,6 s → 1 chamada de 1,3 s, mesmos totais; M1 testes SQL limpam as lojas usadas dentro da transação; M3 Excel barra loja sem estoque; M6 transportadora cortada em 120 também no Excel/PDF. Testes: puros (`node --test`), SQL 210, 211 e RLS (`210_211_rls.sql`).
