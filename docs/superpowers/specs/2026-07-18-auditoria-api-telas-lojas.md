# Auditoria completa: API Omie × telas × lojas (2026-07-18)

Pedido: "verifique tudo que a API dá, veja todos os endpoints e puxe os dados;
olhe cada relatório individualmente, cada tela, se tá tudo com filtros; em
todas as lojas; veja se a API dá dados pra formar cada relatório, mínimo de
cada um". Método: 2 agentes de pesquisa (catálogo oficial da API + auditoria
tela-a-tela do código) + sondas com credenciais reais (loja 3) + matriz de
contagens nas 2 bases (Supabase + Contabo).

## A. Descobertas de DADOS (testadas com chamadas reais, não suposição)

### A1. O movimento granular que "não existia" EXISTE — e metade já está ingerida
`estoque/ajuste → ListarAjusteEstoque` retorna **453.866 registros na loja 3**
com `id_prod + codigo_local_estoque + data + origem (AJU/PDV) + tipo
(ENT/SAI/SLD) + quantidade + valor` — inclui as VENDAS DE PDV movimento a
movimento, com local. Isso contradiz a premissa de que "movimento por
produto+local+operação+dia só existe no Excel MOV_DRV":

- O `sync-ajustes` (cron) JÁ ingere esses registros na tabela `movimentos`
  (25k/loja na janela quente), MAS com 3 defeitos:
  1. **`origem` hardcoded 'AJU'** (`lib/omie/sync-ajustes.ts` linha ~66) — as
     vendas PDV entram mislabeled como ajuste manual.
  2. **Backfill desigual por loja**: Contabo tem loja 2 desde jun/2025 (115k),
     loja 3 desde ago/2025 (129k), mas loja 4 só desde jun/2026 (238!) e
     loja 5 desde fev/2026.
  3. **Sem dual-write**: o sync grava só no Supabase; o Contabo só recebe o
     que passa por webhook → histórico do Contabo defasado (loja 3 para em
     28/jun no frio, mas o quente vai até hoje).
- Consequência se corrigir: **modo operação automático pra TODAS as lojas**
  (hoje: Excel manual, só loja 3, sem produto, sem dia) e filtro de local
  REAL no Histórico (hoje: proxy por posição).

### A2. Financeiro inteiro disponível e 100% não-consumido
- `financas/mf → ListarMovimentos`: **396.780 movimentos** unificados
  (pagar+receber+conta corrente) com categoria, status, datas, parcela.
- `financas/contapagar`: 23.574 títulos (custo real por fornecedor/categoria).
- `financas/contareceber`: 126.576 títulos.
- `geral/categorias`: 147 categorias com estrutura DRE.
- Daria um relatório financeiro novo (fluxo de caixa, custo por categoria,
  previsto×realizado via `financas/caixa ListarOrcamentos`).

### A3. NF-e de SAÍDA invisível hoje
`produtos/nfconsultar → ListarNF`: **7.008 notas de saída** (com itens,
totais, destinatário) na loja 3. O app só vê entrada (recebimentos) + cupom
PDV agregado — venda B2B por nota não aparece em lugar nenhum.

### A4. Resumos prontos funcionam
`ObterResumoCompras` e `ObterResumoProdutos` retornam painéis agregados
prontos (testados OK). `PesquisarPedCompra` vazio na loja 3 (não usam pedido
de compra). Catálogo completo de ~120 endpoints por área: ver o resultado do
agente no histórico desta data (compras, vendas, financeiro, fiscal,
estoque — com marcação do que já usamos).

## B. Matriz de cobertura por loja (contagens reais, 2026-07-18)

| Loja | Produtos | NF 90d | OPs | MovHist | Fat dims | Mov.Operação | Margem | Posição | Inv | Transf |
|---|---|---|---|---|---|---|---|---|---|---|
| 2 | 2.693 | 404 | 7.697 | 5.256 | 5 | **0** | **0** | 9.050 | 37 | 46 |
| 3 | 2.313 | 520 | 15.412 | 20.892 | 6 | 1.692 | 155 | 8.672 | 3 | 14 |
| 4 | 2.512 | 249 | 6.878 | 12.860 | 5 | **0** | **0** | 7.282 | 29 | 87 |
| 5 | 2.510 | 599 | 10.529 | 23.804 | 5 | **0** | **0** | 7.352 | **0** | **0** |
| 6 | 2.869 | 490 | 11.330 | 14.520 | 5 | **0** | **0** | 8.050 | 34 | 158 |
| 7 | 693 | 0 | 71 | 40 | 0 | 0 | 0 | 2.956 | 0 | 0 |

