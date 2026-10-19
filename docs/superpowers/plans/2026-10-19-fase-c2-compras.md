# Fase C2 (compras): requisição, lead time por fornecedor, importar pedidos, compradores e tarefas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** completar a Fase C no estoque próprio com o que faltou da matriz do Omie: requisição de compra [I1] (etapas, aprovação, gerar pedido agrupando por fornecedor, vinda da sugestão), lead time por fornecedor na sugestão, importação de pedidos por planilha [I5], compradores [I8] e painel de tarefas de compras [I7].

**Architecture:** igual à Fase C (`docs/superpowers/plans/2026-10-19-fase-c-compras.md`). Regras em módulos puros `lib/compras/*-puro.ts` (sem `@/`, `node --test`). Tabelas novas com RLS initplan, `anon` nada, `authenticated` só `select`; escrita só por funções `security definer` com `search_path = public`, checagem de loja própria e de posse (linha da mesma loja) dentro da função, trava (`pg_advisory_xact_lock`) antes de conferir a chave de idempotência, eventos append-only (gatilho que recusa update/delete). Server actions conferem permissão e chamam as funções com o service role. Telas novas: `notFound()` em loja que não é `modo_estoque='proprio'`.

**Tech Stack:** Next 16.2 (app router, server actions, body de action até 1 MB), Supabase/PostgREST, Postgres 17, exceljs (`lib/excel.ts` e leitura de `.xlsx`).

**Spec:** pedido do dono (19/10, "Fase C2") + `~/Projects/omie-rea/gaps/matriz-compras-estoque-producao.md` (I1, I5, I7, I8, I9) + `~/Projects/omie-rea/telas/COM/listar-todos-requisicao-compra.md` (itens: produto, quantidade, preço unitário sugerido, unidade; cabeçalho: sugestão de entrega, obs. para a carta de cotação, obs. interna; grid: situação, número, previsão, qtde de itens, valor total), `importar-pedido-compra.md` (baixar modelo → preencher → enviar), `painel-tarefa-compras.md`, `telas/CFG/c57.md` (compradores: só nome + situação), `fluxos/README.md` (board 2001 Requisição → 2002 Pedido → 2003 Aprovação → 2004 Faturado → 2005 Recebido → 2006 Conferido).

## Decisões (o que o Omie não decide por nós)

- Requisição: etapas `aberta → aprovada → pedido` (virou pedido) e `recusada` (com motivo). `reabrir` volta aprovada/recusada para aberta (sem pedido). Editar só aberta. Fornecedor é **sugerido por item** (a sugestão traz o da última nota; pode ficar vazio = "Fornecedor a definir").
- Gerar pedido: só requisições aprovadas, várias de uma vez; agrupa itens por fornecedor (id; senão CNPJ; senão nome sem acento/caixa; vazio = um grupo "Fornecedor a definir"); dentro do grupo junta o mesmo produto+unidade+fator (soma a quantidade, preço = média ponderada). Pedido nasce **rascunho**, `origem='requisicao'`, previsão = menor sugestão de entrega do grupo, obs. interna "Das requisições nº …". Requisição vira `pedido` e cada item guarda `pedido_id`/`pedido_item_id`. Uma chamada é atômica e idempotente pela chave.
- Entrada prevista da sugestão (modo próprio) passa a contar requisições abertas e aprovadas (Omie: "pedidos de compra + requisições + OPs"), em coluna própria `entrada_requisicoes` (hipótese H6, documentada na tela). Requisição que virou pedido sai (já conta no pedido).
- Lead time: produto (`produto_compra_param`) > fornecedor da última nota (`fornecedor_compra_param`) > vazio (1 dia). A função devolve `lead_time_origem` ('produto' | 'fornecedor' | null).
- Importação: `.xlsx` ou `.csv` até 700 KB, até 2.000 linhas, 100 pedidos, 300 itens por pedido. Uma linha = um item. Agrupador = coluna "Pedido" (vazia = fornecedor + previsão). Prévia sempre refeita no servidor; confirmar reenvia o arquivo, o servidor valida de novo e grava tudo ou nada (`pc_importar`). Chave = `imp:` + sha256 do arquivo: o mesmo arquivo duas vezes devolve os pedidos da primeira.
- Compradores: nome, usuário do sistema (opcional), ativo. Pedido e requisição ganham `comprador_id` opcional (pedidos: coluna nova + `pc_salvar` recriada com o campo). Cadastro de comprador e lead time do fornecedor exigem `Compras - Aprovar pedidos` (gestor), sem permissão nova.
- I9 (formas de pagamento de compras) fica fora: o pedido já tem parcelas em dias.
- Desktop offline: as ações novas ficam fora de `politica.ts` (tabelas novas não estão em `offline_tabelas`): só com internet.

## Global Constraints

