# Failover Supabase → Contabo — Fase 2 (Detecção Automática + Troca) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fazer o app detectar sozinho quando o Supabase real fica inacessível e trocar automaticamente pro stack self-hosted do Contabo (Fase 1, já em produção) — leitura E escrita — registrando toda escrita feita nesse modo numa tabela-diário (`outbox`), pronta pra ser reaplicada no Supabase quando ele voltar (o replay em si é Fase 3, fora deste plano).

**Architecture:** Três peças independentes que se encaixam:
1. **Monitor de saúde em processo** — `instrumentation.ts` (hook oficial do Next.js, roda uma vez quando o servidor sobe) inicia um `setInterval` que testa o Supabase real a cada poucos segundos (uma query real via service role E uma checagem do Auth — o incidente de hoje mostrou que um pode estar de pé enquanto o outro não). Estado (`up`/`down` + contadores de falha/sucesso consecutivos) fica numa variável de módulo, em memória — sem arquivo, sem processo separado, porque `next start` no Contabo é um processo Node persistente (não serverless), então o estado sobrevive entre requisições naturalmente.
2. **Troca de destino** — `lib/supabase/server.ts` passa a consultar esse estado antes de montar os clientes: se `down`, usa a URL/chaves do stack self-hosted (Kong em `127.0.0.1:8100`, já que o app roda no MESMO servidor Contabo) em vez das variáveis de ambiente do Supabase real.
3. **Captura de escrita (outbox)** — usa um comportamento NATIVO e documentado do Postgres: o processo de replicação lógica aplica mudanças com `session_replication_role = replica`, e um trigger comum (modo padrão `ORIGIN`) **não dispara** nessa condição — só dispara pra escritas "de origem" (ou seja, feitas pelo próprio app, não pelas que chegam via réplica da Fase 1). Um trigger comum instalado nas 40 tabelas replicadas, só no Postgres do standby, captura exatamente as escritas certas sem precisar de nenhuma lógica extra pra filtrar.

**Tech Stack:** Next.js `instrumentation.ts` (App Router, já `stable` desde a v15, sem flag experimental necessária — confirmado em `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md`), Postgres triggers (`session_replication_role`, comportamento documentado em `runtime-config-client.html`), `@supabase/ssr`/`@supabase/supabase-js`.

**Achado crítico durante o planejamento**: este projeto tem `proxy.ts` na raiz (o antigo `middleware.ts` — renomeado nesta versão do Next.js, ver `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`), que roda em **praticamente toda requisição** (matcher amplo) e monta seu PRÓPRIO `createServerClient` direto com `process.env.NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` — não passa por `lib/supabase/server.ts`. Se só `lib/supabase/server.ts` for corrigido, o `proxy.ts` continuaria batendo direto no Supabase real durante uma queda, e como ele decide se redireciona pra `/login` com base no resultado de `getUser()`, uma queda real faria TODO MUNDO ser redirecionado pro login (já que `getUser()` falharia) mesmo com o resto do app já apontando pro standby — anulando o failover inteiro. **Confirmado que `proxy.ts` roda no runtime Node.js por padrão nesta versão** ("Proxy defaults to using the Node.js runtime" desde v16.0.0, mesma versão deste projeto) — ou seja, o estado em memória do monitor (Task 2) é acessível dali também, sem precisar de nenhum mecanismo extra de compartilhamento entre runtimes diferentes. A Task 3 abaixo corrige os dois arquivos.

## Global Constraints

