# Correção do bug de cupom cancelado no fato de Faturamento — Design

**Data:** 2026-08-10

**Gatilho:** achado pela revisão final do plano do filtro de Situação no
Faturamento — cupom cancelado DEPOIS da primeira sincronização com a
Omie nunca é atualizado na tabela `fat_cupons` (Postgres nativo do
Contabo, `ntb_frio`). Fica marcado como `cancelado=false` ("Normal") pra
sempre, mesmo tendo sido cancelado de verdade na Omie depois.

## Evidência real (já confirmada, não presumir de novo)

Em toda a base (115.644+ cupons, 6 lojas), só 66 têm `cancelado=true` —
todos vindos de um backfill histórico único (script ad-hoc, fora do repo
git), rodado em 2026-07-18 junto com a implantação do fato
(`fat_cupons`/`fat_cupom_itens`/`fat_cupom_pagamentos`). Distribuição
mensal dos 66: 2-9/mês de 2025-07 até 2026-06, depois 8 em 2026-07 (mais
recente: 2026-07-15) — **zero desde então**, confirmado via SQL direto:
`select count(*) from fat_cupons where cancelado=true and data >=
'2026-07-18'` retorna 0 linhas, em toda a base.

Verificação cruzada contra a Omie (loja 3, `CuponsFiscais`, período
18/07-10/08/2026, 36 páginas consultadas de verdade): **6 cupons
genuinamente cancelados** nesse período, nenhum capturado no fato.
Extrapolando pras 6 lojas ativas, o resíduo histórico total é pequeno
(estimativa: 20-40 cupons).

## Causa raiz (confirmada lendo `lib/omie/faturamento.ts` inteiro)

`syncFaturamento` reprocessa o ano corrente inteiro (mês 1 até o mês
atual) toda vez que roda — não é incremental, não tem cursor. O cron que
dispara isso (`/api/cron/sync-faturamento`) roda 1x/hora.

Dentro do loop de cupons (linha ~185-201):

```ts
for (const c of r.cupons ?? []) {
  if (c.cabecalhoCupom?.info?.cCupomCancelado === 'S') continue   // linha 186
  const cab = c.cabecalhoCupom
  cuponsBulk.push({                                               // linha 188
    ...
    cancelado: cab?.info?.cCupomCancelado === 'S',                // linha 199, código morto
    devolvido: cab?.info?.cCupomDevolvido === 'S',
  })
  for (const p of c.pagamentosCupom ?? []) { ... }
  for (const it of c.itensCupom ?? []) { ... }
}
```

O `continue` da linha 186 acontece **antes** do `cuponsBulk.push`. Um
cupom cancelado nunca entra em `cuponsBulk`, em nenhuma execução — logo
nunca é enviado pro `POST /fat_cupons_bulk`, mesmo a sync rodando de novo
sobre o mesmo mês a cada hora. O servidor (`ntb-frio-api`) faz UPSERT de
verdade (`ON CONFLICT (loja_id, n_id_cupom) DO UPDATE`, chave = PK da
tabela) — o problema não está lá, está 100% no cliente nunca reenviar o
cupom depois que ele vira cancelado.

Esse `continue` é o mesmo guard-clause que já existia ANTES do fato ser
introduzido (usado originalmente só pra excluir cupom cancelado do
agregado pré-calculado, `faturamento_importado`/`acc`). O plano que
introduziu `fat_cupons` (2026-07-18) reaproveitou indevidamente o mesmo
`continue` pra dois propósitos incompatíveis: excluir cancelado do
agregado (correto) E excluir cancelado do fato bruto (incorreto — o fato
bruto deveria capturar o cupom com seu status real, cancelado ou não).

O campo `cancelado` na linha 199 é código morto hoje: só é alcançado por
cupons NÃO cancelados, onde sempre avalia `false`.

**Nuance confirmada**: o backfill histórico único (2026-07-18, fora do
repo) não tinha esse `continue` — gravou os cupons cancelados corretos na
foto daquele momento. Só quem cancela DEPOIS de já ter sido gravado como
normal fica travado.

## Correção do código (dai pra frente)

Mover `cuponsBulk.push(...)` pra antes do `if (cancelado) continue`,
calculando `cancelado`/`devolvido` uma vez no topo do loop:

