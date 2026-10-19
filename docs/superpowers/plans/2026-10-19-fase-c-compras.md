# Fase C (compras): sugestão de compra, pedido de compra, aprovação e conferência com a nota

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** sugestão de compra com a fórmula do Omie nos dois modos; pedido de compra com etapas, aprovação, PDF e conferência pedido × nota × recebido no estoque próprio; leitura (desligada) dos pedidos do Omie.

**Architecture:** regras em módulos puros (`lib/compras/*-puro.ts`, sem `@/`, `node --test`). Dados por RPC SQL security invoker, uma por modo (`sugestao_compra_omie` / `sugestao_compra_proprio`), despachadas em TS por `modo_estoque` (teste de despacho como `lib/estoque/nf-despacho.test.ts`). Pedido de compra só no modo próprio: tabelas novas, escrita só por funções `security definer` chamadas pelo servidor (service role) depois da checagem de permissão.

**Tech Stack:** Next 16 (app router, server actions), Supabase/PostgREST, Postgres 17, @react-pdf/renderer, exceljs (`lib/excel.ts`).

**Spec:** pedido da Fase C (mensagem do dono, 19/10) + `docs/superpowers/plans/2026-10-18-plano-mestre-paridade-omie.md` (Fase C, "Os dois modos") + engenharia reversa `~/Projects/omie-rea/telas/COM/sugestao-compra*`, `incluir-pedido-compra.md`, `listar-todos-pedidos-compra.md`, `fluxos/README.md` (board 2001–2006), `endpoints/public-api/stock-and-purchase-detail.md` (`PesquisarPedCompra`).

## Fórmula do Omie (provada na captura de 17/10/2026, loja 5, 50 linhas do grid + os textos de ajuda da tela)

Textos da tela (record-0 da captura) dão as fórmulas literais; as 50 linhas conferem todas:
- Período de análise padrão = mês anterior inteiro (17/10 → 01/09–30/09, 30 dias). Período de estimativa padrão = hoje até o fim do mês (17/10–31/10, 15 dias). Dias contados com as duas pontas.
- Consumo total = soma de todas as saídas do período (venda/PDV, consumo de OP, ajuste de saída), todos os locais. Prova: `movimentos_historico.saidas` set/2026 bate exato em 26/50 produtos e fica a < 1 % em quase todos os outros (o histórico foi relido depois da captura).
- Consumo médio = consumo total ÷ dias de análise (6 casas).
- Estoque mínimo = soma dos mínimos de todos os locais. Estoque atual = soma dos saldos de todos os locais.
- Lead time = cadastro do produto (`lead_time`); vazio ou 0 = 1 dia.
- Ponto de pedido = mínimo + consumo médio × lead time.
- Projeção de saídas = consumo médio × dias de estimativa.
- Previsão de entradas = pedidos de compra + requisições + OPs em aberto + (provado nos dados) **notas já emitidas pelo fornecedor e ainda não recebidas** (etapa 40, quantidade em unidade de estoque `itensAjustes.nQtdeRecebida`): 90001 = 204, 90831 = 240, 80027 = 80, 80107 = 9,26366, exatos.
- Sugestão = máx(0, projeção + ponto de pedido − estoque atual − previsão de entradas).
- Duração do estoque = trunc(estoque ÷ consumo médio) (0 sem consumo). Dias até o ponto de pedido = máx(0, trunc((estoque − ponto) ÷ consumo médio)).
- Recomendação: sugestão = 0 → "Não comprar/produzir"; senão dias até o ponto = 0 → "imediatamente"; senão "nos próximos dias". Tipo 04 (e produto com ficha) = "Produzir", o resto "Comprar".

Hipóteses (não provadas pela captura, documentadas na tela e no AGENTS.md):
- H1 OPs abertas entram na previsão de entradas do produto acabado pela quantidade da OP com previsão até o fim da estimativa (Cafe = 10 na captura; as OPs abertas daquela hora não estão mais no banco para conferir).
- H2 "Produzir" = tipo 03/04 ou produto com ficha técnica (a captura só tem tipo 04).
- H3 Lista padrão: produtos ativos com consumo, mínimo, saldo ou entrada prevista; tipos 08/09/99 fora por padrão (o Omie lista o que o usuário seleciona; "Taxa de Serviço" tipo 99 sugeria comprar 107.794).
- H4 Modo próprio: consumo = saídas do ledger (SAI, PRD e AJU negativos) que não foram estornadas; nota pendente (compra não lançada) = "faturado pelo fornecedor"; pedido aprovado/aguardando com saldo a vincular = pedido de compra.
- H5 Alternativa "previsão" (pedido do dono, fora do Omie): projeção = previsão de venda (`previsao_venda`, por dia × dias de estimativa) + consumo do produto nas OPs abertas. Escolhida pelo usuário na tela (`proj=previsao`); padrão é a do Omie.

