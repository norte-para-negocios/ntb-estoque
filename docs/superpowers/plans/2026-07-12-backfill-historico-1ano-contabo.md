# Backfill de histórico (1 ano) para o Contabo + poda no Supabase — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Copiar o histórico já existente no Supabase (`movimentos`, `movimentos_historico`, `notas_fiscais`, `nota_fiscal_items`, `webhooks`) pro Postgres do Contabo, completar via API do Omie o buraco de histórico de `ordens_producao` (2025-07 a 2026-03), validar por contagem, e só então podar do Supabase tudo mais antigo que 90 dias — aliviando o banco que está em 482MB/500MB (96,4%).

**Architecture:** Todos os scripts rodam no próprio servidor Contabo (`185.193.66.240`) via SSH, em `/opt/ntb-backfill/`, lendo do Supabase pelo pooler (conectividade já confirmada) e escrevendo no Postgres local (`ntb_frio`). Nenhum script roda na Vercel/máquina local. Nenhuma leitura existente do app é tocada até a Task 7 (poda), que só executa depois de validação por contagem.

**Tech Stack:** Node.js + `pg` + `dotenv` (mesmo stack já usado em `ntb-frio-api`), SSH (`ssh2` via `scratchpad/ssh-run.mjs`), Postgres 17.

## Global Constraints

- Nenhuma linha é apagada do Supabase antes de confirmar por contagem que o Contabo tem o equivalente.
- Poda sempre com dry-run primeiro; só executa de verdade com flag explícita `--commit`.
- Scripts contra a API do Omie rodam sequencial por loja, nunca paralelo (Omie trata chamada concorrente da mesma `app_key` como "consumo redundante").
- Não editar nenhum script já existente em `scripts/` do repo — tudo aqui é novo, isolado em `/opt/ntb-backfill/` no servidor.
- Não mexer no Laravel legado nem no MariaDB do Contabo.
- SSH: `root@185.193.66.240` com a chave em `scratchpad/ssh/contabo_key` (usar `scratchpad/ssh-run.mjs "<comando>"` para rodar comandos remotos a partir da máquina local, ou copiar scripts via base64 + `ssh -i chave root@185.193.66.240 "cat > arquivo"`).

---

### Task 1: Ambiente de trabalho no Contabo

**Interfaces:**
- Produces: diretório `/opt/ntb-backfill/` no servidor, com `.env` contendo `SUPABASE_URL` e `CONTABO_PG_URL`, prontas para os scripts das próximas tasks.

- [ ] **Step 1: Criar o diretório e instalar dependências**

Via `scratchpad/ssh-run.mjs`:

```bash
mkdir -p /opt/ntb-backfill && cd /opt/ntb-backfill && npm init -y && npm install pg dotenv
```

- [ ] **Step 2: Criar o `.env`**

```bash
cat > /opt/ntb-backfill/.env << 'EOF'
SUPABASE_URL=postgresql://postgres.waubqgkftwrufepwhctc:rscarneiro3484*@aws-1-sa-east-1.pooler.supabase.com:5432/postgres?sslmode=require
CONTABO_PG_URL=postgresql://ntb_frio_app:pnQMFTbn7KfYe496CJyLvknByYuHepADXGGFBAXd@localhost:5432/ntb_frio
EOF
chmod 600 /opt/ntb-backfill/.env
```

- [ ] **Step 3: Smoke test de conectividade**

```bash
cd /opt/ntb-backfill && node -e "
require('dotenv').config();
const { Client } = require('pg');
(async () => {
  const s = new Client({ connectionString: process.env.SUPABASE_URL });
  const c = new Client({ connectionString: process.env.CONTABO_PG_URL });
  await s.connect(); await c.connect();
  console.log('Supabase:', (await s.query('select 1 as ok')).rows[0]);
  console.log('Contabo:', (await c.query('select 1 as ok')).rows[0]);
  await s.end(); await c.end();
})();
"
```

Expected: as duas linhas imprimem `{ ok: 1 }`.

