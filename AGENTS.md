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
