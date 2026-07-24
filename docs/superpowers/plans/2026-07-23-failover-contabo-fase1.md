# Failover Supabase → Contabo — Fase 1 (Réplica Contínua + Stack Self-Hosted) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer o servidor Contabo rodar uma cópia self-hosted completa e funcional do Supabase (Postgres + Auth + REST), continuamente atualizada a partir do projeto real via replicação lógica nativa do Postgres, e comprovar que dá pra apontar o app manualmente pra ela (login + leitura + escrita funcionando) — sem nenhuma troca automática ainda (isso é Fase 2/3, planos futuros).

**Architecture:** Usa replicação lógica nativa do Postgres (`CREATE PUBLICATION`/`CREATE SUBSCRIPTION`) em vez de duplicar escritas manualmente em cada rota do app — o Postgres cuida da consistência e da ordem sozinho, sem precisar tocar em nenhum código de escrita já existente. O stack self-hosted oficial do Supabase (Docker Compose, mesmo software open-source que a Supabase Cloud roda) fornece Postgres+Auth(GoTrue)+REST(PostgREST), alimentado por essa replicação. O schema `auth` (login) usa uma sincronização periódica separada (script + cron), não replicação nativa, porque acoplar a replicação lógica na estrutura interna do GoTrue é frágil demais pra confiar sem teste extensivo — ver Global Constraints.

**Tech Stack:** Postgres logical replication (`pg_publication`/`pg_subscription`), Docker + Docker Compose, stack oficial `github.com/supabase/supabase/docker`, `psql`/`node-postgres` (já usado no projeto).

> **Resultado real da execução (2026-07-24):** as tarefas abaixo mencionam
> "43 tabelas" como meta original — o resultado final ficou em **40 de 43**.
> 3 tabelas de configuração estática (`cargos`, `permissoes`,
> `cargo_permissao`) foram excluídas da replicação ao vivo após um
> travamento determinístico e reproduzível do motor de replicação lógica
> especificamente nessas 3 tabelas pequenas (causa exata não identificada,
> mas descartada a hipótese de limite de recurso transitório — ver
> `.superpowers/sdd/failover-task-5-report.md`). Aceitável: são dados
> estáticos, já corretos no Contabo via seed das migrations.

## Global Constraints

- **Réplica lógica exige conexão DIRETA ao Postgres do Supabase (não o pooler)** — confirmado na documentação oficial. O hostname direto (`db.<ref>.supabase.co`) só resolve em IPv6; já confirmado que o Contabo tem IPv6 configurado e consegue resolver/alcançar esse host (`getent ahosts db.waubqgkftwrufepwhctc.supabase.co` retornou um IPv6 válido). Não usar o pooler (`aws-1-sa-east-1.pooler.supabase.com`) pra nenhum comando deste plano que envolva `CREATE PUBLICATION`/`CREATE SUBSCRIPTION`.
- **Schema `auth` NÃO usa replicação lógica nativa neste plano.** GoTrue (o serviço de Auth) é dono do schema `auth` e roda suas próprias migrations internas ao subir — se a réplica lógica tentar escrever linhas com uma estrutura de tabela que não bate exatamente com o que aquela versão específica do GoTrue criou, a subscription quebra. Em vez disso, uma tarefa própria (Task 6) cria um script de sincronização periódica que lê `auth.users`/`auth.identities` do Supabase real (via service role) e faz upsert no Postgres do stack self-hosted, casando por email — mais simples e mais tolerante a pequenas diferenças de schema entre versões.
- **Nada neste plano aponta a produção real pro Contabo.** Toda validação (Task 7) usa um ambiente de teste isolado (variáveis de ambiente trocadas só numa sessão de teste local/dev, nunca no `.env.local` de produção nem no Vercel). Trocar a produção de verdade é escopo da Fase 2 (troca automática), não desta fase.
- **Sem framework de testes automatizado no projeto.** "Teste" nos passos abaixo significa: comando exato + saída esperada, e uma verificação funcional real (login/leitura/escrita) via `curl`/Playwright contra o stack self-hosted, não testes unitários.
- Servidor Contabo já confirmado com espaço de sobra (192GB disco, 13% usado; 43% de memória usada) — não deve faltar recurso pra rodar mais esse stack junto com o que já roda lá (`ntb-estoque.service`, `ntb-frio-api`, Postgres do `ntb_frio`).
- O stack self-hosted deste plano é um Postgres/Docker **separado** do banco `ntb_frio` já existente (que serve outro propósito — mirror read-only histórico parcial). Não misturar os dois.

