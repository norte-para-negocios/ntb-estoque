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

- ~~`components/movimentacoes/MovimentosTab.tsx:78` (`sinalEm`)~~ — arquivo
  apagado em 13/10/2026 (Movimentações completas): a aba nova mostra SLD como
  "Contagem: X", fora das somas.
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

**Fix da revisão final (commit `3f85c00`, mesmo dia)**: a revisão de
branch inteiro achou que a reconciliação tratava `cuponsBulk` como
sempre completo, mas a Omie pode truncar a paginação em silêncio no meio
de um mês (`omieRequest` converte a fault "Não existem registros" em
`{}`, zerando `nTotPaginas` e encerrando o loop cedo) -- a mesma classe
de bug que quase gerou falsos-positivos em massa no script de auditoria
da Task 3, só que aqui seria escrito de verdade em produção a cada hora.
Corrigido com 2 guards antes de qualquer `atualizarCanceladoNoFrio`: (1)
pula a reconciliação se `cuponsBulk` vier vazio mas o histórico já
gravado (`existentes`) for grande (`> 10`) -- sinal de falha técnica, não
de mês sem venda nenhuma; (2) teto de sanidade em `sumidos.length`
(maior entre 20 e 5% do histórico) -- sumiço real é fenômeno de unidades
(5 casos em ~13 meses), nunca de dezenas; se estourar, não escreve nada
nesse ciclo. Os dois usam `console.error` (diferente do `console.warn`
do caso normal de sumiço real), pra diferenciar falha técnica de achado
esperado no log.

**Follow-up não corrigido (achado incidental da mesma revisão)**: a
chamada a `buscarFatCupons` dentro da reconciliação não passa
`onTruncado` -- se a LEITURA do histórico no Contabo truncar (silencioso,
`buscarFrioTudo`), `existentes` fica subestimado, enfraquecendo (não
quebrando) os 2 guards acima. Candidato a follow-up, não é uma falha
ativa hoje.

**Nomenclatura SEFAZ**: o filtro "Situação" do Relatório de Faturamento
(`relatorio-faturamento/page.tsx` e `export/route.ts`) trocou os
rótulos exibidos de Normal/Cancelado/Devolvido pra
Autorizada/Cancelada/Devolvida (vocabulário oficial da SEFAZ pra NFC-e)
-- só o texto mudou, o valor interno do parâmetro de URL (`sp.status`:
`NORMAL`/`CANCELADO`/`DEVOLVIDO`/`TODOS`) ficou intacto, sem quebrar
link salvo nem comportamento de filtro (commit `084032f`).

## Feedback do Ramon sobre Movimentação (WhatsApp, 2026-08-10/11) — fórmula do PDV, toggle Família/Produto, e cupom físico ausente na origem

**Achado 1 -- fórmula de valor do PDV subestimava a Movimentação
(corrigido)**: `lib/movimentacao-operacao-auto.ts` calculava o valor de
cada linha de venda (PDV) só com `Number(it.v_item) || 0`. Igual ao
padrão já usado em `lib/faturamento-frio.ts`/`lib/omie/faturamento.ts`,
`v_item` pode vir zerado/ausente enquanto o valor real está em
`v_unit * quant - v_desc`. Achado real medido num dado momento: **loja
2/2026, diferença de R$1.701,35** entre a soma antiga e a soma
corrigida. Corrigido com fallback: `Number(it.v_item) || (Number(it.v_unit)
* Number(it.quant) - Number(it.v_desc)) || 0` (commit `6b2711e`). O mesmo
commit também adicionou o campo `produto` (descrição/código do cadastro,
com fallback pro id bruto) ao tipo `LinhaOperAuto`, populado nos 3 pontos
de agregação (NF de entrada, PDV, ajustes manuais) -- pré-requisito do
Achado 2.

**Ressalva (revisão final, 2026-08-11)**: essa fórmula NÃO é 100% idêntica
à de `lib/omie/faturamento.ts`, que soma um termo a mais
(`+ Number(it.vAcresc ?? 0)`). As outras duas cópias (`lib/faturamento-frio.ts`
e esta nova em `lib/movimentacao-operacao-auto.ts`) não têm esse termo
porque `v_acresc` simplesmente não é gravado em `fat_cupom_itens` -- a
coluna não existe nessa tabela. Não é uma divergência a "consertar": antes
de tentar igualar as 3 fórmulas no futuro, primeiro seria preciso decidir
se vale a pena gravar esse campo no fato.

**Achado 2 -- toggle Família/Produto + coluna "Tipo (SPED)" some quando
já filtrada (corrigido)**: `relatorio-movimentacao/page.tsx` (modo
"Por operação (R$)") ganhou um toggle `SegmentLinks` (mesmo componente já
usado pelo toggle "Em quantidade"/"Por operação" da mesma página) pra
alternar o agrupamento da matriz entre Família e Produto via searchParam
`dimOper`, preservando os demais filtros da URL. Só aparece quando a
fonte é o modo automático (`usarAutomatico === true`, que tem o campo
`produto` do Achado 1) -- a tabela `movimentacao_operacao` (import manual
via MOV_DRV, hoje só loja 3) é pré-agregada por família, sem grão de
produto, então o toggle fica escondido nesse caso e `dimOper` é ignorado
(força `'familia'`). Na mesma leva, a coluna "Tipo (SPED)" da tabela
passou a esconder automaticamente quando o filtro `sp.tipo` já resolve
pra 1 único valor (`esconderColTipo = tiposSel.length === 1`) -- reduz
ruído visual quando o usuário já filtrou por um tipo específico; some
também a célula da coluna e ajusta o `colSpan` do rodapé "Total" (commit
`53d4326`).

**Achado 3 -- cupom físico do Ramon (loja 3, Rio Vermelho, 16/06/2026,
R$334,07) não existe em `fat_cupons`, mas o sync do NTB Estoque está
correto -- causa raiz é externa, sem correção de código**: investigado
até o fim (chave de acesso completa, data+valor, número -- 3 buscas,
nenhuma encontrou o cupom em `fat_cupons`). O dia 16/06/2026 está
totalmente ausente pra loja 3 (0 cupons, contra 33-100/dia nos dias
vizinhos), parte de um padrão semanal de dias zerados só dessa loja
(05/05, 12/05, 19/05, 26/05, 02/06, 09/06, **16/06**, 24/06, 29/06 --
os 7 primeiros batem exatamente de 7 em 7 dias). Consultada a Omie AO
VIVO (`CuponsFiscais`, loja 3) pra 3 dessas datas -- **09/06, 16/06 e
24/06/2026: 0 cupons na própria Omie também**, idêntico ao nosso banco.
Ou seja: `fat_cupons` reflete fielmente o que a Omie tem (mesma classe de
achado já confirmada antes, loja 2/junho inteiro, ver seção "Nomenclatura
SEFAZ" acima -- "buraco de junho/2026, loja 2"). **O cupom físico do
Ramon é uma venda real que nunca chegou na Omie/SEFAZ** -- o gap está a
montante do NTB Estoque, entre o PDV da loja e a Omie/SEFAZ (contingência
nunca transmitida, falha pontual de conexão do PDV, ou outra causa do
lado Omie/loja). Não é bug de código, não há nada no sync pra corrigir --
o dado simplesmente não existe na fonte. **Ação recomendada (fora do
código)**: conferir a chave de acesso do NFC-e
(`29260642200741000166650010001714561002445643`) em
sefaz.ba.gov.br/nfce/consulta e, se confirmado ausente lá também,
contatar o suporte da Omie pra investigar a transmissão perdida daquele
dia específico. **Padrão a vigiar**: "dia inteiro zerado pra 1 loja, mas
confirmado igual na própria Omie" já apareceu 2 vezes (loja 2/junho
inteiro, loja 3/dias específicos aqui) -- pode reaparecer com outras
lojas/datas; nesses casos o diagnóstico correto não é reprocessar sync,
é verificar a origem (Omie/SEFAZ/PDV).

## Contenção de RLS (Fase 0 + Fase 2a) e incidente de recursão infinita (2026-08-10/12)

Achado incidental na revisão final do plano "Sertão Teste": a tabela
`lojas` (e outras 33) estava com RLS desligada e grants totais
(`SELECT`/`INSERT`/`UPDATE`/`DELETE`/`TRUNCATE`) pra `anon`/`authenticated`
desde a migration 061 -- qualquer operador logado conseguia ler
`integracao_api_key`/`omie_app_key`/`omie_app_secret` de TODAS as lojas
direto pelo navegador via PostgREST, e uma anon key pública conseguia
`TRUNCATE lojas`, apagando o sistema inteiro via `ON DELETE CASCADE`.

**Fase 0** (migrations 109/110): revogou `INSERT`/`UPDATE`/`DELETE`/
`TRUNCATE` de `anon`/`authenticated` em 34 tabelas sem RLS, e fechou
leitura das colunas sensíveis de `lojas` (incluindo `codigo_onboarding`,
achado tardio -- é a credencial de auto-cadastro em
`lib/actions/cadastro.ts`, não metadado inofensivo). 3 pontos de código
que liam/escreviam essas colunas via client de sessão migraram pra
`createServiceClient()` antes da migration rodar (`lib/actions/
loja-selector.ts`, `components/movimentacoes/MovimentosTab.tsx`,
`app/(app)/loja/page.tsx`).

**Fase 2a** (migration 111): aplicou RLS de LINHA nas 29 tabelas restantes
com `loja_id` direto + corrigiu um bug real no padrão já usado nas 14
tabelas que já tinham RLS (a policy só checava `loja_user`, sem considerar
Admin/super_admin -- contas como o QA de testes, sem vínculo em
`loja_user`, já ficavam sem acesso a essas 14 silenciosamente).

**Incidente real em produção, corrigido na hora (migration 112)**: a
policy nova de `loja_user` fazia `EXISTS (select 1 from loja_user lu
where ...)` -- uma self-reference dentro da própria condição `USING`.
Como as OUTRAS 40 tabelas também fazem `EXISTS(loja_user)` dentro da
própria policy, isso quebrou com `"infinite recursion detected in policy
for relation loja_user"` **toda leitura via `authenticated` no sistema
inteiro**, assim que a migration 111 foi aplicada (login continuou
funcionando -- não depende dessas tabelas -- mas praticamente todas as
telas de dado pararam). Corrigido substituindo as subqueries diretas por
duas functions `security definer` (`usuario_tem_acesso_loja(p_loja_id)`,
`usuario_e_admin()`) -- rodam com privilégio do dono, ignoram RLS na
leitura interna de `loja_user`/`profiles`, quebrando a recursão. **Padrão
a nunca repetir**: uma policy de RLS de uma tabela `X` nunca deve fazer
`EXISTS (select ... from X ...)` referenciando a própria `X` dentro da
condição `USING` -- mesmo que pareça inofensivo, qualquer OUTRA tabela
cuja policy também consulte `X` herda a mesma recursão. Sempre que uma
policy precisar consultar uma tabela de vínculo (tipo `loja_user`) a
partir de QUALQUER policy (inclusive a dela mesma), usar uma function
`security definer` em vez de subquery direta.

Policy padrão final (idêntica nas 41 tabelas com `loja_id`, mais as 12
que já tinham RLS antes desta rodada):
`usuario_tem_acesso_loja(loja_id) or usuario_e_admin()`.

**Fase 2b** (migrations 113-116, 2026-08-12, conclui a contenção de RLS
das 5 tabelas sem `loja_id` direto): `profiles` (própria linha, Admin,
ou loja em comum via `usuario_compartilha_loja(p_outro_user_id)`, function
nova que consulta só `loja_user`, nunca `profiles` -- testada isolada
ANTES das outras 4, lição direta do incidente acima); `lojas` (mesmo
padrão das 41); `permissoes` (catálogo público, `role() = 'authenticated'`);
`outbox`/`arquivos_mortos` (RLS ligada, ZERO policy -- bloqueio total,
nenhum código do app as lê via sessão).

**2 achados reais na revisão desta fase, corrigidos na hora**:
1. (migration 115) A policy de `permissoes` usava `role()` sem qualificar
   schema -- `authenticated`/`anon` não têm `auth` no `search_path` por
   padrão (só `supabase_admin` tem), então em produção real (PostgREST)
   isso falhava com `"function role() does not exist"`; só "passava" em
   testes via `psql`/`supabase_admin`. Corrigido pra `auth.role()`, mesmo
   padrão já usado em `cargos`/`cargo_permissao` (migration 046). **Ao
   testar RLS via `SET ROLE`/JWT simulado, sempre incluir o claim `role`
   no JSON e considerar rodar `SET search_path = "$user", public` (sem
   `auth`) pra reproduzir fielmente o ambiente da role real** -- testar
   como `supabase_admin` mascara esse tipo de bug.
2. (migration 116) `profiles` com `status='pendente'` (cadastro sem loja
   ainda) ficava invisível pra `AdminLoja` -- a policy só cobria
   `usuario_e_admin()` (Admin global/super_admin), e pendente nunca tem
   `loja_user` (então `usuario_compartilha_loja` sempre falha). Quebrava
   o fluxo já documentado em `app/(app)/usuario/page.tsx` ("tanto Admin
   global quanto AdminLoja... podem aprovar"). Corrigido com
   `usuario_pode_aprovar_pendentes()` (mesma classe de function segura:
   `security definer`, só lê a PRÓPRIA linha do usuário logado, sem
   iterar outras linhas -- não reintroduz recursão).

**Regra pra qualquer policy nova (não só desta fase)**: nunca aplicar
`FORCE ROW LEVEL SECURITY` nas tabelas que as functions `usuario_*`
tocam (`loja_user`, `profiles`), e nunca trocar o dono dessas functions
pra um role não-superuser -- ambas as coisas reabririam o caminho pro
mesmo incidente de recursão, já que a proteção real vem do owner delas
(`supabase_admin`, superuser) bypassando RLS na leitura interna.

**Achados menores, registrados sem ação nesta rodada**: (a) `outbox`/
`arquivos_mortos` bloqueiam por RLS-sem-policy (0 linhas), não por
`REVOKE SELECT` -- efeito de segurança idêntico, mas quem quiser reforço
extra pode `revoke select ... from anon, authenticated` como
defesa-em-profundidade; (b) `cargos`/`cargo_permissao`/`etiqueta_config`
escaparam da lista de 34 tabelas da Fase 0 -- ainda têm grant de escrita
residual pra `anon`/`authenticated`, mas não é explorável hoje (RLS com
só policy de SELECT bloqueia, e `TRUNCATE` não é alcançável via REST) --
candidato a fechamento numa rodada futura; (c) telas que mostram "quem
fez" uma transferência/inventário (`impressoes`, `transferencia`,
`inventario`, mais os respectivos `export`/`relatorio`) ficam com nome
em branco se o autor for desvinculado de `loja_user` depois -- 0 casos
reais hoje, registrado como observação.

O Plano A do Sertão Teste (NTB Vendas, chave de teste já gerada no lado
Estoque) segue pendente, sem relação com este projeto de RLS.

## Lojas de Teste (2026-08-12) — sandbox completo por loja, nunca escreve na Omie, e o incidente do webhook

Cada uma das 6 lojas ativas ganhou uma gêmea de teste (`lojas.is_test`,
`lojas.loja_origem_id`, migration 117): mesma `omie_app_key`/
`omie_app_secret` da loja real (pra LEITURA trazer dado real -- catálogo,
preços), mas NUNCA escreve de volta. Como o app inteiro já é escopado por
`loja_id`, a loja de teste reusa 100% das tabelas/telas normais -- nenhum
schema duplicado.

**Gate central**: `omieRequest` (`lib/omie/client.ts`) recebe `is_test:
boolean` OBRIGATÓRIO (tanto em `LojaOmie` quanto em
`OmieRequestParams`) -- decisão de design que torna a propagação
auto-verificável via `tsc` (compilador aponta todo call site que
esquecer o campo). Quando `is_test && ehChamadaDeEscrita(call)` (regex
`/^(Incluir|Alterar|Excluir|Concluir|Reverter)/`, convenção 100%
consistente na base), a função NUNCA faz o `fetch` real -- devolve uma
resposta sintética (`respostaSimulada()`, um objeto "shotgun" com todos
os nomes de campo de ID usados de verdade no código, mais um contador de
processo somado a `Date.now()*1000` pra nunca colidir mesmo em chamadas
no mesmo milissegundo -- ver achado abaixo) e loga em
`integration_attempts` com `model` prefixado `[SIMULADO]`.

**Achado real, corrigido antes do `tsc` apontar**: `respostaSimulada()`
inicialmente não cobria 3 campos (`codigo`, `codigo_cliente_omie`,
`codigo_produto`) lidos por `incluirFamilia`/`incluirFornecedor`/criação
de produto -- corrigido antes de qualquer deploy.

**Achado real, `tsc`-invisível**: o cast `.single<LojaOmie>()`/
`.maybeSingle<LojaOmie>()` do supabase-js **não é verificado contra a
string do `.select()`** -- um `.select('id, omie_app_key,
omie_app_secret')` sem `is_test` compila limpo, mas `loja.is_test` chega
`undefined` (falsy) em runtime, fazendo o gate tratar QUALQUER loja como
real. Achado em ~41 call sites no total (20 pegos pelo `tsc` por
chamarem `omieRequest` com o objeto solto, ~21 que só o `tsc` não via
por trás do cast) -- todos corrigidos, confirmado com `grep -rn
"omie_app_key, omie_app_secret" app/ lib/ | grep -v is_test` vazio.
**Se adicionar um novo call site na Omie no futuro, sempre confirmar que
a query que busca a `loja` inclui `is_test` explicitamente no
`.select()` -- o `tsc` não é garantia suficiente aqui.**

