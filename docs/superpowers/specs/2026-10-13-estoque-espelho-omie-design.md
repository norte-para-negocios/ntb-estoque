# Tela de Estoque para loja Omie (espelho) — Design

Data: 2026-10-13 · Primeira loja: Donana Praia do Forte (loja 5) · Repo: Norte Estoque.

## 1. Entendimento

Pedido do dono (13/10): "o nosso próprio Omie". O Norte Estoque tem que mostrar o estoque **completo** da loja Omie,
espelhado (mesmo saldo, nada divergente), na **mesma tela de Estoque que a ODARA (modo `proprio`) já tem**. Quando a loja
não tem Omie, a tela já funciona com o estoque próprio. A faxina vai usar essa base depois; este spec não é sobre faxina.

Hoje `/estoque`, `/estoque/local/[codigo]` e `/estoque/produto/[codigo]` dão 404 em loja `omie`
(`modoDaLoja(lojaId) !== 'proprio'`). O espelho de saldo existe (`posicao_estoques`, `syncPosicaoEstoque`), mas não há
kardex por documento com custo.

## 2. Escopo desta entrega

1. **As 3 telas de Estoque abertas para `modo_estoque = 'omie'`**, mesmo layout e componentes da ODARA:
   indicadores (produtos, valor, abaixo do mínimo, negativos), bloco de negativos, filtros (busca, família, tipo, local,
   situação), lista paginada com saldo por local, custo médio, valor e situação; página do local; página do produto.
2. **Fonte de dados Omie**: `carregarEstoqueOmie(lojaId)` devolve o mesmo `VisaoEstoque` a partir da **última foto
   completa** de `posicao_estoques` (linhas por local + linha sentinela `codigo_local_estoque = 0` com mínimo e CMC),
   `produtos`, `familias`, `local_estoques`. Cabeçalho mostra "Espelho do Omie · atualizado às HH:MM".
3. **Botão "Atualizar do Omie"** (permissão `Movimentacoes - Criar` ou admin): roda `syncPosicaoEstoque` só da loja
   atual, com trava (uma execução por loja por vez; recusa se a última atualização foi há menos de 5 min).
4. **Kardex do Omie na página do produto**: nova tabela `kardex_omie` alimentada por `ListarMovimentoEstoque`
   (`estoque/consulta`), por produto, sob demanda (botão "Carregar movimentos do Omie", janela de 55 dias, por local
   ativo), gravada com upsert por `(loja_id, id_mov)`. Mostra data, local, origem (codOrigem/desOrigem: PDV, OPE, OPS,
   AJU, SLD, COM, TRF…), tipo, quantidade, valor, CMC após, saldo após, documento/obs. Marca salto de CMC (≥10× o anterior).
5. **Ações na loja Omie**: nesta entrega a tela é de **leitura**. Os botões de entrada/saída/transferência do modo
   próprio ficam ocultos em loja `omie`; no lugar, links para os fluxos Omie que já existem (`/movimentacoes`,
   `/transferencia`, `/inventario`). (Escrever pela tela nova fica para a próxima rodada.)
6. Menu: item "Estoque" visível também para loja `omie`.

Fora: kardex da loja inteira por cron, histórico de saldo por data, CMC histórico em gráfico, Saúde do estoque,
OPs/fichas — entregas seguintes (ver lista aprovada em 13/10).

## 3. Regras e cuidados

- **Nada diverge**: a tela só lê o espelho; a fonte é o Omie. Se a foto mais recente estiver incompleta (sync em curso,
  local falhou), mostrar o horário e o aviso, nunca misturar fotos de datas diferentes por local.
- **Saldo do produto = soma dos locais** (o Omie não consolida); CMC = da linha sentinela (local padrão).
- **Limite do Omie**: o botão de atualizar e o kardex sob demanda passam pelo `omieRequest` existente (pacing, MISUSE,
  REDUNDANT já tratados). Kardex: no máximo 1 carga por produto a cada 10 min.
- **Lojas**: qualquer loja `omie` não teste vê a tela (é só leitura). Nenhuma escrita no Omie nesta entrega.
- **Migração** `157_kardex_omie.sql`: manual, como as demais (AGENTS.md). Deploy e migration só com OK do dono.

## 4. Testes

- Unitários: montagem do `VisaoEstoque` a partir de linhas de `posicao_estoques` (soma por local, sentinela, situação,
  produto sem posição = 0, foto mais recente apenas); normalização do kardex (datas, sinal de saída, salto de CMC).
- Tela: `next build` + checagem visual local com a loja 5 (sem escrever no Omie).