- **N de histerese**: 3 falhas seguidas pra considerar "caído", 3 sucessos seguidos pra considerar "recuperado" — com checagem a cada 5s, isso é ~15s de instabilidade real antes de trocar em qualquer direção (evita trocar por causa de uma soneca de rede de 1 request, sem demorar tempo demais pra reagir a uma queda real).
- **A checagem de saúde precisa cobrir DOIS aspectos separados**, porque o incidente de hoje mostrou que um pode estar saudável enquanto o outro não: (1) uma query real via service role numa tabela pequena (`lojas`, `select id limit 1`) — prova que o banco responde de verdade; (2) uma chamada ao endpoint de saúde do Auth (`/auth/v1/health`) — prova que o login funcionaria. Considerar "up" só se AMBOS passarem; considerar uma falha se QUALQUER UM falhar ou estourar o timeout.
- **Timeout de cada checagem: 5 segundos** (usar `AbortController` — nunca deixar uma checagem pendurada mais que isso, senão o próprio monitor trava).
- **Este plano NÃO implementa o replay de volta (Fase 3)** — quando o Supabase volta a ficar saudável, o app simplesmente volta a apontar pra ele; qualquer escrita feita no Contabo durante a janela de queda fica registrada no `outbox`, esperando a Fase 3 pra ser reaplicada. Isso é esperado e correto pro escopo desta fase — não tentar construir o replay aqui.
- **Teste de "queda real" NUNCA deve tocar o Supabase de produção de verdade** (o incidente de hoje já mostrou o risco). Simular a queda BLOQUEANDO a rota de rede do servidor Contabo até o Supabase (via `iptables`, temporário, revertido ao final do teste) — nunca mexendo no projeto Supabase em si (sem restart, sem alterar configuração, sem sobrecarregar com query).
- **JWT_SECRET do standby é DIFERENTE do Supabase real** (gerado do zero na Fase 1, `utils/generate-keys.sh`) — uma sessão de usuário já logada (cookie com JWT assinado pelo Supabase real) NÃO vai ser validada pelo GoTrue/PostgREST do standby. Ou seja: ao trocar de destino, usuários já logados precisam logar de novo. Isso é uma limitação aceita para esta fase (não fazer nada pra "consertar" isso automaticamente sem perguntar — se quiser sessão contínua sem novo login, precisaria alinhar o `JWT_SECRET` do standby com o do Supabase real, decisão a ser tomada explicitamente, não default).
- **Sem framework de testes automatizado no projeto.** "Teste" nos passos abaixo significa: comando exato + saída esperada, e verificação funcional real via `curl`/Playwright, não testes unitários.
- Toda alteração em `lib/supabase/server.ts` ou `instrumentation.ts` precisa ser implantada no Contabo ao final (`ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "cd /opt/ntb-estoque && bash deploy.sh"`).

---

### Task 1: Infraestrutura de outbox no Postgres do standby

**Files:** nenhum arquivo do repo — SQL rodado direto contra o Postgres do stack self-hosted (porta 54322, usuário `postgres.ntbestoque`).

**Interfaces:**
- Produces: tabela `outbox` + trigger `outbox_capture()` instalado nas 40 tabelas replicadas — Task 3 (troca de destino) e a futura Fase 3 dependem dessa estrutura exata.

- [ ] **Step 1: Criar a tabela outbox e a função de trigger**

```bash
cd "/Users/joaquimsalles/Projects/norte para negocios/ntb estoque/.claude/worktrees/auditoria-relatorios"
PGPASSWORD="1eef054d2bc1ad8b8e6b865ff65f8315" psql -h 185.193.66.240 -p 54322 -U postgres.ntbestoque -d postgres -c "
create table if not exists outbox (
  id bigserial primary key,
  table_name text not null,
  operation text not null check (operation in ('INSERT','UPDATE','DELETE')),
  row_data jsonb not null,
  created_at timestamptz not null default now()
);

create or replace function outbox_capture() returns trigger as \$\$
begin
  if (tg_op = 'DELETE') then
    insert into outbox (table_name, operation, row_data) values (tg_table_name, tg_op, row_to_json(old)::jsonb);
    return old;
  else
    insert into outbox (table_name, operation, row_data) values (tg_table_name, tg_op, row_to_json(new)::jsonb);
    return new;
  end if;
end;
\$\$ language plpgsql;
"
```

- [ ] **Step 2: Anexar o trigger nas 40 tabelas replicadas**

Lista exata das 40 tabelas (mesma da Fase 1, Task 5 — as 3 excluídas, `cargos`/`permissoes`/`cargo_permissao`, ficam de fora aqui também, já que não estão nem em replicação):

