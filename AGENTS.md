<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Arquitetura de histórico: Supabase (operacional) + Contabo (histórico completo)

O Supabase é o banco free tier (500MB) e guarda só os **últimos 90 dias** de dados
transacionais. O histórico completo (desde 2025-07, "pra sempre" a partir de agora)
mora num Postgres próprio no servidor Contabo (`185.193.66.240`), fora do Supabase,
sem limite de espaço.

**Tabelas cobertas:** `movimentos`, `movimentos_historico`, `notas_fiscais`,
`nota_fiscal_items`, `ordens_producao`, `webhooks`. Fora disso (cadastro, não
histórico): `produtos`, `clientes`, `fornecedores`, `lojas` — só no Supabase, nunca
duplicados no Contabo.

### Como o dado chega no Contabo

1. **Dual-write em tempo real** — `app/api/webhook/route.ts` grava cada webhook
   também no Contabo, fire-and-forget, logo após o insert no Supabase (nunca
   bloqueia nem quebra a resposta se o Contabo falhar).
2. **Backfill histórico** (já executado, não precisa rodar de novo) — copiou o que
   já existia no Supabase e completou via API do Omie o que faltava
   (`docs/superpowers/plans/2026-07-12-backfill-historico-1ano-contabo.md`).

### Como o app lê o histórico

`lib/historico-contabo.ts` é o módulo central — nenhuma tela fala direto com o
Contabo. Expõe uma função por tabela (`complementarNotasFiscais`,
`complementarOrdensProducao`, `complementarMovimentos`,
`complementarMovimentosHistorico`, `complementarNotaFiscalItems`) com o mesmo
contrato: recebe as linhas já lidas do Supabase, decide se precisa completar com o
Contabo (sempre que não há filtro de data, ou quando o período pedido cruza os
90 dias), mescla por `id` (dedupe automático) e devolve um array único — a tela
nem sabe que existem duas fontes. Se a API do Contabo falhar ou demorar mais que
5s, devolve só o que o Supabase tem; nunca quebra a página.

Para contagens que não podem ser truncadas por LIMIT (ex: card "total de OPs" na
home), usa `contarOrdensProducaoAntigas` — chama o endpoint com `count=true`
(faz `count(*)` no Postgres, não busca linhas).

Caso especial: `app/(app)/relatorio-movimentacao/` não lê tabela direto, chama a
RPC `relatorio_movimentacao_matriz` (SQL, faz join com `produtos`). Como `produtos`
não pode ser duplicado no Contabo, quando o período cruza os 90 dias a parte antiga
é buscada como linhas cruas (`buscarMovimentosHistoricoBrutos`) e reagregada em JS
(`agregarMovimentacaoJS`) usando metadados de produto/preço sempre do Supabase.

**17 arquivos adaptados** (busca global, relatórios de OP/NF/movimentação,
telas de OP/NF/movimentações/histórico/validade, home, transferências) — ver
`docs/superpowers/plans/2026-07-12-leitura-hibrida-contabo.md` para a lista completa
e o código de cada adaptação.

### A API do Contabo (`ntb-frio-api`)

Roda em `/opt/ntb-frio-api/server.js` no servidor Contabo (fora deste repo git —
não existe cópia local do arquivo, só no servidor), systemd service `ntb-frio-api`,
exposta em `https://frio-api.norteparanegocios.com.br`, autenticada por
`X-Api-Key` (`NTB_FRIO_API_URL`/`NTB_FRIO_API_KEY` no `.env.local` e na Vercel).
Endpoints: `POST /webhooks` (dual-write) e `GET /movimentos`,
`GET /movimentos_historico`, `GET /notas_fiscais`, `GET /nota_fiscal_items`,
`GET /ordens_producao` (leitura, aceitam `count=true` para contagem sem LIMIT).

**Proxy dos domínios (incidente 2026-07-18):** o rebuild automático do Hestia
regenerou os vhosts com o template padrão (php-fpm) e derrubou os dois
domínios que tinham `proxy_pass` editado NA MÃO: `frio-api.*` (API do
histórico — passou a responder 404 em tudo, e os relatórios híbridos
degradaram SILENCIOSAMENTE, porque o `buscarFrio` engole erro e devolve
`[]`) e `app-estoque.*` (cópia paralela do app, caiu no "Coming Soon").
Corrigido criando templates de proxy de verdade — `node-3001` (frio-api) e
`node-3002` (app-estoque) em
`/usr/local/hestia/data/templates/web/nginx/node-300{1,2}.{tpl,stpl}` — e
aplicando com `v-change-web-domain-proxy-tpl ntb <dominio> node-300X`.
Template aplicado pelo painel SOBREVIVE a rebuilds (o `estoque.*`, que já
usava template, não caiu); edição manual no conf gerado NÃO sobrevive —
nunca mais editar `/etc/nginx/conf.d/domains/*.conf` na mão. Se a fatia
fria "sumir" de novo: `curl` na URL pública (404 = proxy) e depois
`curl 127.0.0.1:3001` dentro do servidor.

