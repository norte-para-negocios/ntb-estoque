// Aplica CREATE INDEX CONCURRENTLY (nao pode ir dentro de transacao, por isso
// nao usa aplicar-migration.mjs padrao). Uso: node scripts/aplicar-indices-concurrently.mjs
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
const [hh, pp] = fs.readFileSync(`${PROJ}/scripts/.pooler-host`, 'utf8').trim().split(':')

const client = new pg.Client({
  host: hh, port: Number(pp), user: `postgres.${ref}`,
  password: senha, database: 'postgres', ssl: { rejectUnauthorized: false },
  statement_timeout: 0, // CONCURRENTLY pode demorar em tabela grande; sem timeout aqui
})
await client.connect()
console.log('Conectado.')

const statements = [
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_movimentos_transferencia_id
     ON movimentos (transferencia_id) WHERE transferencia_id IS NOT NULL`,
  `CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inventario_items_inventario_id
     ON inventario_items (inventario_id)`,
]

for (const sql of statements) {
  const nome = sql.match(/idx_\w+/)[0]
  console.log(`Criando ${nome}...`)
  const t0 = Date.now()
  await client.query(sql)
  console.log(`  OK em ${((Date.now() - t0) / 1000).toFixed(1)}s`)
}

await client.end()
console.log('Concluido.')
