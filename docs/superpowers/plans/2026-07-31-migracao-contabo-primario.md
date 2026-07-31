# Migração: Contabo vira o banco principal — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans ou
> superpowers:subagent-driven-development para executar este plano
> task-by-task.

**Goal:** Promover o stack self-hosted já rodando no Contabo (Docker
Compose, mesmo software do Supabase Cloud) a único banco do NTB Estoque,
aposentando o Supabase cloud, sem perder nenhum dado (linhas, arquivos de
Storage, logins).

**Architecture:** Ver
`docs/superpowers/specs/2026-07-31-migracao-contabo-primario-design.md`
(spec aprovada). Resumo: réplica lógica já cobre 41/44 tabelas do schema
`public`; falta fechar 3 gaps de completude (3 tabelas excluídas da
réplica, arquivos de Storage, backup automático) antes do corte; o corte
em si troca só as env vars que `lib/supabase/server.ts` usa; o código de
failover é removido depois, não durante.

**Tech Stack:** Postgres logical replication (já existente), Docker
Compose (stack já existente em `/opt/ntb-estoque-standby/`),
`@supabase/supabase-js` (cópia de Storage), `pg_dump` (backup), Node
scripts (mesmo padrão de `scripts/*.mjs` já usado no projeto).

---

## Global Constraints

- **Sem framework de teste automatizado no projeto** (mesma constraint já
  registrada no plano de failover original). "Teste" abaixo significa:
  comando exato + saída esperada + verificação funcional real, não teste
  unitário.
- **Réplica lógica exige conexão DIRETA ao Postgres do Supabase** (não o
  pooler) — mesma constraint do plano original de failover. Comandos que
  envolvem `pg_subscription`/`pg_publication` usam
  `host=db.waubqgkftwrufepwhctc.supabase.co`; leituras simples de
  catálogo (contagem, `pg_publication_tables`) podem usar
  `scripts/db.mjs` (via pooler).
- **Tasks 1-4 são seguras para executar sem afetar produção** — só leem/
  copiam dado, não trocam o banco que o app usa. **Tasks 5 e 6 exigem
  confirmação explícita do usuário no momento da execução**, não just a
  aprovação deste plano: Task 5 é o corte de verdade (janela de
  manutenção, produção real das 6 lojas) e Task 6 remove o código que
  permite reverter rápido — nenhuma das duas deve ser disparada
  automaticamente por um executor de plano sem check-in humano antes de
  cada uma.
- **Task 6 só deve rodar depois de um período de estabilidade observada
  pós-corte** (o usuário já decidiu: alguns dias com o Supabase cloud
  pausado como rede de segurança) — não na mesma sessão do corte.
- Servidor Contabo: 6 vCPU, 11GB RAM, 156GB disco livre (confirmado
  2026-07-31) — sem necessidade de provisionar mais recurso.
- Todas as credenciais (senhas, chaves) já existem em `.env.local` (local),
  `/opt/ntb-estoque/.env.local` (servidor) ou `/opt/ntb-estoque-standby/.env`
  (stack self-hosted) — nenhuma credencial nova precisa ser gerada.

---

### Task 1: Script de completude — contagem de linhas das 41 tabelas replicadas

**Files:**
- Create: `scripts/verificar-completude-contabo.mjs`

**Interfaces:**
- Consumes: `SUPABASE_DB_URL` (`.env.local`, mesmo padrão de
  `scripts/db.mjs`) para o lado Supabase; conexão direta `pg` pro Postgres
  do Contabo (`STANDBY_HOST`/`STANDBY_PORT`/senha, mesmo padrão de
  `scripts/sync-auth-standby.mjs`).
- Produces: relatório no terminal, tabela por tabela, com contagem dos
  dois lados e ✅/❌ — usado manualmente antes do corte (Task 5) e no
  checklist de completude da spec.

**Step 1: Escrever o script**

