import fs from 'node:fs'; import pg from 'pg'
const PROJ = process.cwd(); const env = {}
for (const line of fs.readFileSync(`${PROJ}/.env.local`, 'utf8').split(/\r?\n/)) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '') }
const u = new URL(env.SUPABASE_DB_URL); const senha = decodeURIComponent(u.password)
const ref = u.hostname.replace(/^db\./, '').replace(/\.supabase\.co$/, '')
const [hh, pp] = fs.readFileSync(`${PROJ}/scripts/.pooler-host`, 'utf8').trim().split(':')
const db = new pg.Client({ host: hh, port: Number(pp), user: `postgres.${ref}`, password: senha, database: 'postgres', ssl: { rejectUnauthorized: false } })
await db.connect()
const { rows } = await db.query('select id, nome, omie_app_key k, omie_app_secret s from lojas where omie_app_key is not null order by id')
await db.end()

async function omie(key, secret, ep, call, data) {
  const r = await fetch(`https://app.omie.com.br/api/${ep}/`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ call, app_key: key, app_secret: secret, param: [data] })
  })
  return r.json()
}

const STATUS = ['EMABERTO', 'ATRASADO', 'AVENCER', 'VENCEHOJE', 'PAGTO_PARCIAL']
const LOJAS_TEST = rows.slice(0, 3)

console.log('=== Contas a pagar por status (todas as lojas):')
for (const loja of rows) {
  let totals = []
  for (const s of STATUS) {
    const r = await omie(loja.k, loja.s, 'v1/financas/contapagar', 'ListarContasPagar', { pagina: 1, registros_por_pagina: 1, filtrar_por_status: s })
    totals.push(`${s}:${r?.total_de_registros ?? '?'}`)
  }
  console.log(`[Loja ${loja.id}] ${totals.join(' | ')}`)
}

console.log('\n=== Contas a receber EMABERTO por loja:')
for (const loja of LOJAS_TEST) {
  const r = await omie(loja.k, loja.s, 'v1/financas/contareceber', 'ListarContasReceber', { pagina: 1, registros_por_pagina: 1, filtrar_por_status: 'EMABERTO' })
  console.log(`[Loja ${loja.id}] CR EMABERTO: ${r?.total_de_registros ?? '?'}`)
}
