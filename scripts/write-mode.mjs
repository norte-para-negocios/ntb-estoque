// Executa SQL forcando modo de escrita na sessao (contorna read-only do free tier).
// Uso: node scripts/write-mode.mjs "ALTER TABLE ..."
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

const sql = process.argv.slice(2).join(' ')
if (!sql) { console.error('uso: node scripts/write-mode.mjs "<SQL>"'); process.exit(1) }

const client = new pg.Client({
  host, port, user: `postgres.${ref}`, password: senha,
  database: 'postgres', ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10000, statement_timeout: 60000,
})
await client.connect()
// Tenta desligar read-only antes de executar
try { await client.query('SET default_transaction_read_only = off') } catch {}
const r = await client.query(sql)
if (r.rows?.length) console.log(JSON.stringify(r.rows, null, 2))
else console.log(`OK (${r.rowCount} linha(s) afetada(s))`)
await client.end()
