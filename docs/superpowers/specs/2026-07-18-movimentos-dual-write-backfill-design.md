# Movimentos — dual-write + backfill (Onda 2, item 2a)

Pedido: destravar o congelamento do espelho de `movimentos` no Contabo
(cópia única, parada desde 07-12) e equalizar a profundidade histórica
entre lojas, como pré-requisito de infra pro item seguinte (reescrever o
"modo operação" do relatório de Movimentação sobre `movimentos`, spec
separada). Decomposto em 2 specs porque o audit revelou mais trabalho do
que o previsto: aqui não é só "gravar o que já se descarta" (como no
Faturamento) — é um pipeline de escrita que nunca existiu pro Contabo, com
histórico desigual entre lojas.

## Contexto (já levantado, não repetir)

- **`origem` já corrigido** (Onda 1, commit `78e45d9`): `lib/omie/sync-ajustes.ts`
  grava `origem: a.origem === 'PDV' ? 'PDV' : 'AJU'` — não é mais hardcode.
  Reprocessado, sem pendência aqui.
- **O espelho de `movimentos` no Contabo está congelado, não só
  desatualizado.** Foi um `drop+create+insert` único em 07-12
  (`docs/superpowers/plans/2026-07-12-backfill-historico-1ano-contabo.md`).
  Desde então, nada grava lá: `lib/omie/sync-ajustes.ts` só faz `upsert` no
  Supabase; o dual-write em tempo real (`app/api/webhook/route.ts`) explicitamente
  ignora os tópicos `Produto.AjusteEstoque` e `Produto.MovimentacaoEstoque`
  ("evita loop de ajuste") — então nenhum evento de movimento passa pelo
  webhook, nunca. `ntb-frio-api` (`/opt/ntb-frio-api/server.js`) hoje só tem
  `GET /movimentos` — não existe endpoint de escrita além do `POST /webhooks`
  (que grava JSON cru na tabela `webhooks`, não em `movimentos`).
- **Profundidade real por loja no Supabase agora (medido 2026-07-18):**
  loja 3 desde 2022-10-01 (28.763 linhas), lojas 2/5/6 desde 2026-04-13
  (15.2k/29.2k/20.9k linhas), **loja 4 só 393 linhas desde 2026-06-19**,
  **loja 7 só 351 linhas, parado em 2026-06-15**. Todas as 6 lojas estão
  ativas e com integração Omie configurada — não há indício de loja de
  teste/inativa explicando o buraco. Não foi possível confirmar se a loja
  7 parou de sincronizar por erro (logs de `integration_attempts` mais
  antigos que 30 dias já foram podados) — tratar como observação a
  monitorar, não como bug confirmado nesta spec.
- `movimentos` (Supabase) **não tem prune automático** — o cron `prune`
  (`app/api/cron/prune/route.ts`) só apaga `webhooks` (7 dias) e
  `integration_attempts` (2/30 dias). A tabela cresce sem limite de tempo
  hoje.
- Schema de `movimentos` (`migration 001_schema_inicial.sql`, idêntico nas
  duas bases): `id, loja_id, transferencia_id, codigo_local_estoque,
  id_prod, data(timestamptz), tipo(ENT/SAI/SLD/TRF), quan, valor, obs,
  origem(AJU/PDV), motivo, codigo_local_estoque_destino, codigo_status,
  descricao_status, id_movest, id_ajuste, response, status, created_at,
  updated_at`.
- Fonte pro backfill histórico: `estoque/ajuste → ListarAjusteEstoque`
  (mesma call que `sync-ajustes.ts` já pagina todo dia; paginação por
  página, sem filtro de data — precisa iterar página a página até acabar,
  filtrando em código pela data desejada, igual ao padrão já usado em
  `scripts/recover-movimentos-omie.mjs`).

## Decisões (brainstorm, aprovadas)

