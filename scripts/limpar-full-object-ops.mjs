// Libera ~174 MB zerando full_object de ordens_producao em batches.
// Antes de zerar, extrai observacoes.cObs para a coluna `observacao`.
// Roda em lotes de 5000 para nao fazer timeout no pooler.
// Uso: node scripts/limpar-full-object-ops.mjs

import fs from 'node:fs'
import pg from 'pg'

const PROJ = process.cwd()
const env = {}
for (const line of fs.readFileSync(`${PROJ}/.env.local`, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const u = new URL(env.SUPABASE_DB_URL)
const senha = decodeURIComponent(u.password)
const ref = u.hostname.replace(/^db\./, '').replace(/\.supabase\.co$/, '')

let host = 'aws-1-sa-east-1.pooler.supabase.com'
let port = 5432
try {
  const saved = fs.readFileSync(`${PROJ}/scripts/.pooler-host`, 'utf8').trim()
  const [h, p] = saved.split(':')
  if (h) host = h
  if (p) port = Number(p)
} catch {}

function novoClient() {
  return new pg.Client({
    host, port, user: `postgres.${ref}`, password: senha,
    database: 'postgres', ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 10000, statement_timeout: 30000,
  })
}

const BATCH = 5000

async function runBatches(descricao, sql) {
  let total = 0
  while (true) {
    const client = novoClient()
    await client.connect()
    await client.query('SET default_transaction_read_only = off')
    const r = await client.query(sql)
    await client.end()
    total += r.rowCount
    process.stdout.write(`\r  ${descricao}: ${total} linhas processadas...`)
    if (r.rowCount === 0) break
  }
  console.log(` concluido (${total} linhas)`)
}

console.log('=== Limpeza full_object de ordens_producao ===')
console.log('')

// Passo 1: extrair cObs para coluna observacao (onde ainda nao foi extraido)
await runBatches(
  'Extraindo cObs',
  `UPDATE ordens_producao
   SET observacao = full_object -> 'observacoes' ->> 'cObs'
   WHERE id IN (
     SELECT id FROM ordens_producao
     WHERE full_object IS NOT NULL
       AND full_object -> 'observacoes' ->> 'cObs' IS NOT NULL
       AND (observacao IS NULL OR observacao = '')
     LIMIT ${BATCH}
   )`
)

// Passo 2: zerar full_object (a maior parte do espaco)
await runBatches(
  'Zerando full_object',
  `UPDATE ordens_producao
   SET full_object = NULL
   WHERE id IN (
     SELECT id FROM ordens_producao
     WHERE full_object IS NOT NULL
     LIMIT ${BATCH}
   )`
)

console.log('')
console.log('Feito! Rode VACUUM FULL ordens_producao no Supabase Dashboard para recuperar o espaco fisico.')
