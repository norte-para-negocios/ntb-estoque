# Movimentos — dual-write + backfill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Destravar o espelho congelado de `movimentos` no Contabo (parado desde 07-12) com dual-write de verdade a partir de agora, e equalizar a profundidade histórica entre as 6 lojas via backfill desde 01/07/2025.

**Architecture:** Endpoint novo `POST /movimentos_bulk` na `ntb-frio-api` (mesmo molde do `POST /fat_cupons_bulk` já em produção). `lib/omie/sync-ajustes.ts` passa a chamar esse endpoint fire-and-forget depois do upsert no Supabase. Um script de catch-up cobre o buraco 07-12→hoje; um script de backfill histórico (ambos ad-hoc, rodam no servidor Contabo) cobrem 01/07/2025→07-12 nas 6 lojas, escrevendo nas duas bases.

**Tech Stack:** Node/Express + `pg` (servidor Contabo), Next.js Server Actions/cron (app), Postgres (Supabase + Contabo).

## Global Constraints

- Servidor Contabo: SSH `ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240`. Arquivo do servidor: `/opt/ntb-frio-api/server.js` (fora deste repo git — editar via SSH, nunca existe cópia local). Banco Contabo: `DATABASE_URL` em `/opt/ntb-frio-api/.env`, só acessível via `localhost:5432` **dentro** do servidor (não exposto publicamente) — qualquer script que precise gravar no Contabo tem que rodar NO servidor. Serviço: `systemctl restart ntb-frio-api` depois de qualquer edição no `server.js`.
- Autenticação dos endpoints: header `X-Api-Key` == `process.env.API_KEY`, middleware `checkAuth` já existe no `server.js` — reusar, não duplicar.
- Padrão de tipo: `types.setTypeParser(20, ...)` (bigint→Number) e `types.setTypeParser(1082, ...)` (date→string crua) já configurados globalmente no topo do `server.js` — cobre qualquer coluna nova automaticamente, nada a fazer.
- Supabase: acessível via pooler público (`aws-1-sa-east-1.pooler.supabase.com:5432` ou o host salvo em `scripts/.pooler-host`), usuário `postgres.<project-ref>`, senha em `SUPABASE_DB_URL` (`.env.local`). Alcançável de qualquer lugar, incluindo de dentro do servidor Contabo.
- Chave natural de `movimentos`: `(loja_id, id_ajuste)` — **não** `(loja_id, id)` (`id` é `bigserial`, um artefato de cada banco, sem significado entre bases). O upsert do Supabase já usa isso (`onConflict: 'loja_id,id_ajuste'`, migration `059_movimentos_id_ajuste_unique.sql`, índice único parcial `WHERE id_ajuste IS NOT NULL`). O Contabo hoje **não tem esse índice nem nenhuma outra constraint** (cópia crua de 07-12, confirmado via `\d movimentos` no servidor) — Task 1 cria o mesmo índice lá.
- Lote de escrita em `POST /movimentos_bulk`: 200 linhas por request (mesmo tamanho usado em `/fat_cupons_bulk`, evita estourar o limite de 2mb do Express).
- Sem suite automatizada neste repo — verificação manual (`curl`, `node scripts/db.mjs`, contagens `select count(*)`).
- `.env.local` e `scripts/.pooler-host` não são copiados automaticamente pra worktrees — copiar manualmente se for usar uma.
- Ação em banco de produção real requer confirmação explícita do usuário antes de aplicar: Task 1 (DDL no Contabo), Task 4 (catch-up, escreve no Contabo), Task 5 (backfill completo, escreve nas duas bases, 6 lojas).

---

### Task 1: Índice único em `movimentos` no Contabo

**Files:** nenhum (DDL aplicado direto via SSH, sem migration versionada neste repo — o schema do Contabo não é gerenciado pelas migrations do Supabase).

