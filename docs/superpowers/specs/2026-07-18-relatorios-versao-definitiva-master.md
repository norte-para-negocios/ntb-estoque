# Relatórios — versão definitiva (spec mestre consolidado)

Consolidação de 12 investigações paralelas (3 sondas de área na API real do
Omie + 9 "donos de relatório" — um por tela do hub `/relatorios`, cada um
lendo o código atual E testando a API com credenciais reais). Ponto de
partida: `docs/superpowers/specs/2026-07-18-auditoria-api-telas-lojas.md`
(auditoria de código). Este documento é o que muda depois de testar tudo.

## 0. Os 5 achados que mudam o roadmap

1. **`ListarAjusteEstoque` tem o movimento granular perfeito e metade já
   está ingerida** — 453.866 registros na loja 3 com produto+local+data+
   origem(AJU/PDV)+tipo+valor. O sync já grava isso em `movimentos`, mas
   **hardcoda `origem:'AJU'`** mesmo quando a API manda `'PDV'`
   (`lib/omie/sync-ajustes.ts:66`) — conserto de **uma linha**. Filtro por
   `origem=` na API funciona (confirmado: `origem=PDV` → 437.134 de
   453.866 registros); filtro por data não existe (paginação crua).
2. **Forma de pagamento do PDV vem de graça** — a mesma chamada `CuponsFiscais`
   que já paginamos todo dia devolve `pagamentosCupom[]` (tipo de doc,
   valor, categoria, conta corrente) e existe ainda a call irmã
   `CuponsPagamentos` com o código de meio de pagamento oficial (dinheiro/
   crédito/débito/PIX), bandeira, adquirente e taxa por parcela. **Isso
   mata o Excel FAT_DRV manual de forma de pagamento.**
3. **Nossa margem calculada bate com o Excel do Ramon** (diferença 0,00–
   0,37 p.p. testado nas 155 linhas reais) e é **melhor** nos casos de CMC
   podre. Dá pra ter margem automática em todas as lojas hoje, sem Excel.
4. **"Produto não identificado" no Faturamento é 68–86% do faturamento em
   TODAS as lojas** (R$1,9M a R$4,2M) — não é um detalhe, é a pendência
   dominante do sistema e é provavelmente a origem visual da sua queixa de
   "número gigante sem classificação".
5. **O financeiro do Omie (150k títulos / 396k lançamentos) está 100%
   não-consumido** — fluxo de caixa projetado e DRE mensal já vêm prontos
   do Omie (`ObterResumoFinancas`, `ListarOrcamentos`), sem precisar somar
   nada do nosso lado.

## 1. Infraestrutura transversal (destrava vários relatórios de uma vez)

### 1.1 Corrigir a origem em `movimentos` (Fase 2 do spec anterior)
`lib/omie/sync-ajustes.ts`: gravar `a.origem` real em vez de hardcode.
Reprocessar via `scripts/sync-ajustes-omie.mjs <loja> --reset --full` (upsert
já corrige linhas existentes). Equalizar backfill entre lojas (L4 tem só 238
registros vs L2/L3/L6 com 100k+). Dual-write pro Contabo (hoje só Supabase).

### 1.2 Fato de faturamento por cupom (Fase 3 do spec anterior, mais barato do que se pensava)
Gravar no Contabo (não no Supabase — volume ~1M linhas/ano nas 5 lojas):
`fat_cupons` (1/cupom, com hora), `fat_cupom_itens` (1/item, com quantidade),
`fat_cupom_pagamentos` (1/parcela, com forma de pagamento). O sync já pagina
tudo isso hoje e descarta — é parar de descartar + endpoint agregador novo na
`ntb-frio-api`. Destrava: grão diário/hora, quantidade, ticket médio, forma de
pagamento automática, filtros cruzados de verdade.

### 1.3 Margem automática (sem Excel)
Nova consulta: `produtos.valor_unitario` (tipos 04-Acabado + 00-Revenda) ×
CMC da última foto de `posicao_estoques`, mesma fórmula da RPC
`relatorio_estoque_valorizado` (063). Cobertura imediata: 556–850 produtos
por loja. Manter o import Excel só como conferência da loja 3 até confiança
estabelecida com o Ramon.

### 1.4 Parar a poda de `posicao_estoques` + backfill retroativo
`lib/omie/posicao-estoque.ts:202-234` apaga tudo além das 2 fotos mais
recentes — mata a série histórica de valorização/margem a cada sync. Trocar
por: dual-write da foto completa no Contabo + agregado diário compacto no
Supabase. Backfill: `ListarPosEstoque` aceita `dDataPosicao` retroativo
(confirmado) — reconstituir 1 foto/mês desde jul/2025.

