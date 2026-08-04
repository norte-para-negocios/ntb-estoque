# Auditoria de Filtros e Completude de Dados nos Relatórios — Plano de Implementação

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task (ou superpowers:subagent-driven-development se executado nesta mesma sessão).

**Goal:** Investigar com dado real de produção cada um dos 9 relatórios do
NTB Estoque, confirmar ou descartar os bugs suspeitos, implementar as
features de filtro genuinamente pedidas, e documentar o que depende de
esclarecimento do cliente (Ramon) sem implementar por suposição.

**Architecture:** Bloco 0 investiga a causa raiz compartilhada (corte de 90
dias entre Supabase self-hosted e Contabo-frio, possivelmente obsoleto após a
migração desta sessão). Bloco 1 tem uma task por relatório (9 tasks), cada
uma seguindo o mesmo formato: investigar com SQL real → classificar (bug /
feature / pendente-Ramon) → corrigir se aplicável → revalidar com a mesma
query.

**Tech Stack:** Next.js 16 (App Router) + TypeScript + Supabase self-hosted
(Postgres, PostgREST) no Contabo + Postgres "frio" separado (histórico) +
Omie ERP.

**Spec:** `docs/superpowers/specs/2026-08-04-auditoria-filtros-relatorios-design.md`

---

## Global Constraints (aplicam-se a TODAS as tasks)

1. **Nunca simular/mockar dado.** Este projeto não tem staging. Toda
   investigação usa SQL direto contra o Postgres de produção no Contabo
   (self-hosted) e/ou a API `ntb-frio-api` (histórico), e todo teste de
   correção usa a conta QA real da aplicação.
2. **Nenhum valor citado num achado pode ser chutado.** Toda alegação
   numérica no relatório da task vem acompanhada da query exata usada e do
   resultado obtido.
3. **Bug vs. feature vs. pendente-Ramon nunca se misturam sem rótulo claro**
   dentro da mesma task — se uma task achar mais de um tipo de coisa, separe
   em sub-seções rotuladas no relatório da task.
4. **Itens "pendente de esclarecer com Ramon" NÃO são implementados por
   suposição.** Documentar no relatório da task e parar — mesmo que o resto
   do relatório seja corrigido.
5. **Qualquer mudança em RPC de relatório híbrido precisa ser replicada no
   espelho frio equivalente** (`lib/relatorio-frio-nf.ts`,
   `lib/faturamento-frio.ts`) — esses módulos espelham manualmente o
   WHERE/GROUP BY das RPCs e não se atualizam sozinhos.
6. **Qualquer query nova contra uma tabela que pode passar de 1000 linhas
   precisa paginar com `.range()`.** Este bug (truncamento silencioso do
   PostgREST) já aconteceu 2x neste projeto — não reintroduzir.
7. **Deploy no Contabo é sempre via**
   `nohup bash deploy.sh > /tmp/log 2>&1 < /dev/null &` (detached) — nunca em
   foreground (já corrompeu build 2x por queda de SSH neste projeto).
8. **Critério de conclusão por task:** achado confirmado com query real →
   corrigido → revalidado com a mesma query/conta QA mostrando o resultado
   esperado → marcado concluído. Sem achado real confirmado: marcar
   "auditado, sem correção necessária" com a evidência anexada — nunca fechar
   sem evidência.

## Acesso a produção (usar em todas as tasks que precisam de SQL real)

**Postgres self-hosted (Supabase no Contabo, dado "quente"):**
```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 \
  "docker exec supabase-db psql -U supabase_admin -d postgres -c \"<SQL AQUI>\""
```

**API do histórico "frio" (`ntb-frio-api`, dado fora da janela quente):**
```bash
curl -s -H "X-Api-Key: $NTB_FRIO_API_KEY" \
  "https://frio-api.norteparanegocios.com.br/<endpoint>?count=true&loja_id=<id>&..."
```
(`NTB_FRIO_API_KEY` e `NTB_FRIO_API_URL` estão em `.env.local`; endpoints
disponíveis: `movimentos`, `movimentos_historico`, `notas_fiscais`,
`nota_fiscal_items`, `ordens_producao`, `fat_cupons`, `fat_cupom_itens`,
`fat_cupom_pagamentos`, `fat_agregado`.)

