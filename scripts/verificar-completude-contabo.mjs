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
  // Via supavisor (porta 54322) o usuario precisa ser qualificado por tenant
  // (postgres.<POOLER_TENANT_ID>) mesmo em loopback -- 'postgres' sem
  // qualificar da ENOIDENTIFIER. Mesmo padrao/env var de
  // scripts/sync-auth-standby.mjs (que roda com STANDBY_PG_USER=postgres.ntbestoque
  // no cron real).
  user: process.env.STANDBY_PG_USER || 'postgres',
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