### 1.5 Financeiro (novo território)
Sync incremental de `financas/mf` (Contabo, alto volume) + `geral/categorias`
(pequeno, Supabase) + card "hoje" via `ObterResumoFinancas` (1 chamada,
sem sync). Cuidado: saldo de conta corrente retornou **−R$1,81M** na sonda —
parece conta não conciliada no Omie; validar com o Ramon antes de exibir
qualquer saldo.

## 2. Proposta por relatório (resumo — cada um com plano detalhado do agente dono)

| Relatório | Vira | Já / Depois |
|---|---|---|
| **Movimentação** | Fato unificado (PDV+perda+inventário+compra+OP) com local real e dia; 2 modos viram 1 com dimensão pivotável; drill operação→local→família→produto→extrato | Já: fix de 1 linha + quick wins de UI. Depois: fato unificado (depende de 1.1) |
| **Compras** | + evolução de preço unitário (produto/fornecedor), comprado×pago (contas a pagar), fornecedor/NCM/faixa de valor como filtro | Já: **2 bugs de export** (frio ausente + filtros ignorados) — corrigir sempre. Depois: comprado×pago |
| **Faturamento** | Fato por cupom: grão diário/hora, forma de pagamento automática, ticket médio, quantidade, filtros cruzados; aba B2B (NF-e de saída, com margem via CMC) | Já: destrava tudo com 1.2. Depois: aba B2B |
| **Margem** | Automática em todas as lojas (1.3), série mensal exibida, alerta "abaixo do custo" | Já: quase tudo. Depois: snapshot mensal nativo (1.4), lucro R$ ponderado por qtd vendida |
| **Estoque Valorizado** | Comparador entre datas, giro de estoque, capital parado, correção do "total" que hoje soma só as 500 linhas exibidas | Já: correção do total + giro/DDE (usa `movimentos_historico`, já existe). Depois: série histórica (1.4) |
| **Indicadores (Fat×Compras)** | Vira "Saúde do Negócio": abas Compras×Vendas / Caixa / Categorias-DRE / Pontualidade / comparativo entre Lojas | Já: card "hoje" (`ObterResumoFinancas`) + meta configurável. Depois: abas novas (1.5) |
| **Auditoria Fiscal** | R$ de ICMS creditado/perdido (não só contagem), filtros CST/categoria/credita/estoca, aba de conciliação (Omie vs banco local) | Já: export honrando filtros+frio (bug) + R$ ICMS (já no `full_object`). Depois: conciliação |
| **Resumo do dia** | Painel de ação: erros que exigem ação, NF travada, OP atrasada, vencendo, contagem pendente, classificação — tudo rankeado, com card de saúde do sync | Já: quase tudo (dado 100% existente) |
| **Pendências de classificação** | + bloco "cupom não identificado" (achado #4 — o mais importante), saldo sem CMC, sem preço de venda; busca/ordenação/período configurável | Já: quase tudo |

## 3. Ordem de execução recomendada

**Onda 1 (maior impacto, menor esforço — atacar primeiro):**
1. Fix de 1 linha na origem do sync de ajustes (1.1).
2. Bugs de export em Compras e Auditoria Fiscal (ignoram filtro+frio).
3. Margem automática pra todas as lojas (1.3).
4. Bloco "cupom não identificado" em Pendências + investigar a causa raiz
   (provavelmente `idProduto` do cupom não casa com `codigo_produto` — checar
   se é `codigo` em vez disso).
5. Resumo do dia → painel de ação.
6. R$ de ICMS na Auditoria Fiscal.

**Onda 2 (precisa de 1 migration/sync novo cada):**
7. Fato de faturamento por cupom (1.2) — desbloqueia Faturamento inteiro.
8. Fato unificado de Movimentação (usa 1.1 já corrigido).
9. Card financeiro "hoje" + meta configurável nos Indicadores.

**Onda 3 (backfill/infra mais pesada):**
10. Parar poda de posição + backfill de série histórica (1.4).
11. Sync incremental do financeiro (1.5) → abas novas dos Indicadores.
12. Aba B2B do Faturamento (NF-e de saída).
13. Conciliação fiscal.

## 4. Notas de investigação (não repetir)

- Pedido de compra, requisição de compra e nota de entrada manual: **zero
  registros nas 2 lojas testadas** — não vale construir relatório em cima.
- Pedido de venda: módulo morto (1 registro na loja 2, 0 na loja 3).
- Remessa entre lojas: 1 registro histórico — não sustenta relatório de
  transferência via API (a tabela `transferencias` do próprio app é a fonte
  certa, já em uso).
- `contador/xml` só traz documentos **emitidos** (não concilia compras).
- API não filtra por data em `ListarAjusteEstoque` — backfill por paginação
  crua com checkpoint (script já existe).