1. **Endpoint novo `POST /movimentos_bulk` na `ntb-frio-api`**, mesmo
   molde do `POST /fat_cupons_bulk` (Faturamento, já em produção): body
   `{ loja_id, movimentos: [...] }`, transação, `insert ... on conflict
   (loja_id, id) do update`, chamado em lotes de 200 linhas por request
   (mesmo tamanho de lote e mesma lição do Faturamento: um lote grande
   estoura o limite de 2mb do Express).
2. **`lib/omie/sync-ajustes.ts` chama esse endpoint fire-and-forget** logo
   após cada `upsert` no Supabase — nunca lança erro nem bloqueia o sync
   se o Contabo falhar (mesma filosofia de `gravarFatoNoFrio` no
   Faturamento e de `buscarFrio` nas leituras).
3. **Catch-up único do buraco 07-12→hoje** antes do dual-write entrar em
   regime: copiar direto Postgres→Postgres (pooler do Supabase → Contabo)
   as linhas de `movimentos` que já existem no Supabase e ainda não estão
   no Contabo (por `id`), pra não depender de re-sincronizar tudo via API
   do Omie por uma lacuna que já está resolvida do lado Supabase.
4. **Backfill histórico desde 01/07/2025, todas as 6 lojas** (mesma
   data-corte usada nos outros backfills desta sessão — NF, faturamento),
   via `ListarAjusteEstoque`, gravando em **ambas** as bases (Supabase
   `upsert` + Contabo via o `POST /movimentos_bulk` novo). Roda no
   servidor Contabo, sequencial por loja, com checkpoint em arquivo pra
   retomar se cair — mesmo padrão do backfill de faturamento
   (`docs/superpowers/plans/2026-07-18-faturamento-fato-cupom.md`, Task 5).
5. **Fora de escopo desta spec:** investigar por que a loja 7 parou de
   sincronizar em 06-15 (é uma pergunta operacional/de saúde do sync, não
   uma decisão de arquitetura — se depois de rodar o backfill a loja 7
   continuar sem novas linhas no dia a dia, isso vira um bug separado a
   depurar); reescrever o "modo operação" do relatório de Movimentação
   (spec própria, depende desta); adicionar `codigo_local_estoque` como
   dimensão real de filtro no relatório de quantidade (também fica pra
   spec seguinte, é consumidor destes dados, não parte da escrita).

## Arquitetura

```
Omie (ListarAjusteEstoque)
  │
  ├─ sync-ajustes.ts (cron diário, incremental) ──┬─→ Supabase.movimentos (upsert)
  │                                                 └─→ POST /movimentos_bulk (fire-and-forget, novo)
  │                                                        │
  │                                                        ▼
  │                                                 Contabo.movimentos (upsert)
  │
  └─ backfill-movimentos-fato.mjs (script ad-hoc, roda 1x no servidor,
     sequencial por loja desde 2025-07-01, checkpoint) ──┬─→ Supabase.movimentos (upsert)
                                                           └─→ Contabo.movimentos (upsert, direto via pg local)

catch-up-movimentos.mjs (script ad-hoc, roda 1x, ANTES do dual-write
entrar em regime) : Supabase.movimentos (pooler) → Contabo.movimentos
(linhas com id ainda não presente no Contabo)
```

Ordem de aplicação: (1) endpoint novo + dual-write no `sync-ajustes.ts` →
(2) catch-up do buraco 07-12→hoje → (3) backfill histórico desde
01/07/2025. Fazer o catch-up antes do backfill evita que o backfill
histórico precise também cobrir o gap recente — o catch-up já resolve isso
copiando o que o Supabase já tem.

## Testando

Sem suite automatizada neste repo (mesmo padrão do resto do projeto).
Verificação manual: `curl` no endpoint novo (payload fake + limpeza,
mesmo padrão usado no `fat_cupons_bulk`); rodar o sync de 1 loja e
conferir `select count(*) from movimentos where loja_id=X` subir igual
nas duas bases; rodar o backfill e conferir profundidade final
(`min(data)` por loja) bater com 2025-07-01 nas 6 lojas.