Se precisar de acesso SQL direto ao Postgres frio (não só via API), ele roda
num serviço separado dos containers do Supabase self-hosted — confirme com
`ssh ... "docker ps"` e/ou leia a config de conexão em
`/opt/ntb-frio-api/server.js` no servidor antes de assumir host/porta/usuário
— não estão documentados neste plano porque não foram confirmados nesta
sessão.

---

## Task 1 (Bloco 0): Investigar se o corte de 90 dias ainda faz sentido

**Contexto:** `lib/historico-contabo.ts:1` define
`const JANELA_QUENTE_DIAS = 90`. Essa constante decide, em 6 dos 9
relatórios (Compras, Movimentação, Auditoria Fiscal, Indicadores, Nota
Fiscal, e indiretamente Faturamento), quando ir buscar dado no Contabo-frio
em vez de só no Supabase. Foi escrita quando o Supabase cloud (free tier,
500MB) só guardava os últimos 90 dias. Nesta mesma sessão de trabalho o
Supabase cloud foi descontinuado — o projeto roda 100% self-hosted no
próprio Contabo agora. A premissa pode estar obsoleta.

**Arquivo:** `lib/historico-contabo.ts` (não modificar ainda — primeiro
investigar).

**Passo 1 — Escolher uma tabela e período de teste**

Use `notas_fiscais` (menor volume que `movimentos_historico`, mais fácil de
auditar manualmente) para uma loja de volume conhecido (loja 3, já usada como
referência em investigações anteriores desta sessão — ver
`docs/validacao-dados-2026-08-01.md`) e um período que cruza os 90 dias atrás
de hoje (2026-08-04 − 90 dias ≈ 2026-05-06). Use um período de **6 meses**
(ex.: 2026-02-01 a 2026-08-04) que cruza claramente esse corte.

**Passo 2 — Contar no Supabase self-hosted**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 \
  "docker exec supabase-db psql -U supabase_admin -d postgres -c \
   \"select count(*), min(d_emissao_nfe), max(d_emissao_nfe) from notas_fiscais where loja_id = 3 and d_emissao_nfe >= '2026-02-01' and d_emissao_nfe <= '2026-08-04';\""
```

**Passo 3 — Contar no Contabo-frio (via `ntb-frio-api`)**

```bash
curl -s -H "X-Api-Key: $NTB_FRIO_API_KEY" \
  "https://frio-api.norteparanegocios.com.br/notas_fiscais?count=true&loja_id=3&data_inicio=2026-02-01&data_final=2026-08-04"