---

### Task 1: Instalar Docker no Contabo

**Files:** nenhum arquivo do repo — só provisionamento de servidor.

**Interfaces:**
- Produces: `docker`/`docker compose` disponíveis no servidor Contabo — Task 3 depende disso.

- [ ] **Step 1: Instalar o Docker Engine oficial (Ubuntu 24.04, já confirmado como o OS do servidor)**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "curl -fsSL https://get.docker.com | sh"
```

- [ ] **Step 2: Confirmar instalação**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker --version && docker compose version"
```
Expected: ambos os comandos retornam uma versão (ex.: `Docker version 27.x.x`, `Docker Compose version v2.x.x`), sem erro `command not found`.

- [ ] **Step 3: Confirmar que o Docker não conflita com os serviços já rodando**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "systemctl is-active ntb-estoque ntb-frio-api docker"
```
Expected: `active`, `active`, `active` — os serviços existentes continuam de pé depois de instalar o Docker.

---

### Task 2: Preparar a publicação de replicação lógica no Supabase real

**Files:** nenhum arquivo do repo — SQL rodado direto contra o banco Supabase real, via conexão DIRETA.

**Interfaces:**
- Produces: publicação `ntb_estoque_pub` + replication slot `ntb_estoque_slot` no Supabase — Task 5 (criação da subscription) depende exatamente desses dois nomes.

- [ ] **Step 1: Conectar direto (não pooler) e criar a publicação + slot**

Usar o host direto (`db.waubqgkftwrufepwhctc.supabase.co`, porta 5432, mesmo usuário/senha de `SUPABASE_DB_URL` em `.env.local`, sem passar por `aws-1-sa-east-1.pooler.supabase.com`):

```bash
cd "/Users/joaquimsalles/Projects/norte para negocios/ntb estoque/.claude/worktrees/auditoria-relatorios"
PGPASSWORD="$SUPABASE_DB_PASSWORD" psql "host=db.waubqgkftwrufepwhctc.supabase.co port=5432 dbname=postgres user=postgres sslmode=require" -c "
CREATE PUBLICATION ntb_estoque_pub FOR ALL TABLES;
SELECT pg_create_logical_replication_slot('ntb_estoque_slot', 'pgoutput');
"
```
Expected: `CREATE PUBLICATION` seguido de uma linha com `slot_name | lsn` mostrando `ntb_estoque_slot` e um LSN (ex.: `0/1A2B3C4`).

- [ ] **Step 2: Confirmar que a publicação cobre as 43 tabelas do schema `public`**

```bash
PGPASSWORD="$SUPABASE_DB_PASSWORD" psql "host=db.waubqgkftwrufepwhctc.supabase.co port=5432 dbname=postgres user=postgres sslmode=require" -c "
SELECT count(*) FROM pg_publication_tables WHERE pubname='ntb_estoque_pub';
"
```
Expected: `43` (mesma contagem confirmada hoje via `pg_stat_user_tables`).

---

### Task 3: Provisionar o stack self-hosted oficial do Supabase no Contabo

**Files:** nenhum arquivo do repo — provisionamento em `/opt/ntb-estoque-standby/` no servidor Contabo (novo diretório, separado de `/opt/ntb-estoque` e `/opt/ntb-frio-api`).

**Interfaces:**
- Produces: Postgres do stack self-hosted escutando numa porta dedicada (ex.: `54322`, pra não colidir com o Postgres do `ntb_frio` nem com nada já usado) — Task 4 e Task 5 dependem dessa porta.

- [ ] **Step 1: Clonar a config oficial do Supabase self-hosted**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "
mkdir -p /opt/ntb-estoque-standby
cd /tmp && git clone --depth 1 https://github.com/supabase/supabase
cp -rf supabase/docker/* /opt/ntb-estoque-standby/
cp supabase/docker/.env.example /opt/ntb-estoque-standby/.env
"
```

- [ ] **Step 2: Gerar as chaves/segredos (JWT_SECRET, ANON_KEY, SERVICE_ROLE_KEY, senhas)**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "
cd /opt/ntb-estoque-standby
bash utils/generate-keys.sh 2>&1 || echo 'AVISO: se o script nao existir nesta versao, gerar manualmente com openssl e documentar no relatorio da tarefa'
"
```

Se o script `utils/generate-keys.sh` não existir nesta versão do clone (a estrutura muda entre releases), gerar manualmente:

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "
openssl rand -base64 32   # usar como JWT_SECRET no .env
openssl rand -base64 32   # usar como POSTGRES_PASSWORD no .env
"
```