**Detalhe de driver importante:** o `pg` do Node retorna `bigint` como string e
`date` como objeto `Date` completo por padrão — o `server.js` configura
`types.setTypeParser` pros OIDs 20 (bigint) e 1082 (date) pra normalizar isso
(number puro e string `YYYY-MM-DD` respectivamente). Sem isso, o dedup por `id`
no cliente falha silenciosamente (string `"123"` ≠ number `123`) e datas quebram
na formatação. Se algum endpoint novo for adicionado à API, checar se ele também
precisa dessa normalização.

### Backup noturno do Postgres do Contabo (`ntb-backup-postgres`)

Script versionado em `scripts/backup-postgres-contabo.sh` (também existe uma
cópia idêntica em `/opt/ntb-estoque/scripts/` no servidor — copiar de novo com
`scp` sempre que o script mudar aqui). `pg_dump` via `docker exec` no container
`supabase-db` (schemas `public`/`auth`/`storage`), gzip, retenção de 14 dias em
`/root/backups-ntb-estoque/`.

Agendado por systemd timer, **não** crontab — o `cron` deste servidor (Ubuntu
24.04, pacote `cron` 3.0pl1-184ubuntu2) ignora `CRON_TZ` silenciosamente
(confirmado ao vivo e na doc do pacote), então um `0 3 * * *` normal dispara no
fuso do servidor (Europe/Berlin), não em Brasília. As units, fora deste repo
git (só no servidor, mesmo padrão do `ntb-frio-api` acima):
`/etc/systemd/system/ntb-backup-postgres.service` e
`/etc/systemd/system/ntb-backup-postgres.timer`. O timer usa
`OnCalendar=*-*-* 03:00:00 America/Sao_Paulo` — o fuso vai dentro da própria
expressão de calendário (gramática do `systemd.time(7)`), **não** a chave
`TimeZone=` em `[Timer]`, que não existe nesta versão do systemd (255;
`systemd-analyze verify` acusa "Unknown key name"). Conferir agendamento com
`systemctl list-timers ntb-backup-postgres.timer`.

## Reunião com o Ramon de 2026-07-14 (transcrita via `/etl-audio`) e priorização pós-reunião

Reunião de ~55min testando ao vivo o app com o Ramon (opera o sistema nas
lojas reais Donana Rio Vermelho e Vinhas & Vinhetos). Lista completa de
achados, priorização combinada com o usuário (relatórios financeiros —
Margem/Faturamento/Auditoria Fiscal/Compras — viram fase própria, deixada
pro final) e o spec da primeira fase (renomeações, previsão editável,
triangulação de produto substituto, clareza visual de Transferências,
link produto→Movimentos): ver
`docs/superpowers/specs/2026-07-15-fase-a-melhorias-pos-reuniao-design.md`.

Achado relevante da pesquisa pré-spec: os 4 relatórios financeiros acima
**nunca foram migrados** pro padrão híbrido Supabase+Contabo já descrito
no topo deste arquivo (só leem Supabase, perdem dado silenciosamente além
dos 90 dias) — isso é o essencial da fase final, não um backfill novo do
zero.

## Leitura híbrida dos relatórios de NF (Compras, Auditoria Fiscal, Indicadores) — 2026-07-17

Esses 3 relatórios liam só o Supabase (janela de 90 dias) e perdiam
silenciosamente jan–abril. Agora usam leitura híbrida via
`lib/relatorio-frio-nf.ts`: quando o período pedido começa antes do corte
de 90 dias, a fatia antiga vem do Contabo (endpoints `/nota_fiscal_items`
+ `/notas_fiscais`) e é reagregada em JS, espelhando fielmente o
WHERE/GROUP BY das RPCs `relatorio_compras_*` (migration 075) e
`relatorio_auditoria_fiscal_*` (076). Mesmo padrão do precedente
`agregarMovimentacaoJS`. **Se essas RPCs mudarem, replicar a mudança em
`relatorio-frio-nf.ts` também.** Validado: a agregação JS bateu exato com
o SQL equivalente (R$173.463,56 / 135 notas, loja 2, jan–abr).