---

### Task 2: Copiar tabelas prontas (Supabase → Contabo)

**Files:**
- Create (no servidor, via SSH): `/opt/ntb-backfill/copiar-tabelas.mjs`

**Interfaces:**
- Consumes: `.env` da Task 1
- Produces: tabelas `movimentos`, `movimentos_historico`, `notas_fiscais`, `nota_fiscal_items`, `ordens_producao` criadas em `ntb_frio` com todas as linhas atuais do Supabase (schema idêntico, `drop + create + insert`)

- [ ] **Step 1: Criar o script**

```javascript
// /opt/ntb-backfill/copiar-tabelas.mjs
import 'dotenv/config'
import pg from 'pg'

const TABELAS = process.argv.slice(2)
if (!TABELAS.length) {
  console.error('Uso: node copiar-tabelas.mjs <tabela1> <tabela2> ...')
  process.exit(1)
}

const supabase = new pg.Client({ connectionString: process.env.SUPABASE_URL })
const contabo = new pg.Client({ connectionString: process.env.CONTABO_PG_URL })
await supabase.connect()
await contabo.connect()

async function copiarTabela(TABLE) {
  console.log(`\n=== ${TABLE} ===`)

  const schemaRes = await supabase.query(`
    select column_name, data_type, character_maximum_length
    from information_schema.columns
    where table_name = $1 and table_schema = 'public'
    order by ordinal_position
  `, [TABLE])

  if (!schemaRes.rows.length) {
    console.log(`Tabela ${TABLE} nao encontrada no Supabase, pulando.`)
    return
  }

  const colDefs = schemaRes.rows.map((c) => {
    let type = c.data_type
    if (c.character_maximum_length) type += `(${c.character_maximum_length})`
    return `"${c.column_name}" ${type}`
  })
  const colNames = schemaRes.rows.map((c) => c.column_name)
  const temId = colNames.includes('id')

  await contabo.query(`drop table if exists "${TABLE}";`)
  await contabo.query(`create table "${TABLE}" (${colDefs.join(', ')});`)
  console.log(`Tabela criada no Contabo (${colNames.length} colunas).`)

  const totalEsperado = Number((await supabase.query(`select count(*) from "${TABLE}"`)).rows[0].count)
  console.log(`${totalEsperado} linhas a copiar.`)

  const BATCH = 1000
  let copiadas = 0
  let lastId = 0

  for (;;) {
    const dataRes = temId
      ? await supabase.query(`select * from "${TABLE}" where id > $1 order by id limit ${BATCH}`, [lastId])
      : await supabase.query(
          `select * from "${TABLE}" order by ${colNames.map((c) => `"${c}"`).join(', ')} offset ${copiadas} limit ${BATCH}`
        )

    if (!dataRes.rows.length) break

    const placeholders = []
    const values = []
    dataRes.rows.forEach((row, i) => {
      placeholders.push(`(${colNames.map((_, j) => `$${i * colNames.length + j + 1}`).join(', ')})`)
      colNames.forEach((c) => values.push(row[c]))
    })

    await contabo.query(
      `insert into "${TABLE}" (${colNames.map((c) => `"${c}"`).join(', ')}) values ${placeholders.join(', ')}`,
      values
    )

    copiadas += dataRes.rows.length
    if (temId) lastId = dataRes.rows[dataRes.rows.length - 1].id
    process.stdout.write(`\r${copiadas}/${totalEsperado} copiadas...`)
  }

  console.log(`\n${copiadas} linhas copiadas.`)
  const countContabo = Number((await contabo.query(`select count(*) from "${TABLE}"`)).rows[0].count)
  console.log(`Confirmacao: Supabase>=${totalEsperado} Contabo=${countContabo} OK=${countContabo >= totalEsperado}`)
}

for (const t of TABELAS) {
  await copiarTabela(t)
}

await supabase.end()
await contabo.end()
```

- [ ] **Step 2: Transferir o script pro servidor**