```

**Passo 4 — Interpretar e decidir**

Compare os dois números com o que a tela de Nota Fiscal mostra pro mesmo
filtro (loja 3, mesmo período), testado com a conta QA.

- **Se o Supabase self-hosted já retorna a contagem do período inteiro** (ou
  muito próxima — permitindo diferença só pelas notas ainda não sincronizadas
  hoje) **e o Contabo-frio tem uma contagem igual ou sobreposta**: a
  distinção quente/frio virou redundante. Ação: simplificar
  `lib/historico-contabo.ts` para que as funções `complementarX` retornem
  **só** o resultado do Supabase quando `JANELA_QUENTE_DIAS` não fizer mais
  diferença real — documentar a decisão num comentário no topo do arquivo
  citando este achado, mas **não apagar** o código de leitura do Contabo-frio
  nesta task (ele ainda é a fonte de verdade pra dados anteriores ao
  backfill de 07/2025 — só ajustar quando ele é *consultado*).
- **Se o Supabase self-hosted só tem ~90 dias e o Contabo-frio cobre o
  resto, sem sobreposição nem buraco**: a arquitetura está correta, o corte
  não é a causa da queixa de Compras. Documentar isso explicitamente com a
  evidência e não mexer em `historico-contabo.ts`.
- **Se houver um buraco** (nem o quente nem o frio têm um trecho do
  período): esse é o achado mais provável de explicar "faltando os meses
  atuais" — documentar exatamente qual janela de datas está faltando em
  qual das duas fontes, isso vira insumo direto pra Task 2 (Compras).

**Passo 5 — Relatar**

Escreva o achado (números exatos, comando usado, decisão tomada) no
relatório da task. Se mudou `historico-contabo.ts`, rode
`npx tsc --noEmit` antes de commitar.

**Passo 6 — Commit** (só se algo mudou)

```bash
git add lib/historico-contabo.ts
git commit -m "fix: <descrição exata do que mudou no corte quente/frio>"
```

---

## Task 2: Compras — "faltando os meses atuais"

**Arquivos:**
- `app/(app)/relatorio-compras/page.tsx`
- `lib/relatorio-frio-nf.ts`

**Contexto:** Item #9 da reunião (`docs/reuniao-2026-08-03-ramon-pedidos.md`)
e queixa verbal de hoje — Compras não traz todas as compras do ano, em todas
as lojas. Ligado ao achado da Task 1.

**Passo 1 — Reproduzir com dado real**

Na conta QA, abra Compras, filtre por **cada uma das 6 lojas ativas**,
período "Este ano", sem outro filtro. Anote o total mostrado por loja.

**Passo 2 — Comparar com SQL direto**

Para cada loja, rode contra o Supabase self-hosted:
```sql
select count(*), sum(v_nf) from notas_fiscais
where loja_id = <id> and d_emissao_nfe >= '2026-01-01' and d_emissao_nfe <= '2026-08-04';
```
E o equivalente via `ntb-frio-api` pra fatia fria, se a Task 1 confirmou que
ela ainda é usada nessa janela.

**Passo 3 — Checar sync atrasado por loja**

Este projeto já teve um bug idêntico em espírito: loja 7 com credencial Omie
suspensa desde 31/07 travando sync de posição/previsão pra TODAS as lojas
(ver `docs/fix-posicao-previsao-2026-08-03.md` e o fix em
`app/api/cron/sync-nfs/route.ts` se ele seguir o mesmo padrão de "só tenta a
loja mais desatualizada"). Confirme:
```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 \
  "docker exec supabase-db psql -U supabase_admin -d postgres -c \
   \"select loja_id, max(d_emissao_nfe), count(*) from notas_fiscais group by loja_id order by loja_id;\""
