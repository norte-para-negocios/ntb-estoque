import fs from 'node:fs'; import pg from 'pg'
const PROJ = process.cwd(); const env = {}
for (const line of fs.readFileSync(`${PROJ}/.env.local`, 'utf8').split(/\r?\n/)) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '') }
const u = new URL(env.SUPABASE_DB_URL); const senha = decodeURIComponent(u.password)
const ref = u.hostname.replace(/^db\./, '').replace(/\.supabase\.co$/, '')
const [hh, pp] = fs.readFileSync(`${PROJ}/scripts/.pooler-host`, 'utf8').trim().split(':')
const db = new pg.Client({ host: hh, port: Number(pp), user: `postgres.${ref}`, password: senha, database: 'postgres', ssl: { rejectUnauthorized: false } })
await db.connect()
const { rows } = await db.query('select omie_app_key k, omie_app_secret s from lojas where id=3')
await db.end()
const loja = rows[0]

async function omie(ep, call, data) {
  const r = await fetch(`https://app.omie.com.br/api/${ep}/`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ call, app_key: loja.k, app_secret: loja.s, param: [data] })
  })
  return r.json()
}

// CR com filtro
const r2 = await omie('v1/financas/contareceber', 'ListarContasReceber', { pagina: 1, registros_por_pagina: 2, filtrar_por_status: 'EMABERTO' })
console.log('=== CR com filtro EMABERTO ===')
console.log('Campos:', Object.keys(r2))
for (const [k, v] of Object.entries(r2)) {
  if (Array.isArray(v)) console.log(`Array campo="${k}" length=${v.length}`)
}
console.log('total_de_registros:', r2.total_de_registros, '| paginas:', r2.total_de_paginas)
