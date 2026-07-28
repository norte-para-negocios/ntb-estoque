# Varredura completa da API Omie — o que já usamos, o que falta, o que não vale a pena (2026-07-19)

Pedido do usuário: "você já analisou a API? já viu todos os endpoints, literalmente
tudo, pra saber os dados que puxamos?" — resposta honesta na hora foi não, nunca
tinha sido feita uma varredura sistemática. Esta é essa varredura: 9 agentes (5 lendo
código + dado já gravado, 4 fazendo probe ao vivo na API real com credenciais de
loja 3/5), cruzados com 2 documentos anteriores já existentes no repo
(`2026-06-26-omie-varredura-spec.md`, mapeamento de 17 agentes sobre o catálogo
oficial; `2026-07-18-auditoria-api-telas-lojas.md`, auditoria tela-a-tela de ontem).

## O que já foi corrigido NESTA sessão (antes desta varredura)

Sem saber, boa parte do que os documentos de 26/06 e 18/07 já recomendavam como
"Fase 2" e "Fase 3" foi implementado hoje, motivado por um bug real (número
absurdo em Movimentação):

- **Movimentação automática pra todas as lojas** (`lib/movimentacao-operacao-auto.ts`)
  — exatamente a "Fase 2: mata o Excel MOV_DRV" do plano de 18/07.
- **Fato de faturamento por cupom** (`fat_cupons`/`fat_cupom_itens` no Contabo) —
  exatamente a "Fase 3: Faturamento fato-a-fato".
- **CFOP de entrada em Pendências de Classificação** — sugestão do cliente Ramon,
  usa dado que já existia (`full_object.itensAjustes.cCFOPEntrada`).
- Descoberto e corrigido nesse processo: teto de 5000/2000 linhas sem paginação em
  `/movimentos`, `/fat_cupons`, `/fat_cupom_itens`, `/ordens_producao`,
  `/movimentos_historico` no `ntb-frio-api` (Contabo) — nenhum endpoint tinha
  `offset`, ficavam mudos além do teto sem avisar.

## 🔴 Prioridade alta — dado real confirmado, lacuna real, vale implementar

| # | O quê | Fonte | Por quê |
|---|---|---|---|
| 1 | **Consumo de OP em R$** | `ordens_producao.full_object.itensDetalhes` (array de insumos: `nQtde`+`nIdProdutoMalha`) `JOIN produtos.valor_unitario ON codigo_produto=nIdProdutoMalha` | Fecha o "fora de escopo" que ficou em Movimentação hoje (R$0,00 em Consumo de OP). 99,6% das OPs concluídas da loja 5 têm o dado. Limitação real: alguns insumos semi-elaborados têm `valor_unitario=0` (subestima); quantidade *produzida* não é gravada separada da planejada. |
| 2 | **Contas a Pagar** (`financas/contapagar` `ListarContasPagar`) | Probe ao vivo: 552 títulos/janela testada, loja 3 | Status de pagamento e vencimento por título — hoje o relatório de Compras só lê NF, sem saber se foi pago. Dado 100% novo, não espelho de nada já capturado. |
| 3 | **Contas a Receber** (`financas/contareceber` `ListarContasReceber`) | Probe ao vivo: 3.455 títulos/janela, `chave_nfe` vincula à NF | É a fonte certa pra fechar a "aba B2B do Faturamento" que ficou pendente — cupom fiscal (PDV) não cobre venda por nota fiscal (B2B). |
| 4 | **NF-e de saída / vendas B2B** (`produtos/nfconsultar` `ListarNF`, `tpNF=1`, `cApenasResumo=N`) | 7.008 notas de saída na loja 3 (18/07) | Venda B2B por nota simplesmente não aparece em lugar nenhum hoje — só cupom PDV agregado. |
| 5 | **Custo de cartão/maquininha** | `CuponsPagamentos.nValorTaxa` (ex: R$1,56 numa venda de R$226,38 no crédito) | Lido e descartado hoje mesmo na ingestão do fato de cupom. Não existe NENHUMA visão de custo de adquirente no app — é relatório novo, não conserto. |
| 6 | **Conta Corrente por banco** (`geral/contacorrente` `ListarContasCorrentes`) + **Extrato** (`financas/extrato`) | 39 contas reais (Santander, Itaú, aplicação...) | Resolve limitação já documentada no card financeiro "hoje": `contaCorrente.vTotal` é um saldo agregado sem dizer de qual banco. Extrato dá conciliação linha a linha. |

## 🟡 Prioridade média — quick wins de baixo esforço

- **Fase 1 do plano de 18/07** (não mexi nisso hoje): ~20 filtros que faltam em
  quase todo relatório onde a coluna JÁ EXISTE no banco (nota-fiscal: CNPJ/chave/
  modelo/faixa de valor; ordem-producao: filtro por local; movimentacoes: tipo/
  status/motivo; transferencia: responsável; inventario: família/tipo multi-select;
  produto: filtro por local; compras: fornecedor multi-select; auditoria-fiscal:
  CST/categoria; margem: série mensal já existe na tabela e só mostra o último mês;
  estoque-valorizado: escolher a data da foto, série já existe) — + 4 bugs
  específicos (sort perde família/local em nota-fiscal, OP sem previsão some do
  filtro, export ignora filtros em vários relatórios). Ver seção C/D do doc de 18/07
  pra lista completa.