```
Se alguma loja tem `max(d_emissao_nfe)` muito atrás das outras, é sync
atrasado, não bug de relatório — a correção é investigar o cron de sync
daquela loja (mesma classe de bug do sync-posicao/sync-previsao), não mexer
no relatório.

**Passo 4 — Classificar e corrigir**

- Se o problema é o corte de 90 dias (Task 1 já deve ter resolvido/descartado
  isso) → nada a fazer aqui além de confirmar.
- Se é sync atrasado de uma loja específica → aplicar o mesmo padrão de
  `sync-posicao`/`sync-previsao` (tentar em ordem até uma funcionar, nunca
  deixar uma loja quebrada travar as demais) no cron relevante de NF.
- Se é outra coisa (ex.: filtro de status escondendo notas Pendente por
  padrão) → documentar o achado exato e corrigir o filtro/default.

**Passo 5 — Revalidar**

Repita o Passo 1 na conta QA após a correção; os totais devem bater com o
Passo 2.

**Passo 6 — Commit**

```bash
git add <arquivos alterados>
git commit -m "fix: <causa raiz exata encontrada em Compras>"
```

---

## Task 3: Faturamento — "não separa processado x cancelado"

**Arquivos:**
- `app/(app)/relatorio-faturamento/page.tsx`
- `lib/faturamento-frio.ts`

**Contexto crítico encontrado durante este planejamento:** este pedido **já
foi atendido antes**. O item #6 da reunião de 27/07
(`docs/reuniao-2026-07-27-pedidos.md:39`) registra que Ramon disse
explicitamente "[Faturamento] já está funcionando direitinho" — o pedido de
filtro concluído/cancelado era sobre **Compras**, não Faturamento. Depois,
o item #28 do mesmo documento (`docs/reuniao-2026-07-27-pedidos.md:61`)
registra um pedido **real e separado**, feito ao vivo olhando uma nota
cancelada dentro do próprio Faturamento — e foi **resolvido em 2026-07-31**:
filtro Normal/Cancelado/Devolvido/Todos, disponível só dentro do modo
"Ver cupons" (único lugar onde esse dado existe granularmente).

Ou seja: o item #8 da reunião de 03/08 (que motivou este plano) é quase
certamente Ramon **não encontrando** esse filtro de novo — não um bug novo.
**Não implemente nada por padrão nesta task** — o objetivo é confirmar isso
com dado real e decidir se é caso de melhorar a descoberta do filtro (deixar
mais visível) ou se há de fato uma lacuna nova.

**Passo 1 — Confirmar que o filtro existe e funciona**

Na conta QA, abra Faturamento, ative "Ver cupons", filtre um período que
inclua uma nota cancelada conhecida (usar o mesmo caso do item #28 se ainda
existir, ou achar uma via SQL: `select ... from fat_cupons where status =
'Cancelado' limit 5` no Supabase self-hosted). Confirme visualmente que o
toggle Normal/Cancelado/Devolvido/Todos funciona e muda o resultado.

**Passo 2 — Avaliar discoverability**

Se o Passo 1 confirmar que funciona: o achado é que o filtro existe mas está
"escondido" atrás de dois cliques (ativar "Ver cupons" primeiro). Documente
isso e avalie se vale a pena um indicador visual na visão padrão (fora de
"Ver cupons") avisando que há notas canceladas no período — sem inventar uma
feature grande não pedida (YAGNI). Se decidir por essa melhoria pequena,
implemente; se não, documente a conclusão "já resolvido, possível melhoria
de descoberta não crítica" e pare.

**Passo 3 — Se o Passo 1 REFUTAR o funcionamento** (o filtro não existe mais,
quebrou, ou nunca funcionou como o commit de 07/31 sugere), aí sim trate como
bug confirmado: investigue a causa raiz em `lib/faturamento-frio.ts`
(comparar com o padrão de `itemBateStatus` em `lib/relatorio-frio-nf.ts`,
que já resolve o mesmo tipo de filtro em Compras/Auditoria) e corrija.

**Passo 4 — Commit** (se algo mudou)

```bash
git add <arquivos alterados>
git commit -m "<fix ou docs, conforme o achado>"
```

---

## Task 4: Indicadores — status hardcoded em Compras

**Arquivo:** `app/(app)/relatorio-indicadores/page.tsx:157-161`

**Contexto crítico encontrado durante este planejamento:** o código já tem
um comentário explícito dizendo que isso é **decisão deliberada**, não bug:

```
// Sem toggle de status nesta tela (pedido do Ramon foi especifico de
// Compras/Faturamento/Auditoria, item #6/#28) -- fixo em CONCLUIDA, ...
```

Ou seja: quando o filtro de status foi pedido nas outras 3 telas (07/27–07/31),
Ramon **não pediu** o mesmo aqui — foi uma exclusão intencional, não um
esquecimento. **Não implemente um toggle de status aqui por padrão** — isso
contrariaria uma decisão já tomada com o cliente sem confirmar que ele
quer mudá-la agora.

**Passo 1 — Quantificar o que está oculto**

Rode contra o Supabase self-hosted, pra uma loja e período reais:
```sql
select nf_bate_status(<lógica equivalente>, status) ... -- adaptar conforme
  a função nf_bate_status (migrations 097/098) referenciada em
  lib/relatorio-frio-nf.ts:159
