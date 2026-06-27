// Faturamento via API (cupom fiscal / NFC-e do PDV) -> faturamento_importado.
// Substitui o import manual do FAT_DRV: puxa cupomfiscalconsultar (CuponsFiscais),
// agrega o valor vendido por TIPO de produto e por FAMILIA, mes a mes, e grava
// na tabela agregada que o relatorio /relatorio-faturamento ja consome.
//
// Uso: node scripts/sync-faturamento-api.mjs <loja_id> [ano]
import fs from 'node:fs'; import pg from 'pg'
const PROJ = process.cwd(); const env = {}
for (const line of fs.readFileSync(`${PROJ}/.env.local`, 'utf8').split(/\r?\n/)) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '') }
const u = new URL(env.SUPABASE_DB_URL); const senha = decodeURIComponent(u.password)
const ref = u.hostname.replace(/^db\./, '').replace(/\.supabase\.co$/, '')
const [hh, pp] = fs.readFileSync(`${PROJ}/scripts/.pooler-host`, 'utf8').trim().split(':')
const db = new pg.Client({ host: hh, port: Number(pp), user: `postgres.${ref}`, password: senha, database: 'postgres', ssl: { rejectUnauthorized: false } })
await db.connect()

const LOJA = Number(process.argv[2])
const ANO = Number(process.argv[3] ?? new Date().getFullYear())
if (!LOJA) { console.error('uso: node scripts/sync-faturamento-api.mjs <loja_id> [ano]'); await db.end(); process.exit(1) }

const TIPO_NOME = {
  '00': 'Mercadoria p/ revenda', '01': 'Matéria-prima', '02': 'Embalagem', '03': 'Produto em processo',
  '04': 'Produto acabado', '05': 'Subproduto', '06': 'Produto intermediário', '07': 'Uso e consumo',
  '08': 'Ativo imobilizado', '09': 'Serviços', '10': 'Outros insumos', '99': 'Outras',
}

const { rows: [loja] } = await db.query('select omie_app_key k, omie_app_secret s from lojas where id=$1', [LOJA])
if (!loja?.k) { console.error('loja sem app_key'); await db.end(); process.exit(1) }

// Mapa produto: codigo_produto -> { tipo, familia }
const { rows: prods } = await db.query('select codigo_produto, tipo_item, descricao_familia from produtos where loja_id=$1', [LOJA])
const mapProd = new Map()
for (const p of prods) mapProd.set(Number(p.codigo_produto), { tipo: p.tipo_item, familia: p.descricao_familia })
console.log(`Loja ${LOJA}: ${mapProd.size} produtos mapeados. Ano ${ANO}.`)

async function omie(call, data) {
  const r = await fetch('https://app.omie.com.br/api/v1/produtos/cupomfiscalconsultar/', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ call, app_key: loja.k, app_secret: loja.s, param: [data] })
  })
  const j = await r.json()
  if (j?.faultstring) throw new Error(j.faultstring)
  return j
}
const sleep = ms => new Promise(r => setTimeout(r, ms))
const ultimoDia = (ano, mes) => new Date(ano, mes, 0).getDate()

// acc[`${dimensao}|${rotulo}|${mes}`] = valor
const acc = new Map()
const add = (dimensao, rotulo, mes, valor) => {
  if (!valor) return
  const k = `${dimensao}|${rotulo || 'Sem classificação'}|${mes}`
  acc.set(k, (acc.get(k) ?? 0) + valor)
}

const mesAtual = new Date().getMonth() + 1
const anoAtual = new Date().getFullYear()
const mesFim = ANO < anoAtual ? 12 : mesAtual

let totalGeral = 0
for (let mes = 1; mes <= mesFim; mes++) {
  const mm = String(mes).padStart(2, '0')
  const mesISO = `${ANO}-${mm}`
  const de = `01/${mm}/${ANO}`
  const ate = `${ultimoDia(ANO, mes)}/${mm}/${ANO}`
  let pagina = 1, totPag = 1, cupons = 0
  do {
    let r
    try {
      r = await omie('CuponsFiscais', { dDtEmissaoDe: de, dDtEmissaoAte: ate, nPagina: pagina, nRegPorPagina: 50 })
    } catch (e) {
      if (/n.o existem|registros/i.test(e.message)) break
      throw e
    }
    totPag = r.nTotPaginas ?? 1
    for (const c of (r.cupons ?? [])) {
      const cab = c.cabecalhoCupom
      if (cab.info?.cCupomCancelado === 'S') continue
      cupons++
      for (const it of (c.itensCupom ?? [])) {
        if (it.cItemCancelado === 'S' || it.cCupomCancelado === 'S') continue
        const v = Number(it.vItem ?? 0) || (Number(it.vUnit ?? 0) * Number(it.nQuant ?? 0) - Number(it.vDesc ?? 0) + Number(it.vAcresc ?? 0))
        if (!v) continue
        totalGeral += v
        const info = mapProd.get(Number(it.idProduto))
        add('tipo', info?.tipo ? (TIPO_NOME[info.tipo] ?? `Tipo ${info.tipo}`) : 'Não classificado', mesISO, v)
        add('familia', info?.familia || 'Sem família', mesISO, v)
      }
    }
    pagina++
    if (pagina <= totPag) await sleep(340)
  } while (pagina <= totPag)
  if (cupons) console.log(`  ${mesISO}: ${cupons} cupons`)
}

console.log(`\nTotal faturado ${ANO}: R$ ${totalGeral.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`)
console.log(`Linhas agregadas: ${acc.size}`)

// Grava: remove só as dimensoes tipo/familia desta loja (forma_pgto fica intacta se vier de outra fonte) e insere.
await db.query(`delete from faturamento_importado where loja_id=$1 and dimensao in ('tipo','familia')`, [LOJA])
let gravadas = 0
for (const [k, valor] of acc) {
  const [dimensao, rotulo, mes] = k.split('|')
  await db.query('insert into faturamento_importado (loja_id, dimensao, rotulo, mes, valor) values ($1,$2,$3,$4,$5)', [LOJA, dimensao, rotulo, mes, valor.toFixed(2)])
  gravadas++
}
await db.query(`
  insert into faturamento_import_meta (loja_id, importado_em, arquivo) values ($1, now(), 'API cupom fiscal')
  on conflict (loja_id) do update set importado_em=now(), arquivo='API cupom fiscal'
`, [LOJA])
console.log(`Gravadas ${gravadas} linhas em faturamento_importado.`)
await db.end()