Da máquina local (o SCP direto falha neste servidor — usar base64 via SSH, mesma técnica já usada para os scripts anteriores):

```bash
node -e "
const fs = require('fs');
const b64 = fs.readFileSync('copiar-tabelas.mjs').toString('base64');
console.log(b64);
" > /tmp/copiar-tabelas.b64
```

Depois enviar o conteúdo de `/tmp/copiar-tabelas.b64` via `scratchpad/ssh-run.mjs "echo '<base64>' | base64 -d > /opt/ntb-backfill/copiar-tabelas.mjs"`.

- [ ] **Step 3: Rodar para as 5 tabelas (notas_fiscais antes de nota_fiscal_items)**

```bash
cd /opt/ntb-backfill && node copiar-tabelas.mjs movimentos movimentos_historico notas_fiscais nota_fiscal_items ordens_producao
```

Expected: para cada tabela, linha final `OK=true`. Isso pode levar vários minutos (maior tabela: `movimentos_historico` com ~421k linhas).

- [ ] **Step 4: Conferir contagens finais**

```bash
sudo -u postgres psql -d ntb_frio -c "
select 'movimentos' t, count(*) from movimentos
union all select 'movimentos_historico', count(*) from movimentos_historico
union all select 'notas_fiscais', count(*) from notas_fiscais
union all select 'nota_fiscal_items', count(*) from nota_fiscal_items
union all select 'ordens_producao', count(*) from ordens_producao;
"
```

---

### Task 3: Merge de `webhooks` (não sobrescrever o que o dual-write já gravou)

**Files:**
- Create (no servidor): `/opt/ntb-backfill/merge-webhooks.mjs`

**Interfaces:**
- Consumes: tabela `webhooks` já existente em `ntb_frio` (criada antes, recebendo gravações do dual-write em produção desde a ativação)
- Produces: `webhooks` no Contabo com todo o histórico do Supabase mesclado, sem duplicar as linhas que o dual-write já gravou

**Por que não é um `drop + create` como a Task 2:** `webhooks` já tem linhas novas gravadas em produção pelo dual-write (não existiam quando a spec original foi escrita). Um `drop table` apagaria essas linhas.

- [ ] **Step 1: Confirmar que não há duplicata em `(loja_id, message_id)` antes de travar a constraint**

```bash
sudo -u postgres psql -d ntb_frio -c "select loja_id, message_id, count(*) from webhooks group by loja_id, message_id having count(*) > 1;"
```

Expected: 0 linhas. (Se houver alguma, investigar antes de prosseguir — não deveria acontecer, já que o dual-write só grava depois da dedupe no Supabase.)

- [ ] **Step 2: Adicionar a constraint UNIQUE (o índice já existe, mas não é único)**

```bash
sudo -u postgres psql -d ntb_frio -c "alter table webhooks add constraint uq_webhooks_loja_message unique (loja_id, message_id);"
```

- [ ] **Step 3: Criar e transferir o script de merge**

```javascript
// /opt/ntb-backfill/merge-webhooks.mjs
import 'dotenv/config'
import pg from 'pg'

const supabase = new pg.Client({ connectionString: process.env.SUPABASE_URL })
const contabo = new pg.Client({ connectionString: process.env.CONTABO_PG_URL })
await supabase.connect()
await contabo.connect()

const totalEsperado = Number((await supabase.query(`select count(*) from webhooks`)).rows[0].count)
console.log(`${totalEsperado} linhas no Supabase.`)

const BATCH = 1000
let lastId = 0
let vistas = 0
let inseridas = 0

for (;;) {
  const res = await supabase.query(
    `select id, loja_id, message_id, message, created_at, updated_at from webhooks where id > $1 order by id limit ${BATCH}`,
    [lastId]
  )
  if (!res.rows.length) break

  for (const row of res.rows) {
    const r = await contabo.query(
      `insert into webhooks (loja_id, message_id, message, created_at, updated_at)
       values ($1, $2, $3, $4, $5)
       on conflict (loja_id, message_id) do nothing`,
      [row.loja_id, row.message_id, row.message, row.created_at, row.updated_at]
    )
    if (r.rowCount) inseridas++
  }

  vistas += res.rows.length
  lastId = res.rows[res.rows.length - 1].id
  process.stdout.write(`\r${vistas}/${totalEsperado} vistas, ${inseridas} novas inseridas...`)
}

console.log(`\nConcluido.`)
const totalContabo = (await contabo.query(`select count(*) from webhooks`)).rows[0].count
console.log(`Total no Contabo agora: ${totalContabo}`)

await supabase.end()
await contabo.end()
```