```bash
cd "/Users/joaquimsalles/Projects/norte para negocios/ntb estoque/.claude/worktrees/auditoria-relatorios"
for t in permissao_user local_estoques local_estoque_user produto_substituicoes faturamento_importado posicao_estoques ordens_producao notas_fiscais nota_fiscal_items inventarios transferencias inventario_items webhooks movimentos previsao_venda impressao_etiquetas profiles integration_attempts movimentos_historico arquivos_mortos familias lojas fornecedores clientes convites audit_log etiqueta_config produtos faturamento_import_meta movimentacao_importada movimentacao_import_meta margem_importada margem_import_meta movimentacao_operacao movimentacao_operacao_meta loja_user contas_pagar contas_receber contas_correntes categorias_contabeis; do
  PGPASSWORD="1eef054d2bc1ad8b8e6b865ff65f8315" psql -h 185.193.66.240 -p 54322 -U postgres.ntbestoque -d postgres -c "
  drop trigger if exists outbox_trigger on $t;
  create trigger outbox_trigger after insert or update or delete on $t for each row execute function outbox_capture();
  "
done
```

- [ ] **Step 3: Confirmar que o trigger existe nas 40 tabelas**

```bash
PGPASSWORD="1eef054d2bc1ad8b8e6b865ff65f8315" psql -h 185.193.66.240 -p 54322 -U postgres.ntbestoque -d postgres -c "
select count(*) from pg_trigger where tgname='outbox_trigger';
"
```
Expected: `40`.

- [ ] **Step 4: Confirmar que uma escrita LOCAL (feita direto no standby, simulando o app em modo failover) gera uma linha no outbox**

```bash
PGPASSWORD="1eef054d2bc1ad8b8e6b865ff65f8315" psql -h 185.193.66.240 -p 54322 -U postgres.ntbestoque -d postgres -c "
update lojas set updated_at = now() where id = 2;
select count(*) from outbox where table_name = 'lojas';
"
```
Expected: pelo menos `1`.

- [ ] **Step 5: CRÍTICO — confirmar que uma escrita REAL no Supabase (que chega via réplica lógica) NÃO gera uma linha no outbox**

Fazer uma escrita pequena e inofensiva no Supabase real:
```bash
node scripts/db.mjs "update lojas set updated_at = now() where id = 3"
```
Esperar ~5s (tempo de replicação), depois:
```bash
PGPASSWORD="1eef054d2bc1ad8b8e6b865ff65f8315" psql -h 185.193.66.240 -p 54322 -U postgres.ntbestoque -d postgres -c "
select updated_at from lojas where id = 3;
select count(*) from outbox where table_name = 'lojas' and row_data->>'id' = '3' and created_at > now() - interval '1 minute';
"
```
Expected: `updated_at` bate com a escrita feita agora (confirma que a réplica chegou), MAS a contagem do outbox pra esse registro nesse último minuto é `0` (confirma que o trigger não disparou pra escrita replicada — esse é o comportamento central que este plano depende). Se a contagem NÃO for zero, o mecanismo de outbox está quebrado e o resto do plano não deve prosseguir sem investigar.

- [ ] **Step 6: Limpar as linhas de teste do outbox** (não deixar lixo de teste na tabela de produção)

```bash
PGPASSWORD="1eef054d2bc1ad8b8e6b865ff65f8315" psql -h 185.193.66.240 -p 54322 -U postgres.ntbestoque -d postgres -c "
delete from outbox where table_name = 'lojas';
"
```

---

### Task 2: Monitor de saúde em processo (`instrumentation.ts` + `lib/failover/health-monitor.ts`)

**Files:**
- Create: `lib/failover/health-monitor.ts`
- Create: `instrumentation.ts` (raiz do projeto)

**Interfaces:**
- Produces: `getFailoverStatus(): 'up' | 'down'` — Task 3 (`lib/supabase/server.ts`) depende exatamente dessa função e desses dois valores.

- [ ] **Step 1: Escrever o monitor**

