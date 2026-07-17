# Filtros completos nas telas de lista/relatório

Pedido do usuário: adicionar os filtros que faltam em todas as telas de
lista/relatório do app, replicando o padrão já estabelecido
(`FiltrosGaveta` + tipo `CampoFiltro`), sem inventar nenhum componente novo.

**Revisão 2026-07-16 (v2):** a investigação tela-a-tela mostrou que boa
parte do escopo original já estava pronta, e que duas conclusões de
"não dá pra fazer" da v1 estavam erradas — corrigidas abaixo depois de
verificar contra dado real (Supabase/Contabo) em vez de assumir.

## Contexto (já verificado, não precisa refazer)

- **Faturamento**: já tem cron automático (`/api/cron/sync-faturamento`,
  commit `50d4ef9`, anterior a este trabalho, agendado 01:45 diário,
  confirmado rodando). Só o texto do botão estava desatualizado — já
  corrigido fora deste spec.
- **Auditoria Fiscal e Compras**: ligar essas telas no Contabo (histórico
  >90 dias) continua fora de escopo — 736 de 738 itens de nota fiscal
  amostrados no Contabo têm `full_object` vazio (o campo do qual essas
  RPCs dependem pra CFOP/ICMS). Bloqueio de sincronização no servidor
  Contabo, fora deste repo. **Isso não impede os filtros abaixo — eles só
  vão funcionar dentro da janela de 90 dias que o Supabase já cobre hoje,
  igual o resto da tela já funciona.**
- **Margem**: só atualiza via upload manual de Excel do Omie — automatizar
  isso é projeto à parte, fora de escopo.

## Correção importante da v1: dois "não dá" que na verdade dão

1. **`nota_fiscal_items.full_object` tem um campo `codigo_local_estoque`**
   dentro de `itensAjustes`, confirmado com dado real do Supabase
   (`full_object->'itensAjustes'->>'codigo_local_estoque'`, populado em
   100% de uma amostra de 5 linhas). A v1 concluiu "local de estoque não
   existe em nota fiscal" olhando só as colunas da tabela — mas o dado
   está no JSON, mesma técnica já usada pra extrair CFOP de entrada.
2. **Faturamento por produto não precisa de nova integração.**
   `lib/omie/faturamento.ts` já busca `it.idProduto` de cada item do
   cupom fiscal (linha 93) — só usa pra resolver tipo/família e descarta
   depois. Adicionar uma 3ª dimensão `'produto'` ali é uma mudança de
   poucas linhas nesse arquivo, não uma reintegração. A RPC
   `relatorio_faturamento_matriz`/`relatorio_faturamento_opcoes` já é
   agnóstica de dimensão (`where dimensao = p_dim`), então nem migration
   precisa — só popular a nova dimensão na tabela existente.

## Escopo final, por tela

### 🟢 Direto — sem migration nova

| Tela | Filtro | Como |
|---|---|---|
| `transferencia` | produto | Estender o bloco `if (familiasArr.length \|\| tiposArr.length)` (linhas 61-87) pra também rodar quando `sp.produto` existir, adicionando `.or('descricao.ilike...,codigo.ilike...')` na query de `produtos` já existente ali. |
| `inventario` | produto | Mesma ideia: estender o bloco de `itemQuery` (linhas 65-92) com `.or('produto_descricao.ilike...,produto_codigo.ilike...')` quando `sp.produto` vier. |
| `inventario` | local de estoque | `inventarios.codigo_local_estoque` já existe direto na tabela — `campos` novo (multi-select, opções de `local_estoques`) + `.in('codigo_local_estoque', locaisArr)` na query principal. |
| `nota-fiscal` | família | Mesmo padrão já usado pro filtro `tipo` (linhas 76-124): adicionar `familiasSel` resolvido via `produtos.descricao_familia`, unir com os códigos já filtrados por tipo. |
| `nota-fiscal` | local de estoque | Usar o campo confirmado `nota_fiscal_items.full_object->'itensAjustes'->>'codigo_local_estoque'` — adicionar ao `itemQuery` existente (o mesmo que já resolve `notaIds` pra tipo/produto) um filtro nesse path JSON. |
| `movimentacoes` (aba Movimentos) | família, tipo | `produto` e `período` **já existem** nessa aba — só família/tipo faltam. Só fazem sentido como filtro adicional de um produto já buscado (a aba não tem "modo lista" sem busca — ver `EmptyState` de `MovimentosTab.tsx`). Resolver via `produtos.descricao_familia`/`tipo_item`, intersectar com os `idsProdDetalhes` já resolvidos pela busca de produto. |
| `relatorio-movimentacao` (modo operação) | família, tipo | `movimentacao_operacao` já tem colunas `familia`/`tipo_sped` diretas — hoje só usadas como `dim` de agrupamento, nunca como filtro. Adicionar `familiasSel`/`tiposSel` (opções vindas de `[...new Set(rows.map(r => r.familia))]`) e aplicar no filtro `filtradas` já existente (linhas 172-176). |
| `relatorio-movimentacao` (modo operação) | período | `movimentacao_operacao.mes` é `'YYYY-MM'` (sem dia) — o filtro só pode ter granularidade de mês. Rotular os campos como "Mês inicial"/"Mês final" (não reusar o `CampoFiltro` tipo `'data'` genérico, que renderiza seletor de dia) pra não sugerir precisão que não existe. |
| `validade` | local de estoque | `ordens_producao.identificacao_codigo_local_estoque` existe direto (confirmado) — `campos` novo + `.eq()`/`.in()` na query já existente. |
| `auditoria-fiscal` | fornecedor (drill-down) | `relatorio_auditoria_fiscal_itens` **já aceita** `p_fornecedor` (migration 047) — só não está sendo passado pela página. Adicionar `sp.fornecedor` e passar no `.rpc()` já existente (linha 66-69). Não afeta o resumo por CFOP (ver item amarelo abaixo). |
| `relatorio-faturamento` | produto | Editar `lib/omie/faturamento.ts`: estender o `select` de `produtos` pra trazer também `codigo, descricao`; dentro do loop que já lê `it.idProduto` (linha 93), adicionar `add('produto', <descrição ou código>, mesISO, v)`; incluir `'produto'` no `.in('dimensao', [...])` do delete (linha 109). Em `relatorio-faturamento/page.tsx`, adicionar `{ value: 'produto', label: 'Produto' }` ao array `DIMS` (linha 19-23) — a RPC já funciona sem mudança (`p_dim='produto'` já filtraria certo). Mirar o mesmo padrão de paginação/"baixar tudo" que `relatorio-compras` já usa pra `dim=produto` (cardinalidade alta). |

