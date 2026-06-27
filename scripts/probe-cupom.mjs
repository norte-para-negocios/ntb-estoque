// Probe: faturamento via cupom fiscal (NFC-e/PDV) — v1/produtos/cupomfiscalconsultar
import fs from 'node:fs'; import pg from 'pg'
const PROJ = process.cwd(); const env = {}
for (const line of fs.readFileSync(`${PROJ}/.env.local`, 'utf8').split(/\r?\n/)) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '') }
const u = new URL(env.SUPABASE_DB_URL); const senha = decodeURIComponent(u.password)
const ref = u.hostname.replace(/^db\./, '').replace(/\.supabase\.co$/, '')
const [hh, pp] = fs.readFileSync(`${PROJ}/scripts/.pooler-host`, 'utf8').trim().split(':')
const db = new pg.Client({ host: hh, port: Number(pp), user: `postgres.${ref}`, password: senha, database: 'postgres', ssl: { rejectUnauthorized: false } })
await db.connect()
const LOJA = Number(process.argv[2] ?? 3)
const { rows: [loja] } = await db.query('select omie_app_key k, omie_app_secret s from lojas where id=$1', [LOJA])
await db.end()

async function omie(ep, call, data) {
  const r = await fetch(`https://app.omie.com.br/api/${ep}/`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ call, app_key: loja.k, app_secret: loja.s, param: [data] })
  })
  return r.json()
}
const ontem = new Date(Date.now() - 86400000).toLocaleDateString('pt-BR')
const h30 = new Date(Date.now() - 30 * 86400000).toLocaleDateString('pt-BR')

// Janela de 1 dia recente pra somar e validar valores
const d = new Date(Date.now() - 2 * 86400000).toLocaleDateString('pt-BR')
console.log(`=== Validação de valores — dia ${d} loja ${LOJA} ===`)
let pagina = 1, totPag = 1, totCupom = 0, totItens = 0, nCup = 0, nCanc = 0
const amostra = []
do {
  const r = await omie('v1/produtos/cupomfiscalconsultar', 'CuponsFiscais', { dDtEmissaoDe: d, dDtEmissaoAte: d, nPagina: pagina, nRegPorPagina: 50 })
  totPag = r.nTotPaginas ?? 1
  for (const c of (r.cupons ?? [])) {
    const cab = c.cabecalhoCupom
    const cancelado = cab.info?.cCupomCancelado === 'S'
    if (cancelado) { nCanc++; continue }
    nCup++
    totCupom += Number(cab.nValorCupom ?? 0)
    let somaItens = 0
    for (const it of (c.itensCupom ?? [])) {
      if (it.cItemCancelado === 'S') continue
      const v = Number(it.vItem ?? 0) || (Number(it.vUnit ?? 0) * Number(it.nQuant ?? 0) - Number(it.vDesc ?? 0) + Number(it.vAcresc ?? 0))
      somaItens += v
      totItens += v
    }
    if (amostra.length < 3) amostra.push({ cupom: cab.nNumCupom, valorCab: cab.nValorCupom, somaItens: somaItens.toFixed(2), itens: (c.itensCupom ?? []).length })
  }
  pagina++
  await new Promise(r => setTimeout(r, 350))
} while (pagina <= totPag)

console.log(`Cupons válidos: ${nCup} | cancelados: ${nCanc}`)
console.log(`Total por CABEÇALHO (nValorCupom): R$ ${totCupom.toFixed(2)}`)
console.log(`Total por ITENS (vItem/calc):      R$ ${totItens.toFixed(2)}`)
console.log('Amostra:', JSON.stringify(amostra, null, 2))