- NUNCA: deploy, migration em produção, escrita em produção, chamada ao Omie. Não mexer em `/estoque/correcoes` nem `lib/correcoes/*`.
- Leitura em produção só `begin read only; … rollback;`.
- Migrations a partir de 240. Teste SQL local: `ntb-teste-sql`, `create database c2 template fb;` + 187, 188, 190–195, 200, 201.
- Modo Omie intacto: nada escreve no Omie; telas novas 404 em loja Omie.
- `npx tsc --noEmit -p .` limpo; `node scripts/inserir-via-desktop.mjs` depois de ações novas; decisão em `lib/offline/politica.ts`.
- Textos em PT-BR.

## Review Focus

- Gerar pedido duas vezes (duplo clique / retry) → mesmos pedidos, sem duplicar; requisição de outra loja ou não aprovada → recusa tudo (nada criado). Teste em `240`/`241` SQL.
- Planilha com número no formato brasileiro ("1.234,5"), data `dd/mm/aaaa` ou data do Excel, código com zero à esquerda lido como número → teste puro de `lerCelulaNumero`/`lerCelulaData`/código.
- Linhas do mesmo pedido com fornecedor ou previsão diferentes → erro na linha, não pedido misturado. Teste puro.
- Requisição aprovada e depois virada em pedido não conta duas vezes na entrada prevista. Teste SQL 242.
- Comprador desativado ou de outra loja no pedido/requisição → recusado. Teste SQL 240.

---

### Task 1: migration 240 — compradores + requisição de compra

**Files:** Create `supabase/migrations/240_requisicao_compra.sql`, `scripts/testes-sql/240_requisicao_compra.sql`.

**Produces (SQL):**
- `compradores (id, loja_id, nome, user_id text null, ativo bool, created_at, updated_at)`; `unique (loja_id, lower(nome))`.
- `pedidos_compra.comprador_id bigint references compradores` (nova coluna); `pedidos_compra.origem` aceita também `requisicao`, `planilha`.
- `requisicoes_compra`, `requisicoes_compra_itens` (com `fornecedor_id/_nome/_cnpj`, `preco_sugerido`, `pedido_id`, `pedido_item_id`), `requisicoes_compra_eventos` (append-only).
- `comp_salvar(p_loja, p_dados jsonb, p_user, p_nome) → jsonb {ok,id}` (`{id?, nome, user_id?, ativo?}`).
- `rc_salvar(p_loja, p_dados, p_user, p_nome) → {ok,id,numero,duplicado}`; `rc_acao(p_loja, p_id, p_acao 'aprovar'|'recusar'|'reabrir', p_user, p_nome, p_motivo)`; `rc_gerar_pedidos(p_loja, p_ids bigint[], p_chave, p_user, p_nome) → {ok, duplicado, pedidos:[{id,numero,fornecedor}]}`.
- `pc_salvar` recriada: igual à 200 + `comprador_id` (comprador ativo da loja).
- Permissão `Compras - Requisicoes`.

- [ ] Teste SQL: comprador de outra loja/inativo recusado em rc_salvar e pc_salvar; loja Omie recusa; número sequencial; idempotência de rc_salvar; transições (editar só aberta, recusar exige motivo, reabrir); rc_gerar_pedidos com 2 requisições de 2 fornecedores + item sem fornecedor = 3 pedidos rascunho, mesmo produto somado com preço ponderado, previsão = menor; repetir a chave = `duplicado` com os mesmos pedidos; requisição aberta no lote = erro e nada criado; eventos não se apagam.
- [ ] Rodar no `c2`, rodar de novo `200_pedido_compra.sql` (pc_salvar recriada não muda nada). Commit.

### Task 2: migration 241 — lead time por fornecedor + sugestão com requisições

**Files:** Create `supabase/migrations/241_lead_time_fornecedor.sql`, `scripts/testes-sql/241_lead_time_fornecedor.sql`.

- `fornecedor_compra_param (loja_id, fornecedor_id, lead_time_dias 1..365, updated_by, updated_at, pk (loja_id, fornecedor_id))`; `fornecedor_lead_time_salvar(p_loja, p_fornecedor, p_dias int null = apagar, p_user)`.
- `sugestao_compra_proprio` recriada: `lead_time = coalesce(produto, fornecedor)`, `lead_time_origem`, `entrada_requisicoes` (itens × fator de requisições abertas/aprovadas com sugestão de entrega até o fim da estimativa).
- [ ] Teste SQL: produto com lead do fornecedor (5), produto com lead próprio (2) ganha do fornecedor; requisição aberta conta, recusada e virada em pedido não; `201_sugestao_compra.sql` segue passando. Commit.

### Task 3: regras puras (requisição, importação, tarefas) — TDD

**Files:** Create `lib/compras/requisicao-puro.ts` (+ test), `lib/compras/importar-pedidos-puro.ts` (+ test), `lib/compras/tarefas-puro.ts` (+ test); Modify `lib/compras/sugestao-puro.ts` (+ test).