```typescript
// lib/failover/health-monitor.ts
// Monitor de saude do Supabase real, rodando em processo (setInterval),
// iniciado uma vez pelo instrumentation.ts quando o servidor sobe. Estado
// fica em variavel de modulo -- sem arquivo, sem processo separado, porque
// next start no Contabo e um processo Node persistente (nao serverless).
//
// Cobre DOIS aspectos (o incidente de 2026-07-23 mostrou que um pode estar
// de pe enquanto o outro nao): uma query real via service role (prova que
// o banco responde) E uma checagem do endpoint de saude do Auth (prova que
// login funcionaria). So considera "up" se os dois passarem.

const INTERVALO_MS = 5000
const FALHAS_PARA_CAIR = 3
const SUCESSOS_PARA_VOLTAR = 3
const TIMEOUT_MS = 5000

type Status = 'up' | 'down'

let status: Status = 'up'
let falhasConsecutivas = 0
let sucessosConsecutivos = 0
let intervalId: ReturnType<typeof setInterval> | null = null

async function checarComTimeout(url: string, init?: RequestInit): Promise<boolean> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const resp = await fetch(url, { ...init, signal: controller.signal })
    return resp.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

async function checarSupabaseReal(): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !anonKey || !serviceKey) return true // sem config, nao tenta trocar

  const [bancoOk, authOk] = await Promise.all([
    checarComTimeout(`${url}/rest/v1/lojas?select=id&limit=1`, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    }),
    checarComTimeout(`${url}/auth/v1/health`, {
      headers: { apikey: anonKey },
    }),
  ])
  return bancoOk && authOk
}

async function tick() {
  const saudavel = await checarSupabaseReal()

  if (saudavel) {
    falhasConsecutivas = 0
    sucessosConsecutivos++
    if (status === 'down' && sucessosConsecutivos >= SUCESSOS_PARA_VOLTAR) {
      status = 'up'
      console.log('[failover] Supabase real recuperado -- voltando a usar como principal')
    }
  } else {
    sucessosConsecutivos = 0
    falhasConsecutivas++
    if (status === 'up' && falhasConsecutivas >= FALHAS_PARA_CAIR) {
      status = 'down'
      console.log('[failover] Supabase real inacessivel -- trocando para o stack self-hosted do Contabo')
    }
  }
}

export function iniciarMonitorDeSaude() {
  if (intervalId) return // ja iniciado (evita duplicar em hot-reload/re-import)
  intervalId = setInterval(tick, INTERVALO_MS)
  void tick() // primeira checagem imediata, nao espera o primeiro intervalo
}

export function getFailoverStatus(): Status {
  return status
}
```

- [ ] **Step 2: Escrever o `instrumentation.ts`**

```typescript
// instrumentation.ts
// Hook oficial do Next.js (estavel desde v15, sem flag experimental) --
// roda uma vez quando uma nova instancia do servidor sobe, antes de aceitar
// requisicoes. So inicia o monitor no runtime Node (nao no Edge).
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const { iniciarMonitorDeSaude } = await import('@/lib/failover/health-monitor')
    iniciarMonitorDeSaude()
  }
}
```

- [ ] **Step 3: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros novos.

- [ ] **Step 4: Testar manualmente que o monitor inicia e loga**

```bash
cd "/Users/joaquimsalles/Projects/norte para negocios/ntb estoque/.claude/worktrees/auditoria-relatorios"
npm run build && npm start &
sleep 8
curl -s http://localhost:3000/ -o /dev/null -w "%{http_code}\n"
kill %1
```
Expected: nenhum erro no console relacionado a `instrumentation`/`health-monitor`; o servidor sobe e responde normalmente (o monitor rodando em background não deve impedir isso).

- [ ] **Step 5: Commit**

```bash
git add lib/failover/health-monitor.ts instrumentation.ts
git commit -m "feat: monitor de saude do Supabase real em processo (Fase 2 do failover)"
```

---

### Task 3: Troca de destino em `lib/supabase/server.ts` e `proxy.ts`

**Files:**
- Modify: `lib/supabase/server.ts`
- Modify: `proxy.ts`

