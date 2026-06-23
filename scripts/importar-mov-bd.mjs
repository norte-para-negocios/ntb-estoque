// Importa a aba "BD" do export MOV_DRV do Omie e grava AGREGADOS por
// (origem × sentido × local × tipo SPED × família × mês × inventário) em R$ e qtde.
// É a única fonte com operação + local por movimento. Streaming p/ aguentar 935k
// linhas / 160MB. Refaz tudo da loja (delete + insert) — idempotente.
//
// Uso: node --max-old-space-size=4096 scripts/importar-mov-bd.mjs <loja_id> "<arquivo.xlsx>"
import fs from 'node:fs'
import pg from 'pg'
import ExcelJS from 'exceljs'

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

const lojaId = Number(process.argv[2])
const FILE = process.argv[3]
if (!lojaId || !FILE) { console.error('uso: node importar-mov-bd.mjs <loja_id> "<arquivo.xlsx>"'); process.exit(1) }
if (!fs.existsSync(FILE)) { console.error('arquivo não encontrado:', FILE); process.exit(1) }

const txt = (v) => {
  if (v == null) return ''
  if (typeof v === 'object') {
    if ('result' in v) v = v.result
    else if ('text' in v) v = v.text
    else if ('richText' in v) v = v.richText.map((r) => r.text).join('')
  }
  return String(v).trim()
}
const numOf = (v) => {
  if (typeof v === 'number') return v
  if (v && typeof v === 'object' && 'result' in v) return Number(v.result) || 0
  const s = txt(v).replace(/[^\d,.-]/g, '')
  if (!s) return 0
  return s.includes(',') ? Number(s.replace(/\./g, '').replace(',', '.')) : Number(s)
}
// "1".."12" + Ano "2026" -> 'YYYY-MM'. Cai pro ano do arquivo se faltar.
const mm2 = (n) => String(n).padStart(2, '0')

// Colunas (1-based) confirmadas na BD do MOV_DRV:
const C = { origem: 1, tipoSped: 9, familia: 5, ano: 24, mes: 25, tipo: 26, qtde: 27, valor: 28, local: 30, motivo: 32 }

console.log('importando BD —', FILE, '| loja', lojaId)
const reader = new ExcelJS.stream.xlsx.WorkbookReader(FILE, { worksheets: 'emit', sharedStrings: 'cache', styles: 'ignore' })

const agg = new Map() // chave -> {qtde, valor}
let lidas = 0
for await (const ws of reader) {
  if (ws.name !== 'BD') { for await (const _ of ws) {} ; continue }
  let rn = 0
  for await (const row of ws) {
    rn++
    if (rn === 1) continue
    lidas++
    const origem = txt(row.getCell(C.origem).value) || 'N/D'
    const tipoRaw = txt(row.getCell(C.tipo).value) // "2.Entrada" / "3.Saída"
    const sentido = /sa[ií]da/i.test(tipoRaw) ? 'S' : 'E'
    const tipoSped = txt(row.getCell(C.tipoSped).value) || 'N/D'
    const familia = txt(row.getCell(C.familia).value) || 'N/D'
    const local = txt(row.getCell(C.local).value) || 'N/D'
    const ano = txt(row.getCell(C.ano).value) || '2026'
    const mesN = Number(txt(row.getCell(C.mes).value)) || 0
    if (!mesN) continue
    const mes = `${ano}-${mm2(mesN)}`
    const motivo = txt(row.getCell(C.motivo).value)
    const inventario = sentido === 'S' && origem === 'Movimento Manual de Estoque' && /invent/i.test(motivo)
    const qtde = Math.abs(numOf(row.getCell(C.qtde).value))
    const valor = Math.abs(numOf(row.getCell(C.valor).value))

    const k = `${origem}${sentido}${local}${tipoSped}${familia}${mes}${inventario ? 1 : 0}`
    const e = agg.get(k) ?? { qtde: 0, valor: 0 }
    e.qtde += qtde; e.valor += valor
    agg.set(k, e)
    if (rn % 200000 === 0) console.error(`  ...${rn} linhas, ${agg.size} agregados`)
  }
}
console.log(`lidas ${lidas} linhas -> ${agg.size} agregados`)

const db = new pg.Client({ host, port, user: `postgres.${ref}`, password: senha, database: 'postgres', ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 8000 })
await db.connect()
await db.query('begin')
await db.query('delete from movimentacao_operacao where loja_id = $1', [lojaId])

const linhas = [...agg.entries()].map(([k, v]) => {
  const [origem, sentido, local, tipoSped, familia, mes, inv] = k.split('')
  return [lojaId, origem, sentido, local, tipoSped, familia, mes, inv === '1', Number(v.qtde.toFixed(6)), Number(v.valor.toFixed(2))]
})
// insere em lotes de 500
for (let i = 0; i < linhas.length; i += 500) {
  const lote = linhas.slice(i, i + 500)
  const vals = lote.map((_, j) => {
    const b = j * 10
    return `($${b+1},$${b+2},$${b+3},$${b+4},$${b+5},$${b+6},$${b+7},$${b+8},$${b+9},$${b+10})`
  }).join(',')
  await db.query(
    `insert into movimentacao_operacao (loja_id,origem,sentido,local,tipo_sped,familia,mes,inventario,qtde,valor) values ${vals}`,
    lote.flat()
  )
}
await db.query(
  `insert into movimentacao_operacao_meta (loja_id, importado_em, linhas, arquivo) values ($1, now(), $2, $3)
   on conflict (loja_id) do update set importado_em = now(), linhas = excluded.linhas, arquivo = excluded.arquivo`,
  [lojaId, lidas, FILE.split(/[\\/]/).pop()]
)
await db.query('commit')

const { rows: stat } = await db.query(
  `select origem, sentido, sum(valor) v, sum(qtde) q from movimentacao_operacao where loja_id = $1 group by origem, sentido order by v desc`,
  [lojaId]
)
console.log('\n=== GRAVADO (origem × sentido) ===')
for (const r of stat) console.log(`  ${Number(r.v).toLocaleString('pt-BR', {style:'currency',currency:'BRL'}).padStart(20)}  ${r.sentido}  ${r.origem}`)
await db.end()
console.log('\nOK.')