**Produces:**
- `requisicao-puro`: `type EtapaRequisicao = 'aberta'|'aprovada'|'pedido'|'recusada'`; `acoesRequisicao(etapa, {podeEditar, podeAprovar, podeGerarPedido}) → ('editar'|'aprovar'|'recusar'|'reabrir'|'gerar_pedido')[]`; `rotuloEtapaRequisicao(etapa) → {rotulo, tom}`; `chaveFornecedor({fornecedorId, fornecedorCnpj, fornecedorNome}) → string` (a mesma regra do SQL); `previaGerarPedidos(itens) → {fornecedorNome, itens}[]` (mostra na tela o que o SQL vai fazer).
- `importar-pedidos-puro`: `COLUNAS_MODELO`; `lerCelulaNumero(v) → number|null` ("1.234,5", "4,5", "4.5", número); `lerCelulaData(v) → 'YYYY-MM-DD'|null` (dd/mm/aaaa, ISO, Date, serial do Excel); `mapearCabecalho(linha: string[]) → Record<campo, índice> | {erro}`; `validarImportacao(matriz, cadastro) → { linhas: LinhaValidada[], pedidos: PedidoImportado[], erros: number }` com cadastro `{ produtos: {codigoProduto, codigo, descricao, unidade}[], fornecedores: {id, nome, cnpj}[], locais: number[] }`.
- `tarefas-puro`: `montarTarefas({ requisicoes, pedidos, notas, hoje, podeAprovar }) → Tarefa[]` (`tipo: 'aprovar_requisicao'|'gerar_pedido'|'aprovar_pedido'|'pedido_atrasado'|'conferir_nota'|'rascunho_parado'`), ordenadas por urgência; `resumoTarefas(t)`.
- `sugestao-puro`: `LinhaBruta.entrada_requisicoes?`, `lead_time_origem?`; `LinhaSugestao.entradaRequisicoes`, `leadTimeOrigem`; entrada prevista soma as requisições.
- [ ] Testes primeiro (`node --test lib/compras/*.test.ts` falha), depois implementação, passa. Commit.

### Task 4: ações (requisição, compradores, lead time do fornecedor, importação)

**Files:** Create `lib/actions/requisicao-compra.ts`, `lib/actions/compras-cadastros.ts`, `lib/actions/importar-pedidos.ts`; Modify `lib/actions/pedido-compra.ts` (comprador no `PedidoForm`), `lib/offline/politica.ts` (comentário), `lib/offline/registro-acoes.ts` (gerado), `lib/permissoes-catalogo.ts`.
- requisicao: `salvarRequisicao(form)`, `acaoRequisicao(id, acao, motivo?)`, `gerarPedidosDasRequisicoes(ids, chave)`, `criarRequisicaoDaSugestao(linhas, chave)`.
- cadastros: `salvarComprador({id?, nome, userId?, ativo})`, `salvarLeadTimeFornecedor(fornecedorId, dias|null)`.
- importar: `previaImportacaoPedidos({nome, base64})`, `confirmarImportacaoPedidos({nome, base64})` (parse com exceljs/CSV no servidor, `validarImportacao`, `pc_importar` da Task 5).
- [ ] `node scripts/inserir-via-desktop.mjs`, tsc limpo, commit.

### Task 5: migration 242 — `pc_importar`

**Files:** Create `supabase/migrations/242_importar_pedidos_compra.sql`, `scripts/testes-sql/242_importar_pedidos_compra.sql`.
- `pc_importar(p_loja, p_chave text, p_pedidos jsonb, p_user, p_nome) → {ok, duplicado, pedidos:[{id,numero}]}`: trava, se já existe pedido com chave `p_chave:%` devolve esses; senão chama `pc_salvar` por pedido (`origem='planilha'`, chave `p_chave:<i>`) — erro em qualquer um desfaz todos.
- [ ] Teste SQL: 2 pedidos criados; repetir = duplicado; um produto inexistente no 2º = nada criado. Commit.

### Task 6: telas

**Files:** `app/(app)/requisicao-compra/{page,dados}.ts(x)`, `novo/page.tsx`, `[id]/page.tsx`, `[id]/editar/page.tsx`; `components/compras/{FormRequisicao,AcoesRequisicao,GerarPedidos}.tsx`; `app/(app)/pedido-compra/importar/{page.tsx,modelo/route.ts}`, `components/compras/ImportarPedidos.tsx`; `app/(app)/compras-cadastros/page.tsx`, `components/compras/{Compradores,LeadTimeFornecedores}.tsx`; `app/(app)/tarefas-compras/page.tsx`; `components/compras/TabelaSugestao.tsx` ("Criar requisição", lead do fornecedor); `components/compras/FormPedidoCompra.tsx` (comprador); `components/shell/NavItems.ts`.
- [ ] tsc limpo; páginas conferidas no banco local onde der. Commit por tela.

### Task 7: documentação

- [ ] Seção no AGENTS.md (migrations e ordem, permissões, testes, limites). Commit.
