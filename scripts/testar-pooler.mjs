// Descobre uma connection string do Postgres que funcione nesta rede. O "db direct"
// (db.<ref>.supabase.co:5432) costuma ser IPv6-only; o pooler (aws-0-<regiao>.pooler
// .supabase.com) e IPv4. Testa as regioes comuns e reporta a que conecta.
// Uso: node scripts/testar-pooler.mjs
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
console.log('ref:', ref)

const regioes = ['sa-east-1', 'us-east-1', 'us-east-2', 'us-west-1', 'eu-west-1', 'eu-central-1', 'ap-southeast-1']
for (const r of regioes) {
  for (const port of [5432, 6543]) {
    const host = `aws-0-${r}.pooler.supabase.com`
    const c = new pg.Client({
      host,
      port,
      user: `postgres.${ref}`,
      password: senha,
      database: 'postgres',
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 8000,
    })
    try {
      await c.connect()
      await c.query('select 1')
      console.log(`OK -> ${host}:${port}`)
      await c.end()
      process.exit(0)
    } catch (e) {
      console.log(`  falha ${r}:${port} (${e.code || (e.message || '').slice(0, 40)})`)
      try { await c.end() } catch {}
    }
  }
}
console.log('NENHUM pooler conectou')