## Global Constraints

- Nunca: deploy, migration ou escrita em produção, chamada ao Omie a partir daqui. Leitura em produção só `begin read only; … rollback;`.
- Migrations 200+ (200 sugestão, 201 pedido de compra). Teste em `ntb-teste-sql`, banco `fc` criado de `fb_base`. RLS padrão initplan (156). Grants mínimos: `select` para authenticated, escrita só service role / funções.
- Modo Omie não muda nada; pedido de compra só em `modo_estoque='proprio'`; nada escreve no Omie.
- Puro sem `@/`, `node --test`. `npx tsc --noEmit -p .` limpo antes de cada commit. Ações novas: `node scripts/inserir-via-desktop.mjs` + decisão em `lib/offline/politica.ts`.
- Não mexer em `/estoque/correcoes`, `lib/correcoes/*`.

## Review Focus

- Consumo médio zero (produto parado): duração e dias até o ponto = 0, sem divisão por zero; sugestão só pelo mínimo.
- Estoque negativo: duração negativa (como o Omie), sugestão cobre o buraco.
- Último dia do mês: estimativa de 1 dia, não 0.
- Nota vinculada a pedido e ainda não lançada: não pode contar duas vezes na previsão de entradas (pedido pendente desconta o que já está vinculado).
- Item da nota com unidade diferente (fator): conferência compara sempre em unidade de estoque.

---

### Task 1: regras puras da sugestão

**Files:** Create `lib/compras/sugestao-puro.ts`, `lib/compras/sugestao-puro.test.ts`.

**Produces:** `diasInclusivos(ini, fim)`, `periodosPadrao(hoje) → { analise:{ini,fim}, estimativa:{ini,fim} }`, `calcularSugestao(e: EntradaSugestao, p: { diasAnalise, diasEstimativa, base: 'consumo'|'previsao' }) → LinhaCalculada` (`consumoMedio, pontoPedido, diasAtePonto, duracao, saidaProjetada, entradaPrevista, sugestao, recomendacao: 'imediato'|'proximos'|'nao'`), `acaoDoProduto(tipo, temFicha)`, `tipoPadraoIncluido(tipo)`, `deveListar(...)`.

- [ ] Testes com as linhas reais do Omie: 90001 (−1146/30 dias, mín 120, est 150,5, ent 204 → ponto 158,2, saída 573, sugestão 376,7, duração 3, dias 0, imediato); 80006 (est −2,18 → duração −14, sugestão 1,938667); 60002 (sugestão 69,266667, dias 1, próximos); 80000 (sugestão 0, não comprar, dias 594); 60276 sem consumo (tudo 0, não comprar); periodosPadrao('2026-10-17') = 01/09–30/09 e 17/10–31/10; '2026-10-31' → estimativa 1 dia; '2026-01-05' → análise dez/2025.
- [ ] Implementar; `node --test lib/compras/sugestao-puro.test.ts` passa. Commit.

### Task 2: migration 200 (dados da sugestão) + despacho por modo

**Files:** Create `supabase/migrations/200_sugestao_compra.sql`, `scripts/testes-sql/200_sugestao_compra.sql`, `lib/compras/sugestao-despacho.ts` (puro), `lib/compras/sugestao-despacho.test.ts`, `lib/compras/sugestao-dados.ts`.

- 200: permissão `Compras - Sugestao`; tabela `produto_compra_param (loja_id, codigo_produto, lead_time_dias 1..365)`; funções `sugestao_compra_omie(p_loja, p_ini, p_fim, p_proj_fim)` e `sugestao_compra_proprio(...)` (security invoker, stable) com as colunas `codigo_produto, codigo, descricao, unidade, tipo_item, familia, consumo_total, estoque_atual, estoque_minimo, lead_time, entrada_nf, entrada_ops, entrada_pedidos, consumo_ops, previsao_qtde, previsao_dias, tem_ficha, fornecedor_id, fornecedor_nome, ultimo_custo`.
- Despacho: `rpcDaSugestao(modo) → 'sugestao_compra_omie' | 'sugestao_compra_proprio' | null`; loader `carregarSugestao(lojaId, modo, filtros)`.
- [ ] Teste SQL no banco `fc` com dados sintéticos (loja omie + loja própria): números conferidos à mão, estorno não conta como consumo, nota vinculada a pedido não conta duas vezes (depois da 201). Commit.

