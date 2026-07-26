# Sync contínuo de Notas Fiscais e Ordens de Produção pro Contabo — Design

## Contexto

`notas_fiscais`, `nota_fiscal_items` e `ordens_producao` têm hoje, no Postgres
do Contabo (`ntb_frio`), só uma cópia única e congelada desde 2026-07-12 (mais
alguns updates pontuais de `full_object`, nunca insert/delete). Nenhuma linha
criada depois de 07-12 chega lá. Achado ao vivo durante a auditoria de
2026-07-25: a loja 2 não tem nenhuma nota fiscal emitida depois de 12/07 no
Contabo, enquanto o Supabase tem notas de hoje.

Isso não é um bug ativo — o Supabase hoje **não poda** essas 3 tabelas (guarda
histórico completo desde 2024/2025), então nenhum relatório perde dado agora.
Mas a arquitetura documentada em `AGENTS.md` pressupõe que o Supabase só guarda
90 dias e que o Contabo cobre o resto — se uma poda de verdade um dia começar a
rodar (a razão original de existir a fatia fria), notas/OPs emitidas depois de
07-12 vão sumir silenciosamente assim que saírem da janela quente, sem estar em
nenhuma das duas bases.

`movimentos` já passou por esse mesmo problema e já foi corrigido em 2026-07-18
(ver `AGENTS.md`, seção "Dual-write de `movimentos`", e
`docs/superpowers/plans/2026-07-18-movimentos-dual-write-backfill.md`). Este
design replica o mesmo padrão para as 3 tabelas restantes.

**Achado que expande o escopo**: o Contabo já gera seu próprio `id`
(`bigserial`/`nextval`) para as 4 tabelas envolvidas — confirmado via `\d` no
servidor. Isso significa que, assim que o dual-write entrar no ar, o Contabo
vai gerar um `id` diferente do Supabase para a MESMA nota/OP nova — exatamente
a mesma causa raiz do bug de duplicação de `movimentos` corrigido em
2026-07-25 (commit `3f02341`, ver `lib/historico-contabo.ts`). As funções
`complementarNotasFiscais`, `complementarNotaFiscalItems` e
`complementarOrdensProducao` ainda deduplicam por `.id` (`mesclarPorId`) — sem
trocar isso pela chave natural, o dual-write reintroduziria o mesmo bug nessas
3 tabelas assim que fosse ligado. Corrigir isso faz parte deste projeto, não é
opcional.

## Arquitetura

Mesmo padrão de `movimentos` (`lib/omie/sync-ajustes.ts` → `POST
/movimentos_bulk`):

1. Cada função de sync do Omie (`syncNotasFiscais`/`saveNotaFiscal` em
   `lib/omie/nota-fiscal.ts`, `syncOrdensProducao`/`fetchOrdemProducao` em
   `lib/omie/ordem-producao.ts`) continua fazendo upsert no Supabase como hoje
   — sem mudança de comportamento aí — e, logo em seguida, chama uma função
   `gravar*NoFrio` fire-and-forget que envia os mesmos dados pra um endpoint
   novo na `ntb-frio-api`. Falha no Contabo nunca propaga nem bloqueia o
   Supabase (mesma filosofia de `buscarFrio`/`gravarMovimentosNoFrio`).
2. Dois endpoints novos no `server.js` (fora deste repo, servidor Contabo):
   `POST /notas_fiscais_bulk` (cabeçalho + itens numa transação) e `POST
   /ordens_producao_bulk`. Upsert por `ON CONFLICT` na chave natural,
   transação por request, mesmo `checkAuth`/`X-Api-Key` dos outros endpoints.
3. Dois índices únicos novos no Postgres do Contabo (`notas_fiscais`,
   `nota_fiscal_items`) — `ordens_producao` já tem o seu (`uq_op_loja_cod`,
   sobrou do backfill de 07-12).
4. `lib/historico-contabo.ts`: as 3 funções `complementar*` passam a
   deduplicar pela chave natural em vez de `.id`, mesmo padrão já usado em
   `complementarMovimentos` (chave, fallback pro `.id` só quando a chave
   natural for nula) e em `complementarMovimentosHistorico` (chave composta
   pura, sem fallback, quando a chave nunca é nula). Cada call site que ainda
   não seleciona as colunas da chave natural precisa passar a selecionar.
