// Fase 2: restaura full_object de OPs concluidas via ListarOrdemProducao mes-a-mes.
// node scripts/backfill-fase2.mjs
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
  connectionTimeoutMillis: 15000, statement_timeout: 120000,
})
await db.connect()

const { rows: lojas } = await db.query(`
  SELECT id, omie_app_key, omie_app_secret FROM lojas
  WHERE ativo = true AND omie_app_key IS NOT NULL
`)

async function omieListar(appKey, appSecret, pagina, ini, fim) {
  const resp = await fetch('https://app.omie.com.br/api/v1/produtos/op/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app_key: appKey, app_secret: appSecret,
      call: 'ListarOrdemProducao',
      param: [{ pagina, registros_por_pagina: 100, ordem_decrescente: 'S', ordenar_por: 'dConclusao', dDtConclusaoDe: ini, dDtConclusaoAte: fim }],
    }),
  })
  const json = await resp.json()
  if (json.faultstring) throw new Error(json.faultstring)
  return json
}

async function batchUpdate(lojaId, ops) {
  if (!ops.length) return 0
  const params = [], vals = []
  for (let i = 0; i < ops.length; i++) {
    params.push(`($${i * 3 + 1}::int, $${i * 3 + 2}::bigint, $${i * 3 + 3}::jsonb)`)
    vals.push(lojaId, ops[i].nCodOP, JSON.stringify(ops[i].fo))
  }
  const r = await db.query(`
    UPDATE ordens_producao AS op
    SET full_object = t.fo, updated_at = NOW()
    FROM (VALUES ${params.join(',')}) AS t(loja_id, cod_op, fo)
    WHERE op.loja_id = t.loja_id AND op.identificacao_n_cod_op = t.cod_op
  `, vals)
  return r.rowCount ?? 0
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

// Meses: jun/2025 ate jun/2026
const meses = []
for (const [ano, ini, fim] of [[2025, 6, 12], [2026, 1, 6]]) {
  for (let m = ini; m <= fim; m++) {
    const mm = String(m).padStart(2, '0')
    const ult = new Date(ano, m, 0).getDate()
    meses.push([`01/${mm}/${ano}`, `${String(ult).padStart(2,'0')}/${mm}/${ano}`])
  }
}

console.log(`=== Fase 2: ${lojas.length} lojas x ${meses.length} meses ===\n`)
let totalGlobal = 0

for (const loja of lojas) {
  console.log(`[Loja ${loja.id}]`)
  let total = 0

  for (const [ini, fim] of meses) {
    let pagina = 1, totalPaginas = 1, mesOk = 0, erroLogado = false

    let zeroConsecutivos = 0
    do {
      try {
        const res = await omieListar(loja.omie_app_key, loja.omie_app_secret, pagina, ini, fim)
        totalPaginas = res.total_de_paginas || 1
        const ops = (res.cadastros ?? [])
          .map(op => ({ nCodOP: op?.identificacao?.nCodOP, fo: op }))
          .filter(o => o.nCodOP)
        const n = await batchUpdate(loja.id, ops)
        mesOk += n
        zeroConsecutivos = n === 0 ? zeroConsecutivos + 1 : 0
      } catch (e) {
        if (!erroLogado) { console.log(`\n  ERRO [${ini}]: ${e.message}`); erroLogado = true }
        zeroConsecutivos++
      }
      process.stdout.write(`\r  ${ini} pag ${pagina}/${totalPaginas} — ${total + mesOk} restauradas...`)
      pagina++
      await sleep(500)
    } while (pagina <= totalPaginas && zeroConsecutivos < 5)

    total += mesOk
  }

  console.log(`\n  Total loja ${loja.id}: ${total}\n`)
  totalGlobal += total
}

await db.end()
console.log(`=== Concluido: ${totalGlobal} OPs restauradas ===`)
