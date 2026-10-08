# Faturamento: nova tela com período na cara, ranking de produtos e filtros que valem em tudo

Data: 2026-10-08 · Origem: reclamação do cliente na tela `/relatorio-faturamento` · Classificação: arquitetural (tela principal nova)

## Problema (relato do cliente, confirmado na tela)

1. Escolher período exige abrir "Filtros" ou usar chips de meses. Não há seletor de mês.
2. "Por dia" vira uma coluna gigante (sem escolher o mês).
3. Em "Produto" só existe uma matriz por mês: não há ranking de mais/menos vendido, gráfico, nem clique no produto para ver o faturamento dele.
4. Filtro de tipo/família não vale quando se olha por produto (o relatório documenta que cada filtro só vale na aba da própria dimensão), então "não aparece direito".

## Solução

Nova rota `/faturamento` (o card "Faturamento" em Relatórios passa a apontar para ela). A tela antiga continua em `/relatorio-faturamento` e é linkada como "Evolução mensal, forma de pgto e cupons".

Layout, de cima para baixo:
- **Barra de período** sempre visível: `◀ Outubro 2026 ▶`, atalhos (Hoje, Ontem, 7 dias, Este mês, Mês passado, Ano) e datas livres. Padrão: mês atual até hoje. Máximo 366 dias (mantém o trecho mais recente, com aviso).
- **Filtros inline**: Tipo (multi), Família (multi), Situação (Vendas válidas [padrão, sem canceladas, devolvidas incluídas] | Só devolvidas | Só canceladas). Valem em todas as abas.
- **Cards**: Faturado, Cupons, Ticket médio, Melhor dia.
- **Abas**: Produtos | Famílias | Tipos | Por dia.
  - Produtos/Famílias/Tipos: ranking com barras de participação, busca, alternar Mais vendidos | Menos vendidos, ordenar por R$ ou quantidade. Clicar num produto abre o detalhe (faturamento, quantidade, preço médio, posição no ranking, % do total e gráfico dia a dia dele no período).
  - Por dia: gráfico + tabela do período escolhido (um mês por vez no padrão).
- Botão Baixar: Excel do ranking atual.

## Dados

Uma única leitura de itens vendidos por período, agrupada em memória:
- Loja Omie: `fat_cupons` + `fat_cupom_itens` (Contabo) + `produtos` (tipo, família, nome). Valor do item = `v_item`, ou `v_unit × quant − v_desc` quando `v_item` vem zerado.
- Loja de estoque próprio: `vendas_proprio` + `vendas_proprio_itens` + `produtos`.
- Situação: válidas = não cancelado (devolvido incluído, igual ao total mensal); devolvidas = devolvido e não cancelado; canceladas = cancelado.
- Validação: a soma dos itens de um período bate com a soma dos cupons (conferido em set/2026, lojas 2, 3, 5).

## Fora de escopo

Forma de pagamento, evolução mensal, cupons e descontos continuam na tela antiga. Sem comparação com período anterior nesta versão. Sem migration.

## Verificação

Funções puras com `node --test`. Em produção: soma do ranking = soma dos cupons do período; filtro de tipo/família reduz o ranking em todas as abas; clicar no produto mostra o mesmo total da linha; uma loja Omie e (se houver venda real) uma de estoque próprio.