### 🟡 Precisa de migration nova (adicionar parâmetro/join numa função SQL existente)

| Tela | Filtro | O que muda |
|---|---|---|
| `relatorio-compras` | produto | Adicionar `p_produto text default null` + `(p_produto is null or i.c_descricao_produto ilike ... or i.c_codigo_produto ilike ...)` nas 3 funções (`relatorio_compras_total`, `_dim`, `_matriz` — o `left join produtos`/`i.c_descricao_produto` já existe nelas, só falta o parâmetro novo). Seguir o padrão de migrations anteriores (`065`/`067`: `drop function` + `create or replace` das 3 juntas). |
| `relatorio-compras` | local de estoque | Mesmas 3 funções: adicionar `p_local bigint default null` + `(p_local is null or (i.full_object->'itensAjustes'->>'codigo_local_estoque')::bigint = p_local)`, usando o campo confirmado nesta revisão. `campos` novo com opções de `local_estoques`. |
| `auditoria-fiscal` | produto | Adicionar `p_produto` + mesma condição `ilike` em **`relatorio_auditoria_fiscal_cfop`** (hoje só tem `p_loja_id/p_ini/p_fim`) e em `relatorio_auditoria_fiscal_itens` (que já tem `p_cfop_doc/p_cfop_entrada/p_fornecedor`, precisa ganhar mais um). |
| `auditoria-fiscal` | família | Adicionar `left join produtos p on p.loja_id = i.loja_id and p.codigo_produto = i.n_id_produto` (ainda não existe nessas 2 funções) + `p_familia` nas 2. |
| `auditoria-fiscal` | fornecedor (resumo) | `relatorio_auditoria_fiscal_cfop` não tem `p_fornecedor` nenhum — adicionar, mesma condição já usada em `_itens`. |
| `auditoria-fiscal` | local de estoque | Mesmo campo confirmado (`full_object->'itensAjustes'->>'codigo_local_estoque'`) — adicionar `p_local` + condição nas 2 funções. |

### 🔴 Não é viável — falta o dado na origem (confirmado, não é suposição)

| Tela | Filtro | Por quê |
|---|---|---|
| `movimentacoes` (aba Histórico) | local de estoque | `movimentos_historico` não tem coluna de local, e a origem (`ListarMovimentos` do Omie, ver `lib/omie/movimento.ts`) não traz essa informação — é agregado por produto/dia, sem local. Não é possível sem uma sincronização nova do Omie (que hoje não expõe esse dado nesse endpoint). |
| `relatorio-margem` | local de estoque | `margem_importada` vem de um Excel (aba MARGEM do FAT_DRV) que é inerentemente por produto/mês, sem local nenhum — a própria exportação do Omie não tem essa granularidade. |
| `relatorio-movimentacao` (modo operação) | produto | `movimentacao_operacao` é uma tabela pré-agregada (importada de um BD de 160MB via `scripts/importar-mov-bd.mjs`) que já vem sem coluna de produto — o dado foi perdido antes de chegar no banco. Precisaria reimportar com granularidade de produto, fora de escopo. |
| `relatorio-indicadores` | produto, família, local de estoque | Essa tela é um dashboard de 4 números (Faturamento, Compras, diferença, % — comparado a uma meta fixa de 40%), as duas RPCs que ele usa (`relatorio_faturamento_matriz`/`relatorio_compras_matriz`) só agregam por `tipo`/`cfop`. Filtrar por produto/família quebraria o propósito da métrica (a relação Compras÷Faturamento não faz sentido por produto individual). Recomendo não adicionar. |
| `relatorio-faturamento` | local de estoque | Não confirmado se o endpoint `cupomfiscalconsultar` do Omie retorna local — não foi verificado contra uma resposta real da API (diferente de notas_fiscais, que já confirmamos ter o campo). Precisaria de um teste pontual contra a API real antes de prometer isso; não incluído nesta rodada. |

## Arquitetura (sem novidade — replicação de padrão existente)

Mesmo de sempre: `campos: CampoFiltro[]` + `FiltrosGaveta`, searchParams
tipado, filtro aplicado na query/RPC do servidor. Nada de componente novo.
`CampoFiltro` (tipo exato em `components/ui-kit/filtros-utils.ts`) suporta
`'texto' | 'data' | 'select' | 'combobox' | 'multi-select'`.

## Testes

Sem suite automatizada. Verificação manual por tela via Playwright + conta
QA (`claude.qa@ntb-estoque.dev`), confirmando que a URL reflete o parâmetro
E que a lista/relatório realmente filtra (não só que o campo aparece).