```javascript
// scripts/verificar-completude-contabo.mjs
// Compara contagem de linhas Supabase (real) vs Contabo (self-hosted) pra
// todas as tabelas do schema public cobertas pela replicacao logica
// (ntb_estoque_pub). Uso: node scripts/verificar-completude-contabo.mjs
import fs from 'node:fs'
import pg from 'pg'

const PROJ = process.cwd()
const env = {}
for (const line of fs.readFileSync(`${PROJ}/.env.local`, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}

const cloud = new pg.Client({ connectionString: env.SUPABASE_DB_URL })
const standby = new pg.Client({
  host: process.env.STANDBY_HOST || '127.0.0.1',
  port: Number(process.env.STANDBY_PORT || 54322),
  user: 'postgres',
  password: process.env.STANDBY_PG_PASSWORD,
  database: 'postgres',
})

async function main() {
  await cloud.connect()
  await standby.connect()

  const { rows: tabelas } = await cloud.query(`
    select tablename from pg_publication_tables
    where pubname = 'ntb_estoque_pub' order by tablename
  `)

  let algumaDivergencia = false
  for (const { tablename } of tabelas) {
    const [c, s] = await Promise.all([
      cloud.query(`select count(*)::bigint as n from "${tablename}"`),
      standby.query(`select count(*)::bigint as n from "${tablename}"`),
    ])
    const nCloud = c.rows[0].n
    const nStandby = s.rows[0].n
    const ok = nCloud === nStandby
    if (!ok) algumaDivergencia = true
    console.log(`${ok ? '✅' : '❌'} ${tablename}: cloud=${nCloud} contabo=${nStandby}`)
  }

  await cloud.end()
  await standby.end()
  process.exit(algumaDivergencia ? 1 : 0)
}

main().catch((e) => { console.error(e); process.exit(1) })
```

**Step 2: Rodar contra o servidor**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 '
cd /opt/ntb-estoque
STANDBY_PG_PASSWORD="$(grep POSTGRES_PASSWORD /opt/ntb-estoque-standby/.env | cut -d= -f2)" \
  node scripts/verificar-completude-contabo.mjs
'
```

Expected: 41 linhas, todas ✅. Se alguma vier ❌, **não prosseguir pro
corte (Task 5)** até investigar a divergência (rodar de novo depois de
alguns segundos primeiro — pode ser só atraso natural de replicação; se
persistir divergente, é bug real).

**Step 3: Commit**

```bash
cd "/Users/joaquimsalles/Projects/norte para negocios/ntb estoque"
git add scripts/verificar-completude-contabo.mjs
git commit -m "feat: script de verificação de completude da réplica Contabo"
```

---

### Task 2: Completude das 3 tabelas excluídas da réplica + confirmação de RLS

**Files:** nenhum arquivo novo — comandos ad-hoc + checklist manual.

**Interfaces:**
- Consumes: `scripts/db.mjs` (já existe) pro lado Supabase; `docker exec
  supabase-db psql` pro lado Contabo.

**Step 1: Comparar contagem de `cargos`, `permissoes`, `cargo_permissao`
(não cobertas pela réplica — Task 1 não as vê)**

```bash
cd "/Users/joaquimsalles/Projects/norte para negocios/ntb estoque"
node scripts/db.mjs "select 'cargos' t, count(*) from cargos union all select 'permissoes', count(*) from permissoes union all select 'cargo_permissao', count(*) from cargo_permissao"
```

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec supabase-db psql -U postgres -d postgres -c \"select 'cargos' t, count(*) from cargos union all select 'permissoes', count(*) from permissoes union all select 'cargo_permissao', count(*) from cargo_permissao\""
```

Expected: os 3 números batem exatos nos dois comandos. **Se não baterem**:
essas tabelas só mudam por migration nova aplicada nos dois bancos — rodar
`supabase/migrations/*.sql` pendentes manualmente no Contabo até bater
(não tentar religar a replicação lógica pra elas — travamento documentado
e conhecido, ver spec).