**Interfaces:**
- Produces: índice único `movimentos_loja_id_ajuste_unique` em `ntb_frio.movimentos`. Task 2 (endpoint) e Tasks 4/5 (scripts de escrita) dependem dele pra poder usar `ON CONFLICT (loja_id, id_ajuste)`.

- [ ] **Step 1: Escrever o DDL num arquivo local**

Criar `/private/tmp/claude-501/-Users-joaquimsalles/f0e3fe4e-5df2-40b3-b55a-40422402afa7/scratchpad/movimentos-unique-index.sql` (ou caminho equivalente do scratchpad da sessão) com:

```sql
CREATE UNIQUE INDEX IF NOT EXISTS movimentos_loja_id_ajuste_unique
  ON public.movimentos (loja_id, id_ajuste)
  WHERE id_ajuste IS NOT NULL;
```

- [ ] **Step 2: Pedir confirmação e aplicar via SSH**

DDL em banco de produção real — confirmar com o usuário antes de rodar. Depois de confirmado:

```bash
cat /private/tmp/claude-501/-Users-joaquimsalles/f0e3fe4e-5df2-40b3-b55a-40422402afa7/scratchpad/movimentos-unique-index.sql | ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "sudo -u postgres psql -d ntb_frio"
```

- [ ] **Step 3: Verificar**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "sudo -u postgres psql -d ntb_frio -tAc \"select indexname from pg_indexes where tablename='movimentos'\""
```
Esperado: `movimentos_loja_id_ajuste_unique` listado.

---

### Task 2: Endpoint novo `POST /movimentos_bulk` na `ntb-frio-api`

**Files:**
- Modify (via SSH, fora deste repo git): `/opt/ntb-frio-api/server.js`

**Interfaces:**
- Consumes: middleware `checkAuth` já existente, `pool` (pg Pool) já instanciado no topo do arquivo, índice único da Task 1.
- Produces: `POST /movimentos_bulk` (body `{ loja_id, movimentos: [...] }`, cada item com `{ id_ajuste, id_prod, tipo, quan, valor, codigo_local_estoque, codigo_local_estoque_destino, data, motivo, obs, origem, status }`). Task 3 (dual-write do sync) e Tasks 4/5 (catch-up/backfill) consomem.

- [ ] **Step 1: Confirmar a estrutura atual do `server.js` antes de editar**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "grep -n \"app.get\\|app.post\" /opt/ntb-frio-api/server.js"
```
Confirmar que a lista bate com: `POST /webhooks`, `GET /notas_fiscais`, `GET /nota_fiscal_items`, `GET /ordens_producao`, `GET /movimentos`, `GET /movimentos_historico`, `POST /vendas/orders`, `GET /fat_cupons`, `GET /fat_cupom_itens`, `GET /fat_cupom_pagamentos`, `GET /fat_agregado`, `POST /fat_cupons_bulk`, `GET /health`. A rota nova entra **antes** de `app.get('/health', ...)`, mesmo padrão usado pras rotas `fat_*`.

- [ ] **Step 2: Escrever o bloco da rota nova num arquivo local**

Criar `/private/tmp/claude-501/-Users-joaquimsalles/f0e3fe4e-5df2-40b3-b55a-40422402afa7/scratchpad/movimentos-bulk-route.js` com:

