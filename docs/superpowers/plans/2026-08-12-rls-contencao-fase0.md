# Contenção de RLS (Fase 0) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminar o risco de destruição em cascata (34 tabelas sem RLS,
`anon`/`authenticated` com `TRUNCATE` liberado) e fechar o vazamento de
leitura de segredos em `lojas` (`omie_app_key`, `integracao_api_key` etc.
legíveis por qualquer operador logado via PostgREST).

**Architecture:** 3 correções pontuais de código (trocam o client Supabase
usado em 3 queries específicas, de `createClient()`/sessão pra
`createServiceClient()`), seguidas por uma migration de grants/privilégios
(sem tabela nova, sem policy nova — só `REVOKE`/`GRANT`). Ver spec completa:
`docs/superpowers/specs/2026-08-12-rls-contencao-fase0-design.md`.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Supabase (Postgres
self-hosted no Contabo).

## Global Constraints

- Produção real, sem staging.
- `npx tsc --noEmit` limpo antes de cada commit de código (Tasks 1-3).
- Migration aplicada manualmente via SSH: `ssh -i
  ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec -i
  supabase-db psql -U supabase_admin -d postgres" < arquivo.sql` (este
  repo não tem runner automático de migration — ver `AGENTS.md`, seção
  "Migrations: aplicadas à mão, sem tracking").
- Deploy: `git push origin main` + SSH síncrono (`ssh -i
  ~/.ssh/notebook_contabo_key root@185.193.66.240 "cd /opt/ntb-estoque &&
  bash deploy.sh"`, sem `nohup`/background) + confirmar `curl -s -o
  /dev/null -w "HTTP %{http_code}\n"
  https://app-estoque.norteparanegocios.com.br/login` (esperar 200) +
  confirmar commit no servidor via `ssh ... "cd /opt/ntb-estoque && git
  log --oneline -1"`.
- **Ordem de execução não pode inverter**: Tasks 1-3 (código) DEVEM estar
  em produção (deploy feito) ANTES da Task 4 (migration) ser aplicada. Se
  a migration rodar primeiro, os 3 pontos de código corrigidos nas Tasks
  1-3 (que hoje ainda funcionam com o client de sessão) quebram em
  produção na hora — a troca de client é o que permite a migration
  revogar os grants sem quebrar nada. Por isso a Task 3 já inclui
  deploy; a Task 4 aplica a migration só depois de confirmar que esse
  deploy está no ar.
- Nenhuma tabela nova, nenhuma mudança de UI/comportamento visível para o
  usuário final — só grants/privilégios de banco + troca de client em 3
  linhas de código.
- `service_role`/`postgres` nunca são afetados por nenhum `REVOKE` deste
  plano — são roles separadas, com seus próprios grants completos,
  independentes do que é revogado de `anon`/`authenticated`.

---

## Task 1: Migrar escrita de `profiles` (troca de loja) pro client de serviço

**Files:**
- Modify: `lib/actions/loja-selector.ts`

**Interfaces:**
- Consumes: `createServiceClient` de `@/lib/supabase/server` (já existe,
  usado em ~130 outros pontos do repo — só precisa ser importado aqui).
- Produces: nenhuma interface nova — o comportamento externo da action
  `setCurrentLoja` (assinatura, retorno `{ok:true}`/`{error:string}`)
  não muda.

O arquivo hoje (`lib/actions/loja-selector.ts`, 49 linhas):

```typescript
'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { getUser } from '@/lib/auth'

export async function setCurrentLoja(lojaId: number) {
  const user = await getUser()
  const supabase = await createClient()

  // Valida que o usuario pode acessar essa loja antes de gravar.
  const { data: profile } = await supabase
    .from('profiles')
    .select('perfil')
    .eq('id', user.id)
    .single<{ perfil: string | null }>()

  const isAdmin = profile?.perfil === 'Admin'

  let permitido = false
  if (isAdmin) {
    // Admin: qualquer loja ativa.
    const { data: loja } = await supabase
      .from('lojas')
      .select('id')
      .eq('id', lojaId)
      .eq('ativo', true)
      .maybeSingle()
    permitido = !!loja
  } else {
    // Nao-admin: somente lojas em loja_user do usuario.
    const { data: vinculo } = await supabase
      .from('loja_user')
      .select('id')
      .eq('loja_id', lojaId)
      .eq('user_id', user.id)
      .maybeSingle()
    permitido = !!vinculo
  }

  if (!permitido) {
    return { error: 'Voce nao tem acesso a essa loja' }
  }

  await supabase.from('profiles').update({ current_loja_id: lojaId }).eq('id', user.id)
  revalidatePath('/', 'layout')
  return { ok: true }
}
```

