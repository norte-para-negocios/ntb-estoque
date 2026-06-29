// Limpeza de banco NTB: aplica politica de retencao de 12 meses.
// Uso: node scripts/limpar-banco.mjs
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
    connectionTimeoutMillis: 10000, statement_timeout: 60000,
  })
}

async function sql(query) {
  const client = novoClient()
  await client.connect()
  await client.query('SET default_transaction_read_only = off')
  const r = await client.query(query)
  await client.end()
  return r
}

async function batchDelete(descricao, query) {
  let total = 0
  while (true) {
    const r = await sql(query)
    total += r.rowCount
    process.stdout.write(`\r  ${descricao}: ${total} linhas removidas...`)
    if (r.rowCount === 0) break
  }
  console.log(` concluido`)
  return total
}

console.log('=== Limpeza NTB - politica de retencao 12 meses ===\n')

// 1. Limpar integration_attempts (logs operacionais, sem valor historico)
console.log('[1/5] Truncando integration_attempts (logs de integracao)...')
const r1 = await sql('TRUNCATE TABLE integration_attempts RESTART IDENTITY')
console.log('  Concluido.')

// 2. Zerar full_object das ordens_producao (ja extraiu observacao em run anterior)
console.log('[2/5] Zerando full_object de ordens_producao...')
await batchDelete(
  'full_object',
  `UPDATE ordens_producao SET
     observacao = COALESCE(observacao, full_object -> 'observacoes' ->> 'cObs'),
     full_object = NULL
   WHERE id IN (SELECT id FROM ordens_producao WHERE full_object IS NOT NULL LIMIT 5000)`
)

// 3. Deletar ordens_producao com mais de 12 meses (identificacao_d_dt_previsao < hoje-365)
console.log('[3/5] Deletando OPs com previsao anterior a 12 meses...')
const corte_op = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
const n3 = await batchDelete(
  'OPs antigas',
  `DELETE FROM ordens_producao
   WHERE id IN (
     SELECT id FROM ordens_producao
     WHERE identificacao_d_dt_previsao < '${corte_op}'
     LIMIT 5000
   )`
)

// 4. Deletar movimentos_historico com mais de 12 meses
console.log('[4/5] Deletando movimentos_historico com mais de 12 meses...')
const corte_mov = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
const n4 = await batchDelete(
  'movimentos antigos',
  `DELETE FROM movimentos_historico
   WHERE ctid IN (
     SELECT ctid FROM movimentos_historico
     WHERE data < '${corte_mov}'
     LIMIT 5000
   )`
)

// 5. Limpar webhooks processados com mais de 7 dias
console.log('[5/5] Deletando webhooks antigos (>7 dias)...')
await batchDelete(
  'webhooks',
  `DELETE FROM webhooks
   WHERE id IN (
     SELECT id FROM webhooks
     WHERE created_at < NOW() - INTERVAL '7 days'
     LIMIT 5000
   )`
)

console.log('\n=== Limpeza concluida ===')
console.log(`  OPs deletadas:         ~${n3}`)
console.log(`  Movimentos deletados:  ~${n4}`)
console.log('\nProximos passos:')
console.log('  1. Acesse Supabase Dashboard > Database > Vacuum')
console.log('  2. Execute VACUUM FULL nas tabelas: ordens_producao, movimentos_historico, integration_attempts')
console.log('  3. O espaco fisico sera liberado apos o VACUUM.')