```js
app.post('/movimentos_bulk', checkAuth, async (req, res) => {
  const { loja_id, movimentos } = req.body || {};
  if (!loja_id || !Array.isArray(movimentos)) {
    return res.status(400).json({ error: 'loja_id e movimentos (array) sao obrigatorios' });
  }
  const client = await pool.connect();
  try {
    await client.query('begin');
    for (const m of movimentos) {
      await client.query(
        `insert into movimentos (loja_id, id_ajuste, id_prod, tipo, quan, valor, codigo_local_estoque, codigo_local_estoque_destino, data, motivo, obs, origem, status)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         on conflict (loja_id, id_ajuste) where id_ajuste is not null do update set
           id_prod = excluded.id_prod, tipo = excluded.tipo, quan = excluded.quan, valor = excluded.valor,
           codigo_local_estoque = excluded.codigo_local_estoque,
           codigo_local_estoque_destino = excluded.codigo_local_estoque_destino,
           data = excluded.data, motivo = excluded.motivo, obs = excluded.obs, origem = excluded.origem,
           status = excluded.status, updated_at = now()`,
        [loja_id, m.id_ajuste, m.id_prod, m.tipo, m.quan, m.valor, m.codigo_local_estoque,
         m.codigo_local_estoque_destino, m.data, m.motivo, m.obs, m.origem, m.status]
      );
    }
    await client.query('commit');
    res.json({ ok: true, movimentos: movimentos.length });
  } catch (e) {
    await client.query('rollback');
    console.error('Erro POST /movimentos_bulk:', e);
    res.status(500).json({ error: 'internal error' });
  } finally {
    client.release();
  }
});
```

- [ ] **Step 3: Inserir o bloco no `server.js` do servidor, antes de `app.get('/health', ...)`**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "cp /opt/ntb-frio-api/server.js /opt/ntb-frio-api/server.js.bak-$(date +%Y%m%d-%H%M)"
python3 -c "
import subprocess
route = open('/private/tmp/claude-501/-Users-joaquimsalles/f0e3fe4e-5df2-40b3-b55a-40422402afa7/scratchpad/movimentos-bulk-route.js').read()
remote = subprocess.run(['ssh', '-i', '$HOME/.ssh/notebook_contabo_key', 'root@185.193.66.240', 'cat /opt/ntb-frio-api/server.js'], capture_output=True, text=True).stdout
marker = \"app.get('/health'\"
idx = remote.index(marker)
novo = remote[:idx] + route + '\n' + remote[idx:]
subprocess.run(['ssh', '-i', '$HOME/.ssh/notebook_contabo_key', 'root@185.193.66.240', 'cat > /opt/ntb-frio-api/server.js'], input=novo, text=True, check=True)
print('OK, arquivo atualizado')
"
```

- [ ] **Step 4: Validar sintaxe e reiniciar o serviço**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "node -c /opt/ntb-frio-api/server.js && echo SINTAXE-OK && systemctl restart ntb-frio-api && sleep 1 && systemctl is-active ntb-frio-api"
```
Esperado: `SINTAXE-OK` seguido de `active`. Se `node -c` falhar, **restaurar o backup** antes de investigar.

- [ ] **Step 5: Testar com 1 movimento fake e depois limpar**

```bash
API_KEY=$(ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "grep '^API_KEY=' /opt/ntb-frio-api/.env | cut -d= -f2")
curl -s -X POST -H "X-Api-Key: $API_KEY" -H "Content-Type: application/json" \
  -d '{"loja_id":3,"movimentos":[{"id_ajuste":999999999,"id_prod":1,"tipo":"ENT","quan":1,"valor":10,"codigo_local_estoque":1,"codigo_local_estoque_destino":null,"data":"2026-01-15T00:00:00.000Z","motivo":null,"obs":"teste","origem":"AJU","status":"Concluido"}]}' \
  "https://frio-api.norteparanegocios.com.br/movimentos_bulk"
```
Esperado: `{"ok":true,"movimentos":1}`. Depois, limpar:
```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "sudo -u postgres psql -d ntb_frio -c \"delete from movimentos where id_ajuste = 999999999\""
```

---

### Task 3: Dual-write no sync incremental — `lib/omie/sync-ajustes.ts`

**Files:**
- Modify: `lib/omie/sync-ajustes.ts`

**Interfaces:**
- Consumes: `POST /movimentos_bulk` (Task 2), `NTB_FRIO_API_URL`/`NTB_FRIO_API_KEY` (já existem em `.env.local`).
- Produces: nenhuma interface nova — o retorno de `syncAjustes` continua igual (`Promise<number>`).

