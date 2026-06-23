# Plano completo dos relatórios NTB (espelhar as planilhas DRV do Ramon)

Data: 2026-06-22
Status: roadmap aprovado pelo fundador (decomposição OK); aguardando review do spec do Módulo 0

## Contexto

As 5 planilhas DRV do Ramon (varridas aba por aba) são **3 fontes + 2 cruzamentos**:

- **NFS_ENT** (Compras, NF de entrada, 32 abas): matrizes por fam/forn/prod/tipo +
  auditoria fiscal (ICMS/ST, CFOP errado, ICMS indevido, flags Gera Estoque / Gera
  C a Pagar). BD = 169 campos do Omie por item.
- **MOV** (Movimentação/consumo): baixas por tipo SPED em R$ mês a mês, ent/saídas
  por produto. Temos o dado (ListarMovimentos → movimentos_historico).
- **FAT** (Faturamento/vendas PDV): margem por produto, fat por família/tipo/forma
  de pgto/cupom, +/− vendidos, diário. É NFC-e de venda (cupom).
- **COMVSFAT** e **IND_PER**: cruzam Faturamento × Compras (por tipo SPED, % vs limite,
  Fat × Rejeição).

Já feito: Compras (tela matriz + "Baixar tudo" com 6 abas + filtro por fornecedor +
sugestão de compra por fornecedor). Ver [[project_ntb_relatorios]].

## Decomposição (6 módulos) — APROVADA

| # | Módulo | Depende de | Dado pronto? |
|---|--------|-----------|--------------|
| 0 | Sincronizar/derivar **Faturamento (NF de saída / NFC-e)** | — (confirmar API) | não |
| A | **Movimentação/Consumo** (baixas por tipo SPED, ent/saí) | — | sim |
| B | **Auditoria fiscal das Compras** (ICMS/ST, CFOP errado, ICMS indevido, flags) | — | sim (full_object) |
| C | **Relatório de Faturamento** | 0 | — |
| D | **Margem por produto** (preço venda × CMC) | 0 | CMC sim |
| E | **Indicadores Fat × Compras** (COMVSFAT topo + IND_PER) | 0 | — |

Dependências: 0 → C, D, E. A e B são independentes (quick wins). Cada módulo terá
seu próprio spec → plano → implementação.

**Sequência:** 0 (fundação) → A e B em paralelo → C → D → E.

---

## Módulo 0 — Faturamento (NF de saída / NFC-e)

### Por que primeiro
Destrava C, D e E (metade do trabalho). Mas tem 2 riscos que o desenho precisa resolver.

### Risco 1 — o restaurante fatura PRATO, não estoque
O faturamento são os **pratos vendidos no PDV** (produto acabado), que NÃO são item
de estoque (o que sai do estoque é a matéria-prima consumida). Logo **não dá pra
derivar faturamento de `saída × preço`** (isso só valeria pra revenda: água, cerveja).
Conclusão: faturamento real exige a **NFC-e/venda do Omie**.

### Risco 2 — volume (custo zero / free tier)
O BD bruto de vendas é gigante (cupom a cupom = centenas de milhares/milhões de
linhas/ano). Guardar item a item estoura o Supabase free tier. **Solução: agregar no
sync** — guardar resumo por (produto, dia) e por (forma de pagamento, dia), não o
cupom cru. Espelha o padrão do `movimentos_historico` (já agrega entradas/saídas/dia).

### Fase 1 (SPIKE, go/no-go) — confirmar o endpoint do Omie
A NF de entrada usa `v1/produtos/recebimentonfe`. A de saída é outro módulo. Testar
(read-only, loja 3) os candidatos do Omie para NF-e/NFC-e EMITIDA (ex.: `v1/produtos/nfe`,
`nfconsultar`, ou o módulo de cupom/PDV) e ver se retorna as vendas com valor, forma
de pagamento e item.
- **Se SIM** → segue Fase 2 (sync agregado).
- **Se NÃO** → fallback: (a) importar periodicamente o export FAT (upload manual,
  como o Ramon faz hoje) e agregar; ou (b) integrar com o sistema do PDV/André.
  O fallback NÃO trava A, B (independentes).

### Fase 2 — sync agregado
- Tabelas: `faturamento_dia` (loja_id, data, n_cod_prod, tipo_item, descricao_familia,
  qtde, valor, forma_pagamento) — agregado por produto/dia/forma; índices por
  loja_id+data. Opcional `faturamento_forma_dia` se o detalhe por forma pesar.
- `lib/omie/faturamento.ts` (syncFaturamento, paginado, agrega no cliente antes de
  gravar) + entrada no cron (rodízio 1 loja/hora, como os outros syncs).
- Reusa `omieRequest`, `logIntegrationAttempt`, padrão de `nota-fiscal.ts`.

### O que destrava
Faturamento por família/tipo/forma de pgto, +/− vendidos, margem (com o CMC que já
temos), e os indicadores Fat×Compras.

### Testes
- Spike: rodar contra loja 3 e bater o total mensal com a aba "Fat vs tipo de produto"
  do FAT_DRV (que tem os números do Ramon: jan R$861.600, etc.).
- Sync: conferir que o agregado por mês bate com o COMVSFAT "FATURAMENTO POR TIPO SPED".

### Fora de escopo (Módulo 0)
- As TELAS de relatório (são os Módulos C/D/E).
- Guardar cupom a cupom (só agregado).

---

## Próximos módulos (resumo; spec próprio quando chegar a vez)

- **A — Movimentação/Consumo:** RPC/queries em `movimentos_historico` valorizando por
  CMC; tela matriz (baixas por tipo SPED mês a mês) + ent/saídas por produto. Sem
  dependência.
- **B — Auditoria fiscal das Compras:** extrair campos fiscais do `nota_fiscal_items.full_object`
  (CFOP de Entrada × CFOP no Documento, Situação Tributária ICMS, "não deve se creditar",
  Gera Estoque, Gera C a Pagar); tela de divergências/erros. Sem dependência.
- **C — Faturamento:** telas espelhando o FAT (família/tipo/forma/cupom, +/−, diário).
- **D — Margem por produto:** preço de venda (do Módulo 0) × CMC, % margem mês a mês.
- **E — Indicadores Fat×Compras:** COMVSFAT topo + IND_PER (% comprado vs faturado por
  MR/MP/MC vs limite; Fat × Rejeição).