- [ ] **Step 2b: Editar `/opt/ntb-estoque-standby/.env` com as portas dedicadas (não colidir com o que já roda no servidor)**

Confirmar/ajustar estas variáveis no `.env` gerado (usar `sed` ou editar direto via SSH+heredoc):
- `POSTGRES_PORT=54322` (Postgres do stack self-hosted, dedicado, não é o `ntb_frio`)
- `KONG_HTTP_PORT=8100` / `KONG_HTTPS_PORT=8143` (a API do stack — Kong é o gateway que expõe Auth+REST)
- `POSTGRES_PASSWORD`, `JWT_SECRET`, `ANON_KEY`, `SERVICE_ROLE_KEY` — os gerados no Step 2.

- [ ] **Step 3: Subir o stack**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "
cd /opt/ntb-estoque-standby
docker compose up -d
"
```

- [ ] **Step 4: Confirmar que todos os containers subiram saudáveis**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "cd /opt/ntb-estoque-standby && docker compose ps"
```
Expected: todos os serviços (`db`, `auth`, `rest`, `kong`, etc.) com status `Up` ou `running` (healthy), nenhum em `Restarting`/`Exited`.

---

### Task 4: Aplicar as migrations do projeto no Postgres do stack self-hosted

**Files:**
- Consome (leitura, sem modificar): `supabase/migrations/*.sql` (87 arquivos já existentes no repo).

**Interfaces:**
- Consumes: os 87 arquivos de migration já existentes no repo, aplicados NA ORDEM (nome do arquivo já é prefixado com número, ex.: `001_...sql`, `002_...sql`).
- Produces: a mesma estrutura de tabelas (schema, sem dado) do Supabase real, dentro do Postgres do stack self-hosted — Task 5 (subscription) depende de as tabelas já existirem, já que replicação lógica só copia LINHAS pra tabelas que já existem, não cria a estrutura.

- [ ] **Step 1: Copiar os arquivos de migration pro servidor**

```bash
cd "/Users/joaquimsalles/Projects/norte para negocios/ntb estoque/.claude/worktrees/auditoria-relatorios"
scp -i ~/.ssh/notebook_contabo_key supabase/migrations/*.sql root@185.193.66.240:/opt/ntb-estoque-standby/migrations-temp/
```