Transferir com a mesma técnica base64 da Task 2 (Step 2).

- [ ] **Step 4: Rodar**

```bash
cd /opt/ntb-backfill && node merge-webhooks.mjs
```

Expected: total final no Contabo >= total do Supabase (nunca menor).

---

### Task 4: Backfill de `ordens_producao` via Omie (2025-07 a 2026-03)

**Files:**
- Create (no servidor): `/opt/ntb-backfill/backfill-ops.mjs`

**Interfaces:**
- Consumes: tabela `ordens_producao` já populada pela Task 2 (cobre 2026-04 em diante); tabela `lojas` do Supabase (leitura de `omie_app_key`/`omie_app_secret`)
- Produces: linhas de `ordens_producao` no Contabo cobrindo 2025-07 a 2026-03, completando 1 ano de histórico

- [ ] **Step 1: Adicionar constraint UNIQUE em `ordens_producao` (necessária pro `ON CONFLICT` do backfill)**

```bash
sudo -u postgres psql -d ntb_frio -c "alter table ordens_producao add constraint uq_op_loja_cod unique (loja_id, identificacao_n_cod_op);"
```

- [ ] **Step 2: Criar o script**

```javascript
// /opt/ntb-backfill/backfill-ops.mjs
import 'dotenv/config'
import pg from 'pg'

const supabase = new pg.Client({ connectionString: process.env.SUPABASE_URL })
const contabo = new pg.Client({ connectionString: process.env.CONTABO_PG_URL })
await supabase.connect()
await contabo.connect()

const { rows: lojas } = await supabase.query(`
  select id, omie_app_key, omie_app_secret from lojas
  where ativo = true and omie_app_key is not null
