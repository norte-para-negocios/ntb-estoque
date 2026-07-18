# Faturamento — fato por cupom (Onda 2, item 1)

Pedido: gravar o fato de faturamento item-a-item (hoje descartado na
ingestão) pra destravar filtros cruzados, grão diário, ticket médio,
quantidade e forma de pagamento automática em todas as lojas.

## Contexto (já levantado, não repetir)

- A ingestão atual (`lib/omie/faturamento.ts`) pagina `CuponsFiscais`
  (Omie) todo dia, mas grava só pivots pré-agregados `dimensão×rótulo×mês`
  em `faturamento_importado` (Supabase) — o cupom/item/pagamento
  individual é descartado depois de somado.
- A mesma resposta `CuponsFiscais` já traz, sem chamada extra:
  cabeçalho do cupom (`nIdCupom`, `dDtEmissaoCupom`+`cHrEmissaoCupom`,
  `nNumCupom`, `nSerieCupom`, `seqCaixa`, `idCliente`, `idVendedor`,
  `nValorCupom`, flags cancelado/devolvido), itens (`idProduto`, `nQuant`,
  `vUnit`, `vDesc`, `vItem`, CFOP, NCM) e **`pagamentosCupom[]`**
  (`cTipoDoc`, `nValorDocumento`, `cCategoria`, `idContaCorrente`,
  parcela) — a forma de pagamento real, sem depender do Excel FAT_DRV
  manual.
- Volume estimado (medido na loja 3, extrapolado pras 5 lojas ativas):
  ~120 mil cupons, ~650 mil itens, ~150 mil pagamentos por ano — grande
  demais pro Supabase free tier (500MB), tranquilo no Postgres do Contabo
  (sem limite de espaço).
- Arquitetura já estabelecida no projeto: Supabase = operacional (dados
  transacionais recentes), Contabo = histórico completo, comunicação via
  `ntb-frio-api` (Express + `pg`, systemd no servidor, fora deste repo
  git — só editável por SSH `~/.ssh/notebook_contabo_key root@185.193.66.240`,
  arquivo `/opt/ntb-frio-api/server.js`). Autenticação por `X-Api-Key`.

## Decisões (brainstorm, aprovadas)

1. **Sem cópia no Supabase.** Diferente de NF/movimentos, o Faturamento
   nunca teve janela quente — seria uma tabela nova do zero, não uma
   existente sendo estendida. As 3 tabelas do fato vivem só no Contabo; o
   app sempre lê ao vivo via HTTP. Uma fonte de verdade, sem risco de
   dessincronizar (o incidente do proxy do dia 18/07 mostrou como
   duplicação quente/frio pode degradar silenciosamente).
2. **3 endpoints crus + 1 agregador** na `ntb-frio-api`. Os crus sustentam
   drill-down até o cupom individual (mesmo padrão de `/nota_fiscal_items`);
   o agregador faz `GROUP BY` no próprio Postgres do servidor pra a tela
   nunca precisar puxar centenas de milhares de linhas só pra montar uma
   matriz mensal.
3. **Backfill no próprio servidor Contabo**, sequencial por loja, com
   checkpoint — mesmo molde do backfill de `ajustes` executado em
   2026-07-18 (rodar local ao Postgres evita round-trip de rede por linha;
   throttle ~340ms entre chamadas Omie).

## Schema (Contabo, banco `ntb_frio`)

```sql
create table fat_cupons (
  loja_id bigint not null,
  n_id_cupom bigint not null,
  chave text,
  data date not null,
  hora text,
  num text,
  serie text,
  seq_caixa bigint,
  id_cliente bigint,
  id_vendedor bigint,
  valor numeric not null default 0,
  cancelado boolean not null default false,
  devolvido boolean not null default false,
  primary key (loja_id, n_id_cupom)
);
create index fat_cupons_loja_data_idx on fat_cupons (loja_id, data);

create table fat_cupom_itens (
  loja_id bigint not null,
  id_item bigint not null,
  n_id_cupom bigint not null,
  id_produto bigint,
  cfop text,
  ncm text,
  quant numeric not null default 0,
  v_unit numeric not null default 0,
  v_desc numeric not null default 0,
  v_item numeric not null default 0,
  x_prod text,
  primary key (loja_id, id_item)
);
create index fat_cupom_itens_cupom_idx on fat_cupom_itens (loja_id, n_id_cupom);
create index fat_cupom_itens_produto_idx on fat_cupom_itens (loja_id, id_produto);

create table fat_cupom_pagamentos (
  loja_id bigint not null,
  n_id_cupom bigint not null,
  sequencia int not null,
  tipo_doc text,
  valor numeric not null default 0,
  categoria text,
  id_conta_corrente bigint,
  primary key (loja_id, n_id_cupom, sequencia)
);
create index fat_cupom_pagamentos_cupom_idx on fat_cupom_pagamentos (loja_id, n_id_cupom);
```

`tipo_doc` (`cTipoDoc`) é o código bruto do Omie (CRC/CRD/DIN/PIX...) —
tradução pra rótulo amigável fica na camada de leitura do app (mesmo
padrão de `lib/rotulos-opacos.ts`), não no banco.