- [ ] **Step 1: Adicionar a função de envio em lote pro Contabo**

No topo de `lib/omie/sync-ajustes.ts`, depois da declaração de `MovimentoRow` e antes de `TIPOS_VALIDOS`, adicionar:

```ts
const LOTE_MOVIMENTOS = 200

// Envia o lote de movimentos pro Contabo, em pedacos de 200. Nao lanca erro
// se o Contabo falhar -- mesma filosofia de gravarFatoNoFrio
// (lib/omie/faturamento.ts) e buscarFrio (lib/historico-contabo.ts): o
// upsert no Supabase, que sustenta o sync hoje, nunca pode quebrar por
// causa do dual-write.
async function gravarMovimentosNoFrio(lojaId: number, linhas: MovimentoRow[]): Promise<void> {
  const url = process.env.NTB_FRIO_API_URL
  const key = process.env.NTB_FRIO_API_KEY
  if (!url || !linhas.length) return
  for (let i = 0; i < linhas.length; i += LOTE_MOVIMENTOS) {
    const lote = linhas.slice(i, i + LOTE_MOVIMENTOS)
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 15000)
      const resp = await fetch(`${url}/movimentos_bulk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Api-Key': key ?? '' },
        body: JSON.stringify({ loja_id: lojaId, movimentos: lote }),
        signal: controller.signal,
      })
      clearTimeout(timeoutId)
      if (!resp.ok) throw new Error(`Contabo respondeu ${resp.status}`)
    } catch (e) {
      console.error('sync-ajustes: falha ao gravar movimentos no Contabo', e)
    }
  }
}
```

- [ ] **Step 2: Chamar a função logo após o upsert no Supabase, dentro do loop de páginas**

Localizar o bloco (dentro do `for (let pagina = totalPaginas; ...)`):

```ts
    if (novos.length) {
      const { error } = await supabase.from('movimentos').upsert(novos, {
        onConflict: 'loja_id,id_ajuste',
        ignoreDuplicates: false,
      })
      if (error) throw new Error(`Supabase upsert loja ${loja.id}: ${error.message}`)
      totalSalvos += novos.length
    }
```

Substituir por:

```ts
    if (novos.length) {
      const { error } = await supabase.from('movimentos').upsert(novos, {
        onConflict: 'loja_id,id_ajuste',
        ignoreDuplicates: false,
      })
      if (error) throw new Error(`Supabase upsert loja ${loja.id}: ${error.message}`)
      totalSalvos += novos.length
      await gravarMovimentosNoFrio(loja.id, novos)
    }
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit
```

- [ ] **Step 4: Commit**

```bash
git add lib/omie/sync-ajustes.ts
git commit -m "feat(sync-ajustes): dual-write de movimentos pro Contabo"
```

- [ ] **Step 5: Verificação manual (1 loja, sem esperar o cron)**

Rodar o sync manualmente pra uma loja com poucos ajustes pendentes (ex.: loja 4, que hoje só tem histórico desde 06-19) via a rota que já existe (`app/api/cron/sync-ajustes/route.ts` ou o botão de sync equivalente na UI de administração), depois:

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "sudo -u postgres psql -d ntb_frio -tAc \"select count(*) from movimentos where loja_id=4\""
```
Esperado: contagem > 0 (subiu em relação a antes do teste, mesmo que pequena — o objetivo é confirmar que o dual-write disparou, não repovoar tudo).

---

### Task 4: Catch-up do buraco 07-12 → hoje

**Files:** nenhum neste repo (script ad-hoc rodado no servidor Contabo, mesmo padrão do backfill de faturamento).

**Interfaces:**
- Consumes: índice único da Task 1 (Contabo), acesso ao pooler do Supabase.

- [ ] **Step 1: Escrever o script no scratchpad local**

