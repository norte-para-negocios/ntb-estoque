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
- `.in('coluna', [...])` do PostgREST/supabase-js com uma lista grande de
  valores (centenas+) gera uma URL longa o bastante pra estourar o limite de
  ~8KB do nginx/PostgREST e responder 414 URI Too Long — e `buscarTudoPaginado`
  trata QUALQUER erro de query como "acabaram as páginas", então o filtro vira
  silenciosamente "nenhum resultado" em vez de dar erro. Achado real (Task 10
  da auditoria de filtros/relatórios, 2026-08-05): o filtro de tipo/família/
  produto/local em Notas Fiscais (`nota-fiscal/page.tsx`, `export/route.ts`,
  `relatorio/route.ts`) resolve dois `.in()` em sequência que podem chegar a
  milhares de elementos (loja 3, tipo=01 = Matéria Prima, 1626 ids; tipo=07,
  633 códigos de produto) — os dois sofriam 414 e zeravam o resultado, mesmo
  100% dentro da janela quente. Corrigido com `buscarTodosPorIds` (`lib/
  utils-busca.ts`), que quebra o filtro em lotes pequenos o bastante pra nunca
  estourar o limite de URL (e ainda pagina por OFFSET dentro de cada lote,
  necessário quando a coluna filtrada não é chave primária). Risco sistêmico
  não auditado: `transferencia` e `inventario` (`page.tsx`, `export/route.ts`,
  `relatorio/route.ts`) usam o mesmo padrão (`idsFiltrados`) e podem ter a
  mesma vulnerabilidade se o filtro resolver uma lista grande o bastante —
  candidato forte pra um follow-up dedicado.

## Infra de deploy e migrations — riscos sistêmicos (revisão final, 2026-08-05)

### Migrations: aplicadas à mão, sem tracking

Este projeto **não tem runner automático de migration**. `supabase/migrations/*.sql`
é só um diretório de arquivos versionados — cada um precisa ser aplicado à mão,
via `docker exec -i supabase-db psql -U supabase_admin -d postgres <
arquivo.sql`, direto no Postgres self-hosted do Contabo. Não existe nada como
`supabase_migrations.schema_migrations` (a tabela que o Supabase CLI usaria
pra saber quais migrations já rodaram) — o único "registro" de que uma
migration foi aplicada é a memória de quem rodou o comando.

Isso já causou bug real em produção **3 vezes** na mesma auditoria:

1. **Migration 097** (`filtro_status_compras_auditoria.sql`) — ficou meses
   sem aplicar; as RPCs de Compras/Auditoria Fiscal chamadas com `p_status`
   falhavam com `function ... does not exist` em silêncio (código não
   checava `error` do `.rpc()`), escondendo os ~90 dias mais recentes de
   Compras em TODAS as 6 lojas. Corrigido na Task 2 desta auditoria (commit
   `4bd9867`).
2. **5 migrations da revisão final** (087, 089, 091, 095, 096) — nunca
   aplicadas em produção. A mais grave: 091
   (`relatorio_estoque_valorizado_local`) quebrava AO VIVO o toggle "Por
   local" do Estoque Valorizado (RPC inexistente, tela voltava vazia/R$0,00
   em silêncio). As outras 4 eram índices de performance (089/095/096, sem
   os quais certas queries estouravam `statement_timeout`) e um tiebreak de
   paginação (087). Aplicadas via o mesmo comando `docker exec -i
   supabase-db psql ... < supabase/migrations/0XX_*.sql`, na ordem numérica,
   e revalidadas ao vivo (ex.: `?ver=local` voltou a bater exato com SQL
   direto: R$1.086.711,29/1381 linhas, loja 3).