`)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function omieListar(appKey, appSecret, pagina, ini, fim) {
  const resp = await fetch('https://app.omie.com.br/api/v1/produtos/op/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app_key: appKey,
      app_secret: appSecret,
      call: 'ListarOrdemProducao',
      param: [
        {
          pagina,
          registros_por_pagina: 100,
          ordem_decrescente: 'S',
          ordenar_por: 'dConclusao',
          dDtConclusaoDe: ini,
          dDtConclusaoAte: fim,
        },
      ],
    }),
  })
  const json = await resp.json()
  if (json.faultstring) {
    if (/n[aã]o existem registros/i.test(json.faultstring)) return { cadastros: [], total_de_paginas: 0 }
    throw new Error(json.faultstring)
  }
  return json
}

function parseDate(d) {
  if (!d) return null
  const m = d.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (!m) return null
  return `${m[3]}-${m[2]}-${m[1]}`
}

function mapOP(lojaId, op) {
  const ident = op.identificacao ?? {}
  const outrasInf = op.outrasInf ?? {}
  const itens = op.itensDetalhes
  return {
    loja_id: lojaId,
    num_ordem: ident.cNumOP ?? null,
    identificacao_n_cod_op: ident.nCodOP ?? null,
    identificacao_c_cod_int_op: ident.cCodIntOP ?? null,
    identificacao_c_num_op: ident.cNumOP ?? null,
    identificacao_n_cod_produto: ident.nCodProduto ?? null,
    identificacao_d_dt_previsao: parseDate(ident.dDtPrevisao),
    identificacao_n_qtde: ident.nQtde ?? null,
    identificacao_codigo_local_estoque: ident.codigo_local_estoque ?? null,
    concluida: outrasInf.cConcluida === 'S',
    dt_conclusao_real: parseDate(outrasInf.dConclusao),
    dt_inclusao: parseDate(outrasInf.dInclusao),
    full_object: itens?.length ? JSON.stringify({ itensDetalhes: itens }) : null,
  }
}

async function inserirLote(ops) {
  if (!ops.length) return 0
  const cols = [
    'loja_id', 'num_ordem', 'identificacao_n_cod_op', 'identificacao_c_cod_int_op',
    'identificacao_c_num_op', 'identificacao_n_cod_produto', 'identificacao_d_dt_previsao',
    'identificacao_n_qtde', 'identificacao_codigo_local_estoque', 'concluida',
    'dt_conclusao_real', 'dt_inclusao', 'full_object',
  ]
  const placeholders = []
  const values = []
  ops.forEach((op, i) => {
    placeholders.push(`(${cols.map((_, j) => `$${i * cols.length + j + 1}`).join(', ')})`)
    cols.forEach((c) => values.push(op[c]))
  })
  const r = await contabo.query(
    `
    insert into ordens_producao (${cols.map((c) => `"${c}"`).join(', ')})
    values ${placeholders.join(', ')}
    on conflict (loja_id, identificacao_n_cod_op) do update set
      full_object = excluded.full_object,
      concluida = excluded.concluida,
      dt_conclusao_real = excluded.dt_conclusao_real,
      updated_at = now()
  `,
    values
  )
  return r.rowCount ?? 0
}

// Buraco: jul/2025 ate mar/2026 (abr/2026 em diante ja veio da Task 2)
const meses = []
for (const [ano, ini, fim] of [
  [2025, 7, 12],
  [2026, 1, 3],
]) {
  for (let m = ini; m <= fim; m++) {
    const mm = String(m).padStart(2, '0')
    const ult = new Date(ano, m, 0).getDate()
    meses.push([`01/${mm}/${ano}`, `${String(ult).padStart(2, '0')}/${mm}/${ano}`])
  }
}

console.log(`=== Backfill OPs: ${lojas.length} lojas x ${meses.length} meses ===\n`)
let totalGlobal = 0

for (const loja of lojas) {
  console.log(`[Loja ${loja.id}]`)
  let total = 0

  for (const [ini, fim] of meses) {
    let pagina = 1
    let totalPaginas = 1
    let mesOk = 0
    let tentativasErro = 0

    do {
      try {
        const res = await omieListar(loja.omie_app_key, loja.omie_app_secret, pagina, ini, fim)
        totalPaginas = res.total_de_paginas || 0
        const ops = (res.cadastros ?? []).map((op) => mapOP(loja.id, op)).filter((o) => o.identificacao_n_cod_op)
        mesOk += await inserirLote(ops)
        tentativasErro = 0
      } catch (e) {
        tentativasErro++
        console.log(`\n  ERRO [${ini}] pag ${pagina}: ${e.message}`)
        if (tentativasErro >= 3) {
          console.log('  Desistindo deste mes apos 3 erros.')
          break
        }
        await sleep(5000)
        continue
      }
      process.stdout.write(`\r  ${ini} pag ${pagina}/${totalPaginas} — ${total + mesOk} gravadas...`)
      pagina++
      await sleep(500)
    } while (pagina <= totalPaginas)

    total += mesOk
  }

  console.log(`\n  Total loja ${loja.id}: ${total}\n`)
  totalGlobal += total
}

await supabase.end()
await contabo.end()
console.log(`=== Concluido: ${totalGlobal} OPs gravadas/atualizadas ===`)
```

Transferir com a mesma técnica base64 já usada.

- [ ] **Step 3: Rodar em background (pode levar bastante tempo: 6 lojas x 21 meses x paginação)**

```bash
cd /opt/ntb-backfill && nohup node backfill-ops.mjs > backfill-ops.log 2>&1 &
```

- [ ] **Step 4: Acompanhar o progresso**