Criar `/private/tmp/claude-501/-Users-joaquimsalles/f0e3fe4e-5df2-40b3-b55a-40422402afa7/scratchpad/catchup-movimentos.mjs`:

```js
// Catch-up unico: copia pro Contabo as linhas de `movimentos` que ja
// existem no Supabase (id_ajuste is not null) e ainda nao estao la --
// cobre o buraco entre a copia unica de 07-12 e hoje, antes do dual-write
// (Task 3) entrar em regime. Roda NO SERVIDOR Contabo (conecta no pooler
// publico do Supabase + no Postgres local). Uso:
//   node catchup-movimentos.mjs <supabase-conn.json>
import fs from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire('/opt/ntb-frio-api/')
const { Pool } = require('pg')

const conn = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const supaEnv = fs.readFileSync('/opt/ntb-frio-api/.env', 'utf8')
const localEnv = {}
for (const line of supaEnv.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) localEnv[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const poolContabo = new Pool({ connectionString: localEnv.DATABASE_URL })
const poolSupabase = new Pool({
  host: conn.host, port: conn.port, user: conn.user, password: conn.password,
  database: 'postgres', ssl: { rejectUnauthorized: false },
})

const LOJAS = [2, 3, 4, 5, 6, 7]
const LOTE = 500

for (const lojaId of LOJAS) {
  console.log(`\n=== Loja ${lojaId} ===`)
  const { rows: existentes } = await poolContabo.query(
    'select id_ajuste from movimentos where loja_id = $1 and id_ajuste is not null',
    [lojaId]
  )
  const jaTem = new Set(existentes.map((r) => Number(r.id_ajuste)))
  console.log(`  ${jaTem.size} ja presentes no Contabo`)

  const { rows: doSupabase } = await poolSupabase.query(
    `select loja_id, id_ajuste, id_prod, tipo, quan, valor, codigo_local_estoque,
            codigo_local_estoque_destino, data, motivo, obs, origem, status
     from movimentos where loja_id = $1 and id_ajuste is not null`,
    [lojaId]
  )
  const faltando = doSupabase.filter((r) => !jaTem.has(Number(r.id_ajuste)))
  console.log(`  ${faltando.length} faltando no Contabo`)

  for (let i = 0; i < faltando.length; i += LOTE) {
    const lote = faltando.slice(i, i + LOTE)
    const client = await poolContabo.connect()
    try {
      await client.query('begin')
      for (const m of lote) {
        await client.query(
          `insert into movimentos (loja_id, id_ajuste, id_prod, tipo, quan, valor, codigo_local_estoque, codigo_local_estoque_destino, data, motivo, obs, origem, status)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           on conflict (loja_id, id_ajuste) where id_ajuste is not null do nothing`,
          [m.loja_id, m.id_ajuste, m.id_prod, m.tipo, m.quan, m.valor, m.codigo_local_estoque,
           m.codigo_local_estoque_destino, m.data, m.motivo, m.obs, m.origem, m.status]
        )
      }
      await client.query('commit')
    } catch (e) {
      await client.query('rollback')
      throw e
    } finally {
      client.release()
    }
  }
  console.log(`  Loja ${lojaId}: catch-up completo (${faltando.length} linhas gravadas).`)
}
await poolContabo.end()
await poolSupabase.end()
console.log('\nCATCH-UP CONCLUIDO')
```

- [ ] **Step 2: Pedir confirmação, exportar credenciais do pooler, subir e rodar no servidor**

Escreve no Contabo (produção) — confirmar com o usuário antes. Primeiro, criar
`/private/tmp/claude-501/-Users-joaquimsalles/f0e3fe4e-5df2-40b3-b55a-40422402afa7/scratchpad/gerar-supabase-conn.mjs`
(script auxiliar rodado localmente, não no servidor — só lê `.env.local` deste
repo e escreve o JSON de conexão):

