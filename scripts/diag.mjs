// Script de diagnostico do NTB Estoque (uso local/admin). NAO roda em producao.
// Requer: npm install pg --no-save   (le SUPABASE_DB_URL do .env.local)
// Uso: node scripts/diag.mjs
import fs from 'node:fs'
import pg from 'pg'

const PROJ = process.cwd() // rodar a partir da raiz do projeto: node scripts/diag.mjs
const env = {}
for (const line of fs.readFileSync(`${PROJ}/.env.local`, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}

const client = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await client.connect()

console.log('=== ESTOQUE MINIMO: posicao_estoques por loja (ultima data) ===')
const r = await client.query(`
  with ult as (
    select loja_id, max(data_posicao) d from posicao_estoques group by loja_id
  )
  select p.loja_id,
         u.d as data_posicao,
         count(*) as linhas,
         count(*) filter (where p.estoque_minimo > 0) as com_minimo,
         count(distinct p.n_cod_prod) filter (where p.estoque_minimo > 0) as produtos_com_minimo
    from posicao_estoques p
    join ult u on u.loja_id = p.loja_id and u.d = p.data_posicao
   group by p.loja_id, u.d
   order by p.loja_id`)
for (const x of r.rows) {
  console.log(`loja ${x.loja_id} | data ${x.data_posicao?.toISOString?.().slice(0,10) ?? x.data_posicao} | ${x.linhas} linhas | ${x.com_minimo} com minimo (${x.produtos_com_minimo} produtos)`)
}

console.log('\n=== override manual em produtos.estoque_minimo ===')
const o = await client.query(`select loja_id, count(*) filter (where estoque_minimo is not null) com_override from produtos group by loja_id order by loja_id`)
for (const x of o.rows) console.log(`loja ${x.loja_id}: ${x.com_override} com override manual`)

await client.end()
