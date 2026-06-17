// Backfill do historico de MOVIMENTOS de 2026 do Omie (entradas/saidas por
// produto/dia, via ListarMovimentos). Idempotente (upsert). Rode por loja:
//   node scripts/backfill-movimentos.mjs 3
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
let host = 'aws-1-sa-east-1.pooler.supabase.com', port = 5432
try { const [h, p] = fs.readFileSync(`${PROJ}/scripts/.pooler-host`, 'utf8').trim().split(':'); if (h) host = h; if (p) port = Number(p) } catch {}
const db = new pg.Client({ host, port, user: `postgres.${ref}`, password: senha, database: 'postgres', ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 8000 })
await db.connect()

const lojaId = Number(process.argv[2] || 3)
const { rows } = await db.query('select omie_app_key k, omie_app_secret s, nome_fantasia n from lojas where id = $1', [lojaId])
const loja = rows[0]
if (!loja) { console.error('loja nao encontrada'); process.exit(1) }
console.log('backfill movimentos 2026 — loja', lojaId, loja.n)

// Tabela de historico (agregado por produto/dia). Idempotente por (loja, prod, data).
await db.query(`create table if not exists movimentos_historico (
  loja_id int not null, cod_prod bigint not null, codigo text, descricao text,
  data date not null, entradas numeric default 0, saidas numeric default 0,
  primary key (loja_id, cod_prod, data)
)`)

function brToISO(d) { const m = String(d).match(/^(\d{2})\/(\d{2})\/(\d{4})/); return m ? `${m[3]}-${m[2]}-${m[1]}` : null }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// O Omie TRUNCA periodos longos no ListarMovimentos (pediu 01/01-17/06, so veio
// ate 02/03). Solucao: backfill MES A MES (cada mes vem completo). Upsert idempotente.
// 2o arg = ano (default 2026). 2025 traz jun-dez (janela rolante de 12 meses).
const ano = process.argv[3] || '2026'
const meses = ano === '2025'
  ? [
      ['01/06/2025', '30/06/2025'], ['01/07/2025', '31/07/2025'], ['01/08/2025', '31/08/2025'],
      ['01/09/2025', '30/09/2025'], ['01/10/2025', '31/10/2025'], ['01/11/2025', '30/11/2025'],
      ['01/12/2025', '31/12/2025'],
    ]
  : [
      ['01/01/2026', '31/01/2026'], ['01/02/2026', '28/02/2026'], ['01/03/2026', '31/03/2026'],
      ['01/04/2026', '30/04/2026'], ['01/05/2026', '31/05/2026'], ['01/06/2026', '17/06/2026'],
    ]
console.log('ano alvo:', ano, '| meses:', meses.length)
let gravados = 0
for (const [di, df] of meses) {
  let pagina = 1, totalPaginas = 1, doMes = 0
  do {
    let res
    try {
      const r = await fetch('https://app.omie.com.br/api/v1/estoque/movestoque/', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ call: 'ListarMovimentos', app_key: loja.k, app_secret: loja.s, param: [{ pagina, registros_por_pagina: 100, data_inicial: di, data_final: df, ordenar_por: 'CODIGO' }] }),
      })
      res = await r.json()
    } catch (e) { console.error('erro fetch:', e.message); break }
    if (res?.faultstring) {
      if (/não existem registros|nao existem registros/i.test(res.faultstring)) break
      if (/redundante|aguarde/i.test(res.faultstring)) { await sleep(52000); continue }
      console.error('faultstring:', res.faultstring); break
    }
    totalPaginas = res.total_de_paginas || 1
    const linhas = []
    for (const c of res.cadastros ?? []) {
      for (const mv of c.movimentos ?? []) {
        const data = brToISO(mv.dDataMovimento); if (!data) continue
        linhas.push([lojaId, c.nCodProd, c.cCodigo || null, c.cDescricao || null, data, mv.nQtdeEntradas || 0, mv.nQtdeSaidas || 0])
      }
    }
    if (linhas.length) {
      const vals = linhas.map((_, i) => `($${i*7+1},$${i*7+2},$${i*7+3},$${i*7+4},$${i*7+5},$${i*7+6},$${i*7+7})`).join(',')
      await db.query(
        `insert into movimentos_historico (loja_id,cod_prod,codigo,descricao,data,entradas,saidas) values ${vals}
         on conflict (loja_id,cod_prod,data) do update set entradas=excluded.entradas, saidas=excluded.saidas, codigo=excluded.codigo, descricao=excluded.descricao`,
        linhas.flat()
      )
      gravados += linhas.length; doMes += linhas.length
    }
    pagina++
    await sleep(700) // anti-rajada
  } while (pagina <= totalPaginas)
  console.log(`  mes ${di} a ${df}: +${doMes} linhas (acumulado ${gravados})`)
}

const { rows: stat } = await db.query("select count(*) n, pg_size_pretty(pg_total_relation_size('movimentos_historico')) tam, pg_size_pretty(pg_database_size(current_database())) banco from movimentos_historico")
console.log('\n=== RESULTADO loja', lojaId, '===')
console.log('linhas gravadas nesta loja:', gravados)
console.log('tabela movimentos_historico total:', stat[0].n, 'linhas,', stat[0].tam, '| banco:', stat[0].banco)
await db.end()