**Drill-down (2026-07-18):** os relatórios de Compras, Auditoria, Faturamento
e Movimentação têm drill nível-a-nível via `?drill=dim:rotulo|...`
(`lib/drill.ts` + `components/ui-kit/DrillBreadcrumb.tsx`). Convenções que
NÃO podem quebrar: (1) sentinela `__sem__` = "valor nulo" nas RPCs
`relatorio_compras_*` (migration 077) e `relatorio_auditoria_fiscal_*`
(078) e no espelho frio; (2) dimensões compostas `tipo>familia` e
`familia>produto` em `faturamento_importado` (rotulo `"<pai>>><filho>"`,
gravadas por `lib/omie/faturamento.ts`) — o drill do Faturamento depende
delas; (3) rótulos opacos são traduzidos na exibição por
`lib/rotulos-opacos.ts` (o dado continua com os rotulos crus). A tela
`/pendencias-classificacao` lista o que gera "Sem cadastro/família/tipo".
QA reproduzível: `scripts/qa-drilldown.mjs` (dev na porta 3008, conta QA).

**Fato de faturamento por cupom (2026-07-18):** além do pré-agregado
(`faturamento_importado`, tipo/família/forma_pgto sem grão de cupom),
`lib/omie/faturamento.ts` agora também grava o fato item-a-item no Contabo
— 3 tabelas novas, só lá, sem cópia no Supabase (Faturamento nunca teve
janela quente): `fat_cupons`, `fat_cupom_itens`, `fat_cupom_pagamentos`
(schema e endpoints em
`docs/superpowers/specs/2026-07-18-faturamento-fato-cupom-design.md`).
Endpoints novos na `ntb-frio-api`: `GET /fat_cupons`, `GET
/fat_cupom_itens`, `GET /fat_cupom_pagamentos` (aceitam `n_id_cupom` como
atalho pra 1 cupom) e `GET /fat_agregado?group=dia|forma|produto[&group2=mes]`
(agregação server-side; **sem** `group=tipo/familia` — `produtos` não pode
ser duplicado no Contabo, então tipo/família continuam vindo só do
pré-agregado). Escrita em `POST /fat_cupons_bulk` (transação, upsert),
chamada em lotes de 200 cupons pela ingestão (um mês cheio inteiro de uma
vez estoura o limite de body de 2mb do Express — 413 silencioso, descoberto
rodando a sync real). Leitura pelo app via `lib/faturamento-frio.ts` (mesmo
padrão de `buscarFrio`). A tela `relatorio-faturamento/page.tsx` só troca
pro fato em 3 gatilhos: aba "Forma de pgto" ativa, mais de 1 dimensão de
filtro ativa ao mesmo tempo, ou toggle "Ver cupons" — fora isso continua no
pré-agregado, sem mudança de comportamento. Backfill histórico (desde
01/07/2025, todas as lojas) roda sequencial no servidor Contabo, com
checkpoint pra retomar (script ad-hoc, fora do repo, mesmo molde do
backfill de NF).

**Dual-write de `movimentos` (2026-07-18):** o espelho de `movimentos` no
Contabo era uma cópia única de 07-12, congelada — o webhook em tempo real
ignora de propósito os tópicos `Produto.AjusteEstoque`/
`Produto.MovimentacaoEstoque` ("evita loop de ajuste"), então nenhum
evento de movimento nunca passou por ali. `lib/omie/sync-ajustes.ts` agora
chama `POST /movimentos_bulk` (endpoint novo na `ntb-frio-api`, mesmo
molde do `fat_cupons_bulk`) fire-and-forget depois de cada upsert no
Supabase, em lotes de 200. Chave natural: `(loja_id, id_ajuste)` — o
Contabo ganhou o mesmo índice único parcial que o Supabase já tinha
(migration 059). Backfill histórico desde 01/07/2025 (todas as 6 lojas,
incluindo a loja 4 apesar de excluída do cron de sync — a exclusão dela é
especificamente sobre "nunca testar escrita ao vivo", não sobre nunca
gravar dado real via API oficial) roda no servidor, grava nas duas bases.
**Achado incidental corrigido na mesma data:** o `.upsert()` do
supabase-js não consegue expressar `ON CONFLICT` contra um índice único
**parcial** (`WHERE id_ajuste IS NOT NULL`) — o Postgres exige o predicado
repetido no `ON CONFLICT` pra usar um índice parcial como árbitro, e o
PostgREST não gera isso. Resultado: o cron diário de `sync-ajustes` vinha
falhando silenciosamente (erro `there is no unique or exclusion
constraint...`) pra qualquer loja com ajuste novo, desde 29/06 (dia em que
o índice parcial e o cron foram introduzidos juntos) — a tabela só
parecia atualizada por causa de reprocessamentos manuais ad-hoc. Corrigido
com uma RPC (`upsert_movimentos_ajuste`, migration 079) que faz o
`INSERT ... ON CONFLICT (...) WHERE ... DO UPDATE` certo direto em SQL.
**Se qualquer outra tabela ganhar um índice único parcial no futuro, o
mesmo problema vai se repetir com `.upsert()` — sempre checar se o índice
é parcial antes de usar `onConflict` do supabase-js.**

