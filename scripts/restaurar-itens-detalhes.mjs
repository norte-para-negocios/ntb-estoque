// Restaura itensDetalhes (ingredientes) em OPs concluidas onde o backfill apagou
// esses dados. Usa ConsultarEstrutura (malha do produto) para reconstruir.
//
// Logica: itensDetalhes.nQtde = malha.quantProdMalha * op.identificacao_n_qtde
//
// Uso: node scripts/restaurar-itens-detalhes.mjs [--loja 3] [--mes 2026-06]
//
// Flags:
//   --loja N    so roda para a loja N (default: todas)
//   --mes YYYY-MM  limita ao mes (por dDtPrevisao); default: mes corrente

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

// --- args ---
const args = process.argv.slice(2)
const argLoja = args.includes('--loja') ? Number(args[args.indexOf('--loja') + 1]) : null
const argMes = args.includes('--mes') ? args[args.indexOf('--mes') + 1] : null

const hoje = new Date()
const mesDefault = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, '0')}`
const mesFiltro = argMes || mesDefault
const [anoF, mesF] = mesFiltro.split('-').map(Number)
const ultimoDia = new Date(anoF, mesF, 0).getDate()
const dataIni = `${mesFiltro}-01`
const dataFim = `${mesFiltro}-${String(ultimoDia).padStart(2, '0')}`

console.log(`\n=== Restaurar itensDetalhes — mes ${mesFiltro} ===`)
if (argLoja) console.log(`Filtrando loja: ${argLoja}`)

// Lojas ativas
const { rows: lojas } = await db.query(
  `SELECT id, omie_app_key, omie_app_secret FROM lojas WHERE ativo = true AND omie_app_key IS NOT NULL${argLoja ? ' AND id = $1' : ''}`,
  argLoja ? [argLoja] : []
)

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function consultarEstrutura(appKey, appSecret, idProduto) {
  const resp = await fetch('https://app.omie.com.br/api/v1/geral/malha/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app_key: appKey, app_secret: appSecret,
      call: 'ConsultarEstrutura',
      param: [{ idProduto }],
    }),
  })
  const json = await resp.json()
  if (json.faultstring) {
    if (/nao.*cadastrada|nao.*encontrada|sem.*estrutura/i.test(json.faultstring)) return null
    throw new Error(json.faultstring)
  }
  return json
}

let totalGlobal = 0

for (const loja of lojas) {
  console.log(`\n[Loja ${loja.id}]`)

  // OPs concluidas no mes sem itensDetalhes
  const { rows: ops } = await db.query(`
    SELECT id, identificacao_n_cod_op, identificacao_n_cod_produto, identificacao_n_qtde, full_object
    FROM ordens_producao
    WHERE loja_id = $1
      AND concluida = true
      AND full_object IS NOT NULL
      AND NOT (full_object ? 'itensDetalhes')
      AND identificacao_d_dt_previsao BETWEEN $2 AND $3
    ORDER BY id
  `, [loja.id, dataIni, dataFim])

  if (!ops.length) { console.log('  Nenhuma OP a restaurar.'); continue }
  console.log(`  ${ops.length} OPs sem itensDetalhes`)

  // Agrupa por produto para minimizar chamadas Omie
  const porProduto = new Map()
  for (const op of ops) {
    const cod = Number(op.identificacao_n_cod_produto)
    if (!porProduto.has(cod)) porProduto.set(cod, [])
    porProduto.get(cod).push(op)
  }
  console.log(`  ${porProduto.size} produtos unicos`)

  let totalLoja = 0
  let prodIdx = 0
  for (const [prodId, opsDoProdu] of porProduto) {
    prodIdx++
    process.stdout.write(`\r  Produto ${prodIdx}/${porProduto.size} (${prodId}) — ${totalLoja} restauradas...`)

    let estrutura = null
    try {
      estrutura = await consultarEstrutura(loja.omie_app_key, loja.omie_app_secret, prodId)
    } catch (e) {
      console.log(`\n  ERRO estrutura produto ${prodId}: ${e.message}`)
    }
    await sleep(600)

    if (!estrutura?.itens?.length) continue

    // Reconstroi itensDetalhes para cada OP desse produto
    const itensBase = estrutura.itens.map(i => ({
      nIdProdutoMalha: i.idProdMalha,
      quantBase: Number(i.quantProdMalha) || 0,
    }))

    for (const op of opsDoProdu) {
      const opQtd = Number(op.identificacao_n_qtde) || 1
      const itensDetalhes = itensBase
        .filter(i => i.nIdProdutoMalha && i.quantBase > 0)
        .map(i => ({ nIdProdutoMalha: i.nIdProdutoMalha, nQtde: i.quantBase * opQtd }))

      if (!itensDetalhes.length) continue

      const foAtual = op.full_object
      const foNovo = { ...foAtual, itensDetalhes }

      await db.query(
        'UPDATE ordens_producao SET full_object = $1::jsonb, updated_at = NOW() WHERE id = $2',
        [JSON.stringify(foNovo), op.id]
      )
      totalLoja++
    }
  }

  console.log(`\n  Loja ${loja.id}: ${totalLoja} OPs restauradas`)
  totalGlobal += totalLoja
}

await db.end()
console.log(`\n=== Concluido: ${totalGlobal} OPs restauradas ===`)