## Endpoints novos (`ntb-frio-api`, `server.js`)

- `GET /fat_cupons?loja_id=&data_inicio=&data_final=` — linhas cruas de
  `fat_cupons` no período (paginação de 5000 por chamada, igual aos
  demais endpoints, `count=true` opcional).
- `GET /fat_cupom_itens?loja_id=&data_inicio=&data_final=[&n_id_cupom=]`
  — itens no período (join implícito por `n_id_cupom` já resolvido no
  filtro de data do cupom pai) ou de 1 cupom específico.
- `GET /fat_cupom_pagamentos?loja_id=&data_inicio=&data_final=[&n_id_cupom=]`
  — idem.
- `GET /fat_agregado?loja_id=&data_inicio=&data_final=&group=dia|forma|produto`
  — `GROUP BY` no servidor, só com o que existe no Contabo: `dia` agrupa
  por `data` de `fat_cupons`; `forma` faz join com `fat_cupom_pagamentos`
  e agrupa por `tipo_doc`; `produto` agrupa `fat_cupom_itens` por
  `id_produto` (numérico cru). Retorna `{ rotulo, dia_ou_mes, valor,
  qtde_itens }`. **Não existe `group=familia`/`tipo`**: `produtos` (com
  família/tipo) é cadastro, vive só no Supabase — nunca duplicado no
  Contabo (regra do AGENTS.md). Pra abrir por família/tipo, o app pede
  `group=produto` (ou `group=dia` com granularidade de produto — ver
  nota abaixo) e cruza `id_produto` com a tabela `produtos` local, exatamente
  como `lib/relatorio-frio-nf.ts` já faz pra família/tipo de compras.

Mesma normalização de tipo já documentada no AGENTS.md (`bigint`/`date`
via `types.setTypeParser`) se algum campo novo precisar.

**Nota sobre família/tipo/matriz mensal**: `group=produto` sozinho não
teria mês — para a matriz mês×família que a tela precisa, o endpoint
aceita um segundo parâmetro `group2=mes` (`GROUP BY id_produto, mes` no
servidor), devolvendo `{ id_produto, mes, valor, qtde_itens }`. O app
resolve `id_produto → familia/tipo` com o mesmo cache local de `produtos`
já usado em `lib/relatorio-frio-nf.ts` e reagrega em JS por família/tipo —
mesmo padrão de `agregarComprasMatriz`, não um mecanismo novo.

## Ingestão (`lib/omie/faturamento.ts`)

Dentro do loop que já pagina `CuponsFiscais` por mês: além de continuar
alimentando `acc` (pro pré-agregado do Supabase, que segue sendo o cache
rápido de exibição), fazer POST em lote pros 3 endpoints crus (bulk
insert, `ON CONFLICT DO UPDATE` por chave primária — idempotente, permite
re-rodar sem duplicar). Falha de rede no Contabo não deve quebrar a
ingestão do pré-agregado (mesmo princípio de `buscarFrio`: nunca deixar o
histórico frio derrubar o caminho principal).

## Leitura no app (`lib/faturamento-frio.ts`, novo)

Funções: `buscarFatAgregado(opts)`, `buscarFatCupons(opts)`,
`buscarFatCupomDetalhe(nIdCupom)` — chamam os endpoints novos via
`buscarFrio` (helper já existente em `lib/historico-contabo.ts`, reusado
tal qual). Sem branch de "janela quente" — é sempre uma chamada HTTP.

`app/(app)/relatorio-faturamento/page.tsx` troca de fonte (pré-agregado
Supabase → fato no Contabo) exatamente nestes 3 gatilhos, checados nessa
ordem — o primeiro que bater decide:
1. **Dimensão `forma_pgto` selecionada** (o pré-agregado só tem essa
   dimensão via import manual da loja 3; o fato tem em todas as lojas).
2. **Mais de um filtro de dimensão ativo ao mesmo tempo** (ex.: tipo E
   família E forma juntos) — o pré-agregado é por pivot único, não cruza.
3. **Toggle explícito "Ver cupons"/drill até item** — nível que só o fato
   tem.
Fora esses 3 casos (filtro único ou nenhum, dimensão tipo/família/produto
isolada), a tela continua no pré-agregado (mais rápido, já em produção,
sem mudança de comportamento visível pro usuário).

## Backfill

Script novo, rodado no servidor via SSH (fora deste repo, mesmo padrão
ad-hoc do backfill de ajustes de hoje): por loja, pagina `CuponsFiscais`
desde 01/07/2025 até hoje, grava nas 3 tabelas via `pg` local (sem round-trip
de rede por linha), com checkpoint (arquivo ou tabela de controle) pra
retomar se cair. Throttle ~340ms entre chamadas Omie.

## Fora de escopo desta rodada

- Remover as dimensões compostas `tipo>familia`/`familia>produto` do
  pré-agregado (ficam como estão até o fato novo estar validado).
- Aba B2B (NF-e de saída) — item separado do spec mestre.
- Dual-write em tempo real pro fato (o backfill diário via cron já cobre;
  webhook de cupom não existe hoje no Omie).