**Interfaces:**
- Consumes: `getFailoverStatus()` de `@/lib/failover/health-monitor` (Task 2).
- Produces: `urlEChaveAtuais(tipo: 'anon' | 'service'): { url: string, key: string }`, exportada de `lib/supabase/server.ts` — o `proxy.ts` (Step 6 abaixo) depende exatamente dessa função (não pode reusar `createClient()`/`createServiceClient()` diretamente, porque o `proxy.ts` usa a API de cookies de `NextRequest`/`NextResponse`, diferente da API `cookies()` de `next/headers` usada pelos Server Components/Actions).

O arquivo hoje (não mexer na estrutura de cookies, só na escolha de URL/chave):

```typescript
export async function createClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookies: { /* ... */ } }
  )
}

export function createServiceClient() {
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { cookies: { /* ... */ } }
  )
}
```

- [ ] **Step 1: Adicionar as credenciais do standby como constantes + a função de escolha**

No topo do arquivo, depois dos imports existentes:

```typescript
import { getFailoverStatus } from '@/lib/failover/health-monitor'

// Credenciais do stack self-hosted do Contabo (Fase 1 do failover) -- o app
// roda no MESMO servidor, entao acessa via loopback (as portas so escutam
// em 127.0.0.1 desde a correcao de seguranca da Fase 1, nunca reabrir pra
// 0.0.0.0). So usadas quando o monitor de saude confirma o Supabase real
// inacessivel (lib/failover/health-monitor.ts).
const STANDBY_URL = 'http://127.0.0.1:8100'
const STANDBY_ANON_KEY = process.env.FAILOVER_STANDBY_ANON_KEY!
const STANDBY_SERVICE_ROLE_KEY = process.env.FAILOVER_STANDBY_SERVICE_ROLE_KEY!

export function urlEChaveAtuais(tipo: 'anon' | 'service') {
  if (getFailoverStatus() === 'down') {
    return {
      url: STANDBY_URL,
      key: tipo === 'anon' ? STANDBY_ANON_KEY : STANDBY_SERVICE_ROLE_KEY,
    }
  }
  return {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL!,
    key: tipo === 'anon' ? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY! : process.env.SUPABASE_SERVICE_ROLE_KEY!,
  }
}
```

- [ ] **Step 2: Usar a função nos dois clientes**

```typescript
export async function createClient() {
  const cookieStore = await cookies()
  const { url, key } = urlEChaveAtuais('anon')
  return createServerClient(url, key, {
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
  })
}

export function createServiceClient() {
  const { url, key } = urlEChaveAtuais('service')
  return createServerClient(url, key, {
    cookies: {
      getAll() {
        return []
      },
      setAll() {},
    },
  })
}
```

- [ ] **Step 3: Corrigir `proxy.ts` pra usar a mesma escolha de destino**

O arquivo hoje (não mexer na lógica de redirecionamento, só na origem do client):

```typescript
const supabase = createServerClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { cookies: { /* ... */ } }
)
```

Trocar por:

```typescript
import { urlEChaveAtuais } from '@/lib/supabase/server'
// ... (mantém os outros imports existentes)

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const { url, key } = urlEChaveAtuais('anon')
  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll()
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) =>
          request.cookies.set(name, value)
        )
        supabaseResponse = NextResponse.next({ request })
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        )
      },
    },
  })

  // ... resto do arquivo (getUser, isPublic, redirects) fica exatamente igual
```

- [ ] **Step 4: Verificar tipos**

Run: `npx tsc --noEmit`
Expected: sem erros novos (cobre `lib/supabase/server.ts` e `proxy.ts` juntos).

