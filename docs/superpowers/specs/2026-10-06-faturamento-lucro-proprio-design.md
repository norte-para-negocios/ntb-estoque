# Faturamento e lucro das lojas independentes (modo `proprio`) — Design

Parte do plano mestre `docs/superpowers/plans/2026-10-06-independencia-do-estoque-plano-mestre.md` (R7).

## Como os relatórios de hoje obtêm faturamento (pesquisa)

- **Pré-agregado** `faturamento_importado(loja_id, dimensao, rotulo, mes, valor)`, PK `(loja_id, dimensao, rotulo, mes)`. Dimensões: `tipo`, `familia`, `produto`, `tipo>familia` e `familia>produto` (rótulo composto `pai>>filho`), mais `forma_pgto` que só vem do import manual do FAT_DRV. Escrito por `syncFaturamento` (`lib/omie/faturamento.ts`) a partir dos cupons fiscais do Omie; mês corrente e anteriores do ano são apagados e regravados a cada rodada. Meta em `faturamento_import_meta`.
- **Fato granular** no Postgres do Contabo (`ntb_frio`): `fat_cupons`, `fat_cupom_itens`, `fat_cupom_pagamentos`, escrito por `POST /fat_cupons_bulk` da `ntb-frio-api` (upsert por `(loja_id, n_id_cupom)`, lotes de 200) e lido por `lib/faturamento-frio.ts` (`buscarFatCupons`, `buscarFatAgregado`). Alimenta a aba "Forma de pgto", o filtro de Situação, "Ver cupons" e o drill por produto. `tipo_doc` usa as siglas do Omie (`PIX`, `CRC`, `CRD`, `DIN`, `99999`), traduzidas para rótulos por `FORMA_PGTO_LABEL`.
- **Consumidores:** `relatorio-faturamento`, `relatorio-indicadores` (Faturamento × Compras), `pendencias-classificacao`, `lib/dashboard-gerencial.ts`, `lib/movimentacao-operacao-auto.ts`, resumo e home. Todos leem esses dois lugares, nunca o Omie direto.
- **Margem** (`relatorio-margem`): preço de venda (`produtos.valor_unitario`) contra o custo médio de `posicao_estoques.n_cmc`, e uma série diária em `margem_snapshot_diario`. É margem teórica de cadastro, não lucro realizado.

## Decisão

Para lojas `proprio`, o Estoque produz **exatamente o mesmo contrato**, de modo que os relatórios atuais funcionem sem mudança de tela, e acrescenta o **lucro realizado**.

1. **Fonte de verdade da venda no Estoque:** `vendas_proprio` (cabeçalho), `vendas_proprio_itens`, `vendas_proprio_pagamentos` no Postgres do Estoque, idempotente por `(loja_id, pedido_ref)`. O Norte Vendas envia no fechamento (`POST /api/integracao/venda/fechamento`, mesma chave da loja) e reenvia por varredura até confirmar. Cancelamento/estorno do pedido marca a venda como cancelada.
2. **Pré-agregado:** a função SQL `recalcular_faturamento_proprio(loja, mes)` reconstrói as 5 dimensões de `faturamento_importado` do mês a partir dos itens (tipo/família/produto vêm de `produtos`), igual à lógica do `syncFaturamento` (cancelada e devolvida fora). Chamada a cada fechamento. `forma_pgto` agregada no mesmo passo a partir dos pagamentos, com os rótulos do import manual (Dinheiro, Pix, Cartão de Crédito, Cartão de Débito, Outros).
3. **Fato do Contabo:** o Estoque reenvia a venda para `POST /fat_cupons_bulk` (endpoint existente, só essas três tabelas), com `n_id_cupom` numérico próprio (sequência ≥ 8e12, guardado em `vendas_proprio`), `tipo_doc` nas siglas do Omie. Falha do Contabo não perde nada: a venda já está em `vendas_proprio` e o reenvio roda por varredura (`frio_enviado_em` nulo).
4. **Lucro:** CMV por item = `−Σ quantidade × custo_unitario` dos movimentos do ledger da venda (`origem='VENDA'`): venda direta tem `ref = pedido`, venda por receita tem `ref = pedido|produto|linha`; estornos entram como movimentos inversos, então o CMV líquido já considera cancelamento. A função `lucro_proprio(loja, ini, fim, dimensao)` devolve faturamento, CMV, lucro e margem por produto, família, tipo, dia ou local. Venda sem baixa (produto sem código ou ainda sem custo) aparece como "custo não apurado", nunca como lucro 100%.
5. **Custo teórico no relatório de margem:** produto vendável com ficha técnica não tem saldo próprio (o custo está nos insumos); em modo `proprio` o relatório de margem usa o custo da ficha (`custo_unitario_ficha`) quando o custo médio do próprio produto é zero.
6. **Tela nova** `Lucro` (modo `proprio`): KPIs (faturamento, CMV, lucro, margem, ticket), evolução diária, ranking por produto/família/tipo/local com ordenação e busca, aviso de vendas sem custo, exportação Excel. Menu só em modo `proprio`. Lojas `omie` e `nenhum` não mudam.

## Contrato Vendas → Estoque (`POST /api/integracao/venda/fechamento`, Bearer `integracao_api_key`)

```json
{ "pedidoRef": "<order uuid>", "data": "2026-10-06", "hora": "21:04:56", "tipo": "mesa|balcao", "mesa": "12",
  "cancelado": false, "valor": 331.54, "desconto": 0, "taxa": 30.14, "operador": "Nome",
  "nota": { "chave": "44 dígitos|null", "numero": 140, "serie": 1, "status": "autorizada|null" },
  "itens": [ { "linha": 1, "codigo": "90005", "nome": "Caipirinha", "quantidade": 1, "valorUnitario": 22, "desconto": 0, "valor": 22, "ncm": "22089000", "cfop": "5102" } ],
  "pagamentos": [ { "sequencia": 1, "metodo": "CREDIT|DEBIT|PIX|CASH|COURTESY", "valor": 331.54, "bandeira": "elo" } ] }
```

Resposta: `{ ok, venda_id, n_id_cupom, duplicado, frio: 'enviado|pendente' }`. Reenviar o mesmo `pedidoRef` substitui itens e pagamentos (venda ainda aberta de ajuste) sem duplicar; `cancelado:true` marca cancelada.

## Casos de borda (viram teste)

Reenvio do mesmo pedido; pedido cancelado depois de enviado; item de taxa (fee) entra como item com `codigo` de taxa; produto sem código (entra como "Produto não identificado", como no Omie); pagamento dividido; cortesia (valor sem entrada em pagamento); Contabo fora do ar; mês corrente apagado e refeito sem tocar meses anteriores; lojas `omie`/`nenhum` não passam por nada disso.