**Por quê**: depois da Task 4, `authenticated` perde `UPDATE` em
`profiles` — essa é a única escrita do arquivo, e é a única linha que
precisa mudar. As 3 leituras anteriores (`profiles.perfil`, `lojas.id`,
`loja_user.id`) continuam via `createClient()` (sessão) — `SELECT`
continua liberado nessas 3 tabelas para `authenticated` nesta Fase 0 (só
a Fase 2, fora de escopo, vai restringir leitura linha-a-linha).

- [ ] **Step 1: Adicionar o import de `createServiceClient`**

```typescript
import { createClient, createServiceClient } from '@/lib/supabase/server'
```

- [ ] **Step 2: Trocar só a linha do `UPDATE`**

Substituir:
```typescript
  await supabase.from('profiles').update({ current_loja_id: lojaId }).eq('id', user.id)
```
por:
```typescript
  const supabaseService = createServiceClient()
  await supabaseService.from('profiles').update({ current_loja_id: lojaId }).eq('id', user.id)
```

(`createServiceClient()` não é `async` — confirme lendo `lib/supabase/server.ts:45`
antes de escrever `await`; a assinatura atual é síncrona, diferente de
`createClient()`.)

- [ ] **Step 3: Rodar `npx tsc --noEmit` no repo inteiro**

Esperado: sem erros novos.

- [ ] **Step 4: Commit**

```bash
git add lib/actions/loja-selector.ts
git commit -m "fix: usar service client pra gravar current_loja_id (prep. REVOKE de RLS)"
```

---

## Task 2: Migrar leitura de `omie_app_key`/`omie_app_secret` pro client de serviço

**Files:**
- Modify: `components/movimentacoes/MovimentosTab.tsx`

**Interfaces:**
- Consumes: `createServiceClient` de `@/lib/supabase/server`.
- Produces: nenhuma — comportamento visível idêntico (o saldo
  inicial/final continua calculado igual, só a origem do client muda).

Contexto: `MovimentosTab` (função em `components/movimentacoes/MovimentosTab.tsx:88`)
cria `const supabase = await createClient()` uma vez, no topo da função
(linha 89), e reusa essa variável pra várias queries ao longo do corpo
(movimentos, ordens de produção, lojas). Só o trecho abaixo (linhas
380-386 hoje) precisa de um client diferente — as outras queries que usam
`supabase` continuam exatamente como estão.

O trecho relevante hoje:

```typescript
      if (localFiltro && produtoUnico) {
        const { data: lojaRow } = await supabase
          .from('lojas')
          .select('id, omie_app_key, omie_app_secret')
          .eq('id', lojaId)
          .single<LojaOmie>()
        if (lojaRow) {
          try {
            const posicao = await getPosicaoProduto(lojaRow, localFiltro, produtoUnico.id_prod, dataOmieBR(null))
```

**Por quê**: depois da Task 4, `authenticated` perde `SELECT` em
`omie_app_key`/`omie_app_secret` de `lojas` (fica só com as colunas não
sensíveis) — essa query precisa das duas colunas sensíveis pra chamar
`getPosicaoProduto`, então precisa do client de serviço.

- [ ] **Step 1: Adicionar o import de `createServiceClient`**

No topo do arquivo, linha 1 hoje é:
```typescript
import { createClient } from '@/lib/supabase/server'
```
Trocar por:
```typescript
import { createClient, createServiceClient } from '@/lib/supabase/server'
```

- [ ] **Step 2: Trocar só o client dessa query específica**

Substituir:
```typescript
        const { data: lojaRow } = await supabase
          .from('lojas')
          .select('id, omie_app_key, omie_app_secret')
          .eq('id', lojaId)
          .single<LojaOmie>()
```
por:
```typescript
        const supabaseService = createServiceClient()
        const { data: lojaRow } = await supabaseService
          .from('lojas')
          .select('id, omie_app_key, omie_app_secret')
          .eq('id', lojaId)
          .single<LojaOmie>()
```

Não declare `supabaseService` fora deste bloco `if` — o resto da função
continua usando só `supabase` (sessão) pra tudo o mais.

- [ ] **Step 3: Rodar `npx tsc --noEmit` no repo inteiro**