3. **Migration 090** (`movimentacao_preco_cache.sql`) — aplicada **pela
   metade** (Task 9 da auditoria de 2026-08-09): o `create table if not
   exists produto_preco_recente` rodou (ou foi criado à parte), mas a função
   `atualizar_preco_recente` e a troca da RPC `relatorio_movimentacao_matriz`
   pro JOIN na tabela cache nunca rodaram — a RPC ficou presa na CTE cara
   original (o mesmo risco de `statement_timeout` que a migration existia
   pra eliminar), e o cron horário `/api/cron/sync-preco-movimentacao`
   chamava uma função inexistente, falhando **silenciosamente por 9 dias**
   (`sync-cron.log` mostrava `-> 200` toda hora, porque a rota engolia o erro
   em `Promise.allSettled` e sempre respondia 200 mesmo com `falhas ===
   total`). Corrigido aplicando o resto do arquivo 090 + endurecendo 2
   pontos que a revisão desta correção achou: (a) `atualizar_preco_recente`
   fazia só UPSERT, nunca DELETE — um produto cujo item de preço válido
   (`nota_fiscal_items`) sumia ou era ressincronizado sem casar mais
   `n_preco_unit > 0` (a NF pai continuando ativa — confirmado ao vivo que
   NÃO existe nenhuma `notas_fiscais.deleted_at` preenchido em nenhuma loja,
   a causa não é "NF cancelada") ficava com preço órfão preso pra sempre no
   cache (confirmado ao vivo: loja 5/entradas, 6 produtos, R$927,05 de
   divergência permanente); fix em migration nova (105,
   `movimentacao_preco_cache_delete_orfaos.sql`) que apaga a linha órfã antes
   do upsert — a condição do DELETE é genérica ("não existe mais nenhum item
   válido"), cobre qualquer causa de sumiço, não só NF cancelada. (b) a rota
   do cron passou a responder HTTP 502 quando TODAS as lojas falham (mesmo
   padrão de `sync-posicao`/`sync-previsao`), pra um apagão como esse
   aparecer no log da próxima vez.

**Achado incidental da mesma verificação**: `relatorio_auditoria_fiscal_cfop`/
`relatorio_auditoria_fiscal_itens` tinham 2 overloads coexistindo em
produção — uma versão obsoleta (`p_familia text` singular, de antes da
migration 088) e a versão atual (`p_familias text[]` + `p_status`, criada do
zero pela migration 097 sem nunca passar pela forma intermediária de 088,
porque 088 também nunca rodou). Não era bug ativo (PostgREST desambigua por
nome de argumento quando o caller nomeia todos), mas era uma bomba-relógio
pro primeiro caller que não nomeasse um argumento. Removida a versão
obsoleta com `DROP FUNCTION` (assinatura exata, sem tocar na versão em uso).

**Se você aplicar uma migration nova**: confirme com `\df`/
`pg_get_functiondef` DIRETO no Postgres de produção antes de assumir que já
rodou — nunca confie só no fato de o arquivo existir no repo. E depois de
aplicar uma migration que crie/recrie uma função já existente, cheque `\df
nome_da_funcao` pra ver se sobrou mais de 1 overload (sinal de que uma
migration anterior na cadeia nunca rodou e o `DROP FUNCTION` dela nunca
disparou).

### Deploy: manual, `deploy.sh` não versionado, `.next` não é limpo

`git push origin main` **sozinho não deploya nada** — o servidor não tem
watcher nem CI/CD ligado a esse push. Deploy é sempre uma ação manual:

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "cd /opt/ntb-estoque && bash deploy.sh"
```

rodado de forma SÍNCRONA (sem `nohup`/background), aguardando a saída
completa antes de considerar o deploy feito. `deploy.sh` em si **não está
versionado neste repo** — vive só no servidor (mesmo padrão de outros
scripts de infra já documentados acima, tipo `ntb-frio-api`). Faz, nessa
ordem: `git pull`, `npm ci`, `npm run build`, restart do `systemctl` do
serviço `ntb-estoque`. **Não roda migrations** (ver seção acima) — só
código.

**Achado real (Task 10 da auditoria de filtros/relatórios, 2026-08-05)**:
`deploy.sh` não limpa `.next` antes de rodar `npm run build` — pelo menos 1
vez isso produziu um build que não refletia o commit recém-deployado
(suspeita: `.next/cache/.tsbuildinfo`, cache incremental do
TypeScript/RSC, não invalidado corretamente). Sintoma: o mesmo commit,
testado ao vivo logo após o deploy, mostrava comportamento do código
ANTERIOR; um segundo `npm run build` (sem `rm -rf .next`) resolveu sozinho.
Desde então, prática padrão: se qualquer deploy da sessão mostrar sinal de
build stale (código deployado não bate com o comportamento observado ao
vivo), rodar `rm -rf .next` antes do próximo `npm run build` pra garantir um
build limpo. `deploy.sh` em si não foi alterado pra fazer isso por padrão
(fora do escopo das tasks que encontraram o problema) — candidato a
follow-up.

Depois de todo deploy, confirmar com:
```bash
curl -s -o /dev/null -w "HTTP %{http_code}\n" https://app-estoque.norteparanegocios.com.br/login
```
esperando `200`.

### O "trap" do SLD em Movimentações

`tipo='SLD'` em `movimentos` é o SALDO CONTADO no inventário num instante
(foto da contagem física), **não** um movimento de estoque que
entrou/saiu — achado real confirmado por join `movimentos`(SLD) ×
`inventario_items`: 883/883 linhas batem exato, `quan` = a contagem digitada
pelo operador (ver `lib/movimentacao-manual.ts`, achado real #4 no
cabeçalho do arquivo, pro código CORRIGIDO e a evidência completa). Dois
lugares no código ainda tratam SLD como se fosse um movimento assinado
(ENT/SAI) — comportamento SUPERSEDED, mas **não corrigido** nesta rodada de
propósito (fix de verdade fica pra depois, fora de escopo):

- `components/movimentacoes/MovimentosTab.tsx:78` (`sinalEm`) — soma
  `m.quan` de SLD direto no saldo de um local, como se já viesse assinado.
- `lib/movimentacao-operacao-auto.ts` (linha do `sentido`, dentro do loop de
  `ajustes`, ~236-246) — atribui `sentido='S'` e soma `quan`/`valor` de
  qualquer ajuste que não seja `TRF`/`TPQ`/PDV, incluindo SLD, na matriz de
  "Movimento Manual de Estoque".

Comentários `// SUPERSEDED (auditoria 2026-08-05): ...` foram adicionados
direto nessas 2 linhas, apontando pra esta explicação, sem mudar o
comportamento de nenhuma delas. Se for corrigir de verdade:
`lib/movimentacao-manual.ts` já tem o padrão certo (SLD nunca soma em R$,
exposto separadamente por `agregarSaldoContado` como contagem de eventos,
não soma de quantidade entre contagens diferentes).

### `.env.local` local aponta pro Supabase cloud descontinuado

`NEXT_PUBLIC_SUPABASE_URL` em `.env.local`
(`https://waubqgkftwrufepwhctc.supabase.co`) ainda é o Supabase **cloud**,
desligado nesta mesma sessão de auditoria (ver topo deste arquivo, seção
"Arquitetura de histórico"). `npm run dev` local contra esse `.env.local`
mostra dado da nuvem congelada, não de produção — qualquer QA precisa ser
feito direto contra `https://app-estoque.norteparanegocios.com.br` (conta
`claude.qa@ntb-estoque.dev`), nunca contra `localhost`. Achado já registrado
na Task 1 desta auditoria; nota aqui só pra centralizar — atualizar
`.env.local` pras credenciais do self-hosted é candidato a follow-up rápido
(não fizemos porque pode conflitar com o setup de dev de quem já usa o
repo).

### Auditoria do Estoque Valorizado (Task 12, 2026-08-09) — sem bug no relatório, achado incidental em `posicao_estoques`

Reconferido ao vivo que as migrations 087 (tiebreak) e 091
(`relatorio_estoque_valorizado_local`) continuam aplicadas em produção e
batendo exato com o código-fonte (`pg_get_functiondef` comparado linha a
linha) — nenhuma regressão desde a correção de 2026-08-05. Paginação do
`rpcTodos` revalidada contra um caso real que cruza a fronteira de 1000
linhas (loja 3, RPC `relatorio_estoque_valorizado` sem filtro: 1021 linhas)
— soma e contagem das 2 páginas bateram exato com o total via SQL direto,
sem duplicata nem lacuna. Checado também o `INNER JOIN produtos` das duas
RPCs (exclui silenciosamente qualquer posição sem cadastro correspondente
na loja): zero linhas órfãs nas 6 lojas ativas na foto de hoje — risco
real, mas não manifestado.

**Achado incidental (fora do escopo deste relatório, não corrigido)**: linhas
de `posicao_estoques` com `n_saldo < 0` têm `n_cmc` com magnitude
absurda em algumas lojas — ex. loja 6, produto com `n_cmc` = R$
27.960.529.129,45/unidade (`valor = n_cmc * n_saldo` chega a -R$783
bilhões numa única linha); loja 5 também afetada (~-R$10,8 bilhões
somados). `n_cmc` vem direto do Omie (`p.nCMC` em
`lib/omie/posicao-estoque.ts`, sem transformação local) — não é bug
introduzido por este app, mas também não foi confirmado se é o que o Omie
realmente retorna ou um problema de parsing/campo. **Não afeta o Estoque
Valorizado**: a RPC já filtra `n_saldo > 0` (propósito do relatório é
"estoque atual", só posição positiva) e as linhas positivas reais
verificadas são todas plausíveis (maior valor de linha único: R$447.000).
Mas `posicao_estoques` é lido por outras 6 telas/RPCs sem esse mesmo filtro
de saldo positivo (`relatorio-margem`, `produto`, `home`, `resumo`,
`relatorio-movimentacao`, `sync-posicao`) — candidato a follow-up dedicado
pra confirmar se algum desses consumidores herda o valor corrompido.

**Correção (Task 13, 2026-08-09)**: pelo menos `relatorio-margem` já filtra
`n_saldo > 0`/`n_cmc > 0` — na tela (`page.tsx`) e no cron de snapshot
(`snapshot-margem-diario`), não herda o valor corrompido. A exportação
(`export/route.ts`) é a exceção: ver auditoria abaixo.

### Auditoria da Margem (Task 13, 2026-08-09) — export com fórmula desatualizada + `.error` não checado em 3 cópias locais

**Achado real principal**: `relatorio-margem/export/route.ts` calculava o
CMC "ao vivo" (caminho usado hoje por 6 de 6 lojas ativas — inclusive a
loja 3, única com import manual do FAT_DRV, porque esse import parou em
jun/2026) com o algoritmo ANTIGO — maior `n_cmc` entre locais, sem filtrar
`n_saldo > 0` — que já tinha sido substituído em `page.tsx` e no cron
`snapshot-margem-diario` em 2026-07-19 (migration 082: "o maior valor
sozinho superestima o custo") por uma ponderação por saldo. A exportação
nunca recebeu esse fix, então a margem do Excel divergia da margem
mostrada na tela pro MESMO produto no MESMO dia. Confirmado ao vivo (loja
2, foto de hoje): 287 produtos com CMC divergente entre os dois métodos
(diff média R$3,71/un., máx. R$137,14/un.); ex. "Moq. Mariscada 1300g
PIRAO E FRADINHO" saía 34,9% na exportação contra 43,0% na tela — 8,1 p.p.
de diferença no mesmo produto. Corrigido trocando pra ponderação por saldo
idêntica à tela/cron. Achado adicional no mesmo bloco: um `.filter()` final
escondia da planilha qualquer produto sem CMC/PDV cadastrado — o mesmo bug
já corrigido na tela em 2026-07-19, nunca replicado na exportação. Removido.

**Achado secundário (padrão recorrente desta auditoria)**: as 3 cópias
locais hand-rolled de `buscarTodasLinhas` (`page.tsx`, `export/route.ts`,
`snapshot-margem-diario/route.ts`) não checavam `error` — mesma classe de
bug da migration 097. Extraídas pro helper compartilhado
`lib/supabase/buscar-todas-linhas.ts` (mesmo padrão de `lib/supabase/
rpc-todos.ts`, já usado nas RPCs). No cron (mais grave, porque grava num
append-only sem retroativo possível — migration 101), uma falha de query
agora NÃO grava o snapshot do dia daquela loja (vira buraco detectável na
série, em vez de número errado gravado como se fosse real); a rota também
passou a responder 502 se todas as lojas falharem no mesmo dia (mesmo
padrão de `sync-posicao`/`sync-previsao`).

Cron confirmado rodando de verdade (não é o silêncio "-> 200 sem fazer
nada" da Task 9): `margem_snapshot_diario` tem os 9 dias esperados
(01–09/08) em todas as 6 lojas ativas, sem buraco (`count(distinct
data_snapshot) = max - min + 1` bate exato), 2700–8178 linhas/loja
(mínimo real é a loja 7, com 2700).

**Fix round 1 (revisão independente, 2026-08-09)** — 4 achados Important:

1. **Magnitude subestimada em ~10x.** A medição original só comparou o
   VALOR de CMC na interseção das 2 fórmulas (287 produtos, loja 2). Mas o
   CONJUNTO de linhas com margem válida também muda: produtos com
   `n_saldo <= 0` em TODOS os locais (maioria = estoque zerado hoje, não
   CMC quebrado) não geram CMC ponderado — e a fórmula antiga do export
   incluía qualquer linha com `n_cmc > 0`, sem olhar saldo. Números reais
   (produtos com margem válida, antes→depois da correção da fórmula):
   loja 2: 716→434; loja 3: 774→116; loja 4: 819→104; loja 5: 851→107;
   loja 6: 671→76; loja 7: 99→72. Lojas 3–6 perdem ~85% das linhas que
   tinham margem — é o que o usuário nota primeiro no Excel.
2. **Rótulo "CMC inválido" enganava em escala.** Na maioria desses ~700
   casos/loja recém-expostos a causa é só `n_saldo = 0` (sem estoque na
   foto), não CMC quebrado. Corrigido em `page.tsx`/`export/route.ts`: a
   query de `posicao_estoques` deixou de filtrar `n_cmc > 0` (só
   `n_saldo > 0`), com o filtro de CMC movido pra JS — isso permite montar
   um Set `temEstoque` e distinguir "Sem estoque na foto" (benigno) de
   "CMC inválido" de verdade (precisa de ação no Omie), tanto na tela
   quanto na coluna "Situação" do Excel.
3. **Buraco na série ficava invisível** — o próprio fix original (skip do
   snapshot do dia quando uma consulta falha, em vez de gravar dado
   corrompido) cria um buraco por desenho, e sem retry (cron roda só 1x/dia)
   uma falha transiente vira buraco permanente. `relatorio_margem_snapshot_matriz`
   fazia só `avg()` sem indicar quantos dias entraram. Corrigido com
   `supabase/migrations/106_margem_snapshot_dias_com_dado.sql` — a RPC
   agora também retorna `dias` (`count(distinct data_snapshot)` por
   codigo/mês); a tela mostra "(Xd)" ao lado do mês na "Evolução mensal".
   Aplicada em produção via `DROP FUNCTION` + `CREATE FUNCTION` (
   `CREATE OR REPLACE` não permite mudar a lista de colunas de saída de
   uma função `RETURNS TABLE`).
4. **Bug lógico no `todasFalharam`**: `every((r) => r.erro !== null)` era
   derrotado por qualquer loja legitimamente vazia (`erro: null`, mas sem
   gravar nada) — 5 lojas com erro real + 1 vazia ainda retornava 200,
   exatamente a classe de bug "cron parece bem durante um apagão" que a
   correção original queria fechar. Corrigido com um campo `sucesso:
   boolean` por loja (`true` só quando gravou `linhas > 0` sem erro) — a
   rota só responde 200 quando pelo menos 1 loja teve sucesso real.

Série ainda curta (9 dias) — não implementado retry no cron nesta rodada
(fora de escopo), só o buraco virou visível via `dias`.

### Auditoria do Faturamento × Compras (Task 14, 2026-08-09) — export ignorava produto/família + card financeiro documentado aqui em cima nunca existiu de fato

**Achado real principal**: o link "Baixar" de `relatorio-indicadores/page.tsx`
só levava `data_inicio`/`data_final`/`local` pra `export/route.ts` — os
filtros de produto e família (que a tela aplica dos dois lados da razão,
com o aviso visível "Indicadores filtrados") nunca chegavam na URL do
Excel, e `export/route.ts` nem sequer sabia ler esses dois parâmetros nem
tinha o complemento frio (Contabo) de Compras que `page.tsx` já tem desde
2026-07-17. Mesma classe de bug já corrigida antes em
`relatorio-compras/page.tsx` (ver comentário no `exportParams` de lá,
"produto e local ficavam de fora"), nunca replicada aqui. Confirmado ao
vivo o tamanho do problema (loja 3, família "DRINKS", período padrão real
do app sem filtro de data — `compIni` cai em 2026-01-01, primeiro mês com
faturamento importado nesta loja): Faturamento filtrado = R$89.268,07
contra R$4.516.364,14 sem filtro (1,98% do total); Compras filtradas = R$0
(nenhuma NF de entrada classificada em DRINKS no período) contra
R$1.666.753,61 sem filtro (já excluindo Ativo Imobilizado, igual à tela)
— ou seja, um usuário filtrando por família na tela via ~0% de
Compras÷Faturamento mas, ao clicar "Baixar", recebia o Excel com a razão
da loja INTEIRA (~36,9%), sem nenhum aviso de que o filtro foi ignorado.
Corrigido: `page.tsx` agora inclui `produto`/`familia` no `exportParams`;
`export/route.ts` foi reescrito pra espelhar `page.tsx` em tudo — mesma
seleção de dimensão (produto > família > tipo), mesmos parâmetros nas
duas RPCs, e o mesmo complemento frio de Compras (paginação de `produtos`
+ `buscarItensNFFrio` + `filtrarItensCompras`/`agregarComprasMatriz`) para
o pedaço anterior aos ~90 dias.

**Fix round 1 (revisão independente, 2026-08-09)** — 3 achados Important:

1. **Chamada ao vivo pro Contabo (`buscarItensNFFrio` → `buscarFrio`)
   engolia falha em silêncio, encolhendo Compras** — não é o card
   financeiro removido (ver achado documental abaixo), é ESTE mesmo
   relatório: sempre que o período cruza o corte de ~90 dias (o caso
   comum), `page.tsx`/`export/route.ts` chamam a API do Contabo ao vivo
   pra completar o lado de Compras. `buscarFrio` (`lib/historico-contabo.ts:
   113-115`) engole timeout/erro de rede e devolve `null`, que
   `buscarComPaginacaoPorData` convertia direto em `[]` — indistinguível de
   "sem NF antiga de verdade". Uma falha ao vivo (já aconteceu de verdade:
   incidente do rebuild do Hestia, 2026-07-18, documentado mais acima)
   não deixava a tela em branco, ela ENCOLHIA o lado de Compras da razão em
   silêncio, fazendo a loja parecer bater a meta quando só faltou dado.
   Corrigido de forma aditiva (sem tocar `lib/historico-contabo.ts`, usado
   por muitos outros relatórios fora de escopo): `buscarComPaginacaoPorData`/
   `buscarItensNFFrio` (`lib/relatorio-frio-nf.ts`) ganharam um `onErro?`
   opcional (mesmo padrão do `onErro` de `rpcTodos`); `page.tsx` mostra um
   banner de aviso (mesmo estilo dos banners de RPC das Tasks 11-13) e
   `export/route.ts` acrescenta o aviso no subtítulo da planilha (Excel não
   tem como mostrar um banner clicável).
2. **Causa raiz errada no achado incidental do ~0,14%** (ver correção
   abaixo) — não é drift entre cópias, é o limite conhecido de backfill.
3. **Magnitude do achado principal estava ~2x inflada** — a comparação
   original usava `p_ini='2025-06-01'` manual (nunca acontece sob os
   defaults reais do app) e esqueceu de excluir Ativo Imobilizado do RPC
   bruto. Sob o período padrão real (`compIni=2026-01-01` pra loja 3) e já
   excluindo Ativo Imobilizado, o número pré-fix é ~36,9%, não ~69,5% — a
   direção do achado (export ignorava o filtro) sempre esteve certa, só o
   número registrado estava errado. Números corrigidos acima.

**Achado documental (não é bug de código, mas confundiu a auditoria)**: a
seção "Card financeiro 'hoje'" registrada mais acima neste arquivo
(2026-07-18) descreve um card com saldo em conta/a pagar/fluxo de caixa
via `lib/omie/financeiro-resumo.ts` → `ObterResumoFinancas` que **não
existe mais** — removido no dia seguinte por pedido explícito do usuário
(commit `c337167`, 2026-07-20: "Indicadores/Fat x Compras não deve trazer
'coisas do financeiro'"). O arquivo `lib/omie/financeiro-resumo.ts` foi
apagado junto; nada no `page.tsx` atual o referencia. A documentação acima
nunca foi atualizada para refletir a reversão — mantida aqui só como nota
de rodapé pra quem ler a seção de 07-18 e se confundir como esta auditoria
se confundiu; a seção antiga não foi editada/removida para preservar o
histórico do porquê a feature existiu e foi tirada.

**Verificado, sem achado**: `lojas.meta_compras_pct` (meta de
Compras÷Faturamento, editável em "Minha loja") — 4 das 6 lojas ativas
(2, 4, 6, 7) têm o campo `NULL` hoje; `metaPct = lojaRow?.meta_compras_pct
?? 40` cobre tanto "coluna nula" quanto "query da loja falhou" (mesmo
fallback, sem `NaN`/`undefined` em nenhum dos dois casos) — confirmado
direto no Postgres de produção.

**Achado incidental (não corrigido, benigno hoje, causa raiz corrigida na
revisão)**: a comparação entre a RPC `relatorio_compras_matriz` chamada
com o período INTEIRO direto (o que `export/route.ts` fazia antes desta
correção) e o mesmo período via o par clamp-90-dias + complemento frio que
`page.tsx` sempre usou mostrou uma diferença de ~0,14% pra loja 3
(R$2.535.024,48 direto da RPC contra R$2.530.788,50 somando o espelho
frio do Contabo pro mesmo intervalo, 2025-06-01 a 2026-05-10). A causa
real não é drift entre cópias (descrição original desta seção estava
errada) — é o limite de backfill já documentado no topo deste arquivo: o
histórico no Contabo (`ntb_frio`) só começa em 2025-07-01. Confirmado
direto no Postgres: `notas_fiscais` na base fria começa em 2025-07-01 em
todas as 6 lojas (`min(d_emissao_nfe)`), enquanto o Supabase self-hosted
(quente) já tinha dado de junho/2025 pra loja 3 (R$4.250,61 em Compras
nesse mês, contra R$0,00 no espelho frio) — bate quase exato com a
diferença de R$4.236 observada. Ou seja: qualquer período pedido antes de
01/07/2025 perde a fatia de junho/2025 por completo no complemento frio
(mesmo mecanismo silencioso do "Fix round 1" logo acima, mas aqui é um
limite de dado conhecido, não uma falha transiente). Benigno hoje porque
nenhum filtro padrão do app cruza essa data (o período default sempre
começa no primeiro mês com faturamento importado, que pra todas as 6
lojas ativas é 2026 ou depois) — só afetaria alguém filtrando manualmente
uma `data_inicio` anterior a 01/07/2025. Mesmo mecanismo compartilhado com
Compras e Auditoria Fiscal (os outros 2 relatórios que usam
`buscarItensNFFrio`). Não corrigido agora (fora de escopo desta task) --
candidato a follow-up: simplificar as 3 rotas (aqui, `relatorio-compras`,
auditoria fiscal) pra não clampar mais e ler a RPC quente direto no
período inteiro quando ele não cruza 01/07/2025 (mesmo padrão já aplicado
em `nota-fiscal/relatorio`/`nota-fiscal/export` pelo Task 1 da auditoria
de 2026-08-04), com um aviso explícito se o filtro cruzar o limite de
backfill.

### Auditoria da Auditoria Fiscal (Task 15, 2026-08-09) — sem bug de dado ativo, mas RPCs/frio sem sinalização de falha

Confirmado ao vivo que as migrations 076/078/081/088/097 (RPCs
`relatorio_auditoria_fiscal_cfop`/`_itens`) e 102 (`_cst`) estão aplicadas
em produção, cada função com exatamente 1 overload (sem duplicata), e
`pg_get_functiondef` bate byte a byte com o corpo final esperado (097 pras
duas primeiras, 102 pra CST) — nenhuma regressão desde as correções
anteriores desta auditoria. Cross-validado com SQL direto pra loja 3 no
período `[corte_90d, hoje]`: `relatorio_auditoria_fiscal_cfop` bateu exato
(2630 itens / R$613.001,26) e `relatorio_auditoria_fiscal_cst` também
(6855 itens / R$1.737.072,21 no ano corrente). O espelho frio (Contabo)
também tem dado real presente pro pedaço antigo da loja 3 (jan–10/mai:
4087 itens / R$1.094.741,38) — a API do Contabo está no ar hoje (401 sem
chave, não 404/timeout), então não há perda ativa de dado agora.

**Achado real (mesma classe de bug já corrigida em Compras/Margem/
Indicadores nesta mesma auditoria, Tasks 2/12/13/14)**: nenhuma das 3 RPCs
desta tela (`page.tsx` e `export/route.ts`) checava `error`, a paginação
de `produtos` em `buscarMetaProdutos` (usada pra classificar
tipo/família) também não, e — mais importante — as duas chamadas a
`buscarItensNFFrio` (resumo por CFOP e drill-down por item) nunca
passavam o `onErro` que a Task 14 já tinha adicionado a
`lib/relatorio-frio-nf.ts` especificamente pra sinalizar quando o Contabo
falha (`buscarFrio` engole timeout/erro de rede e devolve `null`, que
virava `[]` idêntico a "sem NF antiga de verdade" -- incidente real já
documentado, rebuild do Hestia em 2026-07-18). Como o período padrão desta
tela ("Ano corrente") sempre cruza a janela quente de 90 dias, o
complemento frio roda em toda carga default -- sem essa sinalização, uma
falha no Contabo hoje encolheria o resumo por CFOP em silêncio, sem
nenhum aviso. Corrigido: as 3 RPCs e `buscarMetaProdutos` agora acumulam
erro num array (`errosConsulta`, mesmo padrão de `relatorio-margem`/
`relatorio-compras`) com banner de aviso na tela; as duas chamadas a
`buscarItensNFFrio` passam `onErro`; `export/route.ts` ganhou o mesmo
tratamento com o aviso embutido no subtítulo da planilha (mesmo padrão de
`relatorio-indicadores/export`). Nenhum dado exibido mudou -- é
instrumentação preventiva, não correção de número errado.

**Não corrigido (mesmo achado documentado nas Tasks 11/14, fora de
escopo)**: `relatorio-compras` também chama `buscarItensNFFrio` sem
`onErro` -- candidato a follow-up pra fechar a mesma lacuna lá.

### Auditoria das Pendências de Classificação (Task 16, 2026-08-09) — última task da série (8-16), sem bug de dado ativo, mesma lacuna de sinalização de falha

Suspeita do brief confirmada: as 3 chamadas a `buscarItensNFFrio` desta
tela (`page.tsx:103`, `export/route.ts:64` no bloco `sem-familia`,
`export/route.ts:140` no bloco `sem-cadastro`) rodavam sem `onErro`, e 5
consultas Supabase (`carregarTodosProdutos`/`carregarQuentes`/
`naoIdentRows` em `page.tsx` + as 2 equivalentes em `export/route.ts`) não
checavam `error` -- mesma classe de bug das Tasks 12-15. Confirmado ao
vivo com join direto no Postgres nativo do Contabo (`ntb_frio`, fora do
Docker) que o pedaço frio carrega valor substancial nesta tela (NF
concluída no período `[ini12m, corte)`, ~9 meses: loja 2 R$1.908.580,
loja 3 R$2.324.772, loja 4 R$968.364, loja 5 R$2.976.431, loja 6
R$1.701.654, loja 7 R$102.215) -- uma falha silenciosa do Contabo
encolheria os 3 blocos de "R$ associado" (sem família/tipo/cadastro) por
essa magnitude sem aviso nenhum. Corrigido: mesmo padrão de
`errosConsulta`/banner em `page.tsx`. `export/route.ts` é o único export
CSV puro do app (todos os outros são xlsx com "subtítulo de planilha") --
sem esse slot disponível, o aviso vira uma linha `AVISO: ...` prependada
antes do cabeçalho quando alguma consulta falha (convenção nova,
documentada em comentário no arquivo). Nenhum dado exibido mudou --
instrumentação preventiva. Commit `dc7de81`.

### Rollup: `buscarItensNFFrio` sem `onErro` (Tasks 11/14/15/16, 2026-08-09)

Consolidando o que ficou espalhado em prosa nas Tasks 11/14/15/16 -- todo
call site de `buscarItensNFFrio` (`lib/relatorio-frio-nf.ts`) na base,
status de `onErro` a partir de 2026-08-09:

- **Faturamento × Compras** (`relatorio-indicadores/page.tsx`,
  `relatorio-indicadores/export/route.ts`) -- corrigido, Task 14.
- **Auditoria Fiscal** (`auditoria-fiscal/page.tsx`,
  `auditoria-fiscal/export/route.ts`) -- corrigido, Task 15.
- **Pendências de Classificação** (`pendencias-classificacao/page.tsx`,
  `pendencias-classificacao/export/route.ts`) -- corrigido, Task 16.
- **Notas Fiscais** (`nota-fiscal/page.tsx:191`, via `buscarNotaIdsFrio` em
  `lib/relatorio-frio-nf.ts:139`, usado pra resolver o filtro de produto/
  família/local que cruza os 90 dias) -- era o 4º call site sem `onErro`,
  esquecido no rollup original (a lista abaixo só cobria os 3 relatórios de
  auditoria dedicada, Tasks 11/14/15/16, mas `buscarItensNFFrio` também é
  chamado indiretamente por `nota-fiscal/page.tsx`). Corrigido na fix wave
  final (2026-08-09/10): `buscarNotaIdsFrio` ganhou `onErro?`, repassado a
  `buscarItensNFFrio`; a tela ganhou `errosConsulta`/banner (mesmo padrão
  dos 3 relatórios acima).
- **Compras** (`relatorio-compras`) -- **ainda falta**, 3 call sites:
  `page.tsx:220`, `export/route.ts:153`, `export-completo/route.ts:139`.
  Já mencionado como achado (fora de escopo) nas Tasks 11/14/15/16 sem
  nunca virar correção -- escopo fechado da Task 11 original desta
  auditoria, portanto não corrigido aqui. **Candidato a follow-up
  dedicado**: aplicar o mesmo padrão de `errosConsulta`/banner (páginas)
  e aviso embutido no export (subtítulo de planilha nos xlsx,
  `export-completo` incluso) já usado nos 3 relatórios acima.

### `sync-ajustes` nunca foi migrado pro crontab real do Contabo -- `movimentos` parado desde ~02/08 (Task 17 da auditoria de retry Omie, 2026-08-09)

Achado incidental durante a Task 17 (investigação pura de vínculos
produto↔inventário↔NF↔OP -- ver
`.superpowers/sdd/2026-08-09-retry-omie-auditoria-detalhes/task-17-report.md`
pro relatório completo). Ao medir a cobertura do join
`inventario_items.id_ajuste = movimentos.id_ajuste` (só 19,6%, 883/4.514),
apareceram 3 causas distintas pra lacuna, e uma delas é um cron morto:

`/api/cron/sync-ajustes` (`lib/omie/sync-ajustes.ts`, popula `movimentos` a
partir de `ListarAjusteEstoque` do Omie) só está agendado em
`vercel.json` (`"30 4 * * *"`). Mas a produção não roda mais no Vercel --
o cron real é `scripts/sync-cron.sh`, chamado pelo crontab do sistema no
Contabo. Confirmado ao vivo (`crontab -l` no servidor: só `sync-cron.sh` a
cada 10min + `sync-auth-standby.mjs` a cada 15min) e lendo
`scripts/sync-cron.sh` por completo: ele chama `sync-nfs`, `sync-ops`,
`retry-op-conclusao`, `sync-posicao`, `sync-reconciliar-op`,
`sync-locais`, `sync-produtos`, `sync-previsao`, `sync-movimentos`,
`sync-faturamento`, `sync-preco-movimentacao`, `snapshot-margem-diario`,
`snapshot-op-planejada` -- **`sync-ajustes` nunca aparece**. Ou seja: desde
a migração do cron do Vercel/GitHub Actions pro crontab real do Contabo
(já documentada acima neste arquivo), `sync-ajustes` ficou pra trás e
nunca foi incluído. `movimentos` não recebe ajuste novo do Omie há mais
de uma semana (consistente com os itens de inventário sem match cujo
`created_at` chega até hoje) -- afeta as telas de Movimentações, o
relatório de Movimentação, o Resumo do dia, e qualquer view que dependa
de `movimentos` tipo SLD atualizado.

**Outras 2 causas da mesma lacuna, essas permanentes (não é só religar o
cron que resolve)**: (a) `app/api/cron/sync-ajustes/route.ts:18-19` exclui
a loja 4 por desenho (`// Exclui loja 4 (O SERTAO VAI VIRAR MAR -
produção protegida)`) -- ajustes dessa loja nunca entram em `movimentos`
via cron, ponto; (b) o cursor do `sync-ajustes` (`MAX(id_ajuste)` de toda
`movimentos` da loja) não distingue "id_ajuste que o cron buscou da API"
de "id_ajuste que o próprio app gravou direto" -- `lib/actions/
movimentacoes.ts:98-111` (ajuste manual de saldo) e `lib/actions/
transferencia.ts:377-390` (envio de transferência) também fazem
`.update({ id_ajuste: res.id_ajuste, ... })` em `movimentos` depois de
chamar `IncluirAjusteEstoque` direto, fora do sync. Um ajuste manual de
hoje (id alto) empurra o cursor pra frente na hora, e qualquer ajuste de
inventário mais antigo com id MENOR que nunca foi buscado pelo cron fica
permanentemente "abaixo do cursor" -- reiniciar o cron não traz essas
linhas de volta.

**Não corrigido nesta task** (Task 17 é investigação pura, sem código) --
plano de ação: o fix de crontab (adicionar `sync-ajustes` em
`scripts/sync-cron.sh`) entra como parte do escopo da Task 6 desta mesma
auditoria (que já vai mexer nesse script pra ligar os crons de retry). O
redesign do cursor (pra não conflitar com escrita direta do app) é mais
envolvido -- registrado aqui como candidato a follow-up separado, fora do
escopo de hoje.

## Fix wave final da auditoria de retry Omie (Critical + Importants #2-5, 2026-08-09/10)

Revisão final de todo o branch da auditoria de retry Omie (36 commits,
`827bddd..b96cb65`) achou 1 Critical ativo em produção AGORA + 4 Important.
Corrigidos todos numa única dispatch (ver
`.superpowers/sdd/2026-08-09-retry-omie-auditoria-detalhes/final-review-fix-report.md`
pro relatório completo, antes/depois de cada trecho).

**Critical -- loop infinito de reenvio `TRF` pro Omie**:
`retryMovimentosManuaisPendentes` (`lib/actions/movimentacoes.ts`) filtrava
elegibilidade só por `status`/`transferencia_id IS NULL`, sem checar `tipo`.
Qualquer linha `TRF` (ou qualquer tipo fora de ENT/SAI) com
`transferencia_id NULL` era reenviada pra sempre a cada 10 min: o payload
manual não tem `codigo_local_estoque_destino` (só o fluxo de transferência
preenche), o Omie recusa 100% das vezes, e `status='Erro'` genérico não tem
teto de tentativas por design -- ~2 chamadas Omie por linha a cada ciclo,
indefinidamente, contra um ERP de produção. Corrigido adicionando
`.in('tipo', TIPOS_MANUAIS_ARR)` (ENT/SAI) às 3 queries de elegibilidade da
função. Linhas `TRF`/`transferencia_id NULL` presas em `status='Erro'` antes
deste fix são **órfãs estruturalmente** -- não têm o dado que o fluxo de
transferência precisaria pra reenviar por lá também, e não devem ser
reprocessadas por nenhum caminho sem investigação dedicada. **A query real de
produção pra contar/localizar essas linhas (achado citado no brief: pelo
menos ids 126-155 na loja 4, e também loja 3) não foi executada por este
agente** -- SSH em produção ficou explicitamente fora do escopo desta
dispatch (mesma restrição do passo de deploy, ver relatório). Query pronta
pro controller rodar via `docker exec -i supabase-db psql -U supabase_admin
-d postgres`:
```sql
select loja_id, id, status, tentativas, ultima_tentativa_em
from movimentos
where transferencia_id is null and tipo = 'TRF' and status = 'Erro'
order by loja_id, id;
```
Depois de confirmar a contagem/lista, considerar mover essas linhas pra um
`status` que não apareça mais no filtro de retry (ex.: `'Erro - órfã'`) --
sem apagar nem reprocessar por outro caminho sem decisão explícita do
usuário.

**Important #2 -- `'Processando'` travado sem reclaim**: as 3 funções de
retry (`retryAjustesInventarioPendentes` em `inventario.ts`,
`retryMovimentosTransferenciaPendentes` em `transferencia.ts`,
`retryMovimentosManuaisPendentes` em `movimentacoes.ts`) marcam a linha como
`'Processando'` antes de chamar o Omie, mas um crash/timeout nesse meio
tempo deixava a linha travada nesse status pra sempre -- nenhuma query de
retry selecionava `'Processando'`. Achado real: `inventario_items` ids 5066,
5259, 7033, 7035 (loja 4) presos desde 24/07, 27/07 e 08/08. Corrigido nas
3 funções: uma query adicional reclama linhas
`status='Processando' AND ultima_tentativa_em < now() - interval '1 hour'`,
tratadas com a mesma prioridade/sem teto de `'Erro'`. `maxDuration=300`
(Next.js) **não** protege contra isso nesta infra self-hosted -- é só um
hint do Vercel, sem efeito no servidor Contabo.

**Important #3 -- timeout de 120s do `curl` estourado em todo ciclo**: os 3
crons novos (`retry-ajustes-inventario`, `retry-ajustes-movimentos`,
`sync-ajustes`) batiam no timeout de `-m 120` de `scripts/sync-cron.sh` em
todo ciclo desde o deploy (log sempre `000ERR`). Corrigido reduzindo
`limitePorLoja` de 30 pra 10 nas 3 funções de retry (`retryAjustesInventarioPendentes`,
`retryMovimentosTransferenciaPendentes`, `retryMovimentosManuaisPendentes`)
e subindo o timeout global de `hit()` em `sync-cron.sh` pra `-m 240`
(`hit()` usa um `-m` fixo pra todas as ~20 chamadas do script; diferenciar
por endpoint exigiria reescrever a função só pra 3 delas -- optou-se pelo
aumento global, complementar à redução de `limitePorLoja`).

**Important #4 -- crons de retry sempre 200, mesmo com falha total**:
`app/api/cron/retry-ajustes-inventario/route.ts` e
`.../retry-ajustes-movimentos/route.ts` respondiam 200 incondicionalmente.
Corrigido com o mesmo padrão de `snapshot-margem-diario`/
`sync-preco-movimentacao` (Tasks 9/13): 502 quando houve trabalho de
verdade (algo pendente ou erro de query em qualquer loja) e nenhum sucesso
real -- um ciclo sem nada pendente continua 200 (é o caso saudável mais
comum, não pode virar alarme falso).

**Important #5 -- 142 notas fiscais ausentes só documentadas em doc
gitignored**: ver seção nova abaixo.

**Minor corrigido**: `buscarNotaIdsFrio` (`nota-fiscal/page.tsx`) era o 4º
call site de `buscarItensNFFrio` sem `onErro` -- ver rollup atualizado
acima.

**Minor documentado, não corrigido (comportamento pré-existente, não
regressão desta wave)**: os 2 crons novos de retry (`retry-ajustes-
inventario`, `retry-ajustes-movimentos`) escrevem de verdade na loja 4 --
`getLojasAtivas()` não exclui essa loja, ao contrário de `sync-ajustes`
(que exclui por desenho, "nunca testar escrita ao vivo" -- ver seção acima).
Isso é o **mesmo padrão que `retry-op-conclusao` já tinha** antes desta
auditoria (também sem exclusão de loja 4) -- não é uma regressão nova, mas
também nunca foi uma decisão explícita, só aconteceu por a exclusão de
`sync-ajustes` nunca ter sido replicada nos crons de retry. Registrado aqui
pra virar decisão reconhecida em vez de acidente: se a loja 4 precisar
voltar a ficar 100% livre de escrita automática, os 3 crons de retry
(`retry-op-conclusao`, `retry-ajustes-inventario`, `retry-ajustes-
movimentos`) precisam da mesma exclusão, não só `sync-ajustes`.

**Minor confirmado, sem ação**: `tentativas` compartilhado entre `Erro`/
`Sem CMC` (já documentado como minor deferido em revisões anteriores desta
auditoria) continua registrado como tal -- nenhuma mudança de comportamento
nesta wave.

### As 142 notas fiscais ausentes no espelho do Contabo (Important #5, 2026-08-09/10)

Achado documentado até agora só no cabeçalho de
`scripts/reconcile-notas-fiscais-frio.sql` (seção "GAP MAIOR") e no
relatório gitignored da Task 11 -- nunca chegou a este arquivo. Registrando
aqui pra não se perder:

**O quê**: 142 notas fiscais existem no Supabase (quente, sempre correto) e
**não existem de jeito nenhum** no espelho do Contabo (`ntb_frio`) -- não é
`c_etapa` desatualizado (isso é o achado MENOR do mesmo script, as 134 notas
já corrigidas em 2026-08-09, ver `reconcile-notas-fiscais-frio.sql`), é
**linha totalmente ausente**. 141 das 142 já estão dentro da janela fria
hoje (fora dos ~90 dias quentes) -- só 1 ainda está na janela quente.

**Magnitude, medida ao vivo em 2026-08-09**: ~R$161.067,94 já ausentes do
total "Concluída" da tela de Compras **hoje**, somando as 141 notas já
frias em todas as lojas. Maior concentração: loja 5, 105 notas emitidas em
março/2026, R$131.897,55 sozinhas.

**Telas afetadas**: qualquer relatório que dependa do complemento frio de
NF pra período que cruza os 90 dias -- principalmente **Compras**
(`relatorio-compras`), mas também Auditoria Fiscal e o lado Compras de
Indicadores (Faturamento × Compras), já que os 3 leem `notas_fiscais`/
`nota_fiscal_items` do Contabo via o mesmo `lib/relatorio-frio-nf.ts`
(`buscarItensNFFrio`). O sumiço é silencioso -- não aparece como erro, só
como um total menor do que deveria.

**Por que o script já executado (as 134 notas de `c_etapa` desatualizado)
NÃO resolve isso**: aquele script é um `UPDATE` -- só corrige `c_etapa` de
linhas que **já existem** no Contabo mas com status errado. As 142 notas
deste achado não têm linha nenhuma pra atualizar; a causa raiz é a mesma
(dual-write de `gravarNotaFiscalNoFrio`, `lib/omie/nota-fiscal.ts`, é
fire-and-forget sem retry -- qualquer falha transitória na chamada, ex.: o
incidente do rebuild do Hestia documentado acima neste arquivo em
2026-07-18, perde a nota permanentemente), só que na chamada de **INSERT**
em vez de UPDATE. Um `UPDATE ... WHERE (loja_id, n_id_receb) IN (...)`
não cria linha nenhuma quando a chave não existe -- por design, não é bug
do script, é escopo diferente do problema.

**Mecanismo proposto (não implementado nesta wave, fora de escopo -- é
achado documental, não código)**: mesmo padrão de retry já usado nos outros
3 fluxos desta auditoria (`retry-ajustes-inventario`, `retry-ajustes-
movimentos`, `retry-op-conclusao`) -- um cron dedicado que varre
`notas_fiscais`/`nota_fiscal_items` do Supabase (quente) num período
recente, verifica quais chaves `(loja_id, n_id_receb)` **não existem** no
Contabo (via `GET /notas_fiscais?loja_id=...` na `ntb-frio-api`, comparando
o conjunto de ids) e reenvia via `POST` (endpoint de INSERT teria que ser
adicionado à API, ou reusar `gravarNotaFiscalNoFrio` chamando-o de novo
pras chaves faltantes). Diferente dos retries de ajuste (que reenviam pro
Omie), este reenvio é só entre Supabase e Contabo -- ambos já têm o dado
completo, só falta copiar. Candidato a follow-up dedicado; também vale medir
de novo a magnitude antes de implementar (o achado é de 2026-08-09, pode ter
crescido).

## Revisão final do plano de retry Omie + auditoria (2026-08-10)

A revisão final de todo o branch (36 commits, plano `2026-08-09-retry-omie-
auditoria-detalhes`) achou 1 Critical ativo em produção: `retry-
ajustes-movimentos` (fluxo manual, `retryMovimentosManuaisPendentes` em
`lib/actions/movimentacoes.ts`) não filtrava por `tipo`, reenviando
registros `TRF` (que só deveriam existir vinculados a uma transferência)
pra Omie sem parar -- 100% das chamadas reais desde o deploy anterior
foram rejeitadas (falta `codigo_local_estoque_destino`, que só o fluxo de
transferência preenche), e como `status='Erro'` genérico não tem teto de
tentativas, isso rodava a cada 10min pra sempre. Corrigido com
`.in('tipo', ['ENT','SAI'])` nas 3 queries de elegibilidade.

O fix desse Critical (junto com outros 4 achados Important da mesma
revisão -- reclaim de `'Processando'` travado, timeout de 120s dos crons
novos, crons sempre retornando 200, e este mesmo achado das 142 notas
documentado acima) passou por 1 rodada de re-revisão, que achou um
regressão HIGH: o reclaim de `'Processando'` reabria a mesma janela de
double-send que o marcador de `'Processando'` existe pra evitar (o update
em lote não gravava `ultima_tentativa_em`, então uma linha `Sem CMC`
recém-selecionada -- que só é elegível quando já tem >1h de idade --
ficava reclamável pelo próprio reclaim enquanto ainda estava em voo).
Corrigido gravando o timestamp no mesmo update (3 lugares:
`inventario.ts`, `movimentacoes.ts`, `transferencia.ts`), reordenando
`processandoTravados` pra frente da fila de prioridade (evita fome do
reclaim sob `limitePorLoja=10`), e adicionando `flock -n` no crontab (o
`-m 240` do curl aumentou o pior caso de execução do ciclo pra perto do
próprio intervalo de 10min, sem isso duas execuções do script poderiam
sobrepor).

**Resíduo não resolvido, deixado como está por decisão explícita do
usuário (2026-08-10)**: 23 linhas de `movimentos` (`tipo='TRF'`,
`transferencia_id IS NULL`) ficaram presas em `Erro`/`Sem CMC`/
`Processando` (ids 37/39 loja 3, 126-155 loja 4, 285-308 loja 6,
`tentativas` de 1 a 6) por causa do bug do parágrafo acima. O fix já
impede que sejam selecionadas de novo pelo retry (mesmo filtro de `tipo`
as exclui) -- são inofensivas agora, só resíduo visual/histórico. Causa
raiz de como viraram `TRF` sem `transferencia_id` vinculado não foi
investigada; candidato a follow-up se reaparecer.

## Nomenclatura SEFAZ + auditoria completa do Faturamento (2 bugs, reconciliação automática, 2026-08-10)

Sessão que corrigiu 2 bugs reais no fato granular do Faturamento
(`fat_cupons`/`fat_cupom_itens`/`fat_cupom_pagamentos`, Postgres nativo
do Contabo, `ntb_frio` -- ver seção "Fato de faturamento por cupom"
mais acima), auditou o histórico de 2025 contra a Omie ao vivo, e
blindou `syncFaturamento` com reconciliação automática pra esse tipo de
"dado lixo" nunca mais precisar de correção manual.

**Bug 1 -- cupom cancelado depois da 1ª sync nunca atualizava no fato**:
`syncFaturamento` (`lib/omie/faturamento.ts`) reprocessa o ano corrente
inteiro a cada run (1x/hora, sem cursor), mas tinha um `continue` que
pulava o cupom cancelado ANTES de gravá-lo em `cuponsBulk` -- ou seja,
um cupom que virava `cancelado='S'` na Omie DEPOIS de já ter sido
gravado como Normal ficava preso assim pra sempre, porque nunca mais
entrava no `POST /fat_cupons_bulk` pra o UPSERT corrigir. Corrigido
(commit `437bf7c`) movendo o `push` em `cuponsBulk` pra antes do
`continue`, com `cancelado`/`devolvido` calculados uma vez no topo do
loop -- o `continue` continua existindo e correto pro que sempre fez
(excluir cancelado de itens/pagamentos/agregado), só deixou de excluir
também o cabeçalho do fato bruto. Deployado e confirmado com dado real:
disparando `/api/cron/sync-faturamento` manualmente, 8 cupons foram
corrigidos (loja 2: 1/R$437,03; loja 3: 6/R$1.113,30; loja 5:
1/R$240,20).

**Bug 2 -- cupom "fantasma" que some INTEIRAMENTE da Omie**: diferente
do Bug 1, esse cupom não aparece nem como cancelado na consulta da
Omie -- simplesmente deixa de vir na resposta. Como `syncFaturamento`
só sabe atualizar o que a Omie retorna, um cupom fantasma fica contando
como Normal pra sempre, sem nenhum sinal de erro. Achados e corrigidos
manualmente 5 casos (confirmados via busca ao vivo na Omie, maio-agosto
de 2026, 64 páginas consultadas, nenhum rastro do cupom em nenhuma
delas, antes de cada `UPDATE fat_cupons SET cancelado=true WHERE
loja_id=X AND n_id_cupom=Y AND cancelado=false`): loja 2, R$2.597,50 (2
cupons); loja 3, R$207,78 (2 cupons); loja 6, R$178,90 (1 cupom) --
total R$2.984,18. Achados batendo exatamente com o gap entre
`faturamento_importado` (pré-agregado, sempre correto porque é
recalculado direto da Omie) e o fato granular recalculado, comparação
feita pras 6 lojas × todos os meses de 2026 (jan-ago).

**Buraco de junho/2026, loja 2**: investigado à parte -- `faturamento_
importado` e `fat_cupons` não tinham nenhuma linha pra loja 2 no mês
inteiro. Consultada a Omie ao vivo (`CuponsFiscais`, período completo
do mês): `nTotPaginas: 0`, zero cupons. **Dado real, não é bug** -- a
loja genuinamente não teve nenhuma venda registrada naquele mês (motivo
de negócio não investigado, só confirmado que não é falha de
sincronização).

**Auditoria do histórico 2025 (2025-07 a 2025-12, 6 lojas ativas: 2, 3,
4, 5, 6, 7)**: sem pré-agregado pra comparar nesses meses (ele só cobre
2026), a checagem foi direta contra a Omie -- comparado o conjunto de
`id_item` que a Omie retorna AGORA pra cada combinação loja+mês contra
`fat_cupom_itens` gravado localmente (cupons `cancelado=false`/
`devolvido=false`). **36 combinações checadas, ZERO cupons órfãos
encontrados em todo o histórico de 2025** -- os 5 casos do Bug 2 ficaram
isolados a julho/agosto de 2026, consistente com a hipótese de que o
backfill original (2026-07-18) capturou 2025 corretamente na foto
daquele momento, e o fenômeno de sumiço só afetou meses tocados pela
sync buggy depois do backfill. Achado incidental no próprio script de
auditoria (corrigido antes de rodar em produção, nenhum `UPDATE`
afetado): uma falha de paginação silenciosa no meio de um mês teria
zerado a lista de válidos da Omie e marcado TODOS os itens locais como
órfãos -- corrigido com retry por página, captura explícita de exceção,
e uma checagem de sanidade que trata "0 válidos na Omie com >10 no
banco" como falha técnica, não achado real.

**Reconciliação automática (proteção daqui pra frente)**: em vez de um
cron novo (que gastaria chamadas extras à Omie), `syncFaturamento`
(`lib/omie/faturamento.ts`) foi estendido pra reaproveitar o fetch
mensal que ELE JÁ FAZ a cada run (commit `7699432`). Depois de montar
`cuponsBulk` pro mês (o conjunto de cupons que a Omie retornou AGORA),
compara contra os `n_id_cupom` que já existem em `fat_cupons` pra esse
MESMO loja+mês com `cancelado=false` (via `buscarFatCupons`, `lib/
faturamento-frio.ts`); qualquer `n_id_cupom` que estava no banco mas
não veio nesta resposta é marcado `cancelado=true` por um helper novo
(`atualizarCanceladoNoFrio`, POST com timeout de 10s, nunca lança --
falha vira só `console.error`). Isso não custa nenhuma chamada extra à
Omie e roda automaticamente a cada sync (cron horário) -- qualquer
cupom que sumir no futuro é pego e corrigido em no máximo 1 hora, sem
intervenção manual. **Cuidado de design preservado**: a comparação só
roda pro loja+mês que está SENDO reprocessado no loop atual (nunca
meses fora do range que `syncFaturamento` já processa), então nunca
marca como sumido um cupom de mês antigo só por ele não aparecer numa
busca que nunca o incluiu. Endpoint novo na `ntb-frio-api` (fora deste
repo git, só no servidor): `POST /fat_cupons_marcar_cancelado`, aceita
`{loja_id, n_id_cupom}`, faz `UPDATE fat_cupons SET cancelado=true
WHERE loja_id=$1 AND n_id_cupom=$2 AND cancelado=false` (mesma regra de
ouro de todo este achado: só UPDATE pontual de um campo, nunca INSERT/
DELETE). Validado ao vivo: sync manual disparada pras 6 lojas, resultado
`{"total":6,"ok":6,"falhas":0}`, zero erros/avisos de reconciliação nos
logs (esperado -- a auditoria de 2025 já tinha confirmado zero órfãos
pendentes) -- reconciliação automática funcionando sem falso-positivo.

**Nomenclatura SEFAZ**: o filtro "Situação" do Relatório de Faturamento
(`relatorio-faturamento/page.tsx` e `export/route.ts`) trocou os
rótulos exibidos de Normal/Cancelado/Devolvido pra
Autorizada/Cancelada/Devolvida (vocabulário oficial da SEFAZ pra NFC-e)
-- só o texto mudou, o valor interno do parâmetro de URL (`sp.status`:
`NORMAL`/`CANCELADO`/`DEVOLVIDO`/`TODOS`) ficou intacto, sem quebrar
link salvo nem comportamento de filtro (commit `084032f`).