```
Ou, mais simples: compare o total que a tela de Indicadores mostra (só
CONCLUIDA) com o total via SQL incluindo todos os status, pro mesmo
período/loja. Anote a diferença em R$ e em % — essa é a evidência necessária
caso a pergunta pro Ramon (Passo 2) confirme que ele quer mudar isso.

**Passo 2 — Não implementar, documentar como pendente**

Registre no relatório da task: "achado: Indicadores exclui
Pendente/Manifestada/Cancelada por decisão deliberada anterior (item #6/#28);
a queixa nova do item #8 pode ou não incluir esta tela — a diferença
quantificada é de R$X / Y% no período testado. **Pendente de confirmar com
Ramon** se ele quer esse filtro adicionado aqui também, ou se a queixa #8 era
só sobre Faturamento (ver Task 3)."

**Passo 3 — Sem commit de código nesta task**, a menos que o Passo 1 revele
algo inesperado (ex.: o hardcode está causando um total **incorreto**, não só
incompleto por design — nesse caso, tratar como bug real e corrigir,
documentando a distinção claramente).

---

## Task 5: Produção — filtros faltando + reconfirmar bug "imprimir atrasadas"

**Arquivos:**
- `app/(app)/relatorio-producao/page.tsx`
- `lib/dashboard-producao.ts`
- Referência de padrão: `app/(app)/relatorio-compras/page.tsx:283-296` (como
  montar `campos: CampoFiltro[]` e usar `<FiltrosGaveta>`)

**Contexto:** confirmado por leitura de código — `dashboard-producao.ts` só
agrupa por dia/semana/mês e por funcionário (`concluida_por`); não há
nenhuma dimensão de tipo/família/produto/local. É a única tela de relatório
do sistema sem esses filtros — bate com a queixa de hoje ("filtros uma
merda").

A tabela `ordens_producao` já tem as colunas necessárias:
`identificacao_n_cod_produto` (produto) e
`identificacao_codigo_local_estoque` (local) — confirme os nomes exatos
antes de codar (`grep -n "identificacao_" lib/omie/ordem-producao.ts`).
Tipo/família não estão na própria tabela — precisam de join/mapa com
`produtos` (mesmo padrão de `relatorio-compras/page.tsx`: buscar
`codigo_produto, tipo_item, descricao_familia` da tabela `produtos`
**paginado com `.range()`**, nunca um `.select()` sem paginação — ver Global
Constraint #6).

**Passo 1 — Investigar viabilidade**

Confirme com SQL real que `ordens_producao.identificacao_n_cod_produto`
bate com `produtos.codigo_produto` da mesma loja, pra um punhado de OPs
concluídas reais. Confirme volume: `select count(*) from ordens_producao
where loja_id = <id>` — se for grande, a paginação do mapa produto→tipo/família
é obrigatória (Global Constraint #6).

**Passo 2 — Adicionar os filtros**

Em `app/(app)/relatorio-producao/page.tsx`, adicione um `campos: CampoFiltro[]`
e `<FiltrosGaveta>` seguindo exatamente o padrão de
`relatorio-compras/page.tsx:283-296`: filtro de tipo (multi-select, mesmas
opções `PRODUTO_TIPO_ITEM` usadas em Compras), família (multi-select, vindo
de `buscarFamilias`), produto (texto) e local de estoque (select, vindo de
`local_estoques`).

Em `lib/dashboard-producao.ts`, `carregarDashboardProducao` precisa aceitar
os novos filtros e aplicá-los em `buscarOpsPaginado` (adicionar `.in()`/`.eq()`
conforme os filtros ativos) e, pra tipo/família, cruzar com o mapa de
produtos construído no Passo 1.

**Passo 3 — Testar na conta QA**

Aplique cada filtro novo isoladamente e combinado, confirme que o gráfico
muda conforme esperado e que os totais batem com uma query SQL equivalente.

**Passo 4 — Reconfirmar o bug 3b ("imprimir atrasadas" por local)**

Item #3 da reunião: filtrar "imprimir atrasadas" por local de estoque não
traz OPs mesmo havendo atrasadas ali. Ramon disse que ia investigar sozinho.
Na conta QA, reproduza: ache uma OP atrasada real (`dt_previsao < hoje and
concluida = false`) com um local de estoque conhecido, filtre a impressão por
esse local, confirme se ainda falha.
- Se **ainda falha**: veja o código de geração desse relatório de impressão
  (procure por "atrasada" em `app/` — provavelmente uma rota separada de
  impressão/PDF) e corrija o filtro de local que não está sendo aplicado.
- Se **já funciona**: documentar que foi resolvido (por Ramon ou em outra
  mudança) e não mexer.

**Passo 5 — Commit**

```bash
git add app/\(app\)/relatorio-producao/page.tsx lib/dashboard-producao.ts
git commit -m "feat: filtros de tipo/família/produto/local no relatório de Produção"
```
(Commit separado se o Passo 4 também gerar correção.)

---

## Task 6: Movimentações — só manual (#10) + detalhamento por produto (#11)

**Arquivos:**
- `app/(app)/relatorio-movimentacao/page.tsx`
- `supabase/migrations/090_movimentacao_preco_cache.sql` (RPC
  `relatorio_movimentacao_matriz`, fonte: tabela `movimentos_historico`)
- Tabela `movimentos` (distinta de `movimentos_historico`) — ver
  `lib/omie/sync-ajustes.ts` e a seção "Dual-write de movimentos" em
  `AGENTS.md`

**Contexto crítico encontrado durante este planejamento:** a tabela que
alimenta o relatório atual (`movimentos_historico`, migration 015) é
**pré-agregada por dia** (`loja_id, cod_prod, data → entradas, saidas`) e
**não tem nenhuma coluna de origem/tipo** — os números vêm direto do
`ListarMovimentos` da Omie, que já mistura venda, compra e ajuste manual sem
distinção NA FONTE. Isso significa que o pedido do item #10 ("mostrar só
movimento manual") **pode não ser só um filtro que falta** — pode exigir uma
fonte de dado diferente.

Existe uma tabela **separada**, `movimentos` (populada especificamente pelos
tópicos webhook `Produto.AjusteEstoque`/`Produto.MovimentacaoEstoque` via
`lib/omie/sync-ajustes.ts`, chave natural `loja_id + id_ajuste`) que **pode**
já conter só os ajustes manuais — mas isso não foi confirmado nesta sessão.
Esta task precisa confirmar essa hipótese com dado real antes de decidir a
abordagem.

**Passo 1 — Investigar se `movimentos` é de fato só-manual**

```sql
-- Supabase self-hosted, loja com movimento conhecido
select count(*), min(data), max(data) from movimentos where loja_id = <id>;
select * from movimentos where loja_id = <id> order by data desc limit 20;
```
Compare uma amostra desses registros com o que se sabe ter sido uma
venda/compra real no mesmo dia (via `notas_fiscais`/`fat_cupons`) — se
nenhuma delas aparece em `movimentos`, a hipótese está confirmada: essa
tabela já é o dado puro que o item #10 pede.

**Passo 2a — Se confirmado (`movimentos` = só manual):**

Troque a fonte de `relatorio-movimentacao` (RPC nova ou adaptada) de
`movimentos_historico` para `movimentos`, mantendo os filtros já existentes
(produto, local, sentido, família, tipo). Crie uma nova RPC
`relatorio_movimentacao_manual` (não sobrescreva a existente — o pedido é
mostrar só manual, mas confirme com o Passo 1 se ninguém mais depende da
visão mista antes de decidir se a RPC antiga é removida ou mantida como
opção). Adicione o toggle/aba na tela.

**Passo 2b — Se refutado** (a tabela `movimentos` também mistura tipos, ou
não tem volume suficiente pra ser útil como fonte histórica): documente o
achado — isso vira um item maior (precisaria de uma coluna de origem gravada
desde a ingestão, fora do escopo de "ajustar filtro"), marque como
"pendente — requer decisão de produto sobre nova captura de dado, fora do
escopo deste plano" e não implemente uma solução parcial que pareça
resolver mas não resolve de verdade.

**Passo 3 — Detalhamento por produto (item #11)**

Com a fonte de dado decidida nos passos anteriores, valide primeiro o valor
que Ramon achou baixo: rode a soma real de saídas manuais num ano inteiro
pra uma loja e compare com os ~R$5mil que ele viu. Se o valor real bater
(R$5mil está correto): o achado é só a falta de drill-down, não um bug de
valor — implemente detalhamento por produto/local/família/tipo seguindo o
padrão de drill-down já usado no projeto (`lib/drill.ts` +
`components/ui-kit/DrillBreadcrumb.tsx`, mesmo padrão de
Compras/Auditoria/Faturamento). Se o valor real for maior que R$5mil: é bug
de fato — investigue se é o mesmo problema de fonte de dado do Passo 1/2, ou
outra causa, antes de implementar o drill-down sobre um número que já sabe
estar errado.

**Passo 4 — Item #15 ("situação")**

Não implementar. Documentar no relatório da task: "pedido cortado na
transcrição da reunião — frase incompleta, não dá pra inferir se é status de
nota ou de movimento. Pendente de esclarecer com Ramon antes de qualquer
implementação."

**Passo 5 — Testar e commitar**

Testar cada mudança na conta QA com uma query SQL de conferência. Commits
separados por sub-mudança (fonte de dado, drill-down) para manter histórico
claro.

---

## Task 7: Auditoria Fiscal — confirmar filtro de status

**Arquivo:** `app/(app)/auditoria-fiscal/page.tsx`

**Contexto:** sem queixa direta do cliente/usuário. Achado de varredura: o
filtro de status existe só como chips (`ChipsStatus`), fora da gaveta de
filtros (`FiltrosGaveta`) que os outros campos usam — inconsistência de UX,
não parece bug de dado.

**Passo 1 — Confirmar que não há perda de dado**

Na conta QA, compare o total mostrado com todos os chips de status ativos
("Todos") contra uma contagem SQL sem filtro de status pro mesmo
período/loja. Devem bater.

**Passo 2 — Classificar**

- Se os totais batem: marcar "auditado, sem correção necessária" — a
  inconsistência de UX (chips fora da gaveta) é conhecida e não é bug; **não
  redesenhar isso nesta task** (não foi pedido, é YAGNI mexer em UX não
  solicitada).
- Se não baterem: tratar como bug real, investigar a causa (provavelmente em
  `itemBateStatus`/`lib/relatorio-frio-nf.ts:165`) e corrigir.

**Passo 3 — Commit** (só se algo mudou)

---

## Task 8: Margem — filtro de "local" é um proxy

**Arquivo:** `app/(app)/relatorio-margem/page.tsx`

**Contexto:** sem queixa direta. Achado de varredura: o filtro de "local"
mostra produtos que têm QUALQUER estoque naquele local, não uma dimensão
direta de margem por local (a margem em si vem de `margem_importada`/CMC,
que não é por local de estoque).

**Passo 1 — Testar se isso engana o usuário na prática**

Na conta QA, ative o filtro de local com um produto que existe em múltiplos
locais. Confirme visualmente: o número de margem exibido muda com o filtro
de local (o que seria errado, já que margem não varia por local de estoque),
ou o filtro só restringe QUAIS produtos aparecem na lista (o que é o
comportamento correto de um proxy, só precisa deixar claro na UI)?

**Passo 2 — Classificar**

- Se o número de margem muda incorretamente por local: bug real, corrigir
  (a margem do produto não deve variar por filtro de local, só a lista de
  quais produtos aparecem).
- Se só filtra a lista (comportamento correto, mal comunicado): considerar
  um texto/tooltip explicando que o filtro de local restringe produtos, não
  recalcula margem por local — mudança pequena de UI, não redesenho.

**Passo 3 — Commit** (se algo mudou)

---

## Task 9: Estoque Valorizado — confirmação rápida

**Arquivo:** `app/(app)/relatorio-estoque-valorizado/page.tsx`

**Contexto:** sem queixa. É foto do momento (snapshot do Omie, sem filtro de
data por design). Paginação já parece correta na varredura (totais via
`rpcTodos`, só a tabela exibida capa em 500 linhas, o que é aceitável pra
exibição).

**Passo 1 — Confirmar com dado real**

Na conta QA, compare o total mostrado (sem filtro) com
`select count(*), sum(valor_total) from <fonte da RPC>` direto no banco, pra
uma loja com >500 produtos (ex.: as lojas com 2500+ produtos identificadas
nesta sessão).

**Passo 2 — Classificar**

Resultado esperado: bater exato (a paginação da RPC já cobre isso). Se
bater: marcar "auditado, sem correção necessária". Se não bater: tratar como
bug real e investigar.

---

## Task 10: Nota Fiscal — confirmar fix de 26/07 e atualizar doc obsoleta

**Arquivos:**
- `app/(app)/nota-fiscal/page.tsx`
- `AGENTS.md` (seção "Limitações conhecidas")

**Contexto crítico encontrado durante este planejamento:** o `AGENTS.md`
deste projeto lista, na seção "Limitações conhecidas", que o cruzamento de
filtro tipo/família/produto/local com a fatia fria (>90 dias) **não foi
implementado**. Isso está **desatualizado** — existe um spec
(`docs/superpowers/specs/2026-07-26-nf-filtro-cross-90-dias-design.md`) e um
plano (`docs/superpowers/plans/2026-07-26-...md`, commit `396c522` +
`f403f19`) implementando exatamente esse cruzamento via
`buscarNotaIdsFrio()` em `lib/relatorio-frio-nf.ts:117`, já em uso em
`app/(app)/nota-fiscal/page.tsx:156`. **Este bug muito provavelmente já foi
corrigido em 2026-07-26/31 — a documentação é que ficou para trás.**

**Passo 1 — Confirmar que o fix de fato funciona hoje**

Na conta QA, reproduza o cenário do bug original: filtre Nota Fiscal por um
período que cruza os 90 dias **e** por tipo ou família de produto, numa loja
com notas conhecidas na fatia fria. Compare o resultado com uma contagem SQL
que aplique o mesmo filtro manualmente nas duas fontes (Supabase +
`ntb-frio-api`).

**Passo 2 — Classificar**

- Se bater: o fix de 07/26 continua funcionando. **Ação obrigatória:**
  remover/corrigir o parágrafo desatualizado em `AGENTS.md` (seção
  "Limitações conhecidas") que ainda descreve isso como não implementado —
  documentação errada é pior que ausência de documentação, pois engana o
  próximo a mexer aqui.
- Se não bater (ex.: quebrou depois da migração pra self-hosted, ou nunca
  cobriu 100% dos casos): tratar como bug real, investigar a causa (pode
  estar ligado ao achado da Task 1) e corrigir `buscarNotaIdsFrio`.

**Passo 3 — Commit**

```bash
git add AGENTS.md
git commit -m "docs: remove nota obsoleta sobre filtro cross-90-dias em NF (corrigido em 26/07)"
```
(Commit separado se o Passo 2 também gerar correção de código.)

---

## Ordem de execução

Task 1 primeiro (bloqueia logicamente as demais, mas não impede que rodem em
paralelo depois — cada task de relatório faz sua própria checagem
específica além do achado do Bloco 0). Tasks 2–10 podem seguir em qualquer
ordem depois da Task 1, mas a numeração acima reflete a ordem de prioridade
sugerida pelas queixas reais do cliente (Compras e Faturamento primeiro,
Produção em seguida, os demais por completude).