Leituras: **modo operação e margem só existem na loja 3** (dependem de import
manual de Excel — não é bug, é pipeline manual); `forma_pgto` no faturamento
idem (FAT_DRV); loja 5 não usa inventário/transferência no app; loja 7
praticamente sem operação. Movimentos granulares no Contabo: L2 115k, L3
129k, L5 51k, L6 104k, L4 só 238 (backfill faltando), L7 3k.

## C. Filtros/capacidades faltantes por tela (auditoria de código)

Quick wins (colunas EXISTEM, só falta expor):
- **nota-fiscal**: filtros por CNPJ, chave NFe, modelo/série, faixa de valor,
  CFOP do item, NCM; BUG: `buildSortHref` perde `familia`/`local` ao ordenar.
- **ordem-producao**: filtro por local (`identificacao_codigo_local_estoque`
  existe e não é filtrável AQUI), por falha de conclusão; BUG: OPs sem data
  de previsão somem do filtro de período (TODO no código).
- **movimentacoes/Movimentos**: filtro por tipo de movimento (ENT/SAI/SLD/
  TRF/TPQ), status, motivo; multi-select local/família; com local ativo,
  OP/NF/inventário somem (documentado no código).
- **transferencia**: filtro por responsável; origem vs destino separados;
  export ignora família/tipo/produto/local.
- **inventario**: família/tipo virarem multi-select; filtro "com erro de
  integração"; filtro por responsável; export ignora filtros novos.
- **validade**: multi-select; range livre de datas; export inexistente;
  paginação (LIMITE 200).
- **produto**: filtro por local (dado existe em posicao_estoques!); NCM;
  **tela de posição POR LOCAL não existe** (dado bruto = produto×local×dia).
- **relatorio-compras**: fornecedor como multi-select (hoje texto); NCM;
  faixa de valor; export ignora produto/local.
- **auditoria-fiscal**: filtro por CST, por categoria de CFOP, por
  credita/não-estoca; export ignora TODOS os filtros exceto datas.
- **relatorio-margem**: série mensal EXISTE na tabela e não é exibida (só o
  último mês); ordenar por PDV/CMC; faixa de margem.
- **relatorio-estoque-valorizado**: escolher a DATA da foto (série histórica
  existe!); comparação entre datas; agrupar por local; export; ordenação.
- **relatorio-movimentacao (quantidade)**: a RPC aceita `p_dim` tipo/família
  mas a tela fixa produto; matriz por dia; valor R$ calculado e descartado.
- **relatorio-faturamento**: filtros não cruzam dimensões (limite do
  pré-agregado — ver D3); grão diário; quantidade vendida.
- **pendencias-classificacao**: busca/ordenação/período configurável.
- **resumo**: produto/família nas listas; "Sem contagem" fixa 30d.

## D. Plano proposto (fases independentes)

### Fase 1 — Quick wins de filtro/UI (só código, sem dado novo)
Tudo da seção C que não depende de pipeline: ~20 filtros + 4 bugs (sort perde
filtro, OP sem data, exports ignorando filtros, margem série mensal).

### Fase 2 — Movimentação completa automática (mata o Excel MOV_DRV)
1. `sync-ajustes`: gravar `origem` real do campo da API (migration pra
   coluna aceitar PDV/AJU; refazer rótulos).
2. Backfill por loja via `ListarAjusteEstoque` (direto no Contabo, e janela
   quente no Supabase) — equaliza L4/L5/L7.
3. Dual-write do sync (ou backfill periódico) pro Contabo não defasar.
4. Reescrever o modo operação sobre `movimentos` + NF + OP (todas as lojas,
   automático, com produto E dia); manter o import Excel só como conferência.
5. Histórico/relatório quantidade: local REAL em vez do proxy.

### Fase 3 — Faturamento fato-a-fato
Gravar o fato por item de cupom (Contabo, volume alto) na ingestão que hoje
descarta → filtros cruzados (família ∧ forma), grão diário, quantidade
vendida. `forma_pgto` continua só via FAT_DRV (API não traz — confirmado).

### Fase 4 — Território novo (dados que nunca usamos)
- Relatório financeiro: fluxo de caixa/custo por categoria via `financas/mf`
  + `geral/categorias` (+ previsto×realizado via `ListarOrcamentos`).
- Vendas B2B: NF-e de saída (`ListarNF`) num relatório/aba própria.
- (Opcional) `ObterResumoCompras/Produtos` pra cards da home.

### Fora (confirmado impossível via API)
- `forma_pgto` por cupom via API (só FAT_DRV manual).
- Margem calculada pelo Omie via API (só export FAT_DRV).
- Validade de produto comprado (Omie não fornece em recebimento).