### Task 3: tela `/sugestao-compra` + Excel

**Files:** `app/(app)/sugestao-compra/page.tsx`, `app/(app)/sugestao-compra/excel/route.ts`, `components/compras/TabelaSugestao.tsx`, `components/shell/NavItems.ts`, `lib/permissoes-catalogo.ts`.

- Layout de `/relatorio-compras`: `PageHeader`, períodos (análise e estimativa) por campos de data, `FiltrosGaveta` (tipo, família, busca, ver), 4 `CartaoResumo` (comprar já, próximos dias, produzir, valor estimado), tabela com as colunas do Omie. Excel com as mesmas colunas.
- [ ] tsc limpo; conferir no banco local. Commit.

### Task 4: migration 201 (pedido de compra) + regras puras do pedido

**Files:** `supabase/migrations/201_pedido_compra.sql`, `scripts/testes-sql/201_pedido_compra.sql`, `lib/compras/pedido-puro.ts`, `lib/compras/pedido-puro.test.ts`.

- Tabelas `pedidos_compra`, `pedidos_compra_itens`, `pedidos_compra_vinculos` (item do pedido × item da nota), `pedidos_compra_eventos` (append-only); view `pedidos_compra_itens_situacao` (security_invoker): quantidade base, vinculado, recebido (item da nota lançado). Funções `pc_salvar`, `pc_acao`, `pc_vincular_nota`, `pc_desvincular_nota` (security definer, só loja própria, revoke de public/anon/authenticated). Permissões `Compras - Pedidos`, `Compras - Aprovar pedidos`.
- Puro: `ETAPAS`, `acaoPermitida(etapa, acao, temVinculo)`, `etapaExibida(etapa, qtdTotal, qtdRecebida)`, `conferirPedidoNota(pedido, nota)`, `ordenarPedidosParaNota`, `agruparPorFornecedor`, `totaisPedido`, `parcelasValidas`.
- [ ] Testes puros + teste SQL (número sequencial, transições, aprovação, vínculo, recebido só depois de lançar, cancelar). Commit.

### Task 5: ações e telas do pedido (`/pedido-compra`, novo, detalhe, PDF) + "Criar pedido" na sugestão

**Files:** `lib/actions/pedido-compra.ts`, `app/(app)/pedido-compra/{page,dados}.ts(x)`, `app/(app)/pedido-compra/novo/page.tsx`, `app/(app)/pedido-compra/[id]/page.tsx`, `app/(app)/pedido-compra/[id]/pdf/route.ts`, `components/compras/{FormPedidoCompra,AcoesPedido}.tsx`, `components/relatorio/PedidoCompraPDF.tsx`, `lib/offline/politica.ts`, `lib/offline/registro-acoes.ts` (gerado).

- [ ] tsc limpo, `node scripts/inserir-via-desktop.mjs`, commit.

### Task 6: pedido na nota (conferência pedido × nota × recebido)

**Files:** `components/nota-fiscal/PedidoDaNotaNF.tsx`, `app/(app)/nota-fiscal/[id]/dados-pedido.ts`, `app/(app)/nota-fiscal/[id]/page.tsx` (só no bloco `proprio`).

- [ ] tsc limpo, teste puro da conferência já na Task 4, commit.

### Task 7: leitura dos pedidos do Omie atrás de flag (desligada)

**Files:** `lib/omie/pedidos-compra.ts`, `lib/compras/pedidos-omie-puro.ts`, `lib/compras/pedidos-omie-puro.test.ts`.

- `OMIE_LER_PEDIDOS_COMPRA=1` liga; padrão desligado (a tela diz "pedidos do Omie não lidos"). `PesquisarPedCompra` só pendentes e recebidos parcialmente, `semRepetir`, até 5 páginas, trava `pedidos-compra` em `sync_trava`. Nunca chamado nos testes.
- [ ] Teste puro do saldo pendente por produto; commit.

### Task 8: prova com dado real e documentação

- [ ] Rodar as funções 200 (corpo copiado em CTE, `begin read only`) na loja 5 e na loja 15; comparar com a captura do Omie.
- [ ] Seção no AGENTS.md; commit.
