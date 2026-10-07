# Validade e lotes no estoque próprio — desenho (07/10/2026)

R8 do plano mestre `docs/superpowers/plans/2026-10-06-independencia-do-estoque-plano-mestre.md`.

## Como é hoje (modo omie)
A tela Validade lê `ordens_producao.validade` (OP com validade digitada na criação, `validadeDias` por item), completa com o Contabo nos vencidos e mostra OP × quantidade. Não existe lote: compra (NF) não traz validade, e nada controla o que já saiu. Isso continua IGUAL para lojas `omie`.

## Decisão: lotes derivados do ledger por gatilho
- `estoque_movimentos` continua sendo a única verdade. Um gatilho `AFTER INSERT` (`trg_estoque_movimentos_lotes`, migration 145) distribui cada movimento em `estoque_lotes` e grava o vínculo em `estoque_lote_movimentos` (a imutabilidade do ledger não muda).
- Por isso nenhuma rota existente precisou mudar: venda (Norte Vendas), OP, transferência, inventário, compra, estorno e ajuste passam a manter os lotes sozinhos.
- **Invariante:** para cada (loja, local, produto), soma dos lotes = saldo do ledger. Garantido por desenho: o único lote que pode ficar negativo é o "saldo sem lote" (lote e validade nulos, um por local/produto), que absorve o que falta numa saída. A visão `estoque_lotes_divergencia` mostra qualquer diferença e `reconciliar_lotes(loja)` corrige só no "sem lote" (nunca mexe em lote com validade).
- **Carga inicial:** na aplicação, o saldo existente vira "saldo sem lote" (24 lotes da ODARA no teste em ROLLBACK, 0 divergências).

## Regras do gatilho
| Movimento | O que acontece com os lotes |
|---|---|
| Entrada (qtd > 0) | Cria ou soma o lote (lote, validade) no local. Origem do lote/validade, nesta ordem: 1) contexto da transação (`estoque.lote`/`estoque.validade`, usado por `registrar_entrada_lote`), 2) compra: colunas `lote`/`validade` do item (`compras_proprio_itens`), ou o mapa da transação de `lancar_compra_com_lotes`, 3) OP (`ref = 'OP:<id>:<n>'`): lote = número da OP, validade da OP, 4) sem validade: `produtos.validade_dias` (entrada + N dias) para compra, produção e entrada manual. Sem nada: "saldo sem lote". |
| Saída (qtd < 0) | FEFO: validade mais próxima primeiro, sem validade por último, depois o "sem lote" (pode ficar negativo). `estoque.lote_id` na transação dirige a saída a um lote (baixa por vencimento). |
| Estorno (`reverses_id`) | Espelha exatamente os lotes do movimento original (devolve ao mesmo lote). |
| Transferência | A perna de saída consome FEFO na origem; a de entrada recria os MESMOS lotes (lote e validade) no destino. |

## Funções novas (só `service_role`)
- `registrar_entrada_lote(...)`: entrada manual com lote/validade.
- `lancar_compra_com_lotes(p_compra, p_local, p_user)`: `lancar_compra` + lote/validade por item (compra manual).
- `baixar_lote(loja, lote_id, quantidade, motivo, ref, user)`: saída origem `PERDA` dirigida ao lote; motivo obrigatório; não deixa baixar mais que o lote tem.
- `reconciliar_lotes(loja)`.

## Onde o lote nasce na tela
- Nota fiscal da SEFAZ/XML: o grupo `rastro` (nLote, dVal) é lido do XML (`lerNfe`); com vários lotes no item, entra o de validade mais próxima e a nota ganha um aviso. Na conferência, cada item tem Lote/Validade editáveis até a entrada.
- Compra manual (`/nota-fiscal/nova`): Lote/Validade por item.
- Entrada manual (Estoque → produto): Lote/Validade opcionais.
- OP: a validade da criação (dias por item) já existia; sem ela, vale o prazo do produto.
- Produto: campo "Validade (dias)".

## Tela Validade (modo próprio)
Cartões (vencidos, vencem até o alerta, sem validade, valor), linha do tempo clicável (vencidos, hoje, até 7, 8–30, 31–60), pílulas (Vencidos, Vence hoje, 7/15/30/60 dias, Sem validade, Todos), filtros (produto, tipo, família, grupo com descendentes, local), lista por lote (produto, lote, local, validade com "há/em X dias", quantidade, valor pelo custo médio), "Dar baixa" por lote (quantidade, motivo), exportação CSV com os mesmos filtros, alerta configurável (`estoque_config.validade_alerta_dias`, padrão 7) e aviso de divergência com "Acertar lotes". Alertas também no Início e na Reposição.

## Fora de escopo / limites
- FEFO é automático; não há escolha manual do lote na venda/OP.
- Um item de NF com vários lotes entra como um só (o de validade mais próxima).
- Etiqueta de lote/validade e sugestão de OP pelo vencimento não foram feitas.