Esperado: sem erros novos.

- [ ] **Step 4: Commit**

```bash
git add components/movimentacoes/MovimentosTab.tsx
git commit -m "fix: usar service client pra ler chave Omie em Movimentações (prep. REVOKE de RLS)"
```

---

## Task 3: Migrar listagem de lojas (tela admin) pro client de serviço + deploy

**Files:**
- Modify: `app/(app)/loja/page.tsx`

**Interfaces:**
- Consumes: `createServiceClient` de `@/lib/supabase/server`.
- Produces: nenhuma — a tela continua listando todas as lojas (com
  busca por nome/nome_fantasia/cnpj) exatamente como antes.

Contexto: a página (`app/(app)/loja/page.tsx`) tem `const supabase =
await createClient()` (linha 24) usada em DUAS queries: a listagem de
`lojas` (linhas 25-28, `.select('*')`, é a que precisa mudar) e uma
segunda query em `permissoes` (linha 39, `select('id, nome')`) — essa
segunda **não muda**, porque `permissoes` não tem nenhuma coluna sensível
e continua com `SELECT` liberado pra `authenticated` nesta Fase 0.

O arquivo hoje (trecho relevante):

```typescript
  const supabase = await createClient()
  let query = supabase
    .from('lojas')
    .select('*')
    .order('id')

  if (q) {
    const t = escapeIlikeOr(q)
    // Busca por nome, nome fantasia OU CNPJ
    query = query.or(`nome.ilike.%${t}%,nome_fantasia.ilike.%${t}%,cnpj.ilike.%${t}%`)
  }

  const { data: lojas } = await query

  // Catalogo de permissoes para o convite por codigo (gerado direto da tela da loja).
  const { data: permissoes } = await supabase
    .from('permissoes')
    .select('id, nome')
    .order('id')
```

**Por quê**: `select('*')` traz TODAS as colunas de `lojas`, inclusive as
7 sensíveis — mesmo que a tela (`LojaCard`) só use algumas. Depois da
Task 4, `authenticated` só vai enxergar as colunas não sensíveis via
`SELECT` normal; pra essa tela continuar mostrando tudo que ela já mostra
hoje (ex.: indicadores de status de sync que não são segredo, mas também
não vale a pena listar coluna por coluna), o caminho mais simples é usar
o client de serviço só nessa query.

- [ ] **Step 1: Adicionar o import de `createServiceClient`**

Linha 1 hoje:
```typescript
import { createClient } from '@/lib/supabase/server'
```
Trocar por:
```typescript
import { createClient, createServiceClient } from '@/lib/supabase/server'
```

- [ ] **Step 2: Criar um segundo client só pra query de `lojas`**

Substituir:
```typescript
  const supabase = await createClient()
  let query = supabase
    .from('lojas')
    .select('*')
    .order('id')
```
por:
```typescript
  const supabase = await createClient()
  const supabaseService = createServiceClient()
  let query = supabaseService
    .from('lojas')
    .select('*')
    .order('id')
```

A query de `permissoes` mais abaixo (`await supabase.from('permissoes')...`)
continua usando `supabase` (sessão) — não mude essa linha.

- [ ] **Step 3: Rodar `npx tsc --noEmit` no repo inteiro**

Esperado: sem erros novos.

- [ ] **Step 4: Commit**

```bash
git add "app/(app)/loja/page.tsx"
git commit -m "fix: usar service client pra listar lojas na tela admin (prep. REVOKE de RLS)"
```

- [ ] **Step 5: Deploy — as 3 correções de código precisam estar em produção ANTES da migration (Task 4)**

```bash
git push origin main
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "cd /opt/ntb-estoque && bash deploy.sh"
```

Aguardar terminar (síncrono, sem background). Depois confirmar:

```bash
curl -s -o /dev/null -w "HTTP %{http_code}\n" https://app-estoque.norteparanegocios.com.br/login
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "cd /opt/ntb-estoque && git log --oneline -1"
```

Esperado: `HTTP 200`, e o commit do Step 4 desta task aparecendo como o
mais recente no servidor. **Não prossiga pra Task 4 sem confirmar os
dois.**

---

## Task 4: Migration de contenção — revogar escrita em 34 tabelas + fechar leitura de segredos em `lojas`

**Files:**
- Create: `supabase/migrations/109_rls_contencao_fase0.sql`