```bash
tail -f /opt/ntb-backfill/backfill-ops.log
```

Expected: ao final, `=== Concluido: N OPs gravadas/atualizadas ===` sem lojas travadas em erro.

---

### Task 5: Validação cruzada de contagens

**Interfaces:**
- Consumes: dados gravados nas Tasks 2-4

- [ ] **Step 1: Comparar contagem total por tabela (Supabase vs Contabo)**

```bash
cd /opt/ntb-backfill && node -e "
require('dotenv').config();
const { Client } = require('pg');
(async () => {
  const s = new Client({ connectionString: process.env.SUPABASE_URL });
  const c = new Client({ connectionString: process.env.CONTABO_PG_URL });
  await s.connect(); await c.connect();
  for (const t of ['movimentos','movimentos_historico','notas_fiscais','nota_fiscal_items','ordens_producao','webhooks']) {
    const sc = (await s.query('select count(*) from \"' + t + '\"')).rows[0].count;
    const cc = (await c.query('select count(*) from \"' + t + '\"')).rows[0].count;
    console.log(t + ': Supabase=' + sc + ' Contabo=' + cc + ' OK=' + (Number(cc) >= Number(sc)));
  }
  await s.end(); await c.end();
})();
"
```

Expected: `OK=true` em todas as 6 linhas. Se alguma vier `false`, não avançar para a Task 7 (poda) até investigar e corrigir.

- [ ] **Step 2: Conferir que `ordens_producao` agora cobre 1 ano completo no Contabo**

```bash
sudo -u postgres psql -d ntb_frio -c "select min(dt_conclusao_real), max(dt_conclusao_real), count(*) from ordens_producao;"
```

Expected: `min` próximo de 2025-07 (algumas OPs de meses sem movimento podem não existir, isso é normal).

---

### Task 6: Revisar leituras existentes antes de podar

**Files:**
- Read only: `lib/resumo-dia.ts:171`, `lib/resumo-dia.ts:389`, e qualquer arquivo em `app/relatorio-*` que leia `movimentos`, `movimentos_historico`, `notas_fiscais` ou `ordens_producao`

- [ ] **Step 1: Confirmar a janela de datas usada em cada leitura**

```bash
grep -rn "movimentos_historico\|from('movimentos')\|from('notas_fiscais')\|from('ordens_producao')" lib/ app/ --include="*.ts" --include="*.tsx"
```

Para cada ocorrência, verificar se o filtro de data (se houver) fica dentro de 90 dias. Se alguma consulta não filtrar por data (ex: relatório histórico completo), documentar como exceção e excluir aquela tabela específica da poda da Task 7, ou aumentar a janela apenas para ela.

Expected: nenhuma leitura em produção depende de dado além de 90 dias — o já investigado `lib/resumo-dia.ts` consulta o dia corrente/recente.

---

### Task 7: Poda no Supabase

**Files:**
- Create (no servidor): `/opt/ntb-backfill/podar-supabase.mjs`

**Interfaces:**
- Consumes: validação da Task 5 (contagens batendo) e revisão da Task 6 (nenhuma leitura quebrada)

- [ ] **Step 1: Criar o script**

