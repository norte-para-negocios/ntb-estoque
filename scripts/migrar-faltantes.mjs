// Copia tabelas que faltaram: inventarios + inventario_items
import pg from 'pg'

const OLD = { host: 'aws-1-sa-east-1.pooler.supabase.com', port: 5432, user: 'postgres.ocpytiqhjfxfqcosytdx', password: 'rscarneiro3484*', database: 'postgres', ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000, statement_timeout: 60000 }
const NEW = { host: 'aws-1-sa-east-1.pooler.supabase.com', port: 5432, user: 'postgres.waubqgkftwrufepwhctc', password: 'rscarneiro3484*', database: 'postgres', ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000, statement_timeout: 120000 }

function log(msg) { console.log(`[${new Date().toISOString().slice(11,19)}] ${msg}`) }

async function query(config, sql, params) {
  const client = new pg.Client(config)
  await client.connect()
  const r = await client.query(sql, params)
  await client.end()
  return r
}

async function copiar(nome, sql, colunas) {
  const jatem = parseInt((await query(NEW, `SELECT COUNT(*) AS n FROM ${nome}`)).rows[0].n)
  const total = parseInt((await query(OLD, `SELECT COUNT(*) AS n FROM (${sql}) t`)).rows[0].n)
  log(`${nome}: ${jatem} no novo / ${total} no antigo`)
  if (jatem >= total) { log(`  completo, pulando.`); return }

  const BATCH = 1000
  let offset = jatem, inseridos = 0, erros = 0
  while (true) {
    const r = await query(OLD, `${sql} LIMIT ${BATCH} OFFSET ${offset}`)
    if (!r.rows.length) break
    const cols = colunas || Object.keys(r.rows[0])
    const vals = r.rows.map((_, i) => `(${cols.map((_, j) => `$${i*cols.length+j+1}`).join(',')})`).join(',')
    const params = r.rows.flatMap(row => cols.map(c => {
      const v = row[c]
      if (v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) return JSON.stringify(v)
      return v
    }))
    try {
      await query(NEW, `INSERT INTO ${nome} (${cols.join(',')}) VALUES ${vals} ON CONFLICT DO NOTHING`, params)
      inseridos += r.rows.length
    } catch(e) {
      erros += r.rows.length
      log(`  ERRO offset ${offset}: ${e.message.slice(0,100)}`)
    }
    offset += r.rows.length
    process.stdout.write(`\r  ${offset}/${total}...`)
    if (r.rows.length < BATCH) break
  }
  console.log(`\r  Concluido: ${inseridos} inseridos, ${erros} erros.   `)
}

log('=== TABELAS FALTANTES ===')
await copiar('inventarios', `SELECT id, loja_id, codigo_local_estoque, data, tipo, origem, motivo, finalizado, status, created_at, updated_at FROM inventarios ORDER BY id`)
await copiar('inventario_items', `SELECT * FROM inventario_items ORDER BY id`)
log('=== FIM ===')