- **`fisico`/`reservado`/`nPendente`** de `posicao_estoques` — já gravado no banco,
  nunca lido por nenhuma tela. Expor sem nova chamada à Omie.
- **Vendedores/Projetos como filtro em Faturamento** — dado real existe (14
  vendedores, 7 "projetos" que na prática são canal de venda: Balcão/Salão/
  Delivery Plataformas/Delivery Próprio), zero uso hoje.
- **CBS/IBS, parcelas de pagamento, frete, ICMS-ST** dentro do `full_object` de NF
  — já gravado, nunca lido. Parcelas serviria de base pra contas a pagar sem nova
  chamada.
- **`quantidade_estoque`** do próprio Omie em `produtos.full_object` — nunca
  cruzado com o cálculo interno do app; poderia virar alerta de divergência.
- **`bloquear_faturamento`** em clientes/fornecedores — flag já gravada em
  `full_object`, nunca vira alerta na tela.

## 🟢 Testado ao vivo e confirmado SEM DADO REAL — não implementar agora

- **`ConsultarPrevisao`** (previsão nativa Omie) — testado com produtos de alto
  giro e com produto inexistente: resposta idêntica (`nQtdePrevista:0` sempre).
  É campo manual nunca configurado pelas lojas, não uma previsão calculada. A
  previsão interna do app (`previsao-venda.ts`, ano-a-ano) continua sendo a única
  fonte real.
- **`produtoslote`/validade de produto comprado** — endpoint existe e a
  documentação da Omie confirma que É pra isso (recebimento de NF/nota de
  entrada/devolução), mas retornou **zero lotes cadastrados** nas lojas 3 e 5.
  Achado importante: não é lacuna do app, é que as lojas nunca ativaram/preenchem
  controle de lote na entrada de NF dentro do próprio Omie. Implementar leitura
  hoje não traria nenhum dado — precisaria primeiro mudar o processo operacional
  nas lojas.
- **Tabela de Preços** (`tabelaprecos`) — vazia nas 2 lojas testadas.
- **Pedido de Compra** (`pedidocompra`) — vazio, lojas compram direto por NF.
- **Características de produto** (`prodcaract`) — endpoint funciona, sem dado
  cadastrado.

## ⚠️ Descarte permanente de dado (arquitetural — diferente de "não lido")

Diferente dos casos acima (dado gravado em `full_object`, só não lido), estes
dois domínios **não guardam a resposta bruta da Omie em lugar nenhum** — qualquer
campo que a Omie devolva além do que já está mapeado em colunas é perdido pra
sempre, sem chance de recuperar depois:

- **Movimentos/Ajustes** (`movimentos`, `movimentos_historico`) — só 11 campos
  são lidos de `ListarAjusteEstoque`. `obs` guarda texto livre rico (usuário,
  vínculo com cupom/PDV) mas sem estrutura.
- **Cupons fiscais** (`fat_cupons`/`fat_cupom_itens`/`fat_cupom_pagamentos`) —
  perde totais fiscais do cupom, PIS/COFINS/ICMS por item vendido (o espelho, do
  lado venda, do que a Auditoria Fiscal já faz do lado compra), parcela/
  vencimento/ID de título do pagamento, e o próprio `nValorTaxa` do item 5 acima
  (é lido no cálculo mas descartado antes de gravar).

Se algum dia esses campos importarem, a captura tem que ser adicionada ANTES —
não dá pra "olhar pra trás" e recuperar o que já rodou sem full_object salvo.

## ⚪ Confirmado fora de escopo / impossível via API

- `forma_pgto` por cupom — só vem via FAT_DRV (Excel manual), API não traz.
- Margem calculada pelo Omie — só via export manual FAT_DRV.
- DRE com valores — API só devolve o cadastro de contas, não o relatório calculado.
- Ativar controle de lote — não existe call de escrita pra isso, é manual no Omie.
- CRM, Ordem de Serviço, NFS-e, Contratos, PIX, Boleto — fora do modelo de negócio
  (restaurante/distribuidora vende produto, não presta serviço faturado).

## Recomendação de ordem

1. Consumo de OP (#1) — fecha o que ficou pendente hoje mesmo, já tenho o mapeamento exato do `full_object`.
2. Contas a Pagar + Contas a Receber (#2, #3) — mesmo padrão de leitura, resolvem duas lacunas relacionadas (Compras e Faturamento B2B).
3. NF-e de saída (#4) — depende de Contas a Receber pra fazer sentido completo (join por `chave_nfe`).
4. Custo de cartão (#5) e Conta Corrente/Extrato (#6) — mais isolados, podem vir em paralelo.
5. Fase 1 (quick-wins de filtro) — mecânico, pode intercalar com o resto.