**INCIDENTE REAL EM PRODUÇÃO, corrigido na hora (2026-08-12,
~21:34–22:29 UTC)**: `app/api/webhook/route.ts` resolvia a loja de
origem só por `omie_app_key` (`.eq('omie_app_key', body.appKey)`) --
único ponto do sistema que faz isso (todo o resto resolve por `id`).
Como a loja de teste reusa a MESMA `omie_app_key` da loja real, a query
deixou de ser única assim que as 6 lojas teste foram criadas
(`maybeSingle()` passou a ver 2 linhas por chave), e o `error` do
Supabase não era checado -- **todo webhook recebido nesse intervalo foi
descartado silenciosamente**, inclusive o dual-write pro Contabo
(perda irrecuperável -- Omie não tem endpoint de "listar webhook
antigo", e o `prune` some com o resto em 7 dias). Corrigido com
`.eq('is_test', false)` na query (webhook é sempre da loja real, a
gêmea não tem identidade própria na Omie) + checagem de `error`.
Confirmado com dado real: primeiro webhook novo chegou minutos depois do
deploy do fix. **Lição pro futuro**: qualquer query que resolva `lojas`
por uma coluna que não seja `id` (`omie_app_key`, `cnpj`, etc.) precisa
considerar que ela deixou de ser única desde que lojas de teste existem
-- sempre incluir `.eq('is_test', false)` nesses casos.

**Achado real, corrigido na revisão final**: `getAtorGestao()`
(`lib/auth.ts`) inicialmente filtrava `is_test=false` na branch Admin
global -- mas `ator.lojaIds` é consumido por muito mais que a tela de
usuário (`minha-loja`, `resumo`, `convite`, `cargo`, todos os
relatórios), e o filtro vazou pra esses consumidores, quebrando "loja de
teste faz tudo que a loja real faz" (Admin dentro de uma loja `[TESTE]`
recebia 404 em "Minha loja"; "Resumo" mostrava dado de OUTRA loja real
sem nenhum aviso). Corrigido revertendo o filtro em `getAtorGestao()`
(Admin volta a gerenciar lojas teste como qualquer outra) e movendo o
filtro só pra `app/(app)/usuario/page.tsx` (lista de lojas do formulário
de vínculo de usuário), onde a intenção original fazia sentido.

**Exclusão da automação**: `getLojasAtivas()` (`lib/omie/sync-all.ts`,
choke point de 20 dos 24 crons) ganhou `.eq('is_test', false)`. Colunas
`is_test`/`loja_origem_id` precisaram de `GRANT SELECT` explícito pra
`anon`/`authenticated` (achado do próprio QA: o grant column-level da
Fase 0/migration 109 é um snapshot fixo, não reage a colunas novas --
qualquer coluna adicionada em `lojas` DEPOIS da 109 nunca ganha grant
sozinha, precisa de `GRANT SELECT (coluna) ON lojas TO anon,
authenticated;` numa migration própria).

**Limitação conhecida, documentada, não corrigida**: escrita é sempre
simulada, mas releitura vai pra Omie real e não enxerga o objeto
"criado" (ex: `ConsultarOrdemProducao` com o `nCodOP` negativo simulado
não encontra nada de verdade). É esperado por desenho -- não confundir
com bug ao fazer QA numa loja de teste. Lojas de teste também não têm
produto/local sincronizado localmente (os crons as excluem por design)
-- primeiro uso precisa disparar manualmente as rotas `/api/sync/*`
(são leitura, funcionam normal) dentro da loja de teste antes de tentar
qualquer fluxo de escrita simulada que dependa de um `codigo_produto`
já cadastrado.

## Integração ntb-vendas ↔ ntb-estoque: UI de geração de chave (2026-08-16)

`components/loja/LojaCard.tsx` ganhou a seção "Integração com NTB Vendas"
(`components/loja/IntegracaoNtbVendas.tsx` + `lib/actions/
integracao-ntb-vendas.ts`, `gerarChaveIntegracaoNtbVendas`/
`removerChaveIntegracaoNtbVendas`): antes disso, `lojas.integracao_api_key`
(migration 061) só podia ser gerada via SQL manual — pedido explícito do
usuário pra ter UI dos dois lados (a UI do lado `ntb-vendas`, que consome
essa chave, já existia). A chave é write-only de verdade (mesmo princípio
do `codigo_onboarding`/CSC do certificado): só aparece uma vez, em estado
local, logo depois de gerar/regenerar — nunca volta do banco (`app/(app)/
loja/page.tsx` computa só um boolean `integracao_ntb_vendas_configurada`
no server component antes de descer o objeto pro client). O `ntb-vendas`
(Master Admin, `AdminModule.tsx`) ganhou em paralelo a mesma seção
"Integração com o NTB Estoque" (URL + chave + toggle) que já existia só no
painel do lojista de lá.

**O que ainda falta** (não implementado, precisa de desenho — pedido
original completo era mais amplo): ainda é o operador quem copia URL+chave
gerados aqui e cola manualmente no `ntb-vendas` — não existe descoberta
automática entre as duas lojas nem uma pergunta "integrar com o outro
sistema?" no próprio formulário de CRIAÇÃO de loja (`LojaForm.tsx`) de
nenhum dos dois projetos; a UI nova só existe pós-criação (mesmo padrão já
usado aqui pra Certificado/Código de onboarding). Pontos em aberto pra quem
for desenhar a versão completa — (1) o formulário mostra uma lista de lojas
do outro sistema pra escolher (exigiria uma chamada cross-sistema já na
tela de cadastro) ou só liga por CNPJ/nome depois; (2) quem inicia — criar
a loja aqui já dispara a criação/config do lado do `ntb-vendas`, ou é
sempre "aponta pra uma loja que já existe do outro lado". Não agir sem
pedido explícito.

## Resolvido (2026-08-16): Ordem de Produção usa o local de estoque certo (Cozinha vs. Bar)

A Ordem de Produção criada aqui a partir de uma venda do `ntb-vendas` agora
usa o **local de estoque conforme onde o item foi preparado**. Migration
120 (`lojas.local_estoque_cozinha_codigo`/`local_estoque_bar_codigo`,
guardando o `codigo_local_estoque` do Omie, não um id local) + UI nova
(`LojaCard` → seção "Integração com NTB Vendas" →
`components/loja/MapeamentoLocalEstoque.tsx`, dois selects populados com os
locais que a própria loja já cadastrou em `/local-estoque`) + server action
`lib/actions/mapeamento-local-estoque.ts`. `app/api/integracao/ordem-producao/route.ts`
recebe `destination?: 'kitchen'|'bar'|null` por item (novo campo no payload
do `ntb-vendas`), resolve pro código certo e passa como `codigoLocalEstoque`
pra `incluirOrdemProducao` — **achado técnico que destravou isso**:
`incluirOrdemProducao`/`alterarOrdemProducao` (`lib/omie/ordem-producao.ts`)
já aceitavam esse parâmetro opcional desde antes, só nunca tinha sido
passado nesta chamada específica. Loja que não configurar o mapeamento
continua caindo no local padrão do Omie, como sempre foi (comportamento
aditivo, não quebra nada). `concluirOrdemProducao` não precisa do parâmetro
— o local já fica fixado na criação da OP.