5. Script de backfill (`scripts/`, roda LOCAL, não no servidor): como o
   Supabase já tem 07-13→hoje intacto, lê essas linhas direto do Supabase
   (mesmo padrão de `scripts/db.mjs`) e as envia pros 2 endpoints novos do
   Contabo, pras 6 lojas. Sem precisar tocar a API do Omie de novo (diferente
   do backfill original de 07-12, que teve que reconstruir 2025-07→2026-03
   direto do Omie porque o Supabase nunca teve esse período).

## Componentes

### 1. Migrations no Contabo (SQL direto via SSH, sem versionamento neste repo)

```sql
CREATE UNIQUE INDEX IF NOT EXISTS notas_fiscais_loja_receb_unique
  ON public.notas_fiscais (loja_id, n_id_receb);

CREATE UNIQUE INDEX IF NOT EXISTS nota_fiscal_items_loja_receb_seq_unique
  ON public.nota_fiscal_items (loja_id, n_id_receb, n_sequencia);
```

Sem `WHERE ... IS NOT NULL` (diferente do índice de `movimentos`) — essas duas
colunas são sempre preenchidas pra toda NF/item real vinda do Omie (natural
key já usada sem ressalva no `onConflict` do Supabase hoje).

### 2. `POST /notas_fiscais_bulk` (server.js)

Body: `{ loja_id, notas: [{ n_id_receb, n_id_fornecedor, c_pessoa_fisica,
c_nome, c_razao_social, c_inscricao, c_cnpj_cpf, c_chave_nfe, c_etapa,
c_numero_nfe, c_serie_nfe, c_modelo_nfe, d_emissao_nfe, n_valor_nfe,
c_ambiente_nfe, c_natureza_operacao, full_object, itens: [{ n_sequencia,
n_id_item, n_id_pedido, n_id_it_pedido, n_id_produto, c_codigo_produto,
c_descricao_produto, c_ignorar_item, c_adicionar_novo, c_associar_existente,
c_item_devolvido, c_ncm, c_ean, c_cfop, n_qtde_nfe, c_unidade_nfe,
n_preco_unit, full_object }] }] }`. Só os campos que `saveNotaFiscal`
(`lib/omie/nota-fiscal.ts`) de fato grava no Supabase hoje — `nota_fiscal_items`
tem outras 6 colunas (`produto_codigo`, `quantidade`, `v_desconto`, `v_frete`,
`v_total_item`, `categoria_contabil_id`) que o sync do Omie não preenche
(vêm de outro fluxo, ex. categorização manual) e ficam fora do payload de
dual-write — não fazem parte do que este projeto precisa espelhar.

Pra cada nota do lote, dentro da MESMA transação: `INSERT ... ON CONFLICT
(loja_id, n_id_receb) DO UPDATE ... RETURNING id` no cabeçalho — o `id`
retornado (gerado pelo Contabo, não o do Supabase) alimenta o
`nota_fiscal_id` de cada item dessa nota antes do `INSERT ... ON CONFLICT
(loja_id, n_id_receb, n_sequencia) DO UPDATE` dos itens. Mesmo padrão que
`saveNotaFiscal` já faz localmente contra o Supabase (`.select('id').single()`
→ usa `saved.id` nos itens).

### 3. `POST /ordens_producao_bulk` (server.js)

Body: `{ loja_id, ordens: [{ num_ordem, identificacao_n_cod_op,
identificacao_c_cod_int_op, identificacao_c_num_op,
identificacao_n_cod_produto, identificacao_d_dt_previsao,
identificacao_n_qtde, identificacao_codigo_local_estoque, concluida,
dt_conclusao_real, dt_inclusao, full_object }] }`. `INSERT ... ON CONFLICT
(loja_id, identificacao_n_cod_op) DO UPDATE` por ordem, mesma transação por
request.

### 4. Dual-write nos syncs existentes