```ts
for (const c of r.cupons ?? []) {
  const cab = c.cabecalhoCupom
  const cancelado = cab?.info?.cCupomCancelado === 'S'

  cuponsBulk.push({
    n_id_cupom: Number(cab?.nIdCupom),
    chave: cab?.cChaveCupom ?? null,
    data: cab?.dDtEmissaoCupom ? cab.dDtEmissaoCupom.split('/').reverse().join('-') : mesISO + '-01',
    hora: cab?.cHrEmissaoCupom ?? null,
    num: cab?.nNumCupom != null ? String(cab.nNumCupom) : null,
    serie: cab?.nSerieCupom != null ? String(cab.nSerieCupom) : null,
    seq_caixa: cab?.seqCaixa != null ? Number(cab.seqCaixa) : null,
    id_cliente: cab?.idCliente != null ? Number(cab.idCliente) : null,
    id_vendedor: cab?.idVendedor != null ? Number(cab.idVendedor) : null,
    valor: Number(cab?.nValorCupom) || 0,
    cancelado,
    devolvido: cab?.info?.cCupomDevolvido === 'S',
  })

  if (cancelado) continue   // segue excluindo itens/pagamentos/acc, não mais o cabeçalho

  for (const p of c.pagamentosCupom ?? []) { ... }
  for (const it of c.itensCupom ?? []) { ... }
}
```

O `continue` continua existindo e continua correto pro que faz hoje
(excluir cancelado de itens/pagamentos/agregado) — só deixa de excluir
também o cabeçalho do fato bruto. Isso resolve o caso "cancelado depois"
automaticamente na próxima hora que a sync rodar, sem mecanismo novo,
porque o UPSERT já sabe atualizar por `(loja_id, n_id_cupom)`.

**Limitação que essa correção sozinha NÃO resolve**: a sync só reprocessa
o ano corrente até o mês atual — cupons de meses passados nunca são
re-tocados por essa função. Por isso o resíduo histórico (item seguinte)
precisa de reprocessamento separado.

## Reprocessamento retroativo (resíduo desde 2026-07-18)

Script pontual (ad-hoc, mesmo padrão de outros backfills já rodados
nesta sessão — não vira parte do código de produção versionado como
feature), pra cada loja ativa:

1. Consultar `CuponsFiscais` na Omie desde 2026-07-18 até hoje, paginado
   (mesma paginação/rate-limit já usado por `syncFaturamento`, ~340ms
   entre chamadas), coletando `n_id_cupom` de todo cupom com
   `cCupomCancelado === 'S'`.
2. Pra cada `n_id_cupom` encontrado: `UPDATE fat_cupons SET
   cancelado=true WHERE loja_id=X AND n_id_cupom=Y` direto no Postgres
   nativo do Contabo (`ntb_frio`). Só corrige o campo `cancelado` do
   cabeçalho — não reprocessa itens/pagamentos (que não têm coluna de
   status própria, o consumo hoje sempre é via join com `fat_cupons.
   cancelado`) nem o agregado pré-calculado (`faturamento_importado`, que
   já excluía cancelado desde sempre, correto, e não guarda granularidade
   suficiente pra "adicionar" um cancelamento retroativo sem reagregar).
3. Reportar, por loja: quantos cupons foram encontrados como cancelados
   na Omie, quantos já estavam corretos no fato, quantos foram
   corrigidos agora. Validar com uma query de conferência (contagem antes/
   depois).

**Regra de ouro**: só `UPDATE` de um campo específico (`cancelado`) em
linha que já existe (identificada por `n_id_cupom`, que é imutável e
único por cupom na Omie) — nunca `INSERT`/`DELETE`, nunca mexer noutro
campo. Testar com 1-2 cupons de 1 loja antes de rodar em lote pras 6.

## Fora de escopo

- Reagregar `faturamento_importado` pra refletir os cancelamentos
  corrigidos retroativamente — o agregado já excluía cancelado desde
  antes do bug existir (o bug é só do fato granular), então não há
  correção necessária ali.
- Corrigir itens/pagamentos de cupons cancelados retroativamente (não
  existe consumidor hoje que precise disso — o filtro de Situação, "Ver
  cupons" e o resumo de cancelados usam só `fat_cupons.cancelado`).
- Investigar por que `devolvido` nunca vem `true` da Omie (achado
  separado, documentado como pendência na revisão final do plano
  anterior — fora de escopo desta correção).