Criar locais com nome livre ("Cozinha 1 e 2, Bar 1 e 2 e qualquer outro
nome") já era possível antes disso (`/local-estoque` → "Novo local") — essa
parte nunca foi o gap, só faltava o mapeamento pra automação e o payload do
`ntb-vendas` carregar o destino.

## Cadastro de produto unificado + "produto pai com variações" (2026-08-16)

Duas ideias relacionadas, juntas numa mensagem só do usuário:

1. **Cadastro de produto unificado entre `ntb-vendas` e `ntb-estoque` —
   Resolvido, Direção 1 (ntb-vendas → ntb-estoque).** Mesmo espírito do
   bootstrap de loja ("Criar no NTB Vendas também", seção acima): novo
   endpoint `app/api/integracao/produtos/route.ts` (auth Bearer
   `lojas.integracao_api_key`, mesma da rota de Ordem de Produção), recebe
   `{nome, precoVenda, ncm?, unidade?}` do `ntb-vendas`, gera um `codigo`
   (SKU) automático (`NTBV-<timestamp>`), usa `ncm` enviado ou fallback
   genérico (`21069090`) e `unidade="UN"` como default, chama
   `incluirProduto` (`lib/omie/produto.ts` — ESCREVE no Omie), devolve
   `{codigo, codigoProduto}`. **Loja de teste**: como `IncluirProduto` é
   uma chamada de escrita, `is_test=true` sempre simula (ver
   `ehChamadaDeEscrita` em `lib/omie/client.ts`) — nesse caso a rota grava
   o produto direto em `produtos` (upsert), sem depender de `syncProdutos`
   reconsultar o Omie real (que nunca acharia um produto que só existiu na
   resposta simulada) — mesmo achado/fix já aplicado à Ordem de Produção
   (`fetchOrdemProducao`) mais cedo nesta sessão. **Resolvido, Direção 2
   (ntb-estoque → ntb-vendas), mesma sessão (2026-08-16):** o inverso —
   `criarProduto` (`lib/actions/produto.ts`) ganhou um parâmetro opcional
   `criarNoNtbVendas`, acionado pelo checkbox "Criar no NTB Vendas também"
   em `FormNovoProduto.tsx`, que só aparece quando "Produto de PDV" está
   marcado (só produto de PDV faz sentido no cardápio, mesmo texto que já
   existia no form). Depois de criar no Omie e salvar local, chama
   `enviarProdutoParaNtbVendas` (mesmo arquivo) — espelha
   `criarLojaNoNtbVendas` (`lib/actions/loja.ts`), mas com
   `lojas.integracao_api_key` como Bearer (loja já pareada, não precisa do
   `CROSS_SYSTEM_BOOTSTRAP_KEY`) e reaproveitando o `NTB_VENDAS_INTERNAL_URL`
   global já configurado no servidor pro bootstrap de loja. Manda
   `{nome, preco, omieCodigo: codigo}` (o `codigo`/SKU, não o
   `codigo_produto` interno do Omie) pro novo
   `ntb-vendas:/api/integracao/produtos`, que resolve a loja pela chave e
   insere o produto lá com `available: false` (some do cardápio até o
   lojista completar categoria/imagem/descrição, que não existem aqui).
   Falha nessa etapa não desfaz o produto já criado aqui — só mostra um
   aviso (`avisoVendas`), mesmo princípio não-bloqueante do bootstrap de
   loja. O vínculo usa `omie_codigo` como chave (já existia em
   `products.omie_codigo`/`product_options.omie_codigo`, migration 026 do
   `ntb-vendas`), não precisou de nada novo além disso.
2. **"Produto pai com variações"** — o usuário quer que produtos parecidos
   (ex.: várias moquecas separadas) apareçam agrupados num "produto pai" no
   cardápio do cliente do `ntb-vendas`, com as variações (tamanho, sabor
   etc.) escolhidas dentro. Ele mesmo esclareceu, e é importante registrar
   aqui porque envolve este projeto diretamente: **isso é só uma camada de
   UI/organização do lado do `ntb-vendas`** — o Omie continua sempre com
   SKU plano (não tem "produto pai"), cada variação sempre vira um produto
   Omie específico com código próprio pra consumo de estoque bater certo
   (a Ordem de Produção continua resolvendo por `codigo_produto` normal,
   sem mudança nenhuma esperada aqui). Ou seja: **este projeto
   provavelmente não precisa de nenhuma mudança pra essa parte** — o
   trabalho todo seria do lado do `ntb-vendas` (`product_option_groups`/
   `product_options`, que já suportam exatamente esse modelo hoje). Mesma
   nota espelhada no AGENTS.md do `ntb-vendas`, com mais detalhe técnico do
   que já existe pronto lá.

## Estoque local independente da Omie (lojas de teste) — revisão final e fix wave (2026-08-18)

Plano de 8 tasks (`.superpowers/sdd/2026-08-18-estoque-independente-omie-lojas-teste/`)
que dá às 6 lojas de teste um ledger de estoque próprio (`ficha_tecnica_local`,
`estoque_local_saldos`, `movimentos_locais`, migrations 121-123), deduzido
localmente via BOM (`ConsultarEstrutura` da Omie) sempre que uma Ordem de
Produção chega da rota de integração — nunca toca a Omie de escrita nem
qualquer loja `is_test=false`. A revisão final de branch inteiro achou 0
Critical, 5 Important, 7 Minor; uma fix wave corrigiu o subconjunto ruled
(I-2, I-3, M-1, registro do I-1) e este bloco documenta os 3 achados que
qualificam pra convenção deste arquivo, mais a lista de limitações
conhecidas e não corrigidas por decisão explícita (I-4, I-5, M-2, M-3, M-5).

### `omieRequest` mascarava `MISUSE_API_PROCESS` atrás de um erro genérico — bug pré-existente, app-wide, não deste plano

Até o commit `3849e3c` (18/08), o branch de rate-limit (429/425) de
`omieRequest` (`lib/omie/client.ts`) fazia só `sleep(60_000); continue` sem
nunca popular `lastError` — ao esgotar as 3 tentativas, o `throw lastError ??
new Error('Falha desconhecida na chamada Omie')` do fim da função sempre
caía no fallback genérico, porque `lastError` ficava `null` nesse caminho
específico. Isso descartava o `faultstring`/`faultcode` reais da Omie **em
todo call site do app que já usava `omieRequest`** (~20 lugares, não só
código deste plano) — qualquer rate-lockout real virava só "Falha
desconhecida na chamada Omie" no log, sem nenhuma pista de qual fault
específico da Omie causou. Foi literalmente o motivo de o diagnóstico do
lockout de `MISUSE_API_PROCESS` na Task 3 deste plano ter levado 3 rounds de
fix — cada round via o erro genérico e tinha que reconstruir a causa por
inferência. Corrigido: o branch 429/425 agora monta um `OmieError` real com
o `faultstring`/`faultcode` reais antes de decidir dormir-e-retentar ou
lançar (`e instanceof OmieError` nunca mais chega vazio de contexto). A
revisão final confirmou que nenhum dos outros ~20 call sites quebra com essa
mudança (nenhum faz `instanceof OmieError`, nenhum casa a string genérica
antiga — todos só leem `e.message`, que agora só fica mais informativo).

**`MISUSE_API_PROCESS` como fato operacional, não só como bug corrigido**:
qualquer tentativa nova contra a Omie (mesmo uma única chamada limpa, de
leitura) **reestende** o cooldown desse bloqueio — não é "espera passar e
tenta de novo automaticamente", é "toda tentativa durante o lockout empurra
o fim dele pra mais tarde". E o `app_key` é **compartilhado**: pra uma loja
de teste é literalmente a mesma `omie_app_key`/`omie_app_secret` da loja real
correspondente (ver seção "Lojas de Teste" acima), e esse mesmo `app_key`
também é batido pelo cron de 10 minutos deste servidor (`scripts/sync-cron.sh`)
fazendo chamadas de rotina. Ou seja: um sync manual na loja de teste pode
levar um `MISUSE_API_PROCESS` reestendido pelo PRÓPRIO cron rodando em
paralelo, sem nenhuma ação do operador. **A resposta correta ao ver esse
fault é esperar uma janela quieta (fora do ciclo de 10 min do cron) antes de
tentar de novo — retentar imediatamente só piora, nunca ajuda.**

### A lição do tiebreak de paginação, reforçada pela 3ª vez

`buscarTodasLinhas` (`lib/supabase/buscar-todas-linhas.ts`) pagina via
`.range(from, to)` — OFFSET puro. Sem `.order(<coluna única>)`, o Postgres
não garante a mesma ordem de linhas entre páginas sucessivas, e acima de
1000 linhas (o corte padrão do PostgREST) isso pode **duplicar** linhas
(contadas 2x numa soma) ou **pular** linhas (silenciosamente ausentes do
resultado). Este repo já documentou essa classe de bug pelo menos duas vezes
antes (auditoria de 2026-08-05, seção "Migrations: aplicadas à mão" logo
acima) e mesmo assim ela reapareceu uma 3ª vez **dentro deste mesmo plano**:
a Task 3 (`app/api/sync/ficha-tecnica-local/route.ts`) recebeu o
`.order('id')` correto; a Task 4, escrita depois e cujo próprio comentário
cita a Task 3 ("mesmo helper compartilhado que corrige o corte de 1000
linhas do PostgREST (Task 3)"), herdou o helper mas esqueceu o `.order()` —
`app/api/sync/estoque-local/route.ts` paginava `posicao_estoques` (2553
linhas na loja 12) só com `.range()`, sem tiebreak. Corrigido nesta fix wave
adicionando `.order('id')`. **A lição não propaga sozinha por proximidade
de código ou por citar a correção anterior no comentário — precisa virar
checklist mecânico**: todo novo uso de `.range()` (helper compartilhado ou
cópia local) precisa vir acompanhado de `.order(<coluna única, normalmente
`id`>)` na mesma query, sem exceção, revisado explicitamente nesse ponto
antes de considerar a paginação correta.

**Revalidação ao vivo desta fix wave (regra aplicada: comparar a origem
contra o destino, nunca o destino contra si mesmo)** — `sum(saldo)` de
`estoque_local_saldos` comparado contra `sum(n_saldo)` direto de
`posicao_estoques` (mesma `loja_id`/`data_posicao`, 2026-08-13) pras 6 lojas
de teste (8, 9, 10, 11, 12, 13): 5 batiam exato (8: R$324.296,83; 9:
R$172.401,90; 10: -R$68.522,26; 11: R$284.138,93; 13: R$650.551,85). A loja
12 divergia — R$397.465,69 no destino contra R$397.690,49 na origem
(diferença de R$224,80, mesma contagem de produtos nos dois lados: 2553) —
consistente com o efeito do bug (soma corrompida por página sem afetar a
contagem de chaves distintas, já que o upsert final é por `codigo_produto`).
Resincronizada via `/api/sync/estoque-local` (loja 12) já com o `.order('id')`
aplicado; após o re-sync, `estoque_local_saldos` da loja 12 bateu exato com
a origem.

### Migrations 121–123 aplicadas no Postgres self-hosted

`121_estoque_local_teste.sql` (as 3 tabelas: `ficha_tecnica_local`,
`estoque_local_saldos`, `movimentos_locais`), `122_estoque_local_rls.sql`
(RLS + policies no padrão canônico do repo, `usuario_tem_acesso_loja`/
`usuario_e_admin`) e `123_baixar_saldo_local_rpc.sql` (a RPC atômica
`baixar_saldo_local`) estão aplicadas em produção — confirmado com `\df
baixar_saldo_local` direto no Postgres (não só o arquivo existir no repo,
seguindo a convenção já estabelecida na seção "Migrations: aplicadas à mão,
sem tracking" acima):

```
 Schema |        Name        | Result data type |                       Argument data types                       | Type
--------+--------------------+------------------+-----------------------------------------------------------------+------
 public | baixar_saldo_local | numeric          | p_loja_id bigint, p_codigo_produto bigint, p_quantidade numeric | func
```

### Cobertura real de `ficha_tecnica_local` por loja (o número que substitui o "6/6 OK" enganoso)

Medido em 2026-08-18, `select loja_id, count(*), count(distinct codigo_produto)
from ficha_tecnica_local group by loja_id`:

| loja_id | nome | linhas | produtos c/ BOM | total produtos (`produtos`) | cobertura |
|---|---|---|---|---|---|
| 8  | [TESTE] DONANA VILAS DO ATLANTICO | 27 | 7 | 2706 | 0,26% |
| 9  | [TESTE] VINHAS & VINHETOS DISTRIBUIDORAS LTDA | 0 | 0 | 694 | 0% |
| 10 | [TESTE] DONANA PRAIA DO FORTE | 0 | 0 | 2543 | 0% |
| 11 | [TESTE] DONANA BROTAS | 0 | 0 | 2885 | 0% |
| 12 | [TESTE] O SERTAO VAI VIRAR MAR | 928 | 206 | 2553 | 8,07% |
| 13 | [TESTE] DONANA RIO VERMELHO | 19 | 4 | 2330 | 0,17% |

Isso é o estado real do plano — não "6/6 lojas OK" (esse critério media
`estoque_local_saldos`, que é sempre cheio porque é Omie-independente e não
diz nada sobre se a baixa de estoque de fato deduz alguma coisa). 4 das 6
lojas (9, 10, 11) têm **zero** BOM sincronizado — qualquer venda nelas hoje
é um no-op completo do ponto de vista do ledger local, por desenho (o sync
de ficha técnica aborta cedo por `MISUSE_API_PROCESS`, ver seção acima) mas
sem nenhum sinal visível disso até esta fix wave. Agora exposto na própria
tela (`app/(app)/estoque-local-teste/page.tsx`, "Ficha técnica: X de Y
produtos com estrutura sincronizada") — o operador não precisa mais ler log
de servidor pra saber se o sistema está fazendo alguma coisa.

### Limitações conhecidas, não corrigidas por esta fix wave (follow-up explícito, não abandonado em silêncio)

- **(I-4) `is_test` depende de um único `if`, num único call site.** Nem
  `baixarEstoqueLocal`, nem a RPC `baixar_saldo_local`, nem as 3 tabelas
  novas têm qualquer verificação estrutural de `is_test` — a proteção hoje
  é 100% de disciplina de código no único caminho de escrita existente
  (`app/api/integracao/ordem-producao/route.ts`). Correto hoje, mas não é
  uma propriedade do sistema — se um segundo call site for adicionado sem
  repetir o guard, nada impede que ele alcance uma loja real. Opção mais
  robusta: um trigger `BEFORE INSERT/UPDATE` nas 3 tabelas que rejeita
  `loja_id` cujo `lojas.is_test` seja falso (fecha o caminho até contra SQL
  manual/cron futuro); opção mais barata: guard explícito no topo de
  `baixarEstoqueLocal`.
- **(I-5) O sync de ficha técnica é upsert-only, nunca apaga.** Um insumo
  removido da estrutura na Omie sobrevive pra sempre localmente e continua
  sendo deduzido em toda venda — mesma classe de bug já documentada e
  corrigida neste arquivo pra `atualizar_preco_recente` (migration 105,
  seção "Migrations: aplicadas à mão" acima, "fazia só UPSERT, nunca
  DELETE"), mas não aplicada aqui ainda. Fix natural: apagar as linhas
  `(loja_id, codigo_produto)` cujo `sincronizado_em` seja anterior ao início
  da rodada, só pros produtos efetivamente reconsultados nesta execução
  (nunca em massa — o sync aborta parcial por desenho, e um DELETE global
  apagaria BOM de produtos sequer visitados).
- **(M-2) O ledger local não é idempotente contra retry da mesma venda.**
  `movimentos_locais` não tem chave única amarrada a `pedido_ref`, e a baixa
  roda no `finally` — um retry do NTB Vendas da mesma Ordem de Produção
  deduz o estoque local de novo, em silêncio. O dado necessário pra fechar
  (`pedido_ref`) já está sendo gravado, só falta a constraint/checagem.
- **(M-3) `tipo='ENT'` é enum morto.** O CHECK da migration 121 aceita
  `('SAI','ENT')`, mas nenhum caminho grava `'ENT'` — em particular,
  `/api/sync/estoque-local` sobrescreve `estoque_local_saldos` sem registrar
  nenhum movimento correspondente, então `sum(movimentos_locais)` nunca
  explica `estoque_local_saldos` por completo. Gravar um movimento de reset
  (`'ENT'` ou um tipo `'AJU'` novo) no momento do espelhamento fecharia o
  ledger.
- **(M-5) O sync de catálogo completo não é operável pela tela.** 2553
  produtos × ~400ms de pacing ≈ 17+ minutos de execução; `export const
  maxDuration = 300` (Next.js) **não** protege nada nesta infra self-hosted
  (só um hint do Vercel, já documentado acima neste arquivo). Na prática o
  `fetch` do botão morre no timeout do proxy reverso bem antes do backend
  terminar, e a rota segue rodando desacoplada da UI. O método que funciona
  de verdade: `curl` destacado direto no servidor (`nohup curl ... &` ou
  equivalente), numa janela sem contenção do cron de 10 min (ver
  `MISUSE_API_PROCESS` acima — rodar durante o ciclo do cron é convidar o
  próprio cron a reestender o lockout).

## Notas fiscais de entrada pela SEFAZ em loja de estoque próprio (migration 139, 06/10/2026)

Em loja `modo_estoque='proprio'` (sem Omie) a nota de entrada NÃO é lançada na mão: o sistema puxa sozinho da SEFAZ, como o Omie faz, e confere com o cadastro.
Modo `omie` e `nenhum` ficam IDÊNTICOS (despacho por modo no começo de cada action/rota, teste em `lib/estoque/nf-despacho.test.ts`).

- **Mesmas tabelas do Omie.** A nota grava em `notas_fiscais`/`nota_fiscal_items` (`origem='sefaz'`, `n_id_receb` de `seq_nf_proprio` ≥ 8e12, `full_object` no formato do Omie: `cabec`, `infoCadastro`, `transporte`, `parcelas`, `totais` + bloco próprio `sefaz`). Por isso a tela Notas Fiscais, os relatórios (compras, auditoria fiscal, indicadores) e o espelho no Contabo (`lib/estoque/nf-frio.ts`, mesmo `POST /notas_fiscais_bulk`) funcionam sem mudança. `c_etapa` 60 = entrada lançada no estoque, 40 = pendente; a situação fina (resumo, a conferir, parcial, divergente, estornada) está em `full_object.sefaz.situacao` e `lib/nf-status.ts` a traduz (nota do Omie não tem esse bloco: comportamento de sempre).
- **Consulta (`lib/estoque/sefaz-sync.ts`, cron `/api/cron/sync-sefaz` a cada ciclo do `sync-cron.sh`, botão 'Buscar na SEFAZ' = `/api/sync/notas-fiscais`).** `NFeDistribuicaoDFe` no Ambiente Nacional, por NSU (`sefaz_nsu`: `ult_nsu`, `bloqueado_ate`). Só LEITURA. Sem documento novo (137) ou consumo indevido (656) = espera de 1 h gravada em `bloqueado_ate` (nunca consulta em loop; o botão manual respeita a mesma espera). O NSU só avança depois dos documentos guardados em `sefaz_documentos` (XML cru, idempotente por `(loja_id, nsu)`).
- **Fluxo de um documento.** `resNFe` (resumo) → nota sem itens (situação `resumo`) → **ciência da operação** (evento 210210 assinado, `sefaz-rede.ts`, única escrita na SEFAZ; liga/desliga em `sefaz_nsu.auto_ciencia`) → a SEFAZ entrega o `procNFe` na consulta seguinte → `gravarNotaCompleta` (`lib/estoque/nf-sefaz.ts`). `procEventoNFe` 110111 marca a nota como cancelada. Nota emitida pela própria loja é ignorada.
- **Conferência automática (`lib/estoque/nf-conferencia.ts`).** Para cada item: 1) de-para do fornecedor (`fornecedor_produto_depara`, CNPJ + cProd, com o fator já confirmado por uma pessoa), 2) EAN/GTIN único no cadastro (só automático se a unidade da nota é a do produto; senão sugere e pede o fator), 3) descrição normalizada com score (só SUGERE, nunca lança sozinho). **Regra de entrada automática:** só lança sozinho se TODOS os itens casaram por de-para ou EAN com a mesma unidade E a nota não tem alerta (total que não fecha, destinatário diferente, quantidade zero) E `sefaz_nsu.auto_lancar`. Senão a nota fica 'A conferir' (ou 'Divergente') e o gerente liga os itens pendentes na própria tela da nota e usa 'Confirmar entrada'. Cada ligação feita à mão alimenta o de-para (próximas notas do fornecedor já casam sozinhas).
- **Entrada no estoque.** Sempre por `lancar_compra` (migration 135) → `registrar_movimento` (ENT, origem `COMPRA`, ref = chave): custo = valor do item + frete rateado ÷ quantidade na unidade base; reimportar a mesma chave não duplica (`unique (loja_id, chave_acesso)`). 'Desfazer entrada' = `estornar_compra` (estorno movimento a movimento, histórico fica). `sincronizar_situacao_nota` mantém `c_etapa`/`infoCadastro`/situação em dia depois de qualquer mudança, e `espelharNotaNoFrio` reenvia ao Contabo (o upsert de lá é por `n_id_receb`, então a etapa 40→60 atualiza).
- **Importar XML e lançar sem XML** viraram opções secundárias DENTRO de Notas Fiscais (`/nota-fiscal/importar`, `/nota-fiscal/nova`) para a nota que a SEFAZ não trouxe; também criam a nota em `notas_fiscais` (a compra manual, sem chave). `/compras` e `/compras/[id]` só redirecionam; 'Compras' saiu do menu.
- **Certificado.** O A1 da loja (`lojas.certificado_*`, bucket privado `certificados`, senha em `lib/cripto.ts`) é aberto com `node-forge` (`sefaz-certificado.ts`), cadeia da AC resolvida em memória (24 h). `node-forge` e `xml-crypto` (assinatura do evento) entraram nas dependências, mesmas versões do Vendas.
- **Ainda NÃO validado ao vivo contra a SEFAZ** (nenhuma consulta real foi feita nesta frente): endpoint/SOAP da distribuição e do evento 210210 seguem o `nfephp-org/sped-nfe`, mas o primeiro teste real (cStat 138/137, ciência 135) precisa ser conferido com a ODARA. Pontos de atenção: `cUFAutor` vem de `lojas.uf` (padrão 29); `sefaz_nsu.ambiente` 1 = produção (leitura das notas reais); a primeira consulta com `ultNSU=0` traz o que a SEFAZ guarda (cerca de 90 dias).

## Faturamento por dia e Meta de faturamento (2026-10-08)

- `relatorio-faturamento?ver=diario` ("Por dia") e `/relatorio-meta` leem o mesmo loader, `lib/faturamento-diario.ts`: loja Omie = cupons do Contabo (`fat_cupons`, cancelado fora, devolvido dentro, igual ao total mensal); loja de estoque próprio = `vendas_proprio` (cancelado e devolvido fora, igual a `recalcular_faturamento_proprio`). Soma dos dias conferida contra o SQL e contra o total mensal (set/2026, lojas 2, 3 e 5, exato).
- Meta diária: tabela `metas_faturamento` (migration 154, uma linha por loja, escrita só via action `salvarMetaFaturamento`). Hoje fica "em andamento" e fora da média/dias que bateram; período é limitado a hoje e 366 dias (`limitarPeriodo`).
- Funções puras testáveis com `node --test lib/faturamento-dias.test.ts lib/meta-faturamento.test.ts` (sem alias `@/`; `meta-faturamento.ts` tem `addDias` próprio de propósito, import com `.ts` quebra o `tsc`).
- Os 3 pontos menores do primeiro deploy (campo da meta com ponto decimal, aviso falso de histórico indisponível, meta 0) foram corrigidos no mesmo dia; `parseValorBR` está em `lib/meta-faturamento.ts`.

## Meta do mês (2026-10-08)

- Tela `/meta-mensal` (grupo Faturamento em Relatórios): meta por mês e loja, tabela `metas_mensais` (migration 155, aplicada à mão no Contabo). Campo nasce vazio, quem define o valor é o cliente.
- Meta por dia = meta ÷ dias do mês; "precisa vender por dia" = falta ÷ dias restantes (hoje conta); projeção = média dos dias fechados × dias do mês; semanas de segunda a domingo cortadas nas pontas do mês. Tudo em `lib/meta-mensal.ts` (puro, `node --test lib/meta-mensal.test.ts`). Faturamento vem de `carregarFaturamentoDiario`, o mesmo do "Por dia".
- Conferido em produção (loja 3, out/2026, meta de teste R$ 1.000.000 já removida): faturado R$ 133.302,20, igual ao SQL.

## Tela nova de Faturamento (2026-10-08)

- `/faturamento` (card "Faturamento" em Relatórios) é a tela principal e tem tudo em abas: Produtos, Famílias, Tipos, Forma de pgto, Evolução mensal, Por dia, Cupons e Descontos. `/relatorio-faturamento` (antiga) continua existindo por URL, sem link na tela nova. Forma de pgto, Cupons e Descontos são por cupom: filtros de tipo/família não se aplicam (a tela avisa); Descontos só existe para lojas Omie. Loaders das abas extras em `lib/faturamento-extras-loader.ts`.
- Uma leitura de itens por período (`lib/faturamento-itens-loader.ts`): loja Omie = `fat_cupons` + `fat_cupom_itens` do Contabo; loja própria = `vendas_proprio*`; tipo/família/nome vêm de `produtos`. Filtros de tipo, família e situação são aplicados nessa leitura, então valem em todas as abas (a tela antiga só aplicava o filtro da dimensão exibida).
- Funções puras testáveis: `lib/faturamento-itens.ts` (ranking, ordenação, busca, KPIs, série) e `lib/faturamento-periodo.ts` (atalhos, mês, validação, limite de 366 dias). `node --test lib/faturamento-itens.test.ts lib/faturamento-periodo.test.ts`.
- Conferido em produção (loja 3, set/2026): faturado R$ 657.434,28 (= SQL dos cupons), top produto R$ 59.154,88 (= tabela antiga), detalhe do produto bate com a linha do ranking, filtro tipo=04 reduz para R$ 532.261,91.
- Loja própria (ODARA) ainda sem venda real para validar esse caminho.
- Abas extras conferidas em produção (loja 3, set/2026): forma de pgto igual ao SQL (CRC R$ 446.511,38, CRD 103.602,52, PIX 43.345,24, CRT 43.119,37, DIN 20.855,77), evolução mensal ago–out fecha em R$ 1.463.429,96 (= tela antiga), 2.187 cupons.

## Performance (2026-10-08): RLS em initplan e relatórios de NF sem o Contabo

- **Medir sempre no servidor, como usuário logado**: teste de SQL como `supabase_admin` ou service role NÃO passa por RLS e esconde o custo real (a tela roda como `authenticated`). Padrão: logar a conta QA por `/auth/v1/token`, montar o cookie `sb-127-auth-token` (`base64-` + base64url do JSON da sessão) e dar `fetch` em `127.0.0.1:3002`.
- **Migration 156**: as 68 políticas `(usuario_tem_acesso_loja(loja_id) OR usuario_e_admin())` viraram `((select usuario_e_admin()) OR loja_id IN (select usuario_lojas()))`. Mesmas linhas visíveis (conferido: 4 usuários × 8 tabelas, 0 diferenças), mas o acesso é calculado 1× por consulta e não 1× por linha: leituras grandes como usuário logado ficaram 3–5× mais rápidas. Política nova de RLS por `loja_id` deve usar esse padrão, nunca chamar a função por linha. Para reverter, ver o comentário no topo do arquivo.
- **Compras, Auditoria Fiscal e Fat × Compras** não buscam mais o "pedaço antigo" no Contabo: `limiteJanelaQuenteNF()` (`lib/historico-contabo.ts`) devolve uma data antiga e as RPCs leem o período inteiro direto do banco principal, que tem todo o histórico de NF (mais notas que o Contabo). Diferença de totais vs. antes: ~R$ 12 em R$ 2,16 mi (arredondamento da cópia fria). `home`, `resumo` e Pendências de Classificação ainda usam o frio. `relatorio-movimentacao` (tela e export) também passou a ler só o banco principal: em 08/10/2026 `movimentos_historico` (que só começava em 2026-04-13) recebeu backfill do Contabo-frio de tudo antes disso (348.884 linhas, dedupe por loja/produto/data; soma de saídas da loja 5 idêntica à fria). No período que se sobrepõe (04-13 a 07-11) vale o dado quente, mais novo. Resultado: RPC do ano inteiro em ~0,2 s.
- Tempos no servidor, antes → depois: Compras 4,3 → 0,6 s; Auditoria 4,4 → 1,3 s; Fat × Compras 3,6 → 0,6 s; Inventários 2,5 → 1,1 s; Movimentações 2,4 → 1,3 s; Produtos 2,1 → 1,0 s; Transferências 1,9 → 1,0 s; Estoque valorizado 2,3 → 1,0 s. 

## App desktop offline (Windows) — 2026-10-09

Spec: `docs/superpowers/specs/2026-10-09-estoque-desktop-offline-design.md`. Código em `desktop/` (Electron) + canal no servidor (`app/api/offline/*`, `lib/offline/*`, migration 157).

- **Como roda**: o app sobe Postgres 17 local (`desktop/vendor/<plataforma>/pgsql`, esquema em `desktop/schema/*.sql`), PostgREST v12, a frio-api (`desktop/frio-api/server.js`, cópia da do Contabo + `GET /export`) e o MESMO Next em modo standalone (`desktop/scripts/build-web.sh`, `NTB_DESKTOP=1`, `distDir .next-desktop`). Tudo em 127.0.0.1, portas 54394–54398; a janela e o Next só falam com o gateway (54398).
- **Leitura**: banco local sincronizado. Carga inicial por `/api/offline/snapshot` (páginas de **1000**: o PostgREST de produção corta em 1000), pull a cada 20 s por `/api/offline/mudancas` (log compactado `offline_versoes`, alimentado pela `outbox` por `offline_compactar()`, crontab do servidor a cada minuto; `offline_podar()` diário). `posicao_estoques`, `previsao_venda`, `produto_preco_recente` são "foto" (baixadas inteiras a cada 10 min). Faturamento (fat_*) vem do frio por `/api/offline/frio` (tudo na 1ª vez, últimos 40 dias a cada 15 min).
- **Escrita**: toda server action tem como 1ª linha `viaDesktop(...)` (inserida por `scripts/inserir-via-desktop.mjs`, que também gera `lib/offline/registro-acoes.ts`). **Ação nova: rode o script** e, se ela deve funcionar sem internet, inclua em `lib/offline/politica.ts` (`leitura` / `local` / `fila` / `depende`). Com internet a ação roda no servidor (`/api/offline/acao`, idempotente por `offline_execucoes`); sem internet entra na fila (`fila.json` no userData) e é reenviada na volta, com ids provisórios (faixa alta por tabela, `ntb_local.ajustar_sequencias`) trocados pelos reais (pareamento pela `outbox.intent_id`).
- **Segurança**: allowlist `offline_tabelas` (tabela fora dela nunca sai do servidor; colunas secretas de `lojas` ocultas em SQL). Token real só no processo principal (cofre com `safeStorage`). Gateway confere Host, rotas internas exigem token por execução, POSTs da janela exigem `X-NTB` + Origin local. Login offline só do último usuário que entrou online, senha conferida por scrypt, até 30 dias.
- **Mudou o esquema do banco (migration nova)**: rode `desktop/scripts/gerar-schema.sh` e lance uma versão nova do app; o app recria o banco local quando o hash do esquema muda.
- **Lançar versão**: subir `version` em `desktop/package.json`, `cd desktop && npm run dist && bash scripts/publish.sh` (feed `https://updates.norteparanegocios.com.br/ntb-estoque-desktop/`, link fixo `Norte-Estoque-Setup.exe`). O `build-web.sh` tira o `.env.local` do caminho e falha se algum segredo dele aparecer no build.
- **QA**: `node scripts/qa-canal-offline.mjs` (canal em produção, conta QA); `desktop/scripts/testar-banco.mjs` e `testar-canal.mjs` (banco local). No Mac: `NTB_JANELA_OCULTA=1 node_modules/electron/dist/Electron.app/Contents/MacOS/Electron .` dentro de `desktop/` (com `NTB_SERVIDOR=http://127.0.0.1:9` simula sem internet) e abra `http://127.0.0.1:54398` num navegador.
- **Pegadinhas já vistas**: o Electron trava o fechamento se algo assíncrono roda no `before-quit` (encerramento é síncrono de propósito); conexões `pg` sem handler de `error` derrubam o processo principal; o `pg_ctl start` precisa de `stdio: 'ignore'`; o Postgres do Windows precisa do `vcruntime140.dll` (vai junto, tirado do Python embeddable); o `postgrest.exe` do Windows carrega a `LIBPQ.dll`, então `vendor/pgsql/bin` vai no PATH do processo dele (sem isso morre na partida e o app para com "não respondeu na porta 54396", erro real da 1.0.0 no PC do Ramon). Para conferir DLLs de um `.exe` no Mac: `llvm-objdump -p arquivo.exe | grep "DLL Name"`. O electron-builder precisa ser **26.12+** (está 26.17): o instalador gerado pelo 25.x quebrava em ~75% das instalações no Windows 11 24H2+/Server 2025 (`System.dll`, 0xc0000005, offset 0x1581, bug do `multiUser.nsh`), inclusive na atualização automática. No 26 a pasta `node_modules` na raiz de um `extraResources` é descartada em silêncio, por isso o `web` entra como `from: "."` + filtro `web/**/*`; e os atalhos (symlink) que o Turbopack cria em `.next-desktop/node_modules` (`@react-pdf/renderer-<hash>`, `rimraf-<hash>`) viram cópia no `build-web.sh` (atalho do Mac não funciona no Windows: PDF quebraria).
- **Teste num Windows de verdade (sem PC Windows aqui)**: workflow `.github/workflows/desktop-windows-smoke.yml` (GitHub Actions, `workflow_dispatch`). Instala o instalador do link indicado no topo, sobe o app, confere as 5 portas, faz login com a conta QA (secret `QA_SENHA`), espera a carga, abre telas e um PDF, repete sem internet (hosts) e junta logs/prints como artefato. Para testar antes de publicar: subir o `.exe` em `.../ntb-estoque-desktop-teste/Norte-Estoque-Setup.exe` (fora do feed) e apontar o workflow para lá.
- **Fora (Fase 2)**: Android. DANFE/XML e sync manual com o Omie só com internet (o gateway repassa ao servidor).

## Estoque da loja Omie (espelho) e kardex do Omie (13/10/2026)

- `/estoque`, `/estoque/local/[codigo]` e `/estoque/produto/[codigo]` valem para loja `proprio` **e** `omie` (some só em `nenhum`; menu pelo flag `comEstoque`/`temEstoque` em `NavItems`/`AppShell`). Em loja Omie a tela é **só leitura**: as escritas seguem pelos fluxos Omie (Movimentações, Transferência, Inventário), linkados na própria tela.
- Fonte na loja Omie: `carregarEstoqueOmie` (`app/(app)/estoque/dados-omie.ts`) → `montarVisaoOmie` (`lib/estoque/espelho-omie.ts`, puro, `node --test lib/estoque/espelho-omie.test.ts`). Saldos só da `data_posicao` mais recente de `posicao_estoques` (nunca mistura fotos); local `0` = sentinela (mínimo + CMC), nunca um local; CMC da foto mais recente se > 0, senão da anterior; CMC fora de (0, 1e7) = "custo suspeito" (vale 0 no valor). Local ativo que veio na foto anterior e não na atual aparece no aviso "não atualizou na última leitura".
- "Atualizar do Omie" chama a rota existente `POST /api/sync/posicao` (permissão `Produtos - Sincronizar`), só leitura do Omie.
- Kardex do Omie: tabela `kardex_omie` (migration 159, índice único TOTAL `(loja_id, id_mov, codigo_local_estoque)`), carregada sob demanda por produto em `POST /api/estoque/kardex-omie` (`ListarMovimentoEstoque`, últimos 55 dias, todos os locais ativos, no máximo 1 carga por produto a cada 10 min). Normalização e "salto de CMC" (≥ 10× o anterior no mesmo local) em `lib/estoque/kardex-omie-puro.ts` (`node --test lib/estoque/kardex-omie-puro.test.ts`); busca em `lib/omie/kardex.ts`. Sem a tabela, a página do produto mostra "Kardex do Omie ainda não ativado".
- Foto dos saldos = a `data_posicao` mais recente que já tem linha de algum local real (o sync grava a sentinela primeiro; enquanto a foto do dia só tem sentinela, os saldos vêm da anterior e nada aparece zerado). Locais ativos sem linha em nenhuma foto aparecem como "sem saldo no Omie ou ainda não lidos".
- Trava por loja+recurso (`sync_trava`, RPCs `pegar_trava_sync`/`soltar_trava_sync`, migration 159, helper `lib/omie/trava-sync.ts`): o cron `sync-posicao` e o botão (`/api/sync/posicao`, que também recusa com 429 se a posição tem menos de 5 min) nunca rodam juntos na mesma loja; o kardex usa `kardex:<produto>` (10 min, solta na hora se falhar). Sem a migration, o helper segue sem trava (log). `kardex_omie_carga` guarda a última carga por produto (inclusive "0 movimentos").
- Estado: no ar desde 13/10/2026 (migration 159 aplicada). Spec e plano: `docs/superpowers/specs/2026-10-13-estoque-espelho-omie-design.md`, `docs/superpowers/plans/2026-10-13-estoque-espelho-omie.md`.

## "Nosso Omie" Fase 1 — base de dados do espelho completo (13/10/2026)

Spec: `docs/superpowers/specs/2026-10-13-nosso-omie-design.md`; plano: `docs/superpowers/plans/2026-10-13-nosso-omie-fase1.md`. Migration **160** (`160_espelho_completo.sql`, depende da 159).

- **Flag** `lojas.espelho_completo` (ligada só na loja 5 pela própria migration). Os crons novos usam `getLojasEspelhoCompleto()` (`lib/omie/sync-all.ts` + regra pura `lojaPodeEspelhar` em `lib/estoque/espelho-lojas.ts`): flag ligada, loja real, ativa, `modo_estoque='omie'`, nunca a loja 4. Sem a coluna (migration não aplicada) a lista vem vazia e os crons não fazem nada.
- **Janela proibida** 00:00–07:00 America/Bahia (`janelaProibida`): a faxina do Mac usa a mesma chave do Omie de madrugada. Vale para os 3 crons novos e para o `sync-ajustes` das lojas com flag. O servidor está em Europe/Berlin: datas e horas sempre por `relogioBahia`.
- **Parar sem repetir**: os crons novos chamam `omieRequest` com `semRepetir: true` (sem o "aguarde e repita" do consumo redundante/429) e param a loja no 1º erro do Omie; o cursor fica onde estava e o motivo vai para `espelho_sync_estado.ultimo_erro`.
- **Cursor** em `espelho_sync_estado (loja_id, frente, estado jsonb)`. Motor puro `lib/estoque/espelho-frentes.ts`: frente recente (relê os últimos N dias a cada 30 min; se o cron parou, recupera de `coberto_ate` em janelas de até 30 dias) e backfill (desce em janelas de 30 dias até 2026-07-01). `historicoDesde(estado)` = desde quando o histórico está completo (a tela da Fase 2 mostra "histórico disponível desde dd/mm"). Terceira frente, **revisão** (kardex e ajustes): 1x a cada 24 h relê os 35 dias anteriores à janela recente, só onde o histórico já cobre (lançamento feito hoje com data antiga; o Omie recalcula saldo/CMC dos movimentos seguintes). No kardex, ao fechar uma janela de revisão, apaga as linhas daquela janela/locais que não foram vistas (`carregado_em` < início da janela) = excluídas/estornadas no Omie. Mais antigo que 35 dias fica congelado como foi lido.
- **`sync-kardex`** (`lib/omie/kardex-loja.ts`): `ListarMovimentoEstoque` SEM `idProd`, um local ativo por vez (sem `codigo_local_estoque` o Omie devolve só o padrão), 100 por página, 12 páginas por ciclo, pausa 700 ms, trava `kardex-loja`. Frente recente = ontem + hoje. Grava `kardex_omie` (upsert pela constraint total) e, na frente recente, `kardex_omie_carga.carregado_em` dos produtos vistos.
- **`saldo_em_data(loja, data)`** (SQL, security invoker): último movimento não cancelado até a data por produto+local (`data_mov desc, id_mov desc`) → `saldo_apos`/`cmc_apos`. Só vale a partir de `historicoDesde` do estado `kardex`.
- **`sync-ajustes`**: lojas com flag usam `syncAjustesJanela` (`data_movimento_de/ate`, últimos 3 dias + backfill até 01/07, 8 páginas/ciclo, trava `ajustes`, frente `ajustes`); as outras seguem pelo maior `id_ajuste`. Todas gravam `movimentos.autor` (obs "NTB Estoque · Nome" ou "Usuário:Nome"), `origem_ajuste` (app | script | pdv | api | omie) e `cod_int_ajuste` (`lib/estoque/ajuste-autor.ts`). A RPC `upsert_movimentos_ajuste` (índice parcial: nunca `.upsert()`) agora só regrava linha que mudou e **nunca sobrescreve linha criada pelo app** (`cod_int_ajuste = 'MOV-<id da linha>'` ou `transferencia_id` preenchido: SAI manual guarda `quan` negativo e a hora da Bahia) — nessas só grava autor/origem/código. Se o Omie ignorar `data_movimento_de/ate` (página com ajuste fora da janela), o cron para e a rota cai no modo por id no mesmo ciclo. As 3 colunas novas NÃO vão para o Contabo (`/movimentos_bulk` não as conhece).
- **`sync-ops-abertas`** (`lib/omie/ops-abertas.ts`): `ListarOrdemProducao` `cConcluida: 'N'` (todas, sem janela de data) no máximo a cada 30 min (a trava `ops-abertas` de 30 min é o intervalo); grava `origem_op` (vendas NTBV | app NTB- | script OP-/FPI-/SEED-/CORTE-/FAX- | cupom obs "Cupom N" ou uInc WEBSERVICE | manual), `incluido_por_omie`, `obs_omie`, `aberta_omie=true`; só insere/atualiza o que mudou e nunca mexe em `concluida` de OP existente. OP ausente em DUAS leituras completas seguidas vira `aberta_omie=false` (a lista pode deslocar entre páginas; candidatas guardadas em `estado.pendentes_saida`; lista com mais de 30 páginas é tratada como incompleta) (concluída OU excluída no Omie; não dá para saber pela lista). Até 30 `ConsultarOrdemProducao` por ciclo para gravar `full_object.itensDetalhes` (ficha gravada na OP) + `itens_consultados_em`.
- **`sync-fichas`** (`lib/omie/fichas.ts`): `estrutura_produto_cache` aos poucos (20 produtos PA/PI por ciclo, pausa 1,5 s, refaz a cada 7 dias por `estrutura_produto_sync`), com `incluido_por/em`, `alterado_por/em`, `id_malha` e local de consumo (`ConsultarEstrutura` não traz o local por linha: vem da última OP do produto, `local_fonte='op'`). Apaga os insumos que saíram da ficha (só do produto relido).
- **`sync-familias`** entrou no `sync-cron.sh` (bloco 4, 1×/hora).
- **Deploy**: aplicar a 160, conferir `\df upsert_movimentos_ajuste` (1 overload) e `select id, espelho_completo from lojas where espelho_completo`, depois deploy do código. Rodar `desktop/scripts/gerar-schema.sh` e lançar versão nova do desktop. O backfill do kardex roda sozinho (dias) e o progresso fica em `select frente, estado, ultimo_erro from espelho_sync_estado where loja_id = 5`.

## "Nosso Omie" Fases 2 e 3 — telas de informação e auditoria do estoque (13/10/2026)

Plano: `docs/superpowers/plans/2026-10-13-nosso-omie-fase2-3.md`. Tudo **só leitura** (escrita no Omie é a Fase 4). Migration **161** (`161_estoque_telas_auditoria.sql`, depende da 159/160): só índices (`kardex_omie (loja_id, data_mov desc, id_mov desc)`, `movimentos (loja_id, data desc)`) e as políticas de `kardex_omie`/`kardex_omie_carga` reescritas no padrão initplan da 156. Nenhuma server action nova (só páginas e um GET de CSV): `inserir-via-desktop.mjs`/`politica.ts` não mudaram.

- **Navegação**: abas `EstoqueAtalhos` (Saldos, Saúde, Kardex, Ajustes, Fichas, OPs abertas, Quem mexeu) no topo das telas de estoque; menu ganhou "Saúde do estoque" (`comEstoque`, permissão `Movimentacoes`). O item ativo do menu agora é a rota mais específica (`lib/nav-ativo.ts`), senão `/estoque` e `/estoque/saude` ficavam marcados juntos.
- **`/estoque/saude`** (`dados-saude.ts` + `lib/estoque/saude-puro.ts`): negativos com "negativo desde" (kardex 60 dias dos produtos negativos, limitado ao início do histórico completo; sem histórico completo — loja sem `espelho_completo` ou backfill no começo — mostra "histórico do kardex ainda não lido" e o salto de custo fica "não se aplica", nunca "Tudo certo"), custo absurdo (CMC ≥ R$ 1.000 ou ≥ 20× o anterior, pelas entradas de 60 dias), salto de custo nos últimos 7 dias (≥ 10×), OPs do PDV sobrando (origem cupom e prato com saldo ≥ 0), prato negativo sem OP, insumo sem custo no local de consumo (ficha × `posicao_estoques` por local; causa do Client-193), contagem que oscila (`movimentos` SLD de 120 dias, razão ≥ 3 ou indo a zero), vende sem ficha (só produto cuja ficha já foi LIDA com 0 itens; não lido não entra). Loja própria: negativos, custo, insumo sem custo e vende sem ficha pelo ledger; OPs sobrando/faltando e contagem mostram "não se aplica".
- **`/estoque/kardex`** (`dados-kardex.ts`, `lib/estoque/kardex-loja-puro.ts`): `kardex_omie` da loja inteira, padrão 7 dias, até 366; filtros produto (texto → até 300 produtos), local, origem (`cod_origem`), autor (via `movimentos.autor` → `id_ajuste`, até 300); paginação no servidor 100/página com ordem total `data_mov, id_mov, id`; CSV em `/estoque/kardex/csv` (BOM, `;`, vírgula decimal, até 20.000 linhas). Faixa "histórico completo desde dd/mm" = `historicoDesde` da frente `kardex` em `espelho_sync_estado`. Loja própria redireciona para `/movimentacoes` (o kardex do ledger já está lá).
- **Página do produto**: seção "Custo do produto" (`CustoProduto`, `lib/estoque/custo-produto-puro.ts`): gráfico SVG do custo médio por local (até 3 locais; ponto ≥ R$ 1.000 ou 20× fica vermelho e preso no topo), entradas desde o último zeramento do saldo do local, e para PA/PI o custo do prato = Σ quantidade × (1 + perda%) × custo médio atual do insumo (própria: bruta ÷ rendimento). O kardex do produto agora lê até 1000 linhas (a tabela mostra 300).
- **Saldo em data** (`/estoque?data=YYYY-MM-DD`, só loja Omie): RPCs `saldo_em_data` (160) e `primeiro_mov_apos` (161), paginadas (`order n_cod_prod, codigo_local_estoque`), `lib/estoque/saldo-data-puro.ts`. Por produto+local: último movimento até a data; senão o 1º depois dela (saldo antes = `saldo_apos − quantidade`); senão o saldo de hoje (não mudou desde o início do histórico). Data antes de `historicoDesde`, no futuro ou sem histórico → aviso e saldo de hoje.
- **Data dos ajustes do Omie**: o `sync-ajustes` grava só a data (`'YYYY-MM-DD'` → meia-noite UTC no banco); o app grava a hora real. As telas pedem `[ini 00:00Z, fim+1 03:00Z)` e classificam o dia com `diaDoMovimento` (`lib/estoque/quem-mexeu-puro.ts`): meia-noite UTC exata = aquele dia, sem hora; o resto = dia da Bahia.
- **`/ordem-producao/abertas`** (`dados-ops.ts`, `lib/estoque/ops-tela-puro.ts`): loja com `espelho_completo` → `aberta_omie = true`; Omie sem a flag → `concluida = false` com aviso de lista incompleta; própria → `concluida = false`. Origem, quem abriu, idade, previsão, ficha gravada na OP (`full_object.itensDetalhes`), "Sobrando" (cupom com prato ≥ 0) e "Faltando concluir" (prato ainda negativo).
- **`/estoque/fichas`**: `estrutura_produto_cache` agrupada por prato, local de consumo (+ "(da última OP)"), quem incluiu/alterou; `?insumo=` = "onde é usado". Própria: fichas ativas (`criada_por`). Topo: "N de M produtos de produção já lidos".
- **`/estoque/ajustes`** (`lib/estoque/ajustes-tela-puro.ts`): `movimentos` do período (padrão 30, máx. 92 dias), **sem vendas do PDV** (origem/motivo PDV); valor = |quan| × valor (SLD = contagem, vale 0); "custo fora do normal" = ≥ R$ 1.000 ou 20× acima/abaixo do custo médio atual. Própria: `estoque_movimentos` tipo AJU.
- **`/estoque/quem-mexeu`** (`lib/estoque/quem-mexeu-puro.ts`): ajustes (autor), OPs (`incluido_por_omie`, `dt_inclusao`) e fichas (`incluido_por/alterado_por`) no período (padrão 7, máx. 92), agrupados por pessoa (nome normalizado sem acento/caixa) e por dia da Bahia; linha do tempo corta nos 300 mais recentes. Própria: ledger (uuid → `profiles.name`), `op_historico`, `fichas_tecnicas`.
- **Testes**: `node --test lib/nav-ativo.test.ts lib/estoque/{saude,kardex-loja,custo-produto,saldo-data,ops-tela,fichas-tela,ajustes-tela,quem-mexeu}-puro.test.ts`.
- **Deploy**: aplicar a 161 (depois da 160), deploy do código, `desktop/scripts/gerar-schema.sh` + versão nova do desktop. Conferir como usuário logado (loja 5): `/estoque/saude`, `/estoque/kardex` (+ CSV), `/estoque?data=<desde>`, `/ordem-producao/abertas`, `/estoque/fichas`, `/estoque/ajustes?fora=1`, `/estoque/quem-mexeu`.

## "Nosso Omie" Fase 4 — escrever no Omie pela tela (13/10/2026)

Plano: `docs/superpowers/plans/2026-10-13-nosso-omie-fase4.md` (rulings R1–R10 no topo). Migration **162** (`162_escrita_omie_tela.sql`): 4 permissões + tabela `estoque_correcao_custo`. Só loja `modo_estoque='omie'`; **loja 4 bloqueada** (`bloqueioDeEscrita`, `lib/estoque/escrita-omie-puro.ts`); loja de teste = escrita simulada pelo `omieRequest`. Contexto comum: `contextoEscritaOmie(...permissões)` (`lib/estoque/contexto-escrita-omie.ts`, `lojas` com `is_test`).

- **Permissões novas** (módulo "Escrever no Omie pela tela" no catálogo): `Estoque - Lancar no Omie`, `OP - Acoes em lote`, `Fichas - Trocar insumo`, `Estoque - Corrigir custo`. Cada ação também exige a permissão de sempre (`Movimentacoes - Criar`, `Transferencias - Criar/Editar`, `Ordens de Producao - Concluir/Excluir/Editar`). Admin/AdminLoja passam em tudo.
- **`/estoque` e `/estoque/produto/[codigo]`** (`lib/actions/estoque-omie.ts`): Entrada (`entradaOmie`), Ajuste (`ajusteOmie`: "saldo contado" lê o saldo do local ao vivo no Omie e lança a diferença) e Transferência (`transferirOmie` = createTransferencia + addMovimento + enviarMovimento) com os mesmos modais do modo próprio (`Acoes.tsx`, prop `destino='omie'`). Tudo pelo `criarAjusteManual`/transferência de sempre (CMC lido ao vivo; "Sem CMC" fica pendente para o cron). Entrada no Omie não tem campo de custo.
- **`/ordem-producao/abertas`** (`lib/actions/ops-lote.ts`, `components/estoque-proprio/LoteOPs.tsx`): seleção (até 100) + Concluir / Mudar data / Excluir. A tela chama 1 OP por vez (`acaoOPLote` → `finishOP`/`excluirOP`/`setDataOP`), trava `op:<id>` em `sync_trava`, para no 1º bloqueio do Omie (`ehLimiteOmie`). Concluída → `aberta_omie=false` na hora. Sobrando/faltando agora usa o **saldo do local da OP** (`saldoNoLocalDaOP`; também na Saúde, `opsSobrandoFaltando(..., saldosLocal)`).
- **`/estoque/fichas?trocar=1`** (`lib/actions/fichas-omie.ts`, `TrocarInsumo.tsx`): de/para/quantidade → prévia (`montarTrocas`) → confirmação → por prato, 1 por vez: `ConsultarEstrutura` (`conferirAntesDaTroca`) → `IncluirEstrutura` com `intMalha` (`incluirItemEstrutura`, formato da faxina 11/10: `itemMalhaIncluir: [{ intMalha, idProdMalha, quantProdMalha, percPerdaProdMalha }]`) → reler (`conferirTroca('incluido')`) → `ExcluirEstrutura` pelo `idMalha` lido ao vivo → reler (`conferirTroca('excluido')`) → `gravarFichaLida` (extraído de `lib/omie/fichas.ts`). Pausa 1,5 s entre chamadas, trava `ficha:<prato>`, para no 1º erro e diz se a ficha ficou com os dois. Perda vem do item antigo; **local de consumo do item novo fica em branco** (só o `AlterarEstrutura` aceita `codigo_local_estoque`, fora do escopo). Loja de teste lê as fichas da loja de origem (`loja_origem_id`) e não relê.
- **`/estoque/ajustes`** ("Corrigir custo", `corrigirCustoAjuste`/`relancarCorrecaoCusto`, `CorrigirCusto.tsx`): só ENT/SAI com `id_ajuste`, sem transferência, sem inventário (`ITEM…`), sem PDV (`motivoNaoCorrige`). Prévia (`impactoCorrecaoCusto`), confirmação; mês fechado (`mesDoAjusteFechado`: antes do mês passado, ou até `ESTOQUE_MES_FECHADO_ATE=YYYY-MM` no env) exige 2ª confirmação na tela e no servidor. Fluxo: grava a correção `excluindo` (índice único parcial = uma por ajuste) → confere o ajuste no Omie (`listarAjustesDoDia`, produto/local/tipo/quantidade/custo) → `ExcluirAjusteEstoque` → `relancando` → `IncluirAjusteEstoque` com o custo novo e `cod_int_ajuste = CUSTO-<id da correção>` → `concluido` e a linha de `movimentos` passa a apontar para o ajuste novo. Falha depois de excluir = `pendente_relancar`, aparece em "Correções pendentes" com **Refazer** (procura `CUSTO-<id>` no Omie antes de incluir e, se a lista do dia vier cortada, para em vez de incluir: nunca duplica; `decidirRelancamento`). Exclusão sem resposta do Omie (timeout/rede) fica `excluindo` (`statusAposExclusao`): depois de 10 min o Refazer confere se o antigo ainda existe. Entrada/ajuste/transferência que gravou a linha mas o Omie não confirmou responde "gravado, NÃO lance de novo" (`respostaDoLancamento`; o cron reenvia).
- **Desktop offline**: `entradaOmie`, `transferirOmie`, `acaoOPLote` = `depende`; `ajusteOmie` (saldo contado compara com o Omie na hora do envio), `corrigirCustoAjuste`, `relancarCorrecaoCusto`, `trocarInsumoNoPrato` ficam fora da política de propósito (só com internet).
- **Achado (não corrigido)**: o fallback "concluir sem insumo sem CMC" (`tentarConcluirSemInsumosSemCmc`) recoloca o insumo com o `incluirEstrutura` antigo, sem `intMalha` — pelo que a faxina viu em 11/10 (Client-103), essa restauração provavelmente falha. Trocar para `incluirItemEstrutura` depois de confirmar com um probe.
- **Testes**: `node --test lib/estoque/escrita-omie-puro.test.ts lib/estoque/saude-puro.test.ts`.
- **Deploy**: aplicar a 162, conferir `select nome from permissoes where nome in ('Estoque - Lancar no Omie','Estoque - Corrigir custo','Fichas - Trocar insumo','OP - Acoes em lote')` e `\d estoque_correcao_custo`, deploy do código, `desktop/scripts/gerar-schema.sh` + versão nova do desktop. Testar primeiro na loja de teste da Donana PF (tudo simulado, `integration_attempts.model like '[SIMULADO]%'`).

## Movimentações completas, OP/NF ligadas e velocidade (13/10/2026)

Plano: `docs/superpowers/plans/2026-10-13-movimentacoes-completas.md` (diagnóstico com números da loja 5). Migration **170** (`170_movimentacoes_completas.sql`, depende da 160/161; numerada 170 para não colidir com a Fase 4).

- **Por que não aparecia tudo**: a aba Movimentos exigia produto, olhava só hoje, juntava `movimentos` (`.limit(500)`), OPs do próprio produto (só a entrada) e itens de NF (`.limit(500)` sem data, e como "Saída"); o consumo de insumo nas OPs nunca aparecia (MP da loja 5: 1,06 mi de saída no Omie em 30 dias, 0 na tela). O Histórico cortava produtos/posições em 1000 e totalizava 1000 linhas.
- **`/movimentacoes`**: aba padrão = **Movimentos** (todos os movimentos do período, sem exigir produto); "Histórico por dia" = `?aba=historico`. Loader único `lib/movimentacoes/dados.ts`: loja com `espelho_completo` **e** histórico do kardex cobrindo o início do período (`escolherFonte`) lê `kardex_omie` (via `buscarKardexLoja`, que ganhou o filtro `doc`); as outras chamam a RPC `movimentacoes_loja` (170): `movimentos` com status Concluido (ajuste, PDV, contagem SLD como "Contagem", transferência em DUAS linhas: saída na origem e entrada no destino), produção e consumo das OPs concluídas pela ficha gravada na OP (`full_object.itensDetalhes`; `cUtilizarDoEstoque='N'` também consome — MP da loja 5 vem toda N) e entradas de NF concluídas não canceladas (`n_qtde_nfe`, unidade da nota). Filtros: família, período (7 dias padrão; 366 no kardex ou com produto/documento; 92 na reconstrução da loja inteira), `q` (produto, até 300 códigos, vai por POST), `cod` (produto exato, link "só este"), local, origem, `doc`, autor. `?produto=` (texto, links antigos de Margem/Compras/Auditoria/Relatório) vira a busca. Com até 20 produtos no filtro mostra também o total oficial do Omie (`movimentos_historico`). Cada linha liga ao produto e ao documento (`hrefDocumento`): OP, nota, cupom (`/faturamento/cupom/[id]`, página nova, lê o Contabo), transferência, inventário, ajuste.
- **OPs**: barra de pesquisa `?q=` (número com ou sem ano/zeros, código do Omie, produto, `observacao`/`obs_omie` = cupom, data `dd/mm[/aaaa]` = prevista ou concluída no dia) — `lib/ordem-producao/busca-op.ts`, usada pela tela e pelo export. Com busca o mês corrente deixa de ser o padrão e a lista não completa com o Contabo (o frio guarda OPs já excluídas). Página da OP: "Ficha usada nesta OP" e "Movimentos de estoque desta OP" (kardex casado por número da OP; sem número, um movimento por item da ficha — mesmo produto e mesma quantidade, dia da conclusão primeiro — marcado "provável"; sem espelho, pela ficha).
- **Notas**: cada item liga ao produto e aos movimentos dele desde a emissão; "Movimentos de estoque desta nota" (kardex com origem nota + mesmo número, ou a entrada pela própria nota) substituiu `MovimentacoesGeradasNF`. Página do produto (`/estoque/produto/[codigo]`): "Notas fiscais deste produto".
- **Velocidade**: 170 põe em "initplan" as políticas que a 156 não pegou (`movimentos_historico`, `lojas`, `vendas_proprio_itens`, `vendas_proprio_pagamentos`, `ordens_producao_proprio_itens`), cria índices (`movimentos (loja, id_prod, data)`, OPs por data prevista/conclusão e trigram do número, itens de NF por produto, inventário por ajuste) e reescreve `relatorio_movimentacao_matriz` (soma antes de juntar produtos: pela API 0,53–0,66 s → 0,15 s por página; mesma saída, `scripts/testes-sql/170_relatorio_movimentacao_matriz.sql`). `lib/auth.ts` guarda usuário, perfil e permissões por requisição (`cache` do React). `paginasEmOndas` (`lib/supabase/`) lê páginas em paralelo.
- **Testes**: `node --test lib/movimentacoes/movimentacoes-puro.test.ts lib/movimentacoes/historico-puro.test.ts lib/supabase/paginas-em-ondas.test.ts lib/permissao-puro.test.ts lib/estoque/kardex-loja-puro.test.ts`; SQL em `scripts/testes-sql/170_*.sql` (rodar numa cópia local: Postgres 17 em Docker com `pg_dump --schema-only` da produção + dados da loja 5 por `copy ... to stdout`; nunca em produção).
- **Deploy**: aplicar 160 → 161 → (162 da Fase 4) → **170 sem `-1`** (índices `concurrently`); conferir `\df movimentacoes_loja` e `\df relatorio_movimentacao_matriz` (1 overload cada); deploy do código; `desktop/scripts/gerar-schema.sh` + versão nova do desktop. Conferir como usuário logado: `/movimentacoes` (loja 5 com espelho e loja 3 sem), `/movimentacoes?aba=historico`, `/ordem-producao?q=<nº>`, uma OP concluída, uma nota, `/relatorio-movimentacao`.

## Central de correções (14/10/2026)

Spec: `docs/superpowers/specs/2026-10-14-central-correcoes-design.md`; plano (rulings R1–R18): `docs/superpowers/plans/2026-10-14-central-correcoes.md`. Migration **171** (`171_central_correcoes.sql`). Protótipo aprovado pelo dono: `scratchpad/prototipo-correcoes` (dados reais da loja 5).

- **Tela** `/estoque/correcoes` (menu "Central de correções", aba "Correções" nas telas de estoque; `/estoque/saude` só redireciona). Hero com o progresso do dia (resolvidos/esperando Ramon/ignorados, R$ em aberto), "Comece por aqui" (3 abertos que mais pesam), grupos colapsáveis por R$ em aberto (PA, PI, MP/revenda, custo fora do normal, OPs sobrando/faltando/velhas, contagens estranhas, insumo sem custo ou inativo na ficha, **cupons sem OP**, taxas sempre por último), cada um com busca, ordem e filtro de estado; "Feito pelo robô" (7 dias); painel universal (produto, OP, nota, cupom, ajuste/contagem; abas Resumo/Movimentos/Ligado a; pilha com voltar e caminho; folha de baixo no celular) carregado sob demanda (`carregarPainel`).
- **Regras puras** (sem `@/`, `node --test lib/correcoes/*.test.ts`): `lib/correcoes/central-puro.ts` (formatos, causa em uma frase, classificação, valor, estado efetivo, prévias, opções, busca rápida — um arquivo só porque módulo puro não pode importar valor de outro com `.ts`) e `lib/correcoes/cupons-sem-op-puro.ts` (cupons sem OP, `cCodIntOP` determinístico, validação do pedido). Valor: |saldo negativo| × custo de referência (CMC normal; produto com custo fora do normal usa a ficha/anterior). Chave estável: `<grupo>:<tipo>:<id>[:<local>]`.
- **Estado** em `central_problema_estado` (único por loja + chave): `ramon` fica até reabrir (mensagem guardada, NADA é enviado); `ignorado` "olhar outro dia" vale até hoje, "não é problema" volta se o problema mudar (assinatura); `resolvido` vale até o fim do dia seguinte e depois, se ainda aparece, reabre com aviso. "Não controla estoque" = `estoque_nao_controla` (só aqui; o Omie não muda).
- **Cupons sem OP** (a integração do PDV "JS" parou 07–09/10 e 13/10 à tarde na loja 5 e reprocessou o dia 08 só em 13/10): cupons de 14 dias do Contabo (até agora − 2 h) × OPs do caixa por dia+produto (`central_ops_pdv`, migration 171: cCodIntOP só dígitos, `CP-`, obs "Cupom N" ou origem cupom, em qualquer estado), cobertura em ordem de hora. Produto entra se teve OP do caixa em 60 dias ou tem ficha lida, tipo 03/04.
- **Ações**: as da Fase 4 (`ajusteOmie` zerar/contagem/diferença, `acaoOPLote` concluir — agora com a data escolhida —/excluir/mudar data, `corrigirCustoAjuste`) e as novas em `lib/actions/central.ts`: `lancarOPCorrecao` (motor `lib/correcoes/op-central.ts`: trava única `central_op_lancada (loja, cod_int_op)` + `sync_trava` por produto+dia no cupom; quantidade/data do cupom saem do Contabo; confere de novo vendido × OPs do caixa do dia antes de incluir; retomada consulta o Omie pelo `cCodIntOP` (`consultarOPPorCodInt`) antes de incluir; "já cadastrada" → consulta e segue; criada e não concluída fica `incluida` e o refazer só conclui), `marcarEstadoProblema`, `marcarNaoControla`, `corrigirContagemCentral` (contagem lida do banco; trava `cc:mov:<id do SLD>` em `central_problema_estado`: a mesma contagem nunca é corrigida duas vezes, e ela some da Central). "Zerar" manda `somenteSeNegativo` ao `ajusteOmie` (recusa se o saldo lido agora no Omie não é mais negativo). A OP de cupom tem obs começando com "Cupom N" (igual à da integração do PDV) e a cobertura do dia é conferida antes de TODA inclusão (também na retomada). Permissão nova **`Correcoes - Executar`** (+ `Ordens de Producao - Criar/Concluir`) para lançar OP; estados com `Movimentacoes`. Loja 4 bloqueada e loja de teste simulada (contextoEscritaOmie). `cCodIntOP`: cupom `CP-<cupom b36>-<produto b36>`, correção `CT-<hash>`; `origemDaOP` trata `CP-`/`CT-` como `app`.
- **Busca rápida** (`/` e Cmd/Ctrl+K, `lib/actions/busca-global.ts`): produto, OP com ou sem ano/zeros, nota, cupom (número nos últimos 45 dias ou id). Setas + Enter; na Central abre o painel (evento cancelável `ntb:abrir-painel`), fora dela navega.
- **Robô** (porta do trabalho de 08/10 do checkout antigo): `POST /api/correcoes/ingest` (chave de integração da loja, loja real `is_test=false`, upsert idempotente), tela `/correcoes` ("Feito pelo robô", Administração), contador no painel "Precisa de ação", validação em `lib/correcoes/robo.ts`. Formato do payload: igual ao descrito antes (lote, modulo `faxina|lancarPI|corrigirAzeite|relatorios`, acao, status `ok|falhou|parado|pendente_decisao|desfeito`, origem_ts; opcionais produto_cod, produto_desc, data_ref, quantidade, de_valor, para_valor, motivo, omie_ref, dados com `op_id`).
- **Contabo lento/fora**: a Central, a busca e o motor de OP usam timeout curto e 1 tentativa (`buscarFrioTudo(..., { timeoutMs, tentativas })`); a Central mostra aviso em vez de esperar 60 s.
- **Velocidade** (consultas medidas no servidor como usuário logado da loja 5, `set role authenticated`): posição 28 ms/página, produtos 55 ms/página, fichas 4 ms, contagens 58 ms/página, entradas do kardex 14 dias 14 ms, OPs do caixa agregadas 116 ms, "negativo desde" no banco (`central_negativo_desde`) 36 ms com 10 mil linhas de kardex, OPs abertas 153 ms → índice parcial novo na 171, cupons do Contabo 0,2 s (14 dias). Duas ondas paralelas (páginas em ondas de 4): estimativa ~0,5 s no servidor. `carregarCentral` loga os tempos (`central-correcoes: loja N {...}`) no journal do serviço.
- **Desktop offline**: `central#carregarPainel` = leitura; escritas da Central fora da política (só com internet). Migration nova → `desktop/scripts/gerar-schema.sh` + versão nova do app.
- **Deploy**: aplicar a 171 **sem** `-1` (índices `concurrently` no fim); conferir `\df central_ops_pdv` e `select nome from permissoes where nome = 'Correcoes - Executar'`; deploy do código; dar `Correcoes - Executar` aos cargos; `gerar-schema.sh` + versão do desktop. Testar primeiro na loja de teste da Donana PF (`integration_attempts.model like '[SIMULADO]%'`), depois conferir na loja 5 como usuário logado.

## Notas Fiscais no layout do Faturamento (15/10/2026)

Pedido do Ramon ("tem como colocar a entrada de nota para ficar com o mesmo layout?" do Faturamento). `/nota-fiscal` virou painel de compras recebidas reaproveitando os componentes de `/faturamento`.

- **Tela** (`app/(app)/nota-fiscal/page.tsx`): `PeriodoBar` (padrão "Este mês"; `data_inicio`/`data_final` de links antigos viram `ini`/`fim`; período de até ~10 anos via `lerPeriodo(..., maxDias)`), filtros sempre visíveis `FiltrosNotas` (Fornecedor com busca, Família, Situação) + gaveta "Filtros" com o resto (Nº NFe, Tipo, Local, Natureza, Produto, Categoria), 4 cartões (Total comprado, Notas + fornecedores, Ticket médio por nota, Maior fornecedor), visões Notas / Fornecedores / Produtos / Famílias / Por dia / Evolução mensal (por fornecedor, família ou produto). Notas = lista com barra (`ListaNotasCompra`), 50 por página, ordem Recentes/Antigas/Maior/Menor valor (`ord`/`dir` antigos continuam valendo); cada linha abre `/nota-fiscal/[id]` (detalhe, itens, vínculos e ações não mudaram). Fornecedor → filtra as notas dele; Família → produtos dela; Produto → painel `DetalheItemCompra` (comprado, quantidade, preço médio, notas, dia a dia, lista das notas). Botões PDF/Excel/Importar XML/Lançar sem XML/Atualizar e o `StatusSefaz` ficaram.
- **Situação**: sem `status` = **válidas** (tudo menos cancelada; antes o padrão era "todas"); `TODAS` = sem filtro; `CONCLUIDA`/`PENDENTE`/`CANCELADA`/`MANIFESTADA`, `C`/`P` e etapa crua (`?status=40`) seguem. Excel e PDF recebem `status=VALIDAS` explícito (as duas rotas e `statusBateFiltro` aprenderam `VALIDAS`/`TODAS`).
- **Dados** (`lib/notas-compras-loader.ts`): só o banco principal (tem todo o histórico de NF; conferido 15/10: loja 5, 0 notas só no Contabo). Tipo/família/produto/local/natureza/categoria vão ao banco (mesma resolução de ids em lotes da tela antiga); fornecedor, situação e número em memória (`lib/notas-compras.ts`, puro). Itens só carregam nas visões que precisam; valor do item = quantidade × preço unitário (sem frete/impostos, igual às RPCs de Compras); tipo/família filtram também os itens. Falha de consulta vira aviso na tela.
- **Componentes do Faturamento generalizados** (sem mudar o Faturamento): `RankingBarras` (`legenda`, `hrefDe` pode devolver `undefined`), `BarrasDiarias` (`nome`), `TabelaDiaria` (`rotulo`).
- **Testes**: `node --test lib/notas-compras.test.ts lib/faturamento-itens.test.ts lib/faturamento-periodo.test.ts`.
- Conferido (loja 5, 01–15/10/2026): 108 notas válidas, R$ 171.957,97, 36 fornecedores, maior VILLA PESCADOS R$ 32.464,40 (= SQL); TODAS 109 / R$ 172.447,97; pendentes de set/2026 13 / R$ 10.377,74 (= SQL).

## Refazer inventário, inventário no fim do dia e obs "Cupom N" (15/10/2026)

Pedidos do Ramon. Passo a passo para quem usa: `docs/refazer-inventario.md`. Migration **172** (`172_refazer_inventario.sql`).

- **Refazer inventário** (Central, `lib/correcoes/refazer-inventario.ts` + regras puras `refazer-inventario-puro.ts`, `node --test lib/correcoes/refazer-inventario-puro.test.ts`): substitui o antigo `corrigirContagemCentral` (que lançava uma saída com data de hoje e, além disso, falhava no Omie com motivo `SAI`). Exclui as correções posteriores e o inventário e lança ENT/SAI motivo INV na data do inventário, `cod_int_ajuste = INVR-<id>`. Saldo antes = saldo logo depois do inventário no kardex do dia (`ListarMovimentoEstoque`) − quantidade dele; recusa se o movimento anterior não fecha com isso. Vendas/produção do dia registradas depois dele (PDV, OPS, OPE, ajuste de venda com motivo PDV no banco) passam para antes; nota/ajuste manual depois continuam por cima. Inventário cuja contagem bateu (sem movimento no kardex): posição pelo id do ajuste e contagem do banco. Tabela `estoque_refazer_inventario` = trava (índice único por inventário em andamento/parado/concluído) + diário (`pendente` gravado antes de cada escrita; "Continuar" retoma e confere `INVR-<id>` no Omie antes de incluir de novo). Ao concluir: apaga de `movimentos` os ajustes excluídos (guardados em `apagados_local`) e grava o ajuste novo. `inventario_items` não muda (a Central ignora inventários refeitos). **Loja 4 liberada só para esta ação** (`contextoEscritaOmieCom({ permitirLoja4: true })`); mês fechado só avisa.
- **Inventário fora do fim do dia** (grupo `inventario`, todas as lojas): RPC `central_inventarios_fora_do_fim(loja, desde)` (35 dias): inventário = `inventario_items` com ajuste, SLD em `movimentos` ou `INVR-`; vale o último do dia por produto/local; "depois" = kardex (`kardex_omie`, loja com espelho) ou `movimentos` motivo PDV com `id_ajuste` maior. Medido em produção: 60 ms (loja 4), 170 ms (loja 5). Correção = refazer no modo `fim_do_dia` (contagem = saldo logo depois do inventário).
- **Obs "Cupom N"** (`obsDaBaixa`, `lib/vendas/local-venda.ts`): venda com nota e número da NFC-e no pedido (`cupom` no item ou no corpo de `/api/integracao/ordem-producao`) grava obs só `Cupom <n>`; a marca `Venda ntb-vendas #<pedido>` vai para `movimentos.obs_item` e o estorno (`lib/vendas-estorno.ts`) procura nas duas. Sem `cupom` no pedido = comportamento de sempre. **O Norte Vendas ainda não manda o número** (a baixa sai junto com a emissão, quase sempre antes da nota existir): ver pendência no relatório de 15/10.

## Motivo do ajuste manual no Omie (15/10/2026)

- **Bug**: o ajuste manual (`criarAjusteManual`: Zerar, saldo contado e diferença da Central e de `/estoque` via `ajusteOmie`, `entradaOmie`, Nova movimentação, fila do desktop) gravava `movimentos.motivo = tipo` e `reenviarMovimentoManual` caía no tipo quando o motivo não estava na lista; a correção de custo (`relancarCorrecaoCusto`) tinha o mesmo fallback. O Omie recusa `motivo` "SAI"/"ENT" ("O preenchimento inválido da tag [motivo]! Valores permitidos: 'INV', 'OPS', 'PER', 'PDV'"). Caso real: `movimentos` 1323129 (loja 5, azeitona 80203).
- **Correção**: `lib/omie/motivo-ajuste.ts` (puro, `node --test lib/omie/motivo-ajuste.test.ts`) com a lista da API por tipo (ENT: INV/OPE/PDV/INI; SAI: INV/PER/OPS/PDV). Ajuste manual grava e manda **INV** (`MOTIVO_AJUSTE_MANUAL`, o mesmo da faxina e do Refazer inventário); `motivoOmieDoAjuste` nunca devolve o tipo (inválido/vazio → INV).
- **Retry** (`retryMovimentosManuaisPendentes`): linha antiga com motivo inválido gravado **não é reenviada** (`decidirReenvioAjusteManual`): sai do retry pelo teto (`tentativas` = 30, status `Erro`, explicação em `descricao_status`). Motivo: nunca entrou no Omie e a diferença era do saldo daquele momento; mandar depois com o motivo trocado lançaria uma diferença velha por cima de correção feita à mão. O cron conta essas linhas em `encerradas` (não viram 502).
- O passo encerrar-ou-enviar de cada linha é `encerrarOuEnviarAjusteManual` (mesmo módulo), com teste de comportamento por fakes: linha SAI/ENT grava o teto e **não chama o envio**; linha INV é enviada. Não mexer nesse passo dentro de `retryMovimentosManuaisPendentes` sem passar pelo helper.
- **Janela do deploy**: até o deploy de 15/10 o código antigo gravava motivo = tipo, e o novo encerra essas linhas sem mandar. Por isso, logo antes e logo depois do deploy, conferir `select id, loja_id, tipo, motivo, status, data from movimentos where transferencia_id is null and motivo in ('SAI','ENT') and status in ('Erro','Sem CMC','Processando')`; qualquer linha além da 1323129 é correção de alguém que precisa ser avisado para relançar pela tela.
- Efeito no relatório de movimentação: `inventario: a.motivo === 'INV'` (lib/movimentacao-operacao-auto.ts) passa a classificar todo ajuste manual como inventário, não como perda.
- SQL para encerrar a 1323129 antes do deploy: `scripts/encerrar-mov-1323129-motivo-invalido.sql` (conferido 15/10: é a única linha com motivo inválido em `movimentos`, em todas as lojas).

## Compras no layout das Notas Fiscais (16/10/2026)

Pedido do dono: o relatório `/relatorio-compras` com o mesmo desenho de `/nota-fiscal` (que segue o Faturamento). Só a apresentação mudou: as RPCs `relatorio_compras_*`, o complemento frio, o drill (`?drill=`), o Excel e o "Baixar tudo" são os mesmos.

- **Tela**: `PeriodoBar` (padrão continua "Ano"; `data_inicio`/`data_final` de links antigos viram `ini`/`fim`; as rotas de export continuam recebendo `data_inicio`/`data_final`), `FiltrosNotas` (Fornecedor com busca, Família, Situação; padrão Concluídas) + gaveta "Filtros" (Produto, Tipo, CFOP, Local), 4 cartões (`CartaoResumo`, compartilhado com Notas: Total comprado, Notas + fornecedores, Ticket médio por nota, Maior fornecedor), visões Famílias / Fornecedores / Produtos / Tipos / CFOP (lista ranqueada `RankingBarras`, busca, mais/menos comprados, até 200 linhas) e Evolução mensal (`MatrizMensalTabela`, "Por" qualquer dimensão). Tocar numa linha desce o drill (dimensão → produto → itens); itens = `ListaItensCompra` (500 mais recentes, linha abre as movimentações do produto).
- **Puro**: `lib/relatorio-compras-visoes.ts` (ranking e matriz a partir das linhas rótulo × mês), `node --test lib/relatorio-compras-visoes.test.ts`.
- Cartões de fornecedor: `relatorio_compras_dim` com `p_dim='fornecedor'` (mesmos filtros + trilha); opções do filtro de fornecedor: mesma RPC só com a situação. Não há "Por dia" (as RPCs são mensais) nem contagem de notas por linha.

## Paridade com o Omie — Fase A (branch `paridade-omie`, 18/10/2026)

Plano-mestre: `docs/superpowers/plans/2026-10-18-plano-mestre-paridade-omie.md`; plano da fase: `docs/superpowers/plans/2026-10-18-fase-a-correcoes-provadas.md`. Regras do Omie provadas com dado real em `~/Projects/omie-rea/regras/` (engenharia reversa só leitura da loja 5).

- **Migrations 173–183** (na época, nenhuma aplicada; **a 173 foi aplicada em produção em 18/10/2026**, versão da cadeia de saldo) (cada uma pede backup + OK do dono; ordem numérica; 178 sem `-1`). 175 = `custo_estoque_item_omie`/`item_movimenta_estoque`; 176/177 dependem dela. 181 parte do corpo de `lancar_compra` da 180. 182 não faz a carga das notas antigas: ela é `scripts/backfill/182_fornecedor_notas_sefaz.sql` (escreve em produção, OK à parte).
- **Valor de estoque do item (N3 corrigida)**: `lib/compras/custo-estoque-item.ts` + SQL 175. O `vTotalItem` do Omie já vem SEM o desconto e já contém IPI, ST e as despesas do item; as 8 marcações tiram o que não é custo. Bate com o kardex em 99,3 % (quantidade × preço: 83,8 %). Compras, Indicadores, Notas Fiscais, relatório mensal e painel gerencial mostram "valor de estoque" (padrão) × "valor da nota" (`?valor=fiscal`). Itens "não movimenta estoque"/"ignorar" saem de Compras e Movimentação.
- **Venda → Omie sem duplicar** (`lib/vendas/venda-idempotente.ts`, 178): código da OP = pedido + produto + ocorrência (não a hora); `venda_op_vinculo` registra cada OP; `movimentos.venda_chave` (único) impede a 2ª saída; o estorno acha as OPs pelo vínculo (o log de integração é podado em 2 dias). Código tolerante à 178 ainda não aplicada (grava sem a chave).
- **Ajuste manual**: entrada no Omie com custo digitado (`custo_informado`, 179) e saída como perda (PER). Sem os campos novos tudo segue igual (a Central não passa nada). Regra de 15/10 (motivo inválido gravado = encerrado sem reenvio) intacta.
- **Estoque próprio**: nota cancelada na SEFAZ estorna a entrada e não entra mais, mesmo se o cancelamento chegar antes do XML (`sefaz_chaves_canceladas`, 180); compra manual com chave de idempotência (181); fornecedor da nota vira cadastro com código da faixa própria ≥ 8000000000001 (182; editar/excluir esses não chama o Omie).
- **Bugs menores (183)**: fim de mês certo no previsto × produzido; Lucro e "produtos a repor" paginados (corte de 1.000); repor sem inativos.
- **Ordem obrigatória no deploy desta fase**: aplicar **175 → 176 → 177 → 178 → 179 ANTES de publicar o código** (o código lê `valor_estoque`, `venda_chave`, `custo_informado`; sem a 175/176 as telas de Compras, Indicadores, painel gerencial e relatório mensal mostram R$ 0, porque o padrão é "valor de estoque"). 180–183 podem ir junto. O contrário (migration antes, código velho) é seguro. 176/180/181/182/183 rodam numa transação só (`begin … commit`); 178 não (índice `concurrently`).
- **Testes SQL** em `scripts/testes-sql/17x/18x_*.sql`: rodar numa cópia local com `pg_dump --schema-only -n public` da produção (sem dados), nunca em produção.

## Fase D — relatórios que faltam (branch `fase-d-relatorios`, 19/10/2026)

Plano: `docs/superpowers/plans/2026-10-19-fase-d-relatorios.md`. Regras puras em `lib/relatorios/*-puro.ts` (`node --test lib/relatorios/*.test.ts`); SQL em `scripts/testes-sql/187_*.sql` e `188_*.sql` (cópia local). **Migrations 187 e 188 não aplicadas em produção.** A 187 usa a `saldo_em_data` pela cadeia de saldo da **173**, que já está em produção desde 18/10 (conferir com `pg_get_functiondef` antes). Ordem: 187 → 188, cada uma numa transação; depois recarregar o cache do PostgREST e rodar `desktop/scripts/gerar-schema.sh`. Sem server action nova (só páginas e GETs de Excel).

- **Curva ABC** `/relatorio-curva-abc` (N10/N11): regra do Omie provada com a captura da loja 5 (385 produtos, `lib/relatorios/curva-abc-omie.fixture.json`): ordena por valor ou quantidade, % acumulado inclui o item, A ≤ 20 %, B ≤ 80 %, C resto. Base vendas = `carregarItens` do Faturamento (os dois modos); compras = itens das notas válidas pelo valor que entra no estoque. Período padrão = mês atual.
- **Posição de estoque** `/relatorio-posicao-estoque` (N6/N7): foto mais recente com local real de `posicao_estoques` (lojas Omie = sync; própria = projeção do ledger). Um total só (negativos entram, CMC fora de (0, 1e7) vale 0 e é marcado); visões por produto, por produto e local, e **Tipo SPED (Bloco H)**: produto ativo com saldo > 0, valor unitário = valor ÷ quantidade, colunas do H010 no Excel. "Zerados" = produtos do cadastro sem saldo (no local padrão). O `/relatorio-estoque-valorizado` não mudou.
- **CMV/CPV** `/relatorio-cmv` (N9): fonte escolhida por `escolherFonteCmv` — própria = `lucro_proprio`; Omie com o kardex cobrindo o período inteiro (`espelho_sync_estado` frente `kardex`: `historicoDesde` … `recente.coberto_ate`) = RPC `relatorio_cmv_kardex` (187: vendas PDV/VEN − DVP/CVP, consumo OPS = CPV, produção OPE, compras, EI/EF pela cadeia, aba "Pelo estoque" com EI + C + P − EF como o Omie; coluna `quebra` = quanto o saldo do kardex "pulou" sem movimento no espelho, por produto×local com saldo inicial; produtos com quebra > 0,01 saem dos totais da fórmula e são listados na tela, ex. azeitona 80203 da loja 5 em 12/10, −R$ 449,5 mil; vendas e consumo vêm do fluxo e não mudam); senão **estimado** = quantidade vendida dos cupons × custo médio de hoje, com custo acima do preço de venda descartado e avisado. O Omie não deixa custo histórico em nenhuma outra tabela: `movimentos.valor` das saídas do PDV é o **preço de venda** e `margem_snapshot_diario` não tem CMC de saldo negativo.
- **Movimentação pelo valor do movimento** (N13): `?modo=operacao&valor=movimento` em `/relatorio-movimentacao` (e no Excel) troca as linhas do modo automático pelas da RPC `relatorio_movimentacao_valor_mov` (188: kardex do Omie ou `estoque_movimentos`). O padrão (NF, preço de venda do cupom no PDV, ajuste) não mudou: trocar o padrão é decisão do dono. Fora da cobertura do kardex: aviso e padrão; período cortado ao coberto. O modo "Em quantidade" não mostra R$ (o `valor` da `relatorio_movimentacao_matriz` não é exibido em lugar nenhum).
- **Limites conhecidos**: kardex só existe na loja 5 (12/09–16/10/2026, espelho desligado depois; 14–16/10 incompletos, achado G2.4a — a cobertura gravada diz 16/10). Nas outras lojas Omie o CMV é estimado até o espelho do kardex ser ligado (Fase D item 5 / L7). Falta: posição em data passada para o Bloco H de 31/12 (depende do mesmo espelho), filtros de tipo/família no CMV da loja própria.

## Paridade com o Omie — Fase C: compras (branch `fase-c-compras`, 19/10/2026)

Plano: `docs/superpowers/plans/2026-10-19-fase-c-compras.md`. **Migrations 200 e 201, nenhuma aplicada em produção** (backup + OK do dono; ordem 200 → 201; cada uma numa transação; depois `NOTIFY pgrst` e `desktop/scripts/gerar-schema.sh` + versão do desktop). Testes SQL: `scripts/testes-sql/200_pedido_compra.sql`, `201_sugestao_compra.sql` (cópia local: banco `fb` do `ntb-teste-sql` + 186; o `fb_base` está sem a 184–186).

- **Sugestão de compra** (`/sugestao-compra`, as duas lojas, permissão `Compras - Sugestao`): fórmula do Omie em `lib/compras/sugestao-puro.ts`, provada contra as 50 linhas do grid capturado em 17/10 (loja 5, `lib/compras/fixtures/omie-sugestao-loja5-2026-10-17.json`; 50/50 batem). Consumo médio = saídas do período ÷ dias; ponto de pedido = mínimo + consumo médio × lead time (vazio = 1 dia); projeção = consumo médio × dias de estimativa; sugestão = máx(0, projeção + ponto − estoque − entradas previstas); duração e dias até o ponto truncados; recomendação imediata/próximos dias/não. Padrão: análise = mês passado inteiro, estimativa = hoje até o fim do mês. Base alternativa (`proj=previsao`): previsão de venda (`previsao_venda`) + consumo nas OPs abertas.
- **Dados por modo** (migration 201, `sugestao_compra_omie` / `sugestao_compra_proprio`, security invoker, devolvem um jsonb): Omie = `movimentos_historico.saidas` (bate exato com o Omie em 25/50 e < 1% em mais 10; o resto é histórico relido depois da captura), foto mais recente de `posicao_estoques` (mínimo = soma dos locais com a sentinela; 50/50 iguais ao Omie), `lead_time` do cadastro do Omie, **entrada prevista = notas do fornecedor em etapa 40 em unidade de estoque (`itensAjustes.nQtdeRecebida`, provado: 90001 = 204, 90831 = 240, 80027 = 80)** + OPs abertas. Próprio = saídas do ledger (SAI/PRD/AJU negativas sem estorno; transferência não conta), `estoque_saldos`, lead time em `produto_compra_param` (editável na tela), compras pendentes + saldo de pedidos ainda não vinculado a nota (não conta duas vezes) + OPs abertas. Valor estimado = sugestão × custo médio (CMC/`estoque_custos`; a unidade da nota do Omie às vezes vem errada).
- **Hipóteses não provadas** (na tela, em "Como a conta é feita"): OPs abertas como entrada prevista do produto acabado; "produzir" = tipo 03/04 ou com ficha; tipos 08/09/99 fora por padrão; regra do consumo no modo próprio.
- **Pedido de compra** (só estoque próprio; migration 200; `/pedido-compra`, `/novo`, `/[id]`, `/[id]/editar`, `/[id]/pdf`; permissões `Compras - Pedidos` e `Compras - Aprovar pedidos`): etapas gravadas rascunho → aguardando aprovação → aprovado → cancelado; recebido parcial/total é calculado pela view `pedidos_compra_itens_situacao` (só nota lançada conta). Escrita só pelas funções `pc_salvar`, `pc_acao`, `pc_vincular_nota`, `pc_desvincular_nota` (security definer, só service role), chamadas por `lib/actions/pedido-compra.ts`. Regras puras em `lib/compras/pedido-puro.ts`. Itens com unidade e fator (quantidade/preço comparados em unidade de estoque). "Criar pedido" na sugestão gera um rascunho por fornecedor (o da última nota), com chave de idempotência.
- **Revisão (19/10)**: item da nota religado a outro produto depois do vínculo (`vincular_item_compra`) deixa de contar no item do pedido (a view exige o mesmo produto); trava antes da chave de idempotência e trava da nota no vincular (`scripts/testes-sql/200_concorrencia.sh <banco local>`); local de outra loja recusado; pedido 100% recebido não cancela; eventos não se apagam.
- **Nota × pedido**: na nota do estoque próprio (`PedidoDaNotaNF`) aparecem os pedidos aprovados do mesmo fornecedor; "Conferir com este pedido" liga cada item da nota ao item do pedido do mesmo produto e mostra pedido × nota × recebido (quantidade e preço, tolerância 0,5%). Lojas Omie não mudam (a seção só existe quando há `compras_proprio`).
- **Pedidos do Omie (só leitura, DESLIGADO)**: `lib/omie/pedidos-compra.ts` (`PesquisarPedCompra`, pendentes e recebidos em parte, até 5 páginas, `semRepetir`, cache 10 min, trava `pedidos-compra`). Liga com `OMIE_LER_PEDIDOS_COMPRA=1`; nunca rodou contra produção. Gravar pedido no Omie fica para depois, com OK do dono.
- **Desktop offline**: as ações de pedido ficam fora de `politica.ts` (as tabelas novas não estão em `offline_tabelas`): só com internet.
- **Testes**: `node --test lib/compras/*.test.ts`; SQL acima; smoke do PDF `npx tsx scripts/smoke-pdf-pedido-compra.tsx saida.pdf`.
## Fase C2 — compras: requisição, lead time por fornecedor, importação, compradores e tarefas (branch `fase-c2-compras`, 19/10/2026)

Plano: `docs/superpowers/plans/2026-10-19-fase-c2-compras.md`. Só loja `modo_estoque='proprio'` (loja Omie: telas 404, nada escreve no Omie). **Migrations 240, 241 e 242, nenhuma aplicada em produção** (dependem da 200/201, que já estão). Ordem: 240 → 241 → 242, cada uma numa transação (`-v ON_ERROR_STOP=1`); depois `NOTIFY pgrst`, `desktop/scripts/gerar-schema.sh` e versão nova do desktop. O código novo tolera a 240 ausente nas telas que já existiam (`/pedido-compra` lê `comprador_id` à parte; formulário sem compradores esconde o campo; `pc_salvar` antiga ignora `comprador_id`), mas as telas novas mostram "ainda não ativadas" até aplicar.

- **240** (`240_requisicao_compra.sql`): `compradores` [I8], `requisicoes_compra(_itens, _eventos)` [I1], `pedidos_compra.comprador_id`, `pedidos_compra.origem` + `requisicao`/`planilha`, `pc_salvar` **recriada** (igual à 200 + comprador; só confere o comprador quando ele muda). Funções `comp_salvar`, `rc_salvar`, `rc_acao` (aprovar/recusar/reabrir), `rc_gerar_pedidos` (requisições aprovadas → um pedido rascunho por fornecedor sugerido: cadastro > CNPJ > nome sem acento; mesmo produto+unidade+fator somado com preço ponderado; previsão = menor sugestão de entrega; tudo ou nada; idempotente pela chave). CNPJ de fornecedor cadastrado vira o cadastro já no `rc_salvar` (agrupa junto). Requisição: aberta → aprovada → pedido | recusada.
- **241** (`241_lead_time_fornecedor.sql`): `fornecedor_compra_param` + `fornecedor_lead_time_salvar`; `sugestao_compra_proprio` recriada (mesma assinatura): lead time = produto > fornecedor da última nota > 1 dia (no TS), devolve `lead_time_origem` e `entrada_requisicoes` (abertas/aprovadas, e as já viradas em pedido enquanto o pedido é rascunho; depois disso contam só como pedido). Omie não muda.
- **242** (`242_importar_pedidos_compra.sql`): `pc_importar` (tudo ou nada, chave `imp:<sha256 do arquivo>`; o mesmo arquivo de novo devolve os pedidos da 1ª vez).
- **Segurança** (padrão da 200): RLS initplan, `anon` nada, `authenticated` só `select`; escrita só pelas funções acima (`security definer`, `search_path = public`, loja própria e posse conferidas dentro), só `service_role` executa; trava (`pg_advisory_xact_lock`) antes de conferir a chave; `requisicoes_compra_eventos` append-only.
- **Permissões**: nova `Compras - Requisicoes` (criar/editar requisição). Aprovar/recusar requisição e cadastrar comprador = `Compras - Aprovar pedidos`; gerar pedido, importar planilha e prazo do fornecedor = `Compras - Pedidos`. O menu usa uma permissão por rota (aprovador sem `Compras - Requisicoes` não vê o item "Requisições", só as tarefas/links).
- **Telas**: `/requisicao-compra` (lista; marca as aprovadas e gera pedido com prévia por fornecedor), `/novo`, `/[id]`, `/[id]/editar`; `/pedido-compra/importar` (+ `/modelo`, .xlsx com aba Instruções; aceita .xlsx e .csv até 600 KB e 2.000 linhas; prévia linha a linha refeita no servidor e de novo na confirmação); `/compras-cadastros` (compradores e prazo dos fornecedores); `/tarefas-compras` (pedidos atrasados, pedidos e requisições para aprovar, notas sem vínculo de fornecedor com pedido aprovado em aberto, requisições aprovadas sem pedido, rascunho parado há mais de 3 dias; "só as minhas" pelo comprador ligado ao usuário). Sugestão: "Criar requisição" com os itens marcados, requisições na entrada prevista e a origem do lead time.
- **Regras puras**: `lib/compras/requisicao-puro.ts`, `importar-pedidos-puro.ts` (números "1.234,5"/"1.500", datas dd/mm/aaaa, ISO, Date e série do Excel, código "00123" que o Excel virou 123, cabeçalho por apelido, linhas do mesmo "Pedido" com fornecedor/previsão/frete diferentes = erro), `tarefas-puro.ts`. Leitura do arquivo em `lib/compras/ler-planilha.ts` (exceljs; CSV `;`/`,`, UTF-8 ou Windows-1252).
- **Desktop offline**: as ações novas ficam fora de `politica.ts` (só com internet).
- **Testes**: `node --test lib/compras/*.test.ts`; SQL no banco local `c2` (`create database c2 template fb` + 187, 188, 190–195, 200, 201, 240, 241, 242; a 190 falha localmente por falta do esquema `extensions`, não afeta): `scripts/testes-sql/240_requisicao_compra.sql`, `240_concorrencia.sh c2`, `241_lead_time_fornecedor.sql`, `242_importar_pedidos_compra.sql`, e de novo `200_*`/`201_*` (passam com a `pc_salvar` e a `sugestao_compra_proprio` recriadas).
- **Fora (depois)**: I9 formas de pagamento de compras (o pedido já tem parcelas em dias); relatórios de requisição (N14); cotação com vários fornecedores; tarefas digitadas à mão como o painel genérico do Omie; requisição/pedido gravados no Omie.

## Fase I — velocidade (branch `fase-i-velocidade`, 19/10/2026)

Resultados e números: `docs/superpowers/specs/2026-10-18-fase-i-velocidade-achados.md` ("Resultados 19/10"); plano: `docs/superpowers/plans/2026-10-19-fase-i-velocidade.md`. **Migrations 190–194, nenhuma aplicada em produção** (187–189 ficaram reservadas para outra frente).

- **190** `pgrst_ddl_watch`/`pgrst_drop_watch` só avisam o PostgREST para DDL em `public`/`graphql_public` (e CREATE/DROP SCHEMA). A regra fica escrita dentro das duas funções do gatilho: elas rodam com o papel de quem faz o DDL, e `supabase_auth_admin`/`supabase_storage_admin` não têm USAGE em `extensions` (**nunca chamar outra função de `extensions` dentro desses gatilhos**). Se `PGRST_DB_SCHEMAS` mudar no docker-compose, atualizar a lista nas duas funções. O gasto grande atribuído à "recarga do esquema" em 18/10 era o ping OpenAPI do Vendas (`HEAD /rest/v1/`), que o `gateway-vendas` já responde sozinho desde 04/10. **Nunca apontar ping de conectividade para a raiz do PostgREST**: ele monta a especificação OpenAPI inteira a cada chamada (2 s no Vendas).
- **191** (sem `-1`): `webhooks.n_id_receb` (gatilho + índice; o ALTER usa `lock_timeout` de 3 s com nova tentativa, para não segurar os inserts dos webhooks; teste de bloqueio em `scripts/testes-sql/191_bloqueio_webhooks.sh`) para o histórico da nota; versiona `idx_webhooks_loja_message`; autovacuum a 2 % em `ordens_producao`/`movimentos`/`notas_fiscais`. **Índice de expressão em jsonb não serve com RLS** (`->>` não é leakproof, então não vira condição de índice antes da política). Para filtrar dentro de jsonb como usuário logado, use uma coluna comum preenchida por gatilho.
- **192**: `custo_estoque_item_omie` virou uma expressão só, que o planner embute (a versão com CTEs custava 85 µs por item). **Função SQL escalar chamada por linha deve ser `select <expressão>`, sem FROM/CTE**, senão não é embutida. As RPCs de Compras somam numa subconsulta com `OFFSET 0` (não ordenam mais o `full_object`). Mesma saída: 0 diferenças nos 69.232 itens de produção.
- **193**: `offline_compactar()` relê o que foi gravado a partir de 10 minutos antes da execução ANTERIOR (horário em `offline_meta('ultima_compactacao')`), em vez de 5.000 ids a cada minuto. Assim o cron pode parar sem perder transação atrasada. Sem registro, usa a folga antiga.
- **194** (sem `-1`): índice `(loja_id, status, ultima_tentativa_em)` em `movimentos` para os crons de reenvio.
- **Código**: `syncFaturamento` grava `faturamento_importado` por diferença (`lib/omie/faturamento-diff.ts`, puro; `node --test lib/omie/faturamento-diff.test.ts`). **Filtro `in` com texto livre (rótulo, descrição) usa `filtroInPostgrest`**: o `.in()` do postgrest-js não escapa `"` nem `\` e apaga ou filtra menos do que devia, sem erro. Antes ele apagava e reinseria o mês todo a cada hora, o que era 86 % da outbox e mandava versão nova de cada linha para os desktops. `HistoricoStatusNF` filtra por `n_id_receb` e volta ao caminho antigo se a 191 não estiver aplicada (erro 42703).
- **Servidor (proposta, não aplicada)**: poda da outbox em lotes com `scripts/outbox-podar-lotes.sh` (a linha de crontab está no cabeçalho do script; copiar o script para `/opt/ntb-estoque/scripts/`).
- **Testes SQL** (só no banco local `fi`, criado de `fb_base`): primeiro rode `scripts/testes-sql/fi_setup_usuario_loja5.sql` (usuário comum da loja 5, `auth.uid()` real e GRANTs de leitura). Depois `190_*`, `191_*`, `192_*`, `193_*`, `194_*` e `outbox_poda_lotes.sql`. O 192 usa dados reais da loja 5 copiados com `copy (select * from <tabela> where loja_id = 5) to stdout` (notas_fiscais, nota_fiscal_items, produtos).
- **Deploy (com OK)**: 190 → 191 (sem `-1`) → 192 → 193 → 194 (sem `-1`), depois o código. Pode ser também código antes: o código novo funciona sem a 191. Depois rodar `desktop/scripts/gerar-schema.sh` e lançar versão nova do desktop (a 191 cria coluna).

## Fase F sem emissão fiscal — fechamento de mês, pacote do contador e devolução ao fornecedor (branch `fase-f-contador`, 19/10/2026)

Plano: `docs/superpowers/plans/2026-10-19-fase-f-contador.md` (R1–R10). **Migrations 230, 231 e 232, nenhuma aplicada em produção** (backup + OK do dono; ordem 230 → 231 → 232, cada uma numa transação; depois `NOTIFY pgrst`, `desktop/scripts/gerar-schema.sh` + versão do desktop). Testes SQL: `bash scripts/testes-sql/230_preparar_banco.sh f1` (cópia do `fb` + 187, 188, 190–195, 200, 201, 230+; a 190 falha no local por falta do schema `extensions`, esperado) e depois `scripts/testes-sql/23{0,1,2}_*.sql`.

- **Fechamento de mês (230, as duas lojas)**: `estoque_periodo_fechado` (estado, uma linha por loja × mês) + `estoque_periodo_eventos` (append-only, quem fechou/reabriu e motivo). Só fecha mês que já terminou; reabrir exige motivo (≥ 10 letras). Permissões novas `Fechamento - Fechar mes` e `Fechamento - Reabrir mes`. Trava no banco por `_exigir_periodo_aberto` (SQLSTATE **PF001**, mensagem "Período fechado: …") nos gatilhos: `estoque_movimentos` (data_ref), item de nota lançado (`compras_proprio_itens`: não estorna/muda/apaga), OP de loja própria (`ordens_producao`, só modo `proprio`), `inventarios`/`inventario_items` (criar, mudar data, apagar, contar; status do reenvio passa), pedido de compra (conteúdo de pedido criado no mês; previsão no mês) e `estoque_correcao_custo` (data do ajuste). Estorno com data de hoje de documento não listado (venda cancelada depois) passa. Nada do que o sync do Omie grava ganhou gatilho. `sefaz_marcar_cancelada` captura PF001 (mês fechado) e 22023 (ex.: devolução ao fornecedor ativa): a chave fica em `sefaz_chaves_canceladas`, a compra ganha evento `cancelada` com `estorno_pendente` e a função devolve `estorno_pendente: true` (estornar à mão depois de reabrir o mês / cancelar a devolução). No TS, `marcarCanceladaNaSefaz` (`lib/estoque/sefaz-cancelamento.ts`) lança em erro do banco: o documento não vira processado e `reprocessarComErro` (sefaz-sync, só banco) tenta de novo até 20 por ciclo.
- **Pendências** (`periodo_pendencias`): reenvios ao Omie com data no mês (ajuste manual/transferência, item de inventário, conclusão de OP), inventário não finalizado, correção de custo em andamento. Com pendência, fecha só com confirmação (`p_aceitar_pendencias`); enquanto o mês estiver fechado esses reenvios **ficam parados**: os crons de reenvio (`retryMovimentosManuaisPendentes`, `retryMovimentosTransferenciaPendentes`, `retryAjustesInventarioPendentes`, `retryOPsPendentes`) tiram o mês fechado DENTRO da consulta (`filtrosForaDosFechados`/`filtrosConclusaoOPForaDosFechados` + `semMesFechado`; inventário pela data do cabeçalho com `inventarios!inner`) — filtrar depois do `limit` deixava as pendências do mês fechado ocupando as vagas para sempre (revisão I1; cenário pelo PostgREST local em `scripts/testes-sql/230_reenvio_postgrest.sh`) — e `executarConclusaoOP` recusa data em mês fechado. Medido em produção 19/10 (só leitura): ago–set/2026 têm dezenas de ajustes e centenas de itens de inventário "Sem CMC"/"Iniciado"/"Erro" nas lojas 2, 3, 4, 6 — o primeiro fechamento dessas lojas vai mostrar essas pendências.
- **Servidor** (`lib/estoque/periodo-fechado.ts` + puro `periodo-fechado-puro.ts`): `exigirPeriodoAberto` antes de correção de custo/relançamento, `criarAjusteManual` com data, inventário (criar, duplicar, enviar, editar, remover, finalizar, excluir — sempre ANTES de estornar ajuste próprio), OP (criar, mudar data, concluir, reverter, excluir, lote), desfazer entrada/excluir nota própria (`travaDaCompraLancada`) e pedido de compra. Unificação do aviso: `situacaoDaData` = `fechado` (trava) › `antigo` (o aviso de sempre, antes do mês passado ou até `ESTOQUE_MES_FECHADO_ATE`, pede 2ª confirmação) › `aberto`; a tela de correção de custo usa essa função. **A Central de correções não foi mexida**: `lancarOPCorrecao`/Refazer inventário (`lib/correcoes/**`) continuam só com o aviso de mês antigo (follow-up: ligar a trava formal lá).
- **Devolução ao fornecedor [H1] (231, só estoque próprio, SEM NF-e)**: `devolucoes_fornecedor` (+ itens, + eventos append-only), número por loja, nota de origem lançada, motivo, situação `a_emitir` ("Devolução a emitir") → `cancelada` (`emitida` reservada para a emissão futura). Saída no ledger `SAI`/`DEVOLUCAO_FORNECEDOR` ao **custo da entrada original** com custo médio refeito sem as unidades: C₁ = (S₀·C₀ − q·c)/(S₀ − q) (HIPÓTESE, sem kardex de devolução do Omie capturado; saldo ≤ 0 ou resultado ≤ 0 mantém C₀). Quantidade ≤ entrada − devoluções não canceladas; idempotente por chave; cancelar = `estornar_movimento` de cada saída. Desfazer a entrada com devolução ativa é recusado. CFOP sugerido 1102→5.202, 1403→5.411, 1407→5.413 etc. (`lib/compras/devolucao-puro.ts`). Tela: seção "Devolução ao fornecedor" na nota + `/devolucao-fornecedor`. Permissão `Compras - Devolucao ao fornecedor`.
- **Pacote do contador (232 + `/contador`)**: permissão `Contador - Pacote`. ZIP (`lib/contador/zip.ts`, sem dependência nova, CRC próprio) com `LEIA-ME.txt`, `livro-de-entradas.xlsx`/`.pdf` (uma linha por nota × CFOP de entrada; nota com etapa 60, não cancelada, data de entrada = `infoCadastro.dRec` ou emissão no mês; valor contábil = Σ `vTotalItem`; busca emissões desde 120 dias antes — maior folga medida 50 dias, loja 5), `inventario-bloco-h-<data>.xlsx` (montagem da Fase D, visão SPED) e `xml-nfe-entrada/` (`sefaz_documentos` procNFe). Loja Omie: sem XML guardado (o LEIA-ME lista as chaves) e Bloco H pela foto de `posicao_estoques` mais recente até a data; estoque próprio: `posicao_proprio_em_data` (Σ ledger até a data; custo médio refeito na ordem da data `data_ref, id` com as regras do `registrar_movimento` e da devolução — o `cmc_apos` gravado não serve porque movimento retroativo carrega o custo do momento da gravação, revisão I3). Referência medida (só leitura, 19/10): loja 5, set/2026 = 263 notas, valor contábil R$ 338.745,16. Loja 15 ainda sem nota lançada: caminho próprio sem validação com dado real.
- **Testes**: `node --test lib/estoque/periodo-fechado-puro.test.ts lib/estoque/sefaz-cancelamento.test.ts lib/compras/devolucao-puro.test.ts lib/contador/*.test.ts`; `bash scripts/testes-sql/230_reenvio_postgrest.sh f1` (PostgREST local); smoke `npx tsx scripts/smoke-pacote-contador.tsx saida.zip` (+ `unzip -t`).
- **Ordem de deploy (com OK)**: 230 → 231 → 232 antes do código (o código funciona sem elas: sem a 230 nada está fechado e a tela avisa "não ativado"; sem a 231 a seção de devolução some).

## Fase D item 6 — os demais relatórios do Omie (branch `fase-d6-relatorios`, 19/10/2026)

Plano (com o levantamento relatório × situação): `docs/superpowers/plans/2026-10-19-fase-d6-relatorios.md`. **Migrations 210 e 211, nenhuma aplicada em produção** (backup + OK do dono; 210 depende da 175; cada uma numa transação; depois `NOTIFY pgrst` e `desktop/scripts/gerar-schema.sh` + versão do desktop). Sem server action nova. Testes: `node --test lib/relatorios/{produtos-fornecedor,estrutura,ops-periodo}-puro.test.ts lib/compras/sugestao-despacho.test.ts lib/notas-compras.test.ts`; SQL `scripts/testes-sql/210_*.sql`, `211_*.sql` e `210_211_rls.sql` (banco local `d6` = `fb` + 187, 188, 192, 195, 200, 201, com dados reais das lojas 5 e 15 copiados por `copy … to stdout` em `begin read only`).

- **Produtos por fornecedor** `/relatorio-produtos-fornecedor` (+ Excel; N3): RPC `relatorio_produtos_fornecedor` (210), devolve um jsonb (uma chamada; medido em produção como usuário comum da loja 5: 3,8–4,3 s por página × 2 → 0,65–0,84 s, resultado linha a linha igual; o JSON da nota é lido uma vez por nota e o do item só na última compra de cada par). Omie: só nota concluída (etapa 60) e não cancelada, a última pela data do recebimento (`infoCadastro.dRec`), quantidade e preço na unidade de estoque (`nQtdeRecebida`), custo = valor de estoque ÷ quantidade recebida. Contra a captura do Omie de 17/10 (loja 5, 1.415 pares): nota 98,0 %, quantidade 97,7 %, preço 97,5 %, custo 95,1 %, data 93,4 %; pares e total iguais ao SQL direto em produção (1.483 / R$ 5.102.095,42). Próprio: compras lançadas (`compras_proprio`), chave do fornecedor = md5 do CNPJ. Tela mostra custo médio de hoje e a variação, "mais barato" quando há 2+ fornecedores. `FiltrosFaturamento` ganhou `fornecedores` e `semSituacao` (padrão igual).
- **Estoque mínimo** (N5): `/sugestao-compra?ver=abaixo` e `?ver=minimo` (card no hub). Os cartões contam sempre todos os que têm mínimo (`resumoMinimoDaTela`), também na visão "abaixo". Mesma RPC da sugestão (201); nas duas visões não vale o filtro padrão de tipo e a ordem é atual − mínimo; cartões com quem tem mínimo, quem está abaixo e o custo de voltar ao mínimo; coluna Diferença no Excel. Loja 5 × captura: 267 de 268 produtos ativos com mínimo, mínimo igual em 267/267 (o que falta tem o mínimo num local que não é o padrão: o sync grava o mínimo só da sentinela).
- **Recebimentos por transportadora** (N28): visão "Transportadoras" em `/nota-fiscal` (`transporte.cNomeTransp`, senão `cRazaoTransp`); clicar filtra as notas (`?transportadora=`, exato), Excel e PDF respeitam o filtro e o Excel ganhou a coluna. 12/12 notas da captura iguais.
- **Estrutura dos produtos** (N2): `/estoque/fichas/excel` (botão na tela, os dois modos): cada produto com os itens e, logo abaixo de cada intermediário, os itens da ficha dele com a quantidade no produto (`lib/relatorios/estrutura-puro.ts`, ciclo marcado, até 10 níveis); custo = custo médio de hoje (`lib/relatorios/custo-medio-loader.ts`). Loja 5 × captura: nível 1 igual em 5.077/5.077; níveis 2+ em 3.925 de 4.355 linhas do Omie — o Omie não abre algumas PIs que têm ficha (ex.: farofa 70033 dentro do 90133), aqui todas abrem (regra de quais o Omie abre não provada).
- **Produção por produto** `/relatorio-ops` (+ Excel em 3 abas; N17/N18/N20): RPC `relatorio_ops_periodo(loja, ini, fim, fonte, produtos)` (211), devolve um jsonb `{produtos, dias}` já agregado por papel × produto e a série por dia (1 ano da loja 5 em produção, como usuário comum: antes 56 mil linhas em 57 chamadas de ~1,6 s; depois 1 chamada de 1,3 s, mesmos totais 197.914,15 produzido / 3.667.978,89 consumido / 99.376 OPs). O filtro de tipo/família/busca vai como lista de produtos (`p_produtos`). Fonte: própria = OPs do app com o consumo real e custo; Omie com o kardex cobrindo o período inteiro (mesma regra do CMV, `escolherFonteCmv`) = OPE/OPS do kardex com valor; senão OPs concluídas sincronizadas com a ficha gravada (sem custo). Achado: na loja 5 (12/09–13/10) o espelho de OPs tem 7.044 OPs concluídas e o kardex 15.449 entradas de produção (6.855 das OPs casam por produto e quantidade): as OPs que faltam no espelho estão no kardex, por isso ele é a fonte quando cobre o período. RPC = SQL direto nas duas fontes.
- **Fora (ver tabela do plano)**: Recebimentos por categoria (nome da categoria do Omie exige ler `ListarCategorias`; a categoria contábil do app tem 2 itens), departamento/projeto, requisições, pedidos de compra do Omie (leitura desligada), outras notas de entrada, lotes nas lojas Omie.

## Fase G — recursos transversais (branch `fase-g-transversais`, 19/10/2026)

Plano: `docs/superpowers/plans/2026-10-19-fase-g-transversais.md`. **Migrations 220–223, nenhuma aplicada em produção** (backup + OK do dono; ordem 220 → 221 → 222 → 223, cada uma numa transação; a 220 depois da 200 para pegar os gatilhos de pedido — sem a 200 ela pula esses gatilhos com NOTICE e pode ser reaplicada depois). Depois: `NOTIFY pgrst` (já no fim de cada arquivo) e `desktop/scripts/gerar-schema.sh` + versão do desktop. Testes SQL: banco local `g1` (`create database g1 template fb` + 187, 188, 191–195, 200, 201), depois `scripts/testes-sql/fase_g_setup.sql` (auth.uid, GRANTs e um stub do schema `storage`), as migrations e `scripts/testes-sql/22{0,1,2,3}_*.sql`. Modo Omie: nada muda além de leitura (histórico e notificações); anexos, importação, duplicar e EAN/CEST/origem são só estoque próprio.

- **Histórico campo a campo [O3]** (220): `historico_alteracoes` + gatilho genérico `historico_registrar(entidade, coluna do id, coluna da linha, gravar|ignorar, campos...)` em `produtos`, `fornecedores`, `compras_proprio(+_itens)`, `pedidos_compra(+_itens)` e `ordens_producao` (esta só com autor: o sync regrava OP o tempo todo). Update sem mudança em campo rastreado não grava; insert/delete sem autor = 1 linha. Autor = `auth.uid()` ou o cabeçalho `x-ntb-autor`, que `createServiceClient()` passa a mandar em toda ESCRITA feita numa requisição com usuário logado (`lib/supabase/server.ts`, `fetchComAutor`; 1 `getUser` por requisição); o banco só aceita o cabeçalho com JWT `service_role`. **Sincronização nunca leva autor** (revisão I1): `lib/omie/*` usa `createServiceClient({ semAutor: true })`, as rotas `/api/sync/*` exportam o handler dentro de `rotaSemAutor(...)` e `reprocessarSync`, "Sincronizar agora" do catálogo do Vendas e "Buscar na SEFAZ" rodam dentro de `semAutor(() => ...)` (`lib/supabase/sem-autor.ts`, AsyncLocalStorage): o que vem do Omie/Vendas/SEFAZ grava como "Sistema" mesmo quando alguém clicou, e OP do sync não grava. **Código novo que grava dado vindo de fora numa requisição com usuário logado precisa do mesmo** (teste estático em `lib/supabase/autor-puro.test.ts`). **Retenção (I2): 400 dias**, `historico_podar(dias, lote)` (mínimo 90) chamada pelo cron **`/api/cron/podar-historico`** 1×/dia (`sync-cron.sh`, bloco 2 às 06 UTC), até 20 lotes de 5.000. A 220 começa com `set lock_timeout = '5s'` (se um sync segurar a tabela, desiste; é só rodar de novo). O cálculo roda num bloco de exceção sem escrita (erro vira WARNING, a escrita principal nunca cai) e o insert é um comando só. Custo medido: ~50 µs por linha num update em massa (20 mil produtos: 1,3 s × 0,27 s). Tela: `components/historico/HistoricoAlteracoes.tsx` (consolidação em `lib/historico/historico-puro.ts`: momentos por transação; apagar-e-recriar igual do `pc_salvar` some) nas páginas de produto (`/produto/[codigo]` e `/estoque/produto/[codigo]`), fornecedor (página nova `/fornecedor/[id]`, link "Histórico" na lista), nota de entrada própria, pedido de compra e OP. Ficha técnica: sem gatilho, `HistoricoFicha` mostra a diferença entre as versões já gravadas (`diffVersoesFicha`).
- **Anexos [O2]** (221): bucket privado `anexos` (8 MB, lista de tipos), tabela `anexos` (excluir = apaga o arquivo e marca `excluido_em`/quem), políticas em `storage.objects` pela pasta `loja-<id>` (segunda trava; o app usa a service role). Envio `POST /api/anexos` (multipart; origem conferida; tipo decidido pelo CONTEÚDO, `lib/anexos/anexos-puro.ts`; até 20 por registro), baixa/abre `GET /api/anexos/[id]` (o arquivo passa pelo servidor: o Supabase só escuta em 127.0.0.1), excluir = action `excluirAnexo`. Seção `AnexosRegistro` em produto, nota, pedido e OP, só loja própria (`anexosPermitidos`; liberar para o Omie é uma linha, decisão do dono). Permissões **`Anexos - Enviar`**, **`Anexos - Excluir`** (ver acompanha a permissão do registro). Conferir no nginx do servidor se `client_max_body_size` ≥ 9 MB.
- **Notificações** (222): `notificacoes` (uma por loja+tipo, `nivel` = contagem; só volta a "não lida" quando o nível sobe) + `notificacoes_leituras` (por usuário). Cron **`/api/cron/gerar-notificacoes`** (auth `assertCronAuth`, 502 só se todas as lojas falharem; já agendado no `scripts/sync-cron.sh` nos blocos 1 e 4 = 2×/hora; não precisa mexer no crontab): só lê o banco (`lib/notificacoes/coletar.ts`) e chama `notificacoes_sincronizar`. Tipos (`lib/notificacoes/regras-puro.ts`): validade vencida/próxima (lote no próprio, OP com validade no Omie, vencidas de até 30 dias), abaixo do mínimo (`sugestao_compra` / `produtos_repor`), nota de entrada parada ≥ 3 dias (até 45), OP "Precisa corrigir no Omie", ajuste no teto de 30 tentativas (14 dias), `[BLOQUEIO OMIE]` nas últimas 6 h, fila do Norte Vendas em erro (7 dias), pedido aguardando aprovação (próprio). Consulta que falha deixa o tipo fora de "avaliados" (a notificação antiga não some por engano). Sininho `components/shell/Sininho.tsx` (desktop ao lado de Buscar, celular no topo; consulta a cada 5 min e ao voltar à aba; cada tipo exige a permissão de `PERMISSAO_DO_TIPO`). Nada é enviado para fora.
- **Importação por planilha [K10/O6]** (223, só estoque próprio): `/produto/importar` e `/fornecedor/importar` (botão "Importar planilha" nas listas; modelo `.xlsx` em `/<produto|fornecedor>/importar/modelo`; aceita .csv). `previaImportacao` lê (`lib/importacao/ler-arquivo.ts`, até 900 KB/2.000 linhas), valida linha a linha (`lib/importacao/planilha-puro.ts`: EAN/CNPJ/CPF com dígito, NCM, CEST, origem, tipo SPED, família existente, repetidos na planilha, EAN de outro produto) e grava a prévia em `importacoes_planilha`; `confirmarImportacao` → RPC `importacao_aplicar` (uma transação, só novo/atualizar, 2ª chamada devolve o mesmo resultado, chave reconferida na hora: produto por código → EAN, fornecedor por CNPJ/CPF; célula vazia não apaga; prévia com mais de 1 dia não aplica). Fornecedor importado tem `origem='planilha'` e nunca vai ao Omie ao editar/excluir. Permissões **`Produtos - Importar planilha`**, **`Fornecedores - Importar planilha`**.
- **EAN/CEST/origem depois de criado [K1]**: no próprio já eram editáveis; agora `criarProdutoCatalogo`/`salvarProdutoCatalogo` validam (dígito do EAN, CEST 7 dígitos, origem 0–8, EAN único na loja). No Omie não: o caminho de escrita aprovado (`AlterarProduto`) não manda esses campos. **Duplicar [K9/M6]** (próprio): produto → `/produto/novo?duplicar=<código>` (formulário preenchido, "(cópia)", sem EAN, código novo); OP → `/ordem-producao/nova?duplicar=<id>` (produto e quantidade da OP de origem). Nada é gravado até a pessoa salvar; no Omie não há Duplicar OP (escrita no Omie pede OK do dono).
- "Tabela ainda não existe" = `tabelaAusente` (`lib/supabase/tabela-ausente.ts`: 42P01 do Postgres ou PGRST205 do PostgREST com cache velho): telas novas mostram "ainda não ativado" em vez de erro.
- **Desktop offline**: `anexos#excluirAnexo`, `notificacoes#*` e `importacao#*` fora de `politica.ts` (só com internet; tabelas novas fora de `offline_tabelas`).
- **Testes**: `node --test lib/supabase/autor-puro.test.ts lib/supabase/tabela-ausente.test.ts lib/historico/historico-puro.test.ts lib/historico/ficha-versoes-puro.test.ts lib/anexos/anexos-puro.test.ts lib/notificacoes/regras-puro.test.ts lib/importacao/planilha-puro.test.ts lib/produto/duplicar-puro.test.ts`.
- **Fora desta fase**: resumo diário por WhatsApp, departamentos/centros de custo, webhooks do Omie ignorados, anexos/importação no modo Omie, histórico de `notas_fiscais` do Omie e de `estrutura_produto_cache`.