```js
import fs from 'node:fs'

const env = {}
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const u = new URL(env.SUPABASE_DB_URL)
const senha = decodeURIComponent(u.password)
const ref = u.hostname.replace(/^db\./, '').replace(/\.supabase\.co$/, '')

let host = 'aws-1-sa-east-1.pooler.supabase.com'
let port = 5432
try {
  const saved = fs.readFileSync('scripts/.pooler-host', 'utf8').trim()
  const [h, p] = saved.split(':')
  if (h) host = h
  if (p) port = Number(p)
} catch {}

fs.writeFileSync(
  '/private/tmp/claude-501/-Users-joaquimsalles/f0e3fe4e-5df2-40b3-b55a-40422402afa7/scratchpad/supabase-conn.json',
  JSON.stringify({ host, port, user: `postgres.${ref}`, password: senha }),
)
```

Rodar (a partir da raiz do repo, onde `.env.local` existe) e subir tudo pro servidor:

```bash
node /private/tmp/claude-501/-Users-joaquimsalles/f0e3fe4e-5df2-40b3-b55a-40422402afa7/scratchpad/gerar-supabase-conn.mjs
cat /private/tmp/claude-501/-Users-joaquimsalles/f0e3fe4e-5df2-40b3-b55a-40422402afa7/scratchpad/catchup-movimentos.mjs | ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "cat > /root/catchup-movimentos.mjs"
cat /private/tmp/claude-501/-Users-joaquimsalles/f0e3fe4e-5df2-40b3-b55a-40422402afa7/scratchpad/supabase-conn.json | ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "cat > /root/supabase-conn.json && chmod 600 /root/supabase-conn.json"
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "cd /root && node catchup-movimentos.mjs /root/supabase-conn.json"
```

- [ ] **Step 3: Verificar e apagar as credenciais do servidor**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "sudo -u postgres psql -d ntb_frio -tAc \"select loja_id, count(*) from movimentos group by loja_id order by loja_id\""
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "rm -f /root/supabase-conn.json /root/catchup-movimentos.mjs"
```
Esperado: contagens por loja no Contabo bem mais próximas das contagens atuais do Supabase.

---

### Task 5: Backfill histórico desde 01/07/2025 (todas as lojas, ambas as bases)

**Files:** nenhum neste repo (script ad-hoc rodado no servidor Contabo, mesmo padrão do backfill de faturamento).

**Interfaces:**
- Consumes: `POST /movimentos_bulk` não é usado aqui (o script grava direto nas duas bases via `pg`, mais rápido que HTTP por linha); índice único da Task 1.

- [ ] **Step 1: Escrever o script no scratchpad local**

Criar `/private/tmp/claude-501/-Users-joaquimsalles/f0e3fe4e-5df2-40b3-b55a-40422402afa7/scratchpad/backfill-movimentos-fato.mjs`:

```js
// Backfill historico de `movimentos` desde 01/07/2025, todas as lojas.
// Roda NO SERVIDOR Contabo (node 22, pg local + pooler publico do
// Supabase). Sequencial por loja, com checkpoint em arquivo pra retomar
// se cair. Grava nas DUAS bases (mesma chave natural loja_id+id_ajuste,
// on conflict do nothing -- o dado historico nao muda depois de gravado).
// Uso: node backfill-movimentos-fato.mjs <lojas-creds.json> <supabase-conn.json>
import fs from 'node:fs'
import { createRequire } from 'node:module'
const require = createRequire('/opt/ntb-frio-api/')
const { Pool } = require('pg')

