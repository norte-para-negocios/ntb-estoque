// Backfill da posicao de estoque no modelo de 2 varreduras (igual ao novo
// syncPosicaoEstoque): (1) minimo/custo sem local -> local 0 com saldo 0;
// (2) saldos por local ativo com cExibeTodos='N'. Total = soma dos locais.
// Conserta lojas onde o sync por-local 'S' cortava o ultimo local (ex.: NUCLEO).
// Uso: node scripts/backfill-posicao-2pass.mjs [lojaId ...]   (sem arg = todas)
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

const client = new pg.Client({ host, port, user: `postgres.${ref}`, password: senha, database: 'postgres', ssl: { rejectUnauthorized: false } })
await client.connect()

const filtroIds = process.argv.slice(2).map(Number).filter(Boolean)
const { rows: lojas } = await client.query(
  `select id, omie_app_key, omie_app_secret from lojas where ativo=true and omie_app_key is not null ${filtroIds.length ? 'and id = any($1)' : ''} order by id`,
  filtroIds.length ? [filtroIds] : []
)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const hoje = new Date().toLocaleDateString('pt-BR')
const dataISO = new Date().toISOString().split('T')[0]
const LOCAL_MINIMO = 0

async function omie(loja, extra) {
  for (let tent = 0; tent < 5; tent++) {
    const body = JSON.stringify({ app_key: loja.omie_app_key, app_secret: loja.omie_app_secret, call: 'ListarPosEstoque', param: [{ nRegPorPagina: 50, dDataPosicao: hoje, ...extra }] })
    const r = await fetch('https://app.omie.com.br/api/v1/estoque/consulta/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
    const j = await r.json().catch(() => null)
    const fault = j?.faultstring
    if (fault) {
      if (/n.o existem registros/i.test(fault)) return { produtos: [], nTotPaginas: extra.nPagina }
      if (/j. existe uma requisi|consumo|aguarde|too many/i.test(fault)) { await sleep(5000); continue }
      throw new Error(fault)
    }
    return j
  }
  throw new Error('Omie: rate limit persistente')
}

const COLS = ['loja_id','codigo_local_estoque','n_cod_prod','data_posicao','c_codigo','c_descricao','n_preco_unitario','n_saldo','n_cmc','n_pendente','estoque_minimo','fisico','reservado','updated_at']
async function upsertChunk(rows) {
  if (!rows.length) return
  const vals = [], params = []
  rows.forEach((row, i) => { const base = i * COLS.length; vals.push(`(${COLS.map((_, j) => `$${base + j + 1}`).join(',')})`); params.push(...COLS.map((c) => row[c])) })
  const set = COLS.filter((c) => !['loja_id','codigo_local_estoque','n_cod_prod','data_posicao'].includes(c)).map((c) => `${c}=excluded.${c}`).join(',')
  await client.query(`insert into posicao_estoques (${COLS.join(',')}) values ${vals.join(',')} on conflict (loja_id,codigo_local_estoque,n_cod_prod,data_posicao) do update set ${set}`, params)
}

for (const loja of lojas) {
  const t0 = Date.now()
  const runStart = new Date().toISOString()
  let gravados = 0, buffer = []
  const flush = async (force) => { if (buffer.length >= 400 || (force && buffer.length)) { await upsertChunk(buffer); gravados += buffer.length; buffer = [] } }

  // 1) minimo/custo (sem local, todos os produtos) -> local 0, saldo 0
  let pag = 1, total = 1
  do {
    const res = await omie(loja, { nPagina: pag, cExibeTodos: 'S' })
    total = res?.nTotPaginas || 1
    for (const p of res?.produtos ?? []) buffer.push({ loja_id: loja.id, codigo_local_estoque: LOCAL_MINIMO, n_cod_prod: p.nCodProd, data_posicao: dataISO, c_codigo: p.cCodigo, c_descricao: p.cDescricao, n_preco_unitario: p.nPrecoUnitario, n_saldo: 0, n_cmc: p.nCMC, n_pendente: 0, estoque_minimo: p.estoque_minimo ?? 0, fisico: 0, reservado: 0, updated_at: new Date().toISOString() })
    await flush(); pag++
  } while (pag <= total)
  await flush(true)

  // 2) saldos por local ativo (cExibeTodos='N')
  const { rows: locais } = await client.query("select codigo_local_estoque from local_estoques where loja_id=$1 and coalesce(inativo,'N')<>'S'", [loja.id])
  for (const l of locais) {
    pag = 1; total = 1
    do {
      const res = await omie(loja, { nPagina: pag, codigo_local_estoque: l.codigo_local_estoque, cExibeTodos: 'N' })
      total = res?.nTotPaginas || 1
      for (const p of res?.produtos ?? []) buffer.push({ loja_id: loja.id, codigo_local_estoque: l.codigo_local_estoque, n_cod_prod: p.nCodProd, data_posicao: dataISO, c_codigo: p.cCodigo, c_descricao: p.cDescricao, n_preco_unitario: p.nPrecoUnitario, n_saldo: p.nSaldo, n_cmc: p.nCMC, n_pendente: p.nPendente, estoque_minimo: 0, fisico: p.fisico ?? 0, reservado: p.reservado ?? 0, updated_at: new Date().toISOString() })
      await flush(); pag++
    } while (pag <= total)
  }
  await flush(true)

  // limpa linhas por-local de hoje nao reescritas neste run
  const del = await client.query("delete from posicao_estoques where loja_id=$1 and data_posicao=$2 and codigo_local_estoque<>$3 and updated_at<$4", [loja.id, dataISO, LOCAL_MINIMO, runStart])
  console.log(`loja ${loja.id}: ${gravados} linhas gravadas (1 consolidada de minimo + saldos por local), ${del.rowCount} obsoletas removidas, ${((Date.now() - t0) / 1000).toFixed(0)}s`)
}

await client.end()
