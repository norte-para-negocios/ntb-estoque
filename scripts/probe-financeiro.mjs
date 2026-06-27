// B.3: Probe read-only dos endpoints financeiros do Omie na loja 3.
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
if (!loja) { console.error('Loja 3 nao encontrada'); process.exit(1) }

async function omie(endpoint, call, data) {
  const r = await fetch(`https://app.omie.com.br/api/${endpoint}/`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ call, app_key: loja.k, app_secret: loja.s, param: [data] })
  })
  return r.json()
}

const endpoints = [
  // Contas a pagar
  ['v1/financas/contapagar', 'ListarContasPagar', { pagina: 1, registros_por_pagina: 2 }],
  ['v1/financas/contapagar', 'ListarContasPagar', {}],
  // Contas a receber
  ['v1/financas/contareceber', 'ListarContasReceber', { pagina: 1, registros_por_pagina: 2 }],
  // Extrato (nome real)
  ['v1/financas/extrato', 'ListarExtrato', { pagina: 1, registros_por_pagina: 2 }],
  ['v1/financas/extrato', 'PesquisarExtrato', {}],
  // Categorias financeiras
  ['v1/geral/categorias', 'ListarCategorias', { pagina: 1, registros_por_pagina: 5 }],
]

for (const [ep, call, params] of endpoints) {
  const r = await omie(ep, call, params)
  if (r?.error) {
    console.log(`[404] ${ep} / ${call}`)
  } else if (r?.faultstring) {
    console.log(`[FAULT] ${ep} / ${call} -> ${r.faultstring.slice(0, 150)}`)
  } else if (r?.status === 'error') {
    console.log(`[ERR] ${ep} / ${call} -> ${r.message}`)
  } else {
    const lista = Object.values(r ?? {}).find(v => Array.isArray(v)) ?? []
    const total = r?.nTotRegistros ?? r?.nRegistros ?? lista.length
    console.log(`\n[OK] ${ep} / ${call} — total=${total}`)
    if (lista.length) {
      console.log('Campos:', Object.keys(lista[0]))
      console.log(JSON.stringify(lista[0], null, 2).slice(0, 1200))
    } else {
      console.log('Resposta:', JSON.stringify(r, null, 2).slice(0, 400))
    }
  }
}
