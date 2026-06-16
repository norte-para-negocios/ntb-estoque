# Auditoria de cobertura do sync (Bloco 1.3) — 16/06/2026

Conferência: cada campo relevante do `full_object` do Omie está persistido em coluna
própria? Tabelas com `full_object`: `produtos`, `notas_fiscais`, `nota_fiscal_items`,
`ordens_producao`, `local_estoques`, `lojas`. As `posicao_estoques`/`movimentos`/
`inventarios`/`transferencias` são mapeadas direto (sem `full_object`).

## Gaps preenchidos agora (migration 012, backfill do próprio full_object)

| Tabela | Coluna nova | Origem no full_object | Por quê |
|---|---|---|---|
| ordens_producao | `concluida` (bool) | `outrasInf.cConcluida = 'S'` | Conclusão **real**. A `adicionais_d_dt_conclusao` é a data **planejada** (infAdicionais) e pode estar preenchida numa OP não concluída → falso positivo (bug 3.3). |
| ordens_producao | `dt_conclusao_real` (date) | `outrasInf.dConclusao` | Data efetiva de conclusão. |
| ordens_producao | `dt_inclusao` (date) | `outrasInf.dInclusao` | Quando a OP foi criada no Omie. |
| produtos | `inativo` (bool) | `inativo = 'S'` | Filtrar só produtos ativos (4.551 de 13.362 são inativos). |
| produtos | `bloqueado` (bool) | `bloqueado = 'S'` | Status. |
| produtos | `ncm` (varchar 20) | `ncm` | Fiscal/etiqueta (100% preenchido). |
| produtos | `ean` (varchar 20) | `ean` | Código de barras / etiquetas (2.313 têm). |

Sync atualizado em `lib/omie/produto.ts` e `lib/omie/ordem-producao.ts` para preencher
esses campos nos próximos syncs.

## Gaps mantidos no full_object (sem perda; serão usados no bloco indicado)

- **produtos:** alíquotas e CST/CSOSN (ICMS/PIS/COFINS/IBS/CBS da reforma), `cest`,
  `class_trib`, pesos/dimensões, `lead_time`, `dias_garantia`. `cfop` e `marca` vêm
  **vazios** do cadastro — não viraram coluna. → Bloco 6/7 (fiscal).
- **notas_fiscais:** `totais` (impostos totais), `parcelas` (financeiro), `transporte`,
  `infoAdicionais`. → Bloco 7 (relatórios fiscais/financeiros).
- **nota_fiscal_items:** impostos por item (`itensICMS`, `itensIPI`, `itensPIS`,
  `itensCOFINS`, `itensIBS`, `itensCBS`, `itensICMSST`), `itensCustoEstoque`,
  `itensAjustes`. → Bloco 6 (validação fiscal da entrada de NF) e valorização.
- **local_estoques:** cobertura **completa**, nenhum gap.

> Nada é descartado: o `full_object` é salvo inteiro, então qualquer campo acima pode
> ser promovido a coluna quando o bloco que o usa for implementado.
