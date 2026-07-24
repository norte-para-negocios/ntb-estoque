# Failover Supabase → Contabo — Design Spec

**Data:** 2026-07-23
**Origem:** incidente real no mesmo dia — o projeto Supabase (plano gratuito) ficou
totalmente inacessível por ~30min por consumo de recursos (provavelmente
agravado por queries pesadas da própria auditoria de relatórios rodando
mais cedo). Resolvido só com um restart manual no painel do Supabase — sem
esse restart, o app inteiro (login + tudo) ficaria fora do ar indefinidamente,
para as 6 lojas reais. O usuário pediu que o Contabo (VPS já existente, que
hoje só espelha um subconjunto de tabelas históricas em modo leitura) passe a
conseguir assumir a operação completa (leitura E escrita) enquanto o Supabase
estiver fora, com volta automática quando ele normalizar.

## Contexto atual (o que já existe, não mexer sem necessidade)

- **Supabase** é hoje a ÚNICA fonte de: Auth (login), RLS (permissão por
  loja), e as tabelas de cadastro (`produtos`, `clientes`, `fornecedores`,
  `lojas`, `profiles`, `permissoes`, etc. — 43 tabelas no total no schema
  `public`, ver backup de hoje).
- **Contabo** roda um Postgres próprio (`ntb_frio`) e a API `ntb-frio-api`
  (`/opt/ntb-frio-api/server.js`), além do próprio app Next.js
  (`ntb-estoque.service`). Hoje só recebe, via dual-write fire-and-forget
  (`app/api/webhook/route.ts:59-63`, e o padrão equivalente em
  `sync-ajustes.ts`/`faturamento.ts`), as tabelas `movimentos`,
  `movimentos_historico`, `notas_fiscais`, `nota_fiscal_items`,
  `ordens_producao`, `webhooks`, `fat_cupons`/`fat_cupom_itens`/`fat_cupom_pagamentos`
  — nunca as tabelas de cadastro, por design explícito (documentado em
  AGENTS.md: "Fora disso... só no Supabase, nunca duplicados no Contabo").
- **Achado de hoje, crítico pro design do failover**: Supabase e Contabo
  atribuem ids seriais INDEPENDENTES pro mesmo registro lógico (confirmado
  pra `ordens_producao`, `notas_fiscais`, `movimentos` durante a investigação
  da Task 9 da auditoria) — nunca coincidem entre os dois bancos. Qualquer
  escrita nova feita no Contabo durante uma queda vai gerar um id que NÃO
  bate com o que o Supabase geraria pro mesmo registro.
- **Cliente Supabase centralizado**: `lib/supabase/server.ts` é o único
  lugar que cria os clientes (`createClient` via `@supabase/ssr`,
  `createServiceClient` com service role) — aponta pra
  `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY`/
  `SUPABASE_SERVICE_ROLE_KEY`. Esse é o ponto certo pra injetar a lógica de
  troca de destino.
- **Backup pontual feito hoje** (não é o mecanismo definitivo, só uma rede de
  segurança inicial): `pg_dump` completo do schema `public` (491MB, todas as
  43 tabelas) + schema `auth` (487KB) salvos em `/root/` no servidor Contabo.

## Por que NÃO é um problema de "dois bancos escrevendo ao mesmo tempo"

Como o Supabase fica **totalmente inacessível** durante a queda (não
"lento", inacessível), só o Contabo recebe escritas nesse período. Não é um
cenário multi-master com conflito real — é uma sequência linear de eventos
que precisa ser replicada pro Supabase depois, na ordem certa. Isso evita o
problema mais difícil de sistemas distribuídos (resolução de conflito
concorrente) — o problema real que sobra é só o *remapeamento de id* pros
registros novos criados durante a janela de queda.

## Arquitetura, em 3 fases independentes (cada uma entrega valor sozinha)

### Fase 1 — Réplica contínua completa + Contabo self-hosted funcional (sem troca automática ainda)

- **Atualizado após a implementação real (2026-07-24): não usa dual-write
  manual.** A ideia original era estender o dual-write fire-and-forget já
  existente pra todas as tabelas do schema `public`, mas isso significaria
  tocar em toda rota/Server Action que escreve (dezenas de lugares) — a
  implementação usa **replicação lógica nativa do Postgres**
  (`CREATE PUBLICATION`/`CREATE SUBSCRIPTION`) em vez disso: o Postgres
  cuida da consistência e da ordem sozinho, sem precisar tocar em nenhum
  código de escrita já existente. Cobre 40 das 43 tabelas do schema
  `public` — 3 tabelas de configuração estática (`cargos`, `permissoes`,
  `cargo_permissao`, papéis/permissões definidos no código) foram excluídas
  após uma investigação real de causa-raiz (travamento determinístico e
  reproduzível do motor de replicação lógica especificamente nessas 3
  tabelas pequenas, causa exata não identificada) — aceitável porque são
  dados estáticos, já corretos no Contabo via seed das migrations, e só
  mudam por uma nova migration aplicada nos dois bancos igualmente. Ver
  `docs/superpowers/plans/2026-07-23-failover-contabo-fase1.md` e
  `.superpowers/sdd/failover-task-5-report.md` pro detalhe completo.