**Interfaces:**
- Consumes: nenhuma (SQL puro).
- Produces: nenhuma interface de código — efeito é só em privilégios do
  Postgres. A Task 5 depende do arquivo criado aqui e do fato de ele já
  ter sido aplicado em produção antes de rodar a validação.

**Pré-requisito, confirme antes de escrever o SQL**: rode via SSH `\d
lojas` no Postgres de produção e confirme que a lista de colunas bate com
a lista abaixo (uma migration pode ter mudado o schema entre a escrita
deste plano e a execução desta task):

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec supabase-db psql -U supabase_admin -d postgres -c '\\d lojas'"
```

Colunas SENSÍVEIS de `lojas` (nunca devem ficar legíveis por
`anon`/`authenticated` depois desta migration) — exatamente estas 7,
nem uma a mais nem a menos:
`omie_app_key`, `omie_app_secret`, `integracao_api_key`,
`integracao_teste_api_key`, `csc_producao`, `csc_id_producao`,
`certificado_senha_enc`.

Se o `\d lojas` real mostrar alguma coluna nova desde a escrita deste
plano que pareça sensível (nome contendo `key`/`secret`/`senha`/`token`/
`csc`), pare e pergunte ao controller antes de prosseguir — não decida
sozinho se uma coluna nova é sensível ou não.

**Parte A — revogar escrita nas 34 tabelas sem RLS.** Estas 34 tabelas
hoje têm `INSERT`/`UPDATE`/`DELETE`/`TRUNCATE` liberados pra
`anon`/`authenticated` sem NENHUMA policy de RLS filtrando — uma anon key
pública consegue, por exemplo, `TRUNCATE lojas`, que apaga o sistema
inteiro via `ON DELETE CASCADE` (quase toda tabela do schema referencia
`lojas.id`). `SELECT` continua liberado nelas por enquanto (não é o
escopo desta Fase — ver spec, seção "Fora de escopo").

```sql
-- Contenção de RLS (Fase 0), 2026-08-12 — ver docs/superpowers/specs/
-- 2026-08-12-rls-contencao-fase0-design.md. Elimina o risco de
-- destruição em cascata: estas 34 tabelas tinham INSERT/UPDATE/DELETE/
-- TRUNCATE liberados pra anon/authenticated sem nenhuma policy de RLS.
-- service_role/postgres não são afetados (grants próprios, roles
-- separadas). SELECT continua liberado por enquanto -- RLS de linha
-- fica pra uma Fase 2 separada.

revoke insert, update, delete, truncate on arquivos_mortos from anon, authenticated;
revoke insert, update, delete, truncate on audit_log from anon, authenticated;
revoke insert, update, delete, truncate on categorias_contabeis from anon, authenticated;
revoke insert, update, delete, truncate on clientes from anon, authenticated;
revoke insert, update, delete, truncate on contas_correntes from anon, authenticated;
revoke insert, update, delete, truncate on contas_pagar from anon, authenticated;
revoke insert, update, delete, truncate on contas_receber from anon, authenticated;
revoke insert, update, delete, truncate on convites from anon, authenticated;
revoke insert, update, delete, truncate on familias from anon, authenticated;
revoke insert, update, delete, truncate on fornecedores from anon, authenticated;
revoke insert, update, delete, truncate on integration_attempts from anon, authenticated;
revoke insert, update, delete, truncate on inventario_items from anon, authenticated;
revoke insert, update, delete, truncate on inventarios from anon, authenticated;
revoke insert, update, delete, truncate on local_estoque_user from anon, authenticated;
revoke insert, update, delete, truncate on local_estoques from anon, authenticated;
revoke insert, update, delete, truncate on loja_user from anon, authenticated;
revoke insert, update, delete, truncate on lojas from anon, authenticated;
revoke insert, update, delete, truncate on movimentos from anon, authenticated;
revoke insert, update, delete, truncate on movimentos_historico from anon, authenticated;
revoke insert, update, delete, truncate on nota_fiscal_items from anon, authenticated;
revoke insert, update, delete, truncate on notas_fiscais from anon, authenticated;
revoke insert, update, delete, truncate on ordens_producao from anon, authenticated;
revoke insert, update, delete, truncate on ordens_producao_teste from anon, authenticated;
revoke insert, update, delete, truncate on outbox from anon, authenticated;
revoke insert, update, delete, truncate on permissao_user from anon, authenticated;
revoke insert, update, delete, truncate on permissoes from anon, authenticated;
revoke insert, update, delete, truncate on posicao_estoques from anon, authenticated;
revoke insert, update, delete, truncate on previsao_venda from anon, authenticated;
revoke insert, update, delete, truncate on produto_preco_recente from anon, authenticated;
revoke insert, update, delete, truncate on produto_substituicoes from anon, authenticated;
revoke insert, update, delete, truncate on produtos from anon, authenticated;
revoke insert, update, delete, truncate on profiles from anon, authenticated;
revoke insert, update, delete, truncate on transferencias from anon, authenticated;
revoke insert, update, delete, truncate on webhooks from anon, authenticated;
```

**Parte B — fechar leitura de segredos em `lojas`.** Revoga `SELECT` na
tabela inteira e concede de volta só nas colunas não sensíveis, montadas
dinamicamente a partir do schema real (assim uma coluna nova em `lojas`
no futuro entra automaticamente no grant permitido — só as 7 sensíveis
listadas explicitamente ficam de fora):

```sql
-- Parte B: lojas perde SELECT geral e ganha de volta só nas colunas nao
-- sensiveis. As 7 colunas abaixo (chaves/segredos) NUNCA aparecem nesta
-- lista -- se uma coluna nova for adicionada a lojas no futuro, ela cai
-- automaticamente no grant permitido (é dinâmico via information_schema),
-- entao qualquer coluna sensível nova precisa ser adicionada nesta lista
-- de exclusão em uma migration própria, não fica protegida por padrão.

