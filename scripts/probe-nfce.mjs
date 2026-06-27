// B.2.1: Probe read-only do endpoint de cupom fiscal (NFC-e do PDV) na loja 3.
// Valida que o endpoint existe e revela a estrutura do retorno antes de criar tabelas.
import fs from 'node:fs'; import pg from 'pg'
const PROJ = process.cwd(); const env = {}
for (const line of fs.readFileSync(`${PROJ}/.env.local`, 'utf8').split(/\r?\n/)) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '') }
const u = new URL(env.SUPABASE_DB_URL); const senha = decodeURIComponent(u.password)
const ref = u.hostname.replace(/^db\./, '').replace(/\.supabase\.co$/, '')
const [hh, pp] = fs.readFileSync(`${PROJ}/scripts/.pooler-host`, 'utf8').trim().split(':')
const db = new pg.Client({ host: hh, port: Number(pp), user: `postgres.${ref}`, password: senha, database: 'postgres', ssl: { rejectUnauthorized: false } })
await db.connect()
const { rows } = await db.query('select id, nome, omie_app_key k, omie_app_secret s from lojas where omie_app_key is not null order by id')
await db.end()
if (!rows.length) { console.error('Nenhuma loja com omie_app_key'); process.exit(1) }

async function omie(key, secret, endpoint, call, data) {
  const r = await fetch(`https://app.omie.com.br/api/${endpoint}/`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ call, app_key: key, app_secret: secret, param: [data] })
  })
  return r.json()
}

for (const loja of rows) {
  const r = await omie(loja.k, loja.s, 'v1/produtos/nfe', 'ListarNFe', { nPagina: 1, nRegPorPagina: 3 })
  const lista = r?.listagemNfe ?? []
  if (lista.length) {
    console.log(`\n=== [LOJA ${loja.id} - ${loja.nome}] ${r.nTotRegistros} NF-e ===`)
    console.log('Campos:', Object.keys(lista[0]))
    console.log(JSON.stringify(lista[0], null, 2).slice(0, 3000))
  } else {
    console.log(`[loja ${loja.id}] ${loja.nome} — 0 NF-e (total=${r?.nTotRegistros ?? '?'})`)
  }
}
