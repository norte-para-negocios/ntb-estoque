# Contenção de RLS (Fase 0) — Design

**Data:** 2026-08-12

**Gatilho:** achado incidental na revisão final do plano "Sertão Teste"
(2026-08-12): a tabela `lojas` está com RLS desligada e grants totais
(`SELECT`/`INSERT`/`UPDATE`/`DELETE`/`TRUNCATE`) pra `anon`/`authenticated`
desde a migration 061 (2026-07-07) — qualquer operador logado consegue ler
`integracao_api_key`, `omie_app_key`/`omie_app_secret` de todas as lojas
direto pelo navegador via PostgREST.

## Auditoria completa (não re-investigar)

Rodada em produção hoje. Das 48 tabelas do schema `public`:

- **34 estão com RLS desligada** (`relrowsecurity = false`, zero policy) e
  com grant total pra `anon`/`authenticated`, incluindo `TRUNCATE`. Uma
  anon key pública hoje consegue `TRUNCATE lojas`, que apaga o sistema
  inteiro via `ON DELETE CASCADE` (quase toda tabela do schema referencia
  `lojas.id`).
- **14 já usam um padrão correto e testado**: RLS ligada, 1 policy de
  `SELECT` do tipo `EXISTS (select 1 from loja_user lu where lu.loja_id =
  <tabela>.loja_id and lu.user_id = uid())` — sem policy de escrita, então
  `INSERT`/`UPDATE`/`DELETE` ficam bloqueados por default-deny do Postgres
  mesmo com o grant existente. Esse é o padrão que a Fase 2 (fora de
  escopo deste plano) vai replicar nas 34 restantes.

**As 34 tabelas sem RLS**: `arquivos_mortos`, `audit_log`,
`categorias_contabeis`, `clientes`, `contas_correntes`, `contas_pagar`,
`contas_receber`, `convites`, `familias`, `fornecedores`,
`integration_attempts`, `inventario_items`, `inventarios`,
`local_estoque_user`, `local_estoques`, `loja_user`, `lojas`, `movimentos`,
`movimentos_historico`, `nota_fiscal_items`, `notas_fiscais`,
`ordens_producao`, `ordens_producao_teste`, `outbox`, `permissao_user`,
`permissoes`, `posicao_estoques`, `previsao_venda`,
`produto_preco_recente`, `produto_substituicoes`, `produtos`, `profiles`,
`transferencias`, `webhooks`.

**Colunas sensíveis de `lojas`** (chaves/segredos, nunca devem ser
legíveis por `anon`/`authenticated`): `omie_app_key`, `omie_app_secret`,
`integracao_api_key`, `integracao_teste_api_key`, `csc_producao`,
`csc_id_producao`, `certificado_senha_enc`.

**Confirmado (exploração de código, hoje)**: nenhum Client Component
(`'use client'`) e nenhum uso de `@/lib/supabase/client` (browser client)
toca qualquer uma das 34 tabelas em nenhum lugar do repo — todo acesso é
server-side, via `createClient()` (sessão, role `authenticated`) ou
`createServiceClient()` (service_role, ignora RLS/grants, ~130 pontos,
maioria do código). `service_role`/`postgres` não são afetados por nenhum
`REVOKE` deste plano — são roles separadas.

**3 exceções confirmadas** (código que escreve/lê essas tabelas via
client de sessão, não service — precisam de correção ANTES da migration,
senão quebram):

1. `lib/actions/loja-selector.ts:45` — `UPDATE profiles` (troca de loja
   atual) via `createClient()`.
2. `components/movimentacoes/MovimentosTab.tsx:382-384` — lê
   `omie_app_key`/`omie_app_secret` de `lojas` via `createClient()`, pra
   consultar saldo na Omie (cálculo interno, nunca exibido na tela).
3. `app/(app)/loja/page.tsx:23-26` — `select('*')` em `lojas` (traz até
   `certificado_senha_enc`) via `createClient()`, tela admin-only
   (protegida por `isAdmin()` na aplicação, não no banco).

Nenhuma outra exceção — todo o resto do código já usa
`createServiceClient()` pra escrever/ler colunas sensíveis dessas 34
tabelas (amostra representativa confirmada: todo `lib/actions/*.ts`,
`lib/omie/*.ts`, `lib/auditoria.ts`, `lib/arquivo-morto.ts`, rotas
`app/api/webhook`, `app/api/integracao/*`, `app/api/cron/*`).

## Escopo desta Fase (contenção rápida, baixo risco)

1. **Elimina o risco de destruição**: `REVOKE INSERT, UPDATE, DELETE,
   TRUNCATE` de `anon`/`authenticated` nas 34 tabelas. `SELECT` continua
   liberado nelas por enquanto (RLS de linha fica pra Fase 2).
2. **Fecha o vazamento de leitura que motivou o achado**: em `lojas`
   especificamente, `REVOKE SELECT` (tabela inteira) + `GRANT SELECT`
   só nas colunas não sensíveis, montado **dinamicamente** via
   `information_schema.columns` excluindo as 7 colunas sensíveis listadas
   acima — uma coluna nova em `lojas` no futuro entra automaticamente no
   grant permitido, sem exigir editar esta migration de novo.
3. **3 correções de código** (pré-requisito da migration, na ordem: código
   primeiro, migration depois): as 3 exceções acima passam a usar
   `createServiceClient()`.

## Fora de escopo (explícito, fica pra Fase 2, plano separado)

- RLS de linha (`loja_user`) nas 34 tabelas, replicando o padrão já usado
  nas 14 — trabalho maior, tabela por tabela, cada uma pode precisar de
  uma policy diferente (algumas têm `loja_id` direto, `profiles`/`lojas`
  não têm, tabelas de log/sistema como `webhooks`/`audit_log`/`outbox`
  talvez devam ficar bloqueadas de `SELECT` por completo pra
  `anon`/`authenticated`).
- Qualquer mudança de comportamento visível pro usuário final — este
  plano é só grants/policies de banco + 3 trocas de client, sem alterar
  nenhuma tela/fluxo.
- O achado incidental (fora de RLS) de que `LojaCard.tsx` (Client
  Component) recebe `omie_app_key`/`omie_app_secret` completos via props
  RSC (mascarados só na renderização, visíveis no payload bruto) — é um
  vetor de exposição diferente (client-side, não banco), registrado aqui
  como candidato a follow-up separado, não corrigido nesta Fase.

## Testes

Sem suite automatizada cobrindo isso. Validação manual, direto contra a
anon key pública em produção, depois de aplicar:

- `SELECT integracao_api_key FROM lojas` via PostgREST com a anon key →
  deve falhar (coluna não visível). Idem pras outras 6 colunas sensíveis.
- `SELECT nome, cnpj FROM lojas` via PostgREST com a anon key → deve
  continuar funcionando (coluna não sensível).
- `TRUNCATE`/`DELETE`/`INSERT`/`UPDATE` em qualquer uma das 34 tabelas via
  PostgREST com a anon key → deve falhar em todas.
- Fluxo real no app: login, trocar de loja (seletor), tela de
  Movimentações com filtro de local+produto único (saldo inicial/final),
  tela `/loja` (admin) — todos continuam funcionando idênticos.