**Step 2: Confirmar as 12 políticas RLS presentes no Contabo**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec supabase-db psql -U postgres -d postgres -c \"select tablename, policyname from pg_policies where schemaname='public' order by tablename\""
```

Expected: 12 linhas, cobrindo `impressao_etiquetas`, `etiqueta_config`,
`faturamento_importado`, `faturamento_import_meta`,
`movimentacao_importada`, `movimentacao_import_meta`, `margem_importada`,
`margem_import_meta`, `movimentacao_operacao`,
`movimentacao_operacao_meta`, `cargos`, `cargo_permissao` (mesma lista
confirmada no Supabase real via `grep create policy supabase/migrations/`).
Se alguma faltar: as migrations que criaram essas policies já deveriam ter
sido replicadas via DDL nativo do Postgres (replicação lógica replica DML,
não DDL — **as policies NÃO vêm pela réplica**, precisam ter sido
aplicadas via `supabase/migrations/*.sql` direto no Contabo quando o stack
foi provisionado). Se faltar alguma, rodar a migration correspondente
direto no Contabo.

---

### Task 3: Copiar arquivos de Storage (bytes) — `arquivo-morto` e `certificados`

**Files:**
- Create: `scripts/copiar-storage-contabo.mjs`

**Interfaces:**
- Consumes: `NEXT_PUBLIC_SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY`
  (`.env.local`, lado cloud) e `FAILOVER_STANDBY_ANON_KEY`/
  `FAILOVER_STANDBY_SERVICE_ROLE_KEY` (já existem em
  `/opt/ntb-estoque/.env.local`, apontam pro stack self-hosted em
  `http://127.0.0.1:8100`).
- Produces: bytes reais dos 2 buckets copiados pro volume de Storage do
  Contabo (hoje praticamente vazio — achado crítico da spec).

**Contexto real (confirmado 2026-07-31):** `arquivo-morto` tem 12 arquivos
reais (~6,5MB) que seriam perdidos sem esta task. `certificados` está
vazio hoje (nenhuma loja fez upload ainda) — a task ainda precisa rodar
pra validar que o mecanismo funciona no self-hosted, mas não há arquivo
real em risco nesse bucket agora.

**Step 1: Escrever o script (usa a SDK, não mexe no filesystem do
container diretamente — mais seguro que replicar a estrutura de pastas
interna do storage-api na mão)**

```javascript
// scripts/copiar-storage-contabo.mjs
// Copia os arquivos reais (bytes) dos buckets do Supabase Storage real
// pro Storage self-hosted do Contabo -- a replicacao logica so cobre
// metadado (storage.objects), nao os bytes. Uso:
// node scripts/copiar-storage-contabo.mjs
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const PROJ = process.cwd()
const env = {}
for (const line of fs.readFileSync(`${PROJ}/.env.local`, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}

const origem = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY)
const destino = createClient('http://127.0.0.1:8100', env.FAILOVER_STANDBY_SERVICE_ROLE_KEY)

const BUCKETS = ['arquivo-morto', 'certificados']

async function copiarBucket(bucket) {
  const { data: arquivos, error } = await origem.storage.from(bucket).list('', { limit: 1000 })
  if (error) throw new Error(`listar ${bucket}: ${error.message}`)

  let copiados = 0
  for (const arquivo of arquivos ?? []) {
    if (!arquivo.id) continue // pastas nao tem id
    const { data: blob, error: dlErr } = await origem.storage.from(bucket).download(arquivo.name)
    if (dlErr) { console.error(`  ❌ download ${bucket}/${arquivo.name}: ${dlErr.message}`); continue }

    const buffer = Buffer.from(await blob.arrayBuffer())
    const { error: upErr } = await destino.storage.from(bucket).upload(arquivo.name, buffer, {
      upsert: true,
      contentType: blob.type,
    })
    if (upErr) { console.error(`  ❌ upload ${bucket}/${arquivo.name}: ${upErr.message}`); continue }
    copiados++
  }
  console.log(`${bucket}: ${copiados}/${(arquivos ?? []).filter(a => a.id).length} arquivos copiados`)
}

async function main() {
  for (const bucket of BUCKETS) await copiarBucket(bucket)
}

main().catch((e) => { console.error(e); process.exit(1) })
```

**Step 2: Rodar (do servidor, onde `127.0.0.1:8100` é alcançável — o Kong
do stack self-hosted só escuta em loopback)**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "cd /opt/ntb-estoque && node scripts/copiar-storage-contabo.mjs"
```

Expected: `arquivo-morto: 12/12 arquivos copiados` e `certificados: 0/0
arquivos copiados` (bucket vazio hoje — esperado, não é erro).

**Step 3: Validar funcionalmente — baixar um arquivo real do
`arquivo-morto` através do self-hosted e confirmar que os bytes batem**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 '
cd /opt/ntb-estoque
node -e "
const { createClient } = require(\"@supabase/supabase-js\")
const fs = require(\"fs\")
const env = Object.fromEntries(fs.readFileSync(\".env.local\",\"utf8\").split(/\r?\n/).map(l=>l.match(/^([A-Z0-9_]+)=(.*)$/)).filter(Boolean).map(m=>[m[1],m[2].replace(/^[\"\x27]|[\"\x27]$/g,\"\")]))
const c = createClient(\"http://127.0.0.1:8100\", env.FAILOVER_STANDBY_SERVICE_ROLE_KEY)
c.storage.from(\"arquivo-morto\").list(\"\",{limit:1}).then(({data,error})=>{
  if (error) throw error
  console.log(\"primeiro arquivo:\", data[0]?.name)
  return c.storage.from(\"arquivo-morto\").download(data[0].name)
}).then(({data,error})=>{ if(error) throw error; return data.arrayBuffer() }).then(buf=>{
  console.log(\"bytes baixados:\", buf.byteLength)
})
"
'
```

Expected: nome de um arquivo real do arquivo-morto + um `bytes baixados`
maior que zero, sem erro.

**Step 4: Commit**

```bash
cd "/Users/joaquimsalles/Projects/norte para negocios/ntb estoque"
git add scripts/copiar-storage-contabo.mjs
git commit -m "feat: script de cópia de arquivos de Storage pro Contabo self-hosted"
```

---

### Task 4: Backup automático noturno do Postgres do Contabo

**Files:**
- Create: `scripts/backup-postgres-contabo.sh` (fica só no servidor,
  mesmo padrão de `scripts/sync-cron.sh` que já roda via crontab — mas
  versionado no repo por consistência, igual aos outros scripts em
  `scripts/`).

**Interfaces:**
- Consumes: `docker exec supabase-db pg_dump` (Postgres do stack
  self-hosted).
- Produces: `/root/backups-ntb-estoque/ntb-estoque-YYYYMMDD.sql.gz`,
  retenção de 14 dias, cron diário via crontab do servidor.

**Step 1: Escrever o script**

```bash
#!/bin/bash
# scripts/backup-postgres-contabo.sh
# Backup noturno do Postgres self-hosted do Contabo (stack em
# /opt/ntb-estoque-standby/), com retencao de 14 dias. Necessario a
# partir da virada pra Contabo como principal -- o Supabase cloud cobria
# esse papel antes, sem custo pra nos gerenciar.
set -euo pipefail

DEST_DIR="/root/backups-ntb-estoque"
DATA=$(date +%Y%m%d)
SENHA=$(grep '^POSTGRES_PASSWORD=' /opt/ntb-estoque-standby/.env | cut -d= -f2)

mkdir -p "$DEST_DIR"

docker exec -e PGPASSWORD="$SENHA" supabase-db \
  pg_dump -U postgres -d postgres --schema=public --schema=auth --schema=storage \
  | gzip > "$DEST_DIR/ntb-estoque-$DATA.sql.gz"

# retencao: apaga backups com mais de 14 dias
find "$DEST_DIR" -name 'ntb-estoque-*.sql.gz' -mtime +14 -delete

echo "backup ok: $DEST_DIR/ntb-estoque-$DATA.sql.gz ($(du -h "$DEST_DIR/ntb-estoque-$DATA.sql.gz" | cut -f1))"
```

**Step 2: Copiar pro servidor e dar permissão de execução**

```bash
scp -i ~/.ssh/notebook_contabo_key "scripts/backup-postgres-contabo.sh" root@185.193.66.240:/opt/ntb-estoque/scripts/
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "chmod +x /opt/ntb-estoque/scripts/backup-postgres-contabo.sh"
```

**Step 3: Rodar uma vez manualmente pra validar antes de agendar**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "/opt/ntb-estoque/scripts/backup-postgres-contabo.sh"
```

Expected: `backup ok: /root/backups-ntb-estoque/ntb-estoque-<data>.sql.gz
(<tamanho>)` — tamanho não pode ser 0 nem KB (o schema `public` sozinho já
tem centenas de milhares de linhas em `ordens_producao`/`movimentos`).

**Step 4: Agendar via crontab do servidor (03h, fora do horário de uso)**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 '(crontab -l 2>/dev/null; echo "0 3 * * * /opt/ntb-estoque/scripts/backup-postgres-contabo.sh >> /opt/ntb-estoque/backup-postgres.log 2>&1") | crontab -'
```

**Step 5: Confirmar que entrou**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "crontab -l | grep backup-postgres"
```

Expected: a linha aparece.

**Step 6: Commit**

```bash
cd "/Users/joaquimsalles/Projects/norte para negocios/ntb estoque"
git add scripts/backup-postgres-contabo.sh
git commit -m "feat: backup noturno automático do Postgres do Contabo"
```

---

### Task 5: O corte — janela de manutenção e troca de destino

**⚠️ NÃO EXECUTAR SEM CONFIRMAÇÃO EXPLÍCITA DO USUÁRIO NO MOMENTO, mesmo
que este plano já esteja aprovado.** Produção real das 6 lojas depende
disso. Confirmar: horário de baixo uso escolhido, Tasks 1-4 todas ✅ sem
divergência, usuário ciente da janela de alguns minutos.

**Files:**
- Modify: `/opt/ntb-estoque/.env.local` (no servidor — nunca versionado
  no git, contém segredo).

**Interfaces:**
- Consumes: valores já existentes de `FAILOVER_STANDBY_ANON_KEY`/
  `FAILOVER_STANDBY_SERVICE_ROLE_KEY` em `/opt/ntb-estoque/.env.local`.
- Produces: `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY`/
  `SUPABASE_SERVICE_ROLE_KEY` passam a apontar pro Contabo — a partir daí
  o app inteiro lê/escreve só lá, independente do `getFailoverStatus()`
  (que continua existindo até a Task 6, mas não importa mais pra onde
  aponta já que os dois lados de `urlEChaveAtuais()` passam a levar pro
  mesmo lugar depois desta task — ver Step 3).

**Step 1: Re-rodar o checklist de completude uma última vez (rápido, não
a auditoria inteira)**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 '
cd /opt/ntb-estoque
STANDBY_PG_PASSWORD="$(grep POSTGRES_PASSWORD /opt/ntb-estoque-standby/.env | cut -d= -f2)" \
  node scripts/verificar-completude-contabo.mjs
'
```
Expected: todas ✅ (mesmo comando da Task 1, Step 2).

**Step 2: Rodar o `sync-auth-standby.mjs` uma última vez, na hora do
corte (garante o usuário mais recente também)**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 '
cd /opt/ntb-estoque
STANDBY_HOST=127.0.0.1 STANDBY_PORT=54322 STANDBY_PG_PASSWORD="$(grep POSTGRES_PASSWORD /opt/ntb-estoque-standby/.env | cut -d= -f2)" \
  node scripts/sync-auth-standby.mjs
'
```
Expected: `OK: N usuarios e M identities sincronizados`.

**Step 3: Trocar as env vars — pegar os valores já existentes de
`FAILOVER_STANDBY_*` e usá-los como os novos valores principais**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 '
cd /opt/ntb-estoque
cp .env.local .env.local.bak-pre-corte-$(date +%Y%m%d%H%M)

ANON=$(grep "^FAILOVER_STANDBY_ANON_KEY=" .env.local | cut -d= -f2-)
SERVICE=$(grep "^FAILOVER_STANDBY_SERVICE_ROLE_KEY=" .env.local | cut -d= -f2-)

sed -i "s#^NEXT_PUBLIC_SUPABASE_URL=.*#NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:8100#" .env.local
sed -i "s#^NEXT_PUBLIC_SUPABASE_ANON_KEY=.*#NEXT_PUBLIC_SUPABASE_ANON_KEY=$ANON#" .env.local
sed -i "s#^SUPABASE_SERVICE_ROLE_KEY=.*#SUPABASE_SERVICE_ROLE_KEY=$SERVICE#" .env.local
'
```

**Step 4: Reiniciar o serviço**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "systemctl restart ntb-estoque"
```

**Step 5: Confirmar subiu limpo (mesma checagem usada no incidente de
hoje — `journalctl` + curl local, não confiar só no domínio externo)**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "sleep 3 && systemctl is-active ntb-estoque && journalctl -u ntb-estoque -n 15 --no-pager"
curl -s -o /dev/null -w "app-estoque: %{http_code}\n" -L https://app-estoque.norteparanegocios.com.br --max-time 15
```
Expected: `active`, sem erro no log, `app-estoque: 200`.

**Step 6: Se algo der errado — rollback imediato (reverte o `.env.local`,
não precisa desfazer mais nada)**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 '
cd /opt/ntb-estoque
cp .env.local.bak-pre-corte-* .env.local
systemctl restart ntb-estoque
'
```

---

### Task 6: Remover código de failover obsoleto (só depois de estabilidade confirmada — dias depois do corte)

**⚠️ NÃO EXECUTAR NA MESMA SESSÃO DA TASK 5. Confirmar com o usuário que
já se passaram os dias de observação combinados e que está tudo estável
antes de começar esta task.**

**Files:**
- Delete: `lib/failover/health-monitor.ts`
- Modify: `instrumentation.ts` (remove a chamada de
  `iniciarMonitorDeSaude`)
- Modify: `lib/supabase/server.ts` (remove `urlEChaveAtuais`/import de
  `getFailoverStatus`, usa as env vars direto)

**Step 1: Simplificar `lib/supabase/server.ts`**

```typescript
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // chamado de um Server Component — pode ignorar se middleware atualiza a sessao
          }
        },
      },
    }
  )
}

// Client com service_role para operacoes server-side que ignoram RLS
// (syncs Omie, webhook, escritas administrativas). NUNCA expor ao browser.
export function createServiceClient() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      cookies: {
        getAll() {
          return []
        },
        setAll() {},
      },
    }
  )
}
```

**Step 2: Remover o bootstrap em `instrumentation.ts`**

```typescript
// instrumentation.ts
export async function register() {}
```

(Ou remover o arquivo inteiro se nada mais usar o hook — checar antes:
`grep -rn "instrumentation" next.config.*` pra confirmar que não há outra
dependência.)

**Step 3: Deletar o arquivo do monitor**

```bash
git rm lib/failover/health-monitor.ts
```

**Step 4: Rodar o typecheck do projeto pra confirmar que nada mais importa
esses símbolos**

```bash
cd "/Users/joaquimsalles/Projects/norte para negocios/ntb estoque"
npx tsc --noEmit
```
Expected: sem erro relacionado a `health-monitor`/`getFailoverStatus`/
`urlEChaveAtuais`. Se algo mais importar, corrigir antes de prosseguir.

**Step 5: Deploy**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "cd /opt/ntb-estoque && bash deploy.sh"
```

**Step 6: Confirmar produção segue no ar**

```bash
curl -s -o /dev/null -w "app-estoque: %{http_code}\n" -L https://app-estoque.norteparanegocios.com.br --max-time 15
```
Expected: `200`.

**Step 7: Remover a replicação lógica (não tem mais primary remoto pra
puxar) e o cron do `sync-auth-standby.mjs`**

```bash
node scripts/db.mjs "drop subscription if exists ntb_estoque_sub" 2>&1 || true
```
(Rodar do lado Contabo via `docker exec supabase-db psql`, já que a
subscription vive lá, não no cloud — `DROP SUBSCRIPTION` precisa rodar no
banco assinante.)

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "docker exec supabase-db psql -U postgres -d postgres -c 'drop subscription if exists ntb_estoque_sub;'"
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "crontab -l | grep -v sync-auth-standby | crontab -"
```

**Step 8: Commit**

```bash
git add -A
git commit -m "chore: remove código de failover Supabase↔Contabo (Contabo é o único banco agora)"
```

---

### Task 7: Validação funcional final

**Files:** nenhum — só verificação manual.

**Step 1: Login real** — acessar `https://app-estoque.norteparanegocios.com.br/login`
com um usuário real, confirmar que entra.

**Step 2: Leitura** — abrir a Home, confirmar que os cards de indicadores
carregam com número condizente com o uso real recente.

**Step 3: Escrita** — criar um produto de teste, confirmar que aparece na
listagem e no Omie (sync).

**Step 4: Emissão de NF-e de teste usando o certificado copiado** — se
alguma loja já tiver certificado cadastrado (Task 3 confirmou 0 hoje —
repetir este passo quando a primeira loja cadastrar um), fazer uma emissão
de teste e confirmar que o certificado é lido corretamente do Storage
self-hosted.

**Step 5: Reportar ao usuário** — confirmar todos os passos acima, e que o
Supabase cloud está pausado (não apagado) como combinado.