const lojas = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const conn = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'))
const supaEnv = fs.readFileSync('/opt/ntb-frio-api/.env', 'utf8')
const localEnv = {}
for (const line of supaEnv.split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) localEnv[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const poolContabo = new Pool({ connectionString: localEnv.DATABASE_URL })
const poolSupabase = new Pool({
  host: conn.host, port: conn.port, user: conn.user, password: conn.password,
  database: 'postgres', ssl: { rejectUnauthorized: false },
})

const CHECKPOINT_FILE = '/root/backfill-movimentos-checkpoint.json'
const checkpoint = fs.existsSync(CHECKPOINT_FILE) ? JSON.parse(fs.readFileSync(CHECKPOINT_FILE, 'utf8')) : {}
const salvarCheckpoint = () => fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(checkpoint))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const TIPOS_VALIDOS = new Set(['ENT', 'SAI', 'SLD', 'TRF', 'TPQ'])
function omieDataParaISO(d) {
  const m = String(d).match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!m) return null
  return `${m[3]}-${m[2]}-${m[1]}`
}
function ajusteParaMovimento(lojaId, a) {
  const data = omieDataParaISO(a.data)
  if (!data || !TIPOS_VALIDOS.has(a.tipo)) return null
  return {
    loja_id: lojaId, id_ajuste: a.id_ajuste, id_prod: a.id_prod || null, tipo: a.tipo,
    quan: a.quantidade ?? 0, valor: a.valor ?? 0,
    codigo_local_estoque: a.codigo_local_estoque || null,
    codigo_local_estoque_destino: a.id_local_ds || null,
    data, motivo: a.motivo || null, obs: a.obs || null,
    origem: a.origem === 'PDV' ? 'PDV' : 'AJU', status: 'Concluido',
  }
}

async function omie(loja, pagina) {
  for (let t = 1; t <= 5; t++) {
    const r = await fetch(`https://app.omie.com.br/api/v1/estoque/ajuste/`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ call: 'ListarAjusteEstoque', app_key: loja.omie_app_key, app_secret: loja.omie_app_secret,
        param: [{ pagina, registros_por_pagina: 500 }] }),
    })
    const j = await r.json()
    if (j.faultstring) {
      if (/redundante|Já existe uma requisição/i.test(j.faultstring)) { await sleep(15000); continue }
      throw new Error(j.faultstring)
    }
    return j
  }
  throw new Error('desistiu apos 5 tentativas')
}

async function gravarLote(linhas) {
  if (!linhas.length) return
  for (const [pool, onConflict] of [[poolContabo, 'do nothing'], [poolSupabase, 'do nothing']]) {
    const client = await pool.connect()
    try {
      await client.query('begin')
      for (const m of linhas) {
        await client.query(
          `insert into movimentos (loja_id, id_ajuste, id_prod, tipo, quan, valor, codigo_local_estoque, codigo_local_estoque_destino, data, motivo, obs, origem, status)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
           on conflict (loja_id, id_ajuste) where id_ajuste is not null ${onConflict}`,
          [m.loja_id, m.id_ajuste, m.id_prod, m.tipo, m.quan, m.valor, m.codigo_local_estoque,
           m.codigo_local_estoque_destino, m.data, m.motivo, m.obs, m.origem, m.status]
        )
      }
      await client.query('commit')
    } catch (e) {
      await client.query('rollback')
      throw e
    } finally {
      client.release()
    }
  }
}

const DATA_CORTE = new Date('2025-07-01T00:00:00Z')