- Rodar o stack self-hosted oficial do Supabase (Postgres + GoTrue + 
  PostgREST, via Docker Compose — é o mesmo software open-source que a
  Supabase Cloud roda, não uma reimplementação) no servidor Contabo,
  alimentado pela réplica contínua acima.
- Copiar as políticas de RLS (são só `create policy ...`, já capturadas no
  dump de hoje) pro Postgres do Contabo, garantindo que a mesma regra de
  "só vê dados da própria loja" valha também lá.
- **Critério de pronto desta fase**: apontar manualmente um ambiente de
  teste pro stack do Contabo (trocando as env vars à mão) e confirmar que
  login, leitura e escrita funcionam ali igual ao Supabase — SEM nenhuma
  lógica automática de troca ainda. Essa fase sozinha já garante que, numa
  emergência, alguém consegue trocar manualmente e o sistema não fica
  cego — mesmo antes da automação completa.

### Fase 2 — Detecção automática de queda + troca automática

- Health check leve e contínuo (mesmo formato dos testes feitos hoje: GET
  no REST + tentativa de login) rodando a cada poucos segundos a partir do
  próprio servidor Contabo (não do browser do usuário, pra não distorcer
  com problemas de rede do cliente).
- **Troca só depois de N falhas seguidas** (evita trocar por causa de uma
  soneca de rede de 1 request) — valor exato de N a definir no plano de
  implementação, calibrado pra não reagir a uma janela de instabilidade
  curta.
- Quando confirma queda: `lib/supabase/server.ts` passa a apontar os
  clientes pro stack self-hosted do Contabo (leitura E escrita), e toda
  escrita feita nesse modo grava também numa tabela-diário (`outbox`, só no
  Postgres do Contabo) com: nome da tabela, tipo de operação
  (insert/update/delete), o id usado no Contabo, e os dados completos da
  linha.

### Fase 3 — Volta automática por replay do outbox

- Mesmo health check da Fase 2, na direção contrária: só considera o
  Supabase "de volta" depois de **N confirmações seguidas** de saúde.
- Processo de replay lê o `outbox` em ordem cronológica e aplica cada
  entrada no Supabase real:
  - **Insert** de um registro criado durante a queda: insere no Supabase
    (deixando o Supabase gerar seu próprio id), e grava um mapa
    `id_contabo → id_supabase` pra essa linha.
  - **Update/delete** de um registro que já existia ANTES da queda (id já
    bate nos dois lados, porque a réplica contínua da Fase 1 já sincronizou
    esse registro antes da queda começar): aplica direto pelo id.
  - **Update/delete** de um registro criado DURANTE a queda: usa o mapa
    `id_contabo → id_supabase` gerado no passo de insert acima pra saber
    qual linha atualizar no Supabase.
  - Ordem de aplicação respeita dependências (ex.: um item de nota fiscal só
    é inserido depois que a nota fiscal "pai" já foi inserida e tem seu id
    do Supabase mapeado).
- **Falha no replay não falha silenciosamente**: se uma entrada do outbox
  não conseguir ser aplicada (ex.: um registro conflitante, uma constraint
  violada), isso fica registrado de forma visível (log + notificação) pra
  correção manual — o usuário já decidiu aceitar esse risco em troca de não
  precisar decidir a volta manualmente.
- Depois do replay completo, o app volta a apontar pro Supabase como
  principal, e o Contabo volta ao papel normal de espelho/complemento
  (mesmo papel de hoje).

## Fora de escopo desta spec (não incluído, riscos e decisões que ficam pra depois)

- **Novos cadastros de usuário durante a queda**: um usuário criado no
  GoTrue do Contabo durante o failover precisa do mesmo tratamento de
  remapeamento de id que qualquer outra tabela no replay — tratado pelo
  mecanismo genérico da Fase 3, não como caso especial.
- **O bug do merge híbrido sem limite de data** (achado na Task 9 da
  auditoria de relatórios, que provavelmente contribuiu pro consumo de
  recursos de hoje) é uma spec/plano separado — não faz parte deste design,
  mesmo sendo relacionado.
- Calibração exata dos parâmetros N (quantas falhas pra trocar, quantas
  confirmações pra voltar) e o mecanismo de notificação de falha de replay
  ficam para o plano de implementação, não para esta spec de arquitetura.
- Testes de carga/performance do stack self-hosted do Contabo sob uso real
  das 6 lojas simultâneas não fazem parte desta spec — a Fase 1 já inclui
  validação funcional básica, mas não um teste de capacidade.

## Testes / validação (visão geral, detalhado no plano)

Critério central de aceite antes de confiar em produção: simular uma queda
real (derrubar a conectividade com o Supabase de propósito, em ambiente de
teste/staging), confirmar troca automática, realizar operações reais de
escrita (criar produto, dar entrada em NF, criar transferência) só no
Contabo, "religar" o Supabase, confirmar replay automático, e verificar que
tudo aparece corretamente no Supabase depois — sem duplicar, sem perder
nada, com qualquer falha de replay visível e não silenciosa.