`lib/omie/nota-fiscal.ts`: `saveNotaFiscal` (chamada tanto por
`syncNotasFiscais` quanto por `fetchOrdemProducao`-equivalente
`fetchNotaFiscal`) ganha uma chamada fire-and-forget a
`gravarNotaFiscalNoFrio(loja.id, { ...cabecalho, itens })` logo após o upsert
no Supabase ter sucesso — 1 POST por NF (volume real de NF por sync é baixo
o bastante pra não precisar de lote como `movimentos`/`fat_cupons`).

`lib/omie/ordem-producao.ts`: `syncOrdensProducao` ganha uma chamada
`gravarOrdensNoFrio(loja.id, rows)` fire-and-forget depois do `upsert` em
lote no Supabase (mesmo lote de até 100, mesmo padrão de
`gravarMovimentosNoFrio`); `fetchOrdemProducao` ganha a mesma chamada com um
array de 1 elemento.

### 5. Fix de dedupe em `lib/historico-contabo.ts`

`complementarNotasFiscais`: chave `n_id_receb` (sempre presente, sem
fallback — mesmo estilo de `complementarMovimentosHistorico`).
`complementarNotaFiscalItems`: chave composta `n_id_receb|n_sequencia`.
`complementarOrdensProducao`: chave `identificacao_n_cod_op`. As 3 continuam
assumindo 1 loja por chamada (todo call site atual já filtra por loja — a
mesma verificação feita na revisão do fix de `movimentos` deve se repetir
aqui antes de fechar cada call site).

Call sites a atualizar (selecionar a coluna da chave natural onde faltar):
NF — `app/(app)/nota-fiscal/page.tsx`, `.../relatorio/route.ts`,
`.../export/route.ts`, `.../[id]/page.tsx`, `lib/movimentacao-operacao-auto.ts`,
`lib/resumo-dia.ts`, `lib/actions/busca-global.ts`. NF Items —
`app/(app)/nota-fiscal/[id]/page.tsx`, `lib/movimentacao-operacao-auto.ts`.
OP — `app/(app)/ordem-producao/page.tsx`, `.../relatorio/route.ts`,
`.../export/route.ts`, `app/(app)/validade/page.tsx`,
`components/movimentacoes/MovimentosTab.tsx`, `lib/resumo-dia.ts`,
`lib/actions/busca-global.ts`.

### 6. Backfill (script novo em `scripts/`, roda local)

Pra cada uma das 6 lojas: lê do Supabase (via `pg`, mesmo padrão de
`scripts/db.mjs`) todas as `notas_fiscais`+`nota_fiscal_items` com
`d_emissao_nfe >= '2026-07-13'` e todas as `ordens_producao` com
`identificacao_d_dt_previsao >= '2026-07-13' OR updated_at >= '2026-07-13'`
(cobre OPs antigas reabertas/alteradas depois do corte), e envia em lotes
de 200 pros 2 endpoints novos. Idempotente (todo endpoint faz upsert) —
pode rodar mais de uma vez sem duplicar.

## Tratamento de erro

Mesma filosofia do resto do sistema: o dual-write NUNCA lança nem bloqueia o
fluxo principal (upsert no Supabase continua sendo a fonte da verdade
operacional); falha só vira `console.error`. Os endpoints novos usam
transação (`BEGIN`/`COMMIT`/`ROLLBACK`) por request — uma nota malformada no
meio de um lote de 200 não deixa metade gravada.

## Verificação

Sem suite automatizada neste repo (convenção já estabelecida). Verificação
manual, mesmo modelo usado pra confirmar o fix de `movimentos` nesta mesma
auditoria: 1) inserir/alterar uma NF e uma OP reais via sync normal, conferir
que aparecem no Contabo com `id` próprio e mesma chave natural; 2) simular o
merge (`complementarNotasFiscais`/`complementarOrdensProducao`) com dado real
de um período que cruza os 90 dias e confirmar 0 duplicatas; 3) rodar o
backfill contra 1 loja primeiro, conferir contagem batendo com o Supabase,
só depois rodar nas 6.

## Fora de escopo

- Replay/backfill de NF/OP anteriores a 07-12 (já resolvido pelo backfill
  original de 2026-07-12).
- Qualquer mudança no comportamento do Supabase (upserts existentes
  continuam exatamente como estão).
- A poda de 90 dias em si (este projeto só fecha o risco de perda quando/se
  ela um dia for implementada — não é este projeto que vai implementá-la).
