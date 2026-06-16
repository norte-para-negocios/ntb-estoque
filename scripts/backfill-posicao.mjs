// Backfill da posicao de estoque (saldo, CMC, estoque_minimo, fisico, reservado)
// para as lojas, lendo o ListarPosEstoque do Omie. Mesma logica do
// lib/omie/posicao-estoque.ts (syncPosicaoEstoque), usada quando o cron ainda
// nao repopulou apos uma mudanca. So leitura do Omie + escrita no nosso banco.
//
// Requer: npm install pg --no-save   (le SUPABASE_DB_URL e a service key do .env.local)
// Uso:  node scripts/backfill-posicao.mjs            (todas as lojas com chave)
//       node scripts/backfill-posicao.mjs 3 4 5      (apenas as lojas informadas)
import fs from 'node:fs'
import pg from 'pg'

const PROJ = process.cwd()
const env = {}
for (const line of fs.readFileSync(`${PROJ}/.env.local`, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}

const filtroLojas = process.argv.slice(2).map(Number).filter((n) => !Number.isNaN(n))
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const client = new pg.Client({ connectionString: env.SUPABASE_DB_URL, ssl: { rejectUnauthorized: false } })
await client.connect()

const hojeBR = new Date().toLocaleDateString('pt-BR')
const hojeISO = new Date().toISOString().split('T')[0]

const lojasRes = await client.query(
  `select id, coalesce(nome_fantasia, nome) nome, omie_app_key, omie_app_secret
     from lojas where omie_app_key is not null order by id`
)
const lojas = lojasRes.rows.filter((l) => !filtroLojas.length || filtroLojas.includes(Number(l.id)))
console.log('Lojas a processar:', lojas.map((l) => l.id).join(', '))

async function omiePos(loja, local, pagina) {
  for (let tent = 0; tent < 5; tent++) {
    const r = await fetch('https://app.omie.com.br/api/v1/estoque/consulta/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        app_key: loja.omie_app_key,
        app_secret: loja.omie_app_secret,
        call: 'ListarPosEstoque',
        param: [{ nPagina: pagina, nRegPorPagina: 500, dDataPosicao: hojeBR, codigo_local_estoque: local, cExibeTodos: 'S' }],
      }),
    })
    const j = await r.json().catch(() => null)
    if (j && j.faultstring) {
      if (/n.o existem registros/i.test(j.faultstring)) return { nTotPaginas: 0, produtos: [] }
      if (/consumo redundante|aguarde|too many|j. existe uma requisi/i.test(j.faultstring)) {
        await sleep(8000)
        continue
      }
      throw new Error(j.faultstring)
    }
    return j
  }
  throw new Error('rate limit persistente')
}

const COLS = ['loja_id','codigo_local_estoque','n_cod_prod','data_posicao','c_cod_int','c_codigo','c_descricao','n_preco_unitario','n_saldo','n_cmc','n_pendente','estoque_minimo','reservado','fisico','updated_at']
async function upsert(rows) {
  if (!rows.length) return
  const vals = []
  const tuples = rows.map((row, i) => {
    const base = i * COLS.length
    vals.push(...row)
    return '(' + COLS.map((_, j) => `$${base + j + 1}`).join(',') + ')'
  })
  await client.query(
    `insert into posicao_estoques (${COLS.join(',')}) values ${tuples.join(',')}
     on conflict (loja_id,codigo_local_estoque,n_cod_prod,data_posicao) do update set
       c_cod_int=excluded.c_cod_int, c_codigo=excluded.c_codigo, c_descricao=excluded.c_descricao,
       n_preco_unitario=excluded.n_preco_unitario, n_saldo=excluded.n_saldo, n_cmc=excluded.n_cmc,
       n_pendente=excluded.n_pendente, estoque_minimo=excluded.estoque_minimo,
       reservado=excluded.reservado, fisico=excluded.fisico, updated_at=now()`,
    vals
  )
}

for (const loja of lojas) {
  const locais = (
    await client.query(`select codigo_local_estoque from local_estoques where loja_id=$1 and coalesce(inativo,'N')<>'S'`, [loja.id])
  ).rows.map((r) => Number(r.codigo_local_estoque))
  let grav = 0
  let comMin = 0
  for (const local of locais) {
    let pagina = 1, total = 1
    do {
      const res = await omiePos(loja, local, pagina)
      total = res.nTotPaginas || 1
      const prods = res.produtos || []
      const rows = prods.map((p) => [
        loja.id, local, p.nCodProd, hojeISO,
        (p.cCodInt || '').slice(0, 60), (p.cCodigo || '').slice(0, 60), (p.cDescricao || '').slice(0, 120),
        p.nPrecoUnitario ?? 0, p.nSaldo ?? 0, p.nCMC ?? 0, p.nPendente ?? 0,
        p.estoque_minimo ?? 0, p.reservado ?? 0, p.fisico ?? 0, new Date().toISOString(),
      ])
      for (let i = 0; i < rows.length; i += 200) await upsert(rows.slice(i, i + 200))
      comMin += prods.filter((p) => (p.estoque_minimo ?? 0) > 0).length
      grav += rows.length
      pagina++
      await sleep(300)
    } while (pagina <= total)
  }
  console.log(`loja ${loja.id} (${loja.nome}): ${grav} linhas, ${comMin} com minimo`)
  await sleep(2000)
}
console.log('BACKFILL CONCLUIDO')
await client.end()
