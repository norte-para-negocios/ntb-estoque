// Enxuga o full_object das ordens_producao, guardando apenas itensDetalhes.
// O resto do payload Omie ja tem colunas escalares e infla o banco inutilmente.
//
// Estimativa de reducao: ~2-3KB por linha -> ~200 bytes (com ingredientes) ou null.
// Com 191k linhas, economia de ~400MB.
//
// Uso: node scripts/slim-full-object-ops.mjs [--loja N] [--dry-run]
//
// Flags:
//   --loja N    so roda para a loja N (default: todas)
//   --dry-run   mostra contagens mas nao grava nada

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
try {
  const saved = fs.readFileSync(`${PROJ}/scripts/.pooler-host`, 'utf8').trim()
  const [h] = saved.split(':')
  if (h) host = h
} catch {}

const db = new pg.Client({
  host, port: 5432, user: `postgres.${ref}`, password: senha,
  database: 'postgres', ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000, statement_timeout: 300000,
})
await db.connect()

const args = process.argv.slice(2)
const argLoja = args.includes('--loja') ? Number(args[args.indexOf('--loja') + 1]) : null
const dryRun = args.includes('--dry-run')

console.log(`\n=== Slim full_object ordens_producao${dryRun ? ' [DRY-RUN]' : ''} ===`)
if (argLoja) console.log(`Filtrando loja: ${argLoja}`)

const BATCH = 2000
let offset = 0
let totalSlim = 0
let totalNull = 0
let totalJaSlim = 0

while (true) {
  const { rows } = await db.query(
    `SELECT id, full_object
     FROM ordens_producao
     WHERE full_object IS NOT NULL
       ${argLoja ? `AND loja_id = ${argLoja}` : ''}
     ORDER BY id
     LIMIT $1 OFFSET $2`,
    [BATCH, offset]
  )

  if (!rows.length) break

  let batchSlim = 0
  let batchNull = 0
  let batchJaSlim = 0

  // Classifica cada linha e prepara atualizacoes
  const toNull = []
  const toUpdate = [] // { id, itensDetalhes }

  for (const row of rows) {
    const fo = row.full_object
    if (!fo) continue

    const keys = Object.keys(fo)
    // Ja slim: so tem itensDetalhes (ou esta vazio)
    const jaSlim = keys.every(k => k === 'itensDetalhes')
    if (jaSlim) { batchJaSlim++; continue }

    const itens = fo.itensDetalhes
    if (itens && Array.isArray(itens) && itens.length) {
      toUpdate.push({ id: row.id, itensDetalhes: itens })
      batchSlim++
    } else {
      toNull.push(row.id)
      batchNull++
    }
  }

  if (!dryRun) {
    // Linhas sem ingredientes: objeto vazio (nao null, para o restaurar-itens-detalhes
    // ainda poder encontra-las via full_object IS NOT NULL + NOT (full_object ? 'itensDetalhes'))
    if (toNull.length) {
      await db.query(
        `UPDATE ordens_producao SET full_object = '{}'::jsonb WHERE id = ANY($1::int[])`,
        [toNull]
      )
    }
    // Linhas com ingredientes: guardar apenas { itensDetalhes: [...] }
    for (const { id, itensDetalhes } of toUpdate) {
      await db.query(
        `UPDATE ordens_producao SET full_object = $1::jsonb WHERE id = $2`,
        [JSON.stringify({ itensDetalhes }), id]
      )
    }
  }

  totalSlim += batchSlim
  totalNull += batchNull
  totalJaSlim += batchJaSlim
  offset += rows.length

  process.stdout.write(
    `\r  Processadas ${offset} linhas | slim: ${totalSlim} | null: ${totalNull} | ja slim: ${totalJaSlim}...`
  )
}

await db.end()
console.log(`\n\n=== Concluido ===`)
console.log(`  Slim (preservou itensDetalhes): ${totalSlim}`)
console.log(`  Null (sem itensDetalhes):       ${totalNull}`)
console.log(`  Ja slim (sem alteracao):        ${totalJaSlim}`)
if (dryRun) console.log('\n  [DRY-RUN] Nenhuma gravacao feita.')
else console.log('\n  IMPORTANTE: rode VACUUM ANALYZE ordens_producao no Supabase para liberar espaco fisico.')