**Chave do acumulador de faturamento (2026-07-18):** `lib/omie/faturamento.ts`
monta `faturamento_importado` agregando num `Map` cuja chave era uma string
tipo `"${dimensao}|${rotulo}|${mes}"`. Achado real: um produto com `|` no
próprio nome (loja com bebidas tipo "JOHNNIE WALKER | BLACK") quebrava o
`split('|')` na volta, corrompendo `rotulo`/`mes` e colidindo com outro mês
do mesmo produto (`duplicate key` em produção). Corrigido trocando a chave
pra `JSON.stringify([dimensao, rotulo, mes])` — à prova de qualquer
caractere no rótulo. **Qualquer novo código que monte uma chave composta
concatenando strings com um separador precisa considerar que rótulos vêm
de descrição de produto sem sanitização — prefira `JSON.stringify`/array
a um separador de texto.**

**Card financeiro "hoje" (2026-07-18):** `relatorio-indicadores/page.tsx`
(rota, tela ainda chamada "Fat × Compras") ganhou um card com saldo em
conta, a pagar/receber em aberto e fluxo de caixa projetado (5 dias), via
`lib/omie/financeiro-resumo.ts` → `ObterResumoFinancas` (1 chamada ao
Omie, sem sync nem tabela nova — chamada ao vivo a cada carregamento da
página). `contaCorrente.vTotal` é um saldo agregado (não por conta
bancária) e pode vir negativo/desconciliado no Omie — exibido com aviso
visual, não escondido. A meta de Compras÷Faturamento (antes fixa em 40%
no código) agora é `lojas.meta_compras_pct` (nula = 40%, editável em
"Minha loja").

**Auditoria pós-incidente do card financeiro + meta (2026-07-18):** ao
reverificar as 6 lojas ativas, achado o mesmo padrão de bug do 1000-linhas
do PostgREST (já visto em `estoque-valorizado`), mas fora de uma RPC: o
complemento frio de Compras em `relatorio-indicadores/page.tsx` lia
`produtos` inteiro com um `.from().select()` sem paginação, pra montar o
mapa `codigo_produto -> {tipo, familia}` usado no filtro por família. 5 das
6 lojas ativas têm >1000 produtos (2693/2313/2512/2510/2869; só a loja 7
com 693 escapava). Sem paginação, produtos além da linha 1000 (ordem não
garantida) ficavam de fora do mapa — silenciosamente excluídos do total de
Compras sempre que um filtro de família estivesse ativo E o período
cruzasse os 90 dias (o caso comum, já que o padrão é ano inteiro). Não
afetava a visão sem filtro (a agregação usa dim='cfop', que não depende do
mapa). Corrigido paginando com `.range()` + `.order('id')`, mesmo padrão de
`rpcTodos`. Faturamento e Compras (RPC quente + complemento frio) foram
cross-validados via SQL direto para as lojas 2 e 3 e bateram exato.

**Pré-requisito de dado resolvido nesta data:** os itens de NF antigos no
Contabo tinham `full_object` **vazio** (a cópia inicial de 07-12 trouxe as
linhas sem o JSONB, e é dele que saem CFOP de entrada, crédito de ICMS e
`codigo_local_estoque`). Backfill retroativo puxou tudo de novo do Omie
(`ListarRecebimentos`, `cExibirDetalhes=S`, desde 01/07/2025) e fez
`update` só nas linhas existentes (nunca insert/delete). O
`prune` cron **não apaga NF** (só webhooks + integration_attempts), então
não há risco de o buraco voltar por poda. Se `full_object` voltar a faltar
no Contabo no futuro (ex.: nova cópia de histórico que não traga o JSONB),
rodar de novo um backfill no mesmo molde (script foi ad-hoc, fora do repo).

### Limitações conhecidas

- `webhooks` anteriores a 2026-07-05 foram perdidos pelo prune de 7 dias que já
  existia antes do dual-write — não são recuperáveis (Omie não tem endpoint pra
  "listar webhooks antigos"). Dual-write garante que não se perde mais nada dali
  pra frente.
- Filtro de tipo/família/produto em `nota-fiscal/page.tsx` quando o período cruza
  os 90 dias só enxerga notas que já tinham itens correspondentes no Supabase — o
  cruzamento com o Contabo não foi implementado para esse caso específico.