revoke select on lojas from anon, authenticated;

do $$
declare
  colunas_permitidas text;
begin
  select string_agg(quote_ident(column_name), ', ')
  into colunas_permitidas
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'lojas'
    and column_name not in (
      'omie_app_key',
      'omie_app_secret',
      'integracao_api_key',
      'integracao_teste_api_key',
      'csc_producao',
      'csc_id_producao',
      'certificado_senha_enc'
    );

  execute format('grant select (%s) on lojas to anon, authenticated', colunas_permitidas);
end $$;
```

- [ ] **Step 1: Confirmar o schema real via SSH (pré-requisito acima)**

Rode o comando `\d lojas` mostrado acima. Compare as colunas retornadas
contra a lista de 7 sensíveis. Só prossiga se baterem (nenhuma sensível
nova sem estar na lista de exclusão).

- [ ] **Step 2: Escrever o arquivo completo**

Escreva `supabase/migrations/109_rls_contencao_fase0.sql` com a Parte A
seguida da Parte B, exatamente como os dois blocos SQL acima (cole os
dois blocos em sequência, um arquivo só).

- [ ] **Step 3: Aplicar em produção via SSH**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec -i supabase-db psql -U supabase_admin -d postgres" < supabase/migrations/109_rls_contencao_fase0.sql
```

Esperado: uma sequência de `REVOKE` (34 vezes) seguida de `REVOKE` +
`DO` (sem erro) para a Parte B. Se qualquer linha der erro, pare e
reporte — não continue aplicando o resto do arquivo manualmente linha a
linha sem entender o erro primeiro.

- [ ] **Step 4: Confirmar o grant dinâmico aplicado corretamente**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec supabase-db psql -U supabase_admin -d postgres -c \"select column_name from information_schema.column_privileges where table_name='lojas' and grantee='authenticated' and privilege_type='SELECT' order by column_name\""
```

Esperado: a lista de colunas retornada NÃO deve conter nenhuma das 7
sensíveis (`omie_app_key`, `omie_app_secret`, `integracao_api_key`,
`integracao_teste_api_key`, `csc_producao`, `csc_id_producao`,
`certificado_senha_enc`), e deve conter as demais (ex.: `nome`, `cnpj`,
`ativo`).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/109_rls_contencao_fase0.sql
git commit -m "fix: revoga escrita anon/authenticated em 34 tabelas sem RLS + fecha leitura de segredos em lojas"
```

(A migration em si já foi aplicada no Step 3 — o commit é só pra manter
o arquivo versionado, mesmo padrão das migrations anteriores deste repo.)

---

## Task 5: Validação em produção com a anon key pública + fluxos reais

**Files:**
- Nenhum arquivo novo/modificado — task de validação pura.

**Interfaces:**
- Consumes: a migration aplicada na Task 4, as 3 correções de código já
  em produção desde a Task 3.

