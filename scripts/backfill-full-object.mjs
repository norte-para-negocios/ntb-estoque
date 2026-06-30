// Repopula full_object das OPs no banco.
// Fase 1: OPs abertas (concluida=false) — ConsultarOrdemProducao por nCodOP.
// Fase 2: OPs concluidas — ListarOrdemProducao mes-a-mes (jun/2025 a jun/2026).
// Uso: node scripts/backfill-full-object.mjs
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
  const [h, p] = saved.split(':')
  if (h) host = h
} catch {}

const db = new pg.Client({
  host, port: 5432, user: `postgres.${ref}`, password: senha,
  database: 'postgres', ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000, statement_timeout: 60000,
})
await db.connect()

// Busca lojas ativas
const { rows: lojas } = await db.query(`
  SELECT id, omie_app_key, omie_app_secret FROM lojas
  WHERE ativo = true AND omie_app_key IS NOT NULL
`)

function parseDate(d) {
  if (!d) return null
  const m = d.match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  return m ? `${m[3]}-${m[2]}-${m[1]}` : null
}

async function omiePost(appKey, appSecret, call, param) {
  const resp = await fetch('https://app.omie.com.br/api/v1/produtos/op/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ app_key: appKey, app_secret: appSecret, call, param: [param] }),
  })
  const json = await resp.json()
  if (json.faultstring) throw new Error(json.faultstring)
  return json
}

// Aplica batch UPDATE de full_object via VALUES (1 query por pagina)
async function batchUpdate(lojaId, ops) {
  if (!ops.length) return 0
  const params = []
  const vals = []
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
  return r.rowCount
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// ====== FASE 1: OPs abertas ======
console.log('=== FASE 1: OPs abertas (ConsultarOrdemProducao) ===\n')
let totalAbertos = 0

for (const loja of lojas) {
  const { rows: abertas } = await db.query(`
    SELECT identificacao_n_cod_op FROM ordens_producao
    WHERE loja_id = $1 AND concluida = false AND full_object IS NULL
    ORDER BY identificacao_n_cod_op DESC
  `, [loja.id])

  if (!abertas.length) { console.log(`[Loja ${loja.id}] 0 abertas\n`); continue }
  console.log(`[Loja ${loja.id}] ${abertas.length} OPs abertas...`)

  let ok = 0, err = 0
  for (const row of abertas) {
    try {
      const res = await omiePost(loja.omie_app_key, loja.omie_app_secret,
        'ConsultarOrdemProducao', { nCodOP: row.identificacao_n_cod_op })
      if (res?.identificacao) {
        await db.query(`
          UPDATE ordens_producao SET full_object = $1, updated_at = NOW()
          WHERE loja_id = $2 AND identificacao_n_cod_op = $3
        `, [JSON.stringify(res), loja.id, row.identificacao_n_cod_op])
        ok++
      }
    } catch { err++ }
    process.stdout.write(`\r  ok:${ok} err:${err}`)
    await sleep(250)
  }
  totalAbertos += ok
  console.log(`\n  Concluido: ${ok} ok, ${err} err\n`)
}

// ====== FASE 2: OPs concluidas (mes-a-mes) ======
console.log('=== FASE 2: OPs concluidas (ListarOrdemProducao mes-a-mes) ===\n')
let totalConcluidos = 0

// Gera pares [ini, fim] no formato DD/MM/AAAA
const meses = []
for (const [ano, mesIni, mesFim] of [[2025, 6, 12], [2026, 1, 6]]) {
  for (let m = mesIni; m <= mesFim; m++) {
    const mm = String(m).padStart(2, '0')
    const ultimo = new Date(ano, m, 0).getDate()
    meses.push([`01/${mm}/${ano}`, `${String(ultimo).padStart(2, '0')}/${mm}/${ano}`])
  }
}

for (const loja of lojas) {
  console.log(`[Loja ${loja.id}]`)
  let lojaTotal = 0

  for (const [ini, fim] of meses) {
    let pagina = 1, totalPaginas = 1, mesOk = 0, erroLogado = false

    do {
      try {
        const res = await omiePost(loja.omie_app_key, loja.omie_app_secret,
          'ListarOrdemProducao', {
            pagina, registros_por_pagina: 100,
            ordem_decrescente: 'S', ordenar_por: 'dConclusao',
            dDtConclusaoDe: ini, dDtConclusaoAte: fim,
          })
        totalPaginas = res.total_de_paginas || 1
        const ops = (res.cadastros ?? []).map(op => ({
          nCodOP: op.identificacao?.nCodOP,
          fo: op,
        })).filter(o => o.nCodOP)
        const n = await batchUpdate(loja.id, ops)
        mesOk += n
      } catch (e) {
        if (!erroLogado) { console.log(`\n  ERRO Omie [${ini}]: ${e.message}`); erroLogado = true }
        process.stdout.write(`!`)
      }
      process.stdout.write(`\r  ${ini}: pag ${pagina}/${totalPaginas} — ${lojaTotal + mesOk} restauradas...`)
      pagina++
      await sleep(450)
    } while (pagina <= totalPaginas)

    lojaTotal += mesOk
  }

  console.log(`\n  Concluido: ${lojaTotal} OPs\n`)
  totalConcluidos += lojaTotal
}

await db.end()
console.log(`=== Backfill finalizado ===`)
console.log(`  Abertas:    ${totalAbertos}`)
console.log(`  Concluidas: ${totalConcluidos}`)
console.log(`  Total:      ${totalAbertos + totalConcluidos}`)