for (const loja of lojas) {
  const lojaId = Number(loja.id)
  let pagina = checkpoint[lojaId]?.proximaPagina ?? 1
  console.log(`\n=== Loja ${lojaId}: retomando da pagina ${pagina} ===`)
  let totPag = 1
  let paradaPorData = false
  do {
    const r = await omie(loja, pagina)
    totPag = r.total_de_paginas ?? 1
    const ajustes = r.ajuste_estoque_lista ?? []
    if (!ajustes.length) break

    const linhas = ajustes.map((a) => ajusteParaMovimento(lojaId, a)).filter(Boolean)
    // A API pagina em ordem crescente de id_ajuste (~ordem cronologica) --
    // quando TODA a pagina ja esta antes da data de corte, para (paginas
    // seguintes so tem datas ainda mais antigas nao, ao contrario: paginas
    // seguintes tem id maior = mais recente. Aqui filtramos por data em vez
    // de parar cedo, pra nao perder linha fora de ordem.
    const dentroDoCorte = linhas.filter((m) => new Date(m.data) >= DATA_CORTE)
    await gravarLote(dentroDoCorte)

    pagina++
    checkpoint[lojaId] = { proximaPagina: pagina }
    salvarCheckpoint()
    console.log(`  pagina ${pagina - 1}/${totPag}: ${ajustes.length} ajustes, ${dentroDoCorte.length} gravados (>=01/07/2025)`)
    await sleep(340)
  } while (pagina <= totPag)
  console.log(`Loja ${lojaId}: backfill completo.`)
}
await poolContabo.end()
await poolSupabase.end()
console.log('\nBACKFILL CONCLUIDO')
```

- [ ] **Step 2: Pedir confirmação, exportar credenciais, subir e rodar no servidor**

Backfill completo em produção (6 lojas, ambas as bases) — confirmar com o usuário antes. Depois:

```bash
node scripts/db.mjs "select id, omie_app_key, omie_app_secret from lojas where ativo=true and omie_app_key is not null order by id" > /private/tmp/claude-501/-Users-joaquimsalles/f0e3fe4e-5df2-40b3-b55a-40422402afa7/scratchpad/lojas-creds.json
cat /private/tmp/claude-501/-Users-joaquimsalles/f0e3fe4e-5df2-40b3-b55a-40422402afa7/scratchpad/backfill-movimentos-fato.mjs | ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "cat > /root/backfill-movimentos-fato.mjs"
cat /private/tmp/claude-501/-Users-joaquimsalles/f0e3fe4e-5df2-40b3-b55a-40422402afa7/scratchpad/lojas-creds.json | ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "cat > /root/lojas-creds.json && chmod 600 /root/lojas-creds.json"
cat /private/tmp/claude-501/-Users-joaquimsalles/f0e3fe4e-5df2-40b3-b55a-40422402afa7/scratchpad/supabase-conn.json | ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "cat > /root/supabase-conn.json && chmod 600 /root/supabase-conn.json"
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "cd /root && nohup node backfill-movimentos-fato.mjs /root/lojas-creds.json /root/supabase-conn.json > /root/backfill-mov.log 2>&1 & echo pid=\$! && disown"
```
(Se o comando ficar preso localmente esperando o SSH fechar, é só o shell remoto não ter fechado stdin — o processo já está rodando desanexado no servidor; confirmar com `ps aux | grep backfill-movimentos` numa segunda conexão SSH e encerrar a conexão travada localmente.)

- [ ] **Step 3: Acompanhar e, ao concluir, apagar as credenciais do servidor**

```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "tail -20 /root/backfill-mov.log"
```
Repetir até ver `BACKFILL CONCLUIDO`. Depois:
```bash
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "rm -f /root/lojas-creds.json /root/supabase-conn.json /root/backfill-movimentos-checkpoint.json"
```

- [ ] **Step 4: Verificar profundidade final**

```bash
node scripts/db.mjs "select loja_id, count(*), min(data)::date, max(data)::date from movimentos group by loja_id order by loja_id"
ssh -i ~/.ssh/notebook_contabo_key root@185.193.66.240 "sudo -u postgres psql -d ntb_frio -tAc \"select loja_id, count(*), min(data)::date, max(data)::date from movimentos group by loja_id order by loja_id\""
```
Esperado: `min(data)` próximo de `2025-07-01` nas 6 lojas, em ambas as bases, com contagens equivalentes entre Supabase e Contabo.

---

## Ordem de execução

Task 1 (índice, pré-requisito de todo o resto) → Task 2 (endpoint) → Task 3 (dual-write no sync, pode rodar em paralelo com Task 4) → Task 4 (catch-up do buraco recente, antes do backfill histórico pra não duplicar trabalho) → Task 5 (backfill histórico, por último — mais pesado e mais lento).