```javascript
// /opt/ntb-backfill/podar-supabase.mjs
import 'dotenv/config'
import pg from 'pg'

const COMMIT = process.argv.includes('--commit')
const supabase = new pg.Client({ connectionString: process.env.SUPABASE_URL })
const contabo = new pg.Client({ connectionString: process.env.CONTABO_PG_URL })
await supabase.connect()
await contabo.connect()

const CUTOFF_DIAS = 90
const cutoff = new Date(Date.now() - CUTOFF_DIAS * 86400000).toISOString().slice(0, 10)
console.log(`Cutoff: ${cutoff} (${COMMIT ? 'MODO COMMIT' : 'DRY-RUN'})\n`)

async function podarPorColuna(nome, coluna) {
  const supabaseCount = Number(
    (await supabase.query(`select count(*) from "${nome}" where "${coluna}" < $1`, [cutoff])).rows[0].count
  )
  const contaboCount = Number(
    (await contabo.query(`select count(*) from "${nome}" where "${coluna}" < $1`, [cutoff])).rows[0].count
  )
  const seguro = contaboCount >= supabaseCount
  console.log(`${nome}: Supabase(<${cutoff})=${supabaseCount} Contabo(<${cutoff})=${contaboCount} Seguro=${seguro}`)
  if (!seguro) {
    console.log(`  ABORTADO: Contabo tem menos linhas que o Supabase pro periodo.`)
    return
  }
  if (COMMIT) {
    const r = await supabase.query(`delete from "${nome}" where "${coluna}" < $1`, [cutoff])
    console.log(`  Deletado: ${r.rowCount} linhas.`)
  } else {
    console.log(`  [dry-run] Seria deletado: ${supabaseCount} linhas.`)
  }
}

async function podarNotaFiscalItems() {
  const nfIdsRes = await supabase.query(`select id from notas_fiscais where d_emissao_nfe < $1`, [cutoff])
  const nfIds = nfIdsRes.rows.map((r) => r.id)
  const itemCount = nfIds.length
    ? Number(
        (await supabase.query(`select count(*) from nota_fiscal_items where nota_fiscal_id = any($1)`, [nfIds]))
          .rows[0].count
      )
    : 0
  console.log(`nota_fiscal_items: ${nfIds.length} notas antigas, ${itemCount} itens a remover`)
  if (itemCount && COMMIT) {
    const r = await supabase.query(`delete from nota_fiscal_items where nota_fiscal_id = any($1)`, [nfIds])
    console.log(`  Deletado: ${r.rowCount} itens.`)
  } else if (itemCount) {
    console.log(`  [dry-run] Seria deletado: ${itemCount} itens.`)
  }
}

await podarNotaFiscalItems()
await podarPorColuna('notas_fiscais', 'd_emissao_nfe')
await podarPorColuna('movimentos', 'data')
await podarPorColuna('movimentos_historico', 'data')
await podarPorColuna('ordens_producao', 'dt_conclusao_real')

await supabase.end()
await contabo.end()
```

Transferir via base64, mesma técnica das tasks anteriores.

- [ ] **Step 2: Rodar em dry-run e revisar a saída com atenção**

```bash
cd /opt/ntb-backfill && node podar-supabase.mjs
```

Expected: todas as linhas `Seguro=true`, nenhum `ABORTADO`. Anotar quantas linhas seriam removidas por tabela.

- [ ] **Step 3: Medir o tamanho do banco Supabase antes**

```bash
node scripts/db.mjs "select pg_size_pretty(pg_database_size(current_database()))"
```

(Rodar esta a partir da máquina local, no diretório do projeto — usa a conexão já configurada em `scripts/db.mjs`.)

- [ ] **Step 4: Rodar de verdade**

```bash
cd /opt/ntb-backfill && node podar-supabase.mjs --commit
```

- [ ] **Step 5: Confirmar o tamanho do banco depois**

```bash
node scripts/db.mjs "select pg_size_pretty(pg_database_size(current_database()))"
```

Expected: tamanho visivelmente menor que os 482MB de antes.

---

### Task 8: Documentar

**Files:**
- Modify: `AGENTS.md`

- [ ] **Step 1: Atualizar `AGENTS.md`**

Adicionar uma seção descrevendo: o dual-write de `webhooks` (já documentado na spec anterior), o backfill de histórico completo (esta spec), a divisão de responsabilidade Supabase (janela quente, 90 dias) vs Contabo (histórico completo, para sempre), e a limitação conhecida de que `webhooks` anteriores à ativação do dual-write (antes de 2026-07-12) foram perdidos pelo prune de 7 dias que já existia e não são recuperáveis.

- [ ] **Step 2: Commit**

```bash
git add AGENTS.md
git commit -m "docs: documenta backfill de historico e divisao Supabase/Contabo"
git push origin main
```