- [ ] **Step 5: Adicionar as novas variáveis de ambiente no `.env.local` de produção (Contabo) — NÃO no repo (segredo)**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "cat >> /opt/ntb-estoque/.env.local << 'EOF'
FAILOVER_STANDBY_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzg0ODQ3MjYwLCJleHAiOjE5NDI1MjcyNjB9.YmlPFysJDamnhjkRwwNDOqNhzPIVtmrIjlucfDKPOv4
FAILOVER_STANDBY_SERVICE_ROLE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwiaXNzIjoic3VwYWJhc2UiLCJpYXQiOjE3ODQ4NDcyNjAsImV4cCI6MTk0MjUyNzI2MH0.FaJBdvdikRzLEYR_H1HgwoMC9Rl4-myeIFTgKVmKNmQ
EOF
"
```

- [ ] **Step 6: Commit**

```bash
git add "lib/supabase/server.ts" "proxy.ts"
git commit -m "feat: troca automatica de destino Supabase->standby conforme o monitor de saude, incluindo proxy.ts (Fase 2 do failover)"
```

---

### Task 4: Validação end-to-end de uma queda simulada (sem tocar o Supabase real)

**Files:** nenhum arquivo do repo — só verificação em produção.

**Interfaces:** nenhuma nova.

- [ ] **Step 1: Deploy**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "cd /opt/ntb-estoque && bash deploy.sh"
```

- [ ] **Step 2: Confirmar que o app funciona normal (Supabase real saudável) antes de simular a queda**

Login normal via `claude.qa@ntb-estoque.dev`/`claudeqa123456` contra `https://app-estoque.norteparanegocios.com.br`, confirmar leitura de `/produto` funcionando.

- [ ] **Step 3: Descobrir o IP do Supabase real (pra bloquear só ele, nada mais)**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "getent ahosts waubqgkftwrufepwhctc.supabase.co db.waubqgkftwrufepwhctc.supabase.co aws-1-sa-east-1.pooler.supabase.com"
```

- [ ] **Step 4: Bloquear temporariamente a rota até esses IPs (simulando queda, sem tocar o Supabase em si)**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "
for ip in <IPs do Step 3>; do
  iptables -A OUTPUT -d \$ip -j DROP
done
"
```

- [ ] **Step 5: Esperar ~20-30s (3 falhas x 5s de intervalo + margem) e confirmar que o monitor detectou a queda**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "journalctl -u ntb-estoque --since '1 min ago' --no-pager | grep failover"
```
Expected: linha `[failover] Supabase real inacessivel -- trocando para o stack self-hosted do Contabo`.

- [ ] **Step 6: Confirmar que o app AGORA funciona contra o standby**

Login (deve pedir de novo, sessão antiga não é válida no standby — ver Global Constraints), leitura de `/produto` (deve mostrar os mesmos produtos, vindos do standby), e uma escrita simples (ex.: editar `meta_compras_pct` via "Minha loja", mesmo padrão de teste da Fase 1).

- [ ] **Step 7: Confirmar que a escrita do Step 6 apareceu no `outbox`**

```bash
PGPASSWORD="1eef054d2bc1ad8b8e6b865ff65f8315" psql -h 185.193.66.240 -p 54322 -U postgres.ntbestoque -d postgres -c "
select table_name, operation, created_at from outbox order by created_at desc limit 5;
"
```
Expected: uma linha recente pra `lojas`, operação `UPDATE`.

- [ ] **Step 8: Remover o bloqueio (restaurar conectividade)**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "
for ip in <IPs do Step 3>; do
  iptables -D OUTPUT -d \$ip -j DROP
done
"
```

- [ ] **Step 9: Esperar ~20-30s e confirmar que o monitor detectou a recuperação e voltou pro Supabase real**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "journalctl -u ntb-estoque --since '1 min ago' --no-pager | grep failover"
```
Expected: linha `[failover] Supabase real recuperado -- voltando a usar como principal`.

- [ ] **Step 10: Confirmar que o app volta a funcionar contra o Supabase real, e que a escrita feita durante a janela de queda (Step 6) NÃO está lá** (isso é esperado — só a Fase 3 replica de volta; documentar isso claramente no relatório final, não é um bug)

- [ ] **Step 11: Limpar as linhas de teste do outbox**

```bash
PGPASSWORD="1eef054d2bc1ad8b8e6b865ff65f8315" psql -h 185.193.66.240 -p 54322 -U postgres.ntbestoque -d postgres -c "
delete from outbox where created_at > now() - interval '1 hour';
"
```

- [ ] **Step 12: Documentar o resultado completo** — este é o critério de "Fase 2 pronta" antes de avançar pra Fase 3.