- [ ] **Step 2: Aplicar cada migration em ordem, contra o Postgres do stack self-hosted (porta 54322, dentro do próprio servidor via `docker compose exec` ou `psql` direto na porta publicada)**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 '
cd /opt/ntb-estoque-standby
for f in $(ls migrations-temp/*.sql | sort); do
  echo "=== aplicando $f ==="
  PGPASSWORD="$(grep POSTGRES_PASSWORD .env | cut -d= -f2)" psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -f "$f" 2>&1 | tail -5
done
'
```

- [ ] **Step 3: Investigar e corrigir qualquer migration que falhar**

Migrations projetadas originalmente pra rodar via ferramentas do Supabase podem referenciar algo específico do ambiente gerenciado deles que não existe de imediato no self-hosted (ex.: uma extensão não habilitada por padrão, uma função auxiliar do painel deles). Se alguma migration falhar:
1. Ler o erro exato.
2. Se for uma extensão faltando (`CREATE EXTENSION IF NOT EXISTS ...`), habilitar via `ALTER SYSTEM`/rodar a criação da extensão manualmente antes de re-tentar essa migration específica.
3. Documentar no relatório da tarefa QUALQUER migration que precisou de ajuste manual e por quê — não pular uma migration silenciosamente.

- [ ] **Step 4: Confirmar que as 43 tabelas existem, vazias, no Postgres do stack self-hosted**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 '
PGPASSWORD="$(grep POSTGRES_PASSWORD /opt/ntb-estoque-standby/.env | cut -d= -f2)" psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -c "
select count(*) from information_schema.tables where table_schema='"'"'public'"'"';
"
'
```
Expected: `43`.

---

### Task 5: Criar a subscription (puxa o snapshot inicial + mantém ao vivo)

**Files:** nenhum arquivo do repo — SQL rodado contra o Postgres do stack self-hosted.

**Interfaces:**
- Consumes: publicação `ntb_estoque_pub` + slot `ntb_estoque_slot` (Task 2), tabelas já criadas (Task 4).
- Produces: dado real, ao vivo e continuamente atualizado, nas 43 tabelas do Postgres do stack self-hosted — Task 7 (validação) depende disso.

- [ ] **Step 1: Criar a subscription, puxando o Supabase real via conexão DIRETA (mesmo motivo da Task 2 — pooler não funciona pra replicação lógica)**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 '
PGPASSWORD="$(grep POSTGRES_PASSWORD /opt/ntb-estoque-standby/.env | cut -d= -f2)" psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -c "
CREATE SUBSCRIPTION ntb_estoque_sub
CONNECTION '"'"'host=db.waubqgkftwrufepwhctc.supabase.co port=5432 dbname=postgres user=postgres password=$SUPABASE_DB_PASSWORD sslmode=require'"'"'
PUBLICATION ntb_estoque_pub
WITH (copy_data = true, create_slot = false, slot_name = ntb_estoque_slot);
"
'
```

- [ ] **Step 2: Aguardar a cópia inicial completar e confirmar contagem de linhas batendo com o Supabase real**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 '
PGPASSWORD="$(grep POSTGRES_PASSWORD /opt/ntb-estoque-standby/.env | cut -d= -f2)" psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -c "
select count(*) from produtos;
select count(*) from ordens_producao;
select count(*) from lojas;
"
'
```
Comparar cada número com a contagem real de hoje no Supabase (`produtos`=13606, `ordens_producao`=327027, `lojas`=6 — via `node scripts/db.mjs "select count(*) from produtos"` etc., já que o número pode ter mudado ligeiramente entre agora e quando a Task 4 rodou os testes de hoje). Diferença esperada: zero, ou muito pequena (poucas linhas, se algo foi escrito no meio tempo — a subscription está viva, não é um snapshot congelado).

- [ ] **Step 3: Confirmar que a subscription continua recebendo mudanças ao vivo**

Fazer uma escrita pequena e inofensiva no Supabase real (ex.: um `update` num registro de teste que não afete produção, ou simplesmente observar `updated_at` de um registro real avançar naturalmente por uso normal do sistema), e confirmar que aparece no Postgres do stack self-hosted em poucos segundos:

```bash
node scripts/db.mjs "select id, updated_at from lojas order by updated_at desc limit 1"
```
Depois, no Contabo:
```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 '
PGPASSWORD="$(grep POSTGRES_PASSWORD /opt/ntb-estoque-standby/.env | cut -d= -f2)" psql -h 127.0.0.1 -p 54322 -U postgres -d postgres -c "select id, updated_at from lojas order by updated_at desc limit 1"
'
```
Expected: mesmo `id`/`updated_at` nos dois lados (ou muito próximo, considerando o pequeno atraso natural de replicação).

---

### Task 6: Script de sincronização periódica do schema `auth`

**Files:**
- Create: `scripts/sync-auth-standby.mjs`

**Interfaces:**
- Consumes: `createServiceClient` — na verdade, este script roda fora do Next.js (script standalone Node, como os outros `scripts/*.mjs` do projeto), então usa `@supabase/supabase-js` diretamente com a service role key, igual ao padrão de outros scripts existentes.
- Produces: linhas em `auth.users`/`auth.identities` no Postgres do stack self-hosted, mantidas em sincronia periódica (não em tempo real) com o Supabase real.

- [ ] **Step 1: Escrever o script**

```javascript
// scripts/sync-auth-standby.mjs
// Sincroniza auth.users/auth.identities do Supabase real pro Postgres do
// stack self-hosted no Contabo -- NAO usa replicacao logica nativa pro
// schema auth (GoTrue e dono desse schema e roda suas proprias migrations,
// acoplar replicacao logica na estrutura interna dele e fragil). Rodar
// periodicamente via cron (Task 7 documenta a frequencia recomendada).
import fs from 'node:fs'
import pg from 'pg'
import { createClient } from '@supabase/supabase-js'

const PROJ = process.cwd()
const env = {}
for (const line of fs.readFileSync(`${PROJ}/.env.local`, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)

// Conexao direta com o Postgres do stack self-hosted (porta dedicada da Task 3).
const standbyClient = new pg.Client({
  host: process.env.STANDBY_HOST || '127.0.0.1',
  port: Number(process.env.STANDBY_PORT || 54322),
  user: 'postgres',
  password: process.env.STANDBY_PG_PASSWORD,
  database: 'postgres',
})

async function main() {
  const { data, error } = await supabase.auth.admin.listUsers({ perPage: 1000 })
  if (error) throw error

  await standbyClient.connect()
  let sincronizados = 0
  for (const u of data.users) {
    await standbyClient.query(
      `insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_user_meta_data)
       values ($1, $2, $3, $4, $5, $6, $7)
       on conflict (id) do update set
         email = excluded.email,
         encrypted_password = excluded.encrypted_password,
         email_confirmed_at = excluded.email_confirmed_at,
         updated_at = excluded.updated_at,
         raw_user_meta_data = excluded.raw_user_meta_data`,
      [u.id, u.email, u.encrypted_password, u.email_confirmed_at, u.created_at, u.updated_at, u.user_metadata]
    )
    sincronizados++
  }
  await standbyClient.end()
  console.log(`OK: ${sincronizados} usuarios sincronizados`)
}

main().catch((e) => {
  console.error('ERRO na sincronizacao de auth:', e)
  process.exit(1)
})
```

- [ ] **Step 2: Rodar manualmente uma vez e confirmar**

```bash
cd "/Users/joaquimsalles/Projects/norte para negocios/ntb estoque/.claude/worktrees/auditoria-relatorios"
STANDBY_HOST=185.193.66.240 STANDBY_PORT=54322 STANDBY_PG_PASSWORD="<senha do .env do stack, Task 3 Step 2>" node scripts/sync-auth-standby.mjs
```
Expected: `OK: N usuarios sincronizados` (N deve bater com o número real de usuários — hoje visto como 12 em `profiles`, mas `auth.users` pode ter um número um pouco diferente se houver contas nunca vinculadas a um profile).

- [ ] **Step 3: Commit**

```bash
git add scripts/sync-auth-standby.mjs
git commit -m "feat: script de sincronizacao periodica de auth.users para o stack self-hosted do Contabo"
```

---

### Task 7: Validação end-to-end manual (ambiente de teste, não produção)

**Files:** nenhum arquivo do repo modificado permanentemente — só variáveis de ambiente locais, temporárias, numa sessão de teste.

**Interfaces:** nenhuma nova.

- [ ] **Step 1: Rodar o app localmente apontado pro stack self-hosted (NUNCA no `.env.local` de produção nem no Vercel)**

Criar um arquivo `.env.test-standby` temporário (não commitado, `.gitignore` já cobre `.env*` variantes — confirmar isso antes) com:
```
NEXT_PUBLIC_SUPABASE_URL=http://185.193.66.240:8100
NEXT_PUBLIC_SUPABASE_ANON_KEY=<ANON_KEY gerado na Task 3 Step 2>
SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY gerado na Task 3 Step 2>
```

```bash
cd "/Users/joaquimsalles/Projects/norte para negocios/ntb estoque/.claude/worktrees/auditoria-relatorios"
cp .env.local /tmp/.env.local.backup-antes-do-teste
cp .env.test-standby .env.local
npm run dev
```

- [ ] **Step 2: Testar login com o usuário de QA (que já foi sincronizado na Task 6)**

Via Playwright ou `curl` direto no Kong (porta 8100) do stack self-hosted, tentar login com `claude.qa@ntb-estoque.dev`/`claudeqa123456`. Expected: login bem-sucedido, sessão válida.

- [ ] **Step 3: Testar leitura (ex.: abrir `/produto`, confirmar que os 13606 produtos aparecem)**

- [ ] **Step 4: Testar escrita (ex.: criar um produto de teste, ou editar um campo simples)**

Confirmar que a escrita funciona no stack self-hosted (sem erro de RLS, sem erro de permissão).

- [ ] **Step 5: Restaurar o ambiente local pro normal**

```bash
cp /tmp/.env.local.backup-antes-do-teste .env.local
rm .env.test-standby /tmp/.env.local.backup-antes-do-teste
```
Confirmar via `git status` que `.env.local` não aparece como modificado (já é gitignored, mas confirmar que voltou ao conteúdo original mesmo assim).

- [ ] **Step 6: Documentar o resultado**

Escrever um resumo (achados, qualquer migration que precisou de ajuste manual na Task 4, qualquer comportamento diferente do esperado) — este é o critério de "Fase 1 pronta" que a spec exige antes de prosseguir pra Fase 2 (detecção automática de queda).