**Pré-requisito**: pegar a `NEXT_PUBLIC_SUPABASE_ANON_KEY` real de
produção — está em `.env.local` do repo, ou pode ser lida do servidor
(`ssh ... "cat /opt/ntb-estoque/.env.local | grep ANON_KEY"`). Nunca
imprima essa chave inteira em nenhum log/relatório — ela é pública por
natureza (é a mesma que já está embutida no bundle do app), mas ainda
assim trate com o mesmo cuidado do resto deste plano: use direto dentro
de comandos, não a cole solta em texto.

A forma mais simples de simular exatamente o que a anon key pública
consegue fazer é rodar SQL como o role `anon` direto no Postgres, via
SSH — isso testa a mesma política de grants que o PostgREST aplicaria,
sem precisar descobrir a URL pública do PostgREST nem montar requisições
HTTP:

- [ ] **Step 1: Confirmar que colunas sensíveis de `lojas` NÃO são mais legíveis pelo role `anon`**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec supabase-db psql -U supabase_admin -d postgres -c \"set role anon; select omie_app_key from lojas limit 1;\""
```

Esperado: erro `permission denied for column omie_app_key` (ou
equivalente — a mensagem exata do Postgres pra coluna sem grant).
Repita trocando `omie_app_key` por cada uma das outras 6 colunas
sensíveis (`omie_app_secret`, `integracao_api_key`,
`integracao_teste_api_key`, `csc_producao`, `csc_id_producao`,
`certificado_senha_enc`) — as 7 devem falhar.

- [ ] **Step 2: Confirmar que colunas não sensíveis de `lojas` continuam legíveis**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec supabase-db psql -U supabase_admin -d postgres -c \"set role anon; select nome, cnpj, ativo from lojas limit 3;\""
```

Esperado: retorna as 3 linhas normalmente, sem erro.

- [ ] **Step 3: Confirmar que escrita nas 34 tabelas falha pro role `anon`**

Teste em pelo menos 3 tabelas representativas das 34 (uma com dado
financeiro, uma de sistema/log, e `lojas` — a mais crítica):

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec supabase-db psql -U supabase_admin -d postgres -c \"set role anon; delete from contas_pagar where id = -1;\""
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec supabase-db psql -U supabase_admin -d postgres -c \"set role anon; truncate webhooks;\""
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec supabase-db psql -U supabase_admin -d postgres -c \"set role anon; truncate lojas;\""
```

Esperado: as 3 devem falhar com `permission denied for table <nome>`.
**Se qualquer uma dessas 3 passar (não der erro), pare imediatamente e
reporte — significa que a migration não foi aplicada corretamente ou
uma role diferente de `anon` está sendo usada.**

- [ ] **Step 4: Confirmar que `service_role` continua com acesso total (não foi afetado)**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec supabase-db psql -U supabase_admin -d postgres -c \"set role service_role; select omie_app_key from lojas limit 1;\""
```

Esperado: retorna normalmente (sem erro) — confirma que o `REVOKE` não
afetou `service_role`, então todo o código do app que usa
`createServiceClient()` continua funcionando.

- [ ] **Step 5: Validar os 3 fluxos reais afetados pelas Tasks 1-3**

Login em produção (`https://app-estoque.norteparanegocios.com.br`) com
uma conta de teste/QA já existente (ver `AGENTS.md`, seção sobre a conta
`claude.qa@ntb-estoque.dev`, se disponível — ou pedir ao controller uma
conta pra usar):

1. Trocar de loja no seletor (topo do app) — confirma que
   `setCurrentLoja` (Task 1) continua funcionando.
2. Ir em Movimentações, filtrar por um local + produto único que gere
   saldo inicial/final calculado — confirma que a leitura de
   `omie_app_key`/`omie_app_secret` (Task 2) continua funcionando.
3. Ir em `/loja` (tela admin, precisa de conta com perfil Admin) — a
   lista de lojas deve aparecer normalmente, confirma que a query
   `select('*')` via service client (Task 3) continua funcionando.

Se não houver acesso a navegador nesta sessão, documente isso
explicitamente no relatório final e ofereça ao controller confirmar
manualmente — não declare esses 3 fluxos como testados sem tê-los visto
funcionar de verdade.

- [ ] **Step 6: Relatório final**

Resuma no relatório: resultado de cada step acima (passou/falhou), e se
algum dos 3 fluxos do Step 5 não pôde ser testado por falta de acesso a
navegador.

---

## Execução

Todas as 5 tasks neste único repo, mesma sessão — oferecer execução via
`superpowers:subagent-driven-development`.
