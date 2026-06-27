// B.3: Sync de contas a pagar e receber (Omie -> banco)
// Sincroniza apenas itens abertos: EMABERTO, ATRASADO, AVENCER, VENCEHOJE, PAGTO_PARCIAL
// Deleta do banco os que foram pagos/cancelados entre syncs.
import fs from 'node:fs'; import pg from 'pg'
const PROJ = process.cwd(); const env = {}
for (const line of fs.readFileSync(`${PROJ}/.env.local`, 'utf8').split(/\r?\n/)) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '') }
const u = new URL(env.SUPABASE_DB_URL); const senha = decodeURIComponent(u.password)
const ref = u.hostname.replace(/^db\./, '').replace(/\.supabase\.co$/, '')
const [hh, pp] = fs.readFileSync(`${PROJ}/scripts/.pooler-host`, 'utf8').trim().split(':')
const db = new pg.Client({ host: hh, port: Number(pp), user: `postgres.${ref}`, password: senha, database: 'postgres', ssl: { rejectUnauthorized: false } })
await db.connect()

// Lock exclusivo: impede dois syncs paralelos de corromper dados
const { rows: [lock] } = await db.query('SELECT pg_try_advisory_lock(20260626) AS ok')
if (!lock.ok) { console.error('Sync ja rodando em outro processo. Abortando.'); await db.end(); process.exit(1) }

const { rows: lojas } = await db.query('select id, omie_app_key k, omie_app_secret s from lojas where omie_app_key is not null order by id')

const STATUS_ABERTOS = ['EMABERTO', 'ATRASADO', 'AVENCER', 'VENCEHOJE', 'PAGTO_PARCIAL']
const POR_PAGINA = 50
const DELAY = 310

async function omie(key, secret, ep, call, data) {
  const r = await fetch(`https://app.omie.com.br/api/${ep}/`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ call, app_key: key, app_secret: secret, param: [data] })
  })
  const json = await r.json()
  if (json?.faultstring || json?.faultcode) throw new Error(`Omie fault: ${json.faultstring ?? json.faultcode}`)
  return json
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function paginatCP(key, secret, status) {
  const items = []
  let pagina = 1, totalPags = 1
  while (pagina <= totalPags) {
    const r = await omie(key, secret, 'v1/financas/contapagar', 'ListarContasPagar', { pagina, registros_por_pagina: POR_PAGINA, filtrar_por_status: status })
    totalPags = r.total_de_paginas ?? 1
    const lista = r?.conta_pagar_cadastro ?? []
    items.push(...lista)
    pagina++
    if (pagina <= totalPags) await sleep(DELAY)
  }
  return items
}

async function paginateCR(key, secret, status) {
  const items = []
  let pagina = 1, totalPags = 1
  while (pagina <= totalPags) {
    const r = await omie(key, secret, 'v1/financas/contareceber', 'ListarContasReceber', { pagina, registros_por_pagina: POR_PAGINA, filtrar_por_status: status })
    totalPags = r.total_de_paginas ?? 1
    const lista = r?.conta_receber_cadastro ?? []
    items.push(...lista)
    pagina++
    if (pagina <= totalPags) await sleep(DELAY)
  }
  return items
}

function parseBR(d) {
  if (!d || !d.includes('/')) return null
  const [dd, mm, yyyy] = d.split('/')
  return `${yyyy}-${mm}-${dd}`
}

for (const loja of lojas) {
  console.log(`\n[Loja ${loja.id}] sincronizando...`)

  // ---- Contas a pagar ----
  let cpError = false
  const cpTodos = []
  for (const s of STATUS_ABERTOS) {
    try {
      const items = await paginatCP(loja.k, loja.s, s)
      for (const it of items) it._status = s
      cpTodos.push(...items)
      process.stdout.write(`  CP ${s}: ${items.length} | `)
    } catch (e) {
      console.error(`\n  [CP ${s} ERRO] ${e.message} -- loja ${loja.id} pulada`)
      cpError = true
      break
    }
  }
  console.log(`\n  CP total: ${cpTodos.length}${cpError ? ' (ERRO -- sem delete)' : ''}`)

  if (cpTodos.length && !cpError) {
    const oids = cpTodos.map(i => i.codigo_lancamento_omie)
    // Remove do banco o que nao apareceu nos abertos (foi pago/cancelado)
    await db.query('delete from contas_pagar where loja_id=$1 and codigo_lancamento_omie != all($2::bigint[])', [loja.id, oids])
    // Upsert
    for (const it of cpTodos) {
      await db.query(`
        insert into contas_pagar (loja_id, codigo_lancamento_omie, codigo_cliente_fornecedor, data_emissao, data_vencimento, data_previsao, data_entrada, valor_documento, status_titulo, codigo_categoria, codigo_tipo_documento, numero_documento, numero_documento_fiscal, numero_parcela, id_conta_corrente, synced_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,now())
        on conflict (loja_id, codigo_lancamento_omie) do update set
          status_titulo=excluded.status_titulo, data_vencimento=excluded.data_vencimento,
          data_previsao=excluded.data_previsao, valor_documento=excluded.valor_documento,
          codigo_cliente_fornecedor=excluded.codigo_cliente_fornecedor, synced_at=now()
      `, [
        loja.id, it.codigo_lancamento_omie, it.codigo_cliente_fornecedor || null,
        parseBR(it.data_emissao), parseBR(it.data_vencimento), parseBR(it.data_previsao), parseBR(it.data_entrada),
        it.valor_documento, it._status,
        it.codigo_categoria || null, it.codigo_tipo_documento || null,
        it.numero_documento || null, it.numero_documento_fiscal || null, it.numero_parcela || null,
        it.id_conta_corrente || null
      ])
    }
    console.log(`  CP upserted: ${cpTodos.length}`)
  }

  // ---- Contas a receber ----
  let crError = false
  const crTodos = []
  for (const s of STATUS_ABERTOS) {
    try {
      const items = await paginateCR(loja.k, loja.s, s)
      for (const it of items) it._status = s
      crTodos.push(...items)
      process.stdout.write(`  CR ${s}: ${items.length} | `)
    } catch (e) {
      console.error(`\n  [CR ${s} ERRO] ${e.message} -- loja ${loja.id} pulada`)
      crError = true
      break
    }
  }
  console.log(`\n  CR total: ${crTodos.length}${crError ? ' (ERRO -- sem delete)' : ''}`)

  if (crTodos.length && !crError) {
    const oids = crTodos.map(i => i.codigo_lancamento_omie)
    await db.query('delete from contas_receber where loja_id=$1 and codigo_lancamento_omie != all($2::bigint[])', [loja.id, oids])
    for (const it of crTodos) {
      await db.query(`
        insert into contas_receber (loja_id, codigo_lancamento_omie, codigo_cliente_fornecedor, data_emissao, data_vencimento, data_previsao, data_registro, valor_documento, status_titulo, codigo_categoria, codigo_tipo_documento, numero_documento, numero_documento_fiscal, numero_parcela, numero_pedido, chave_nfe, id_conta_corrente, synced_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,now())
        on conflict (loja_id, codigo_lancamento_omie) do update set
          status_titulo=excluded.status_titulo, data_vencimento=excluded.data_vencimento,
          valor_documento=excluded.valor_documento, synced_at=now()
      `, [
        loja.id, it.codigo_lancamento_omie, it.codigo_cliente_fornecedor || null,
        parseBR(it.data_emissao), parseBR(it.data_vencimento), parseBR(it.data_previsao), parseBR(it.data_registro),
        it.valor_documento, it._status,
        it.codigo_categoria || null, it.codigo_tipo_documento || null,
        it.numero_documento || null, it.numero_documento_fiscal || null, it.numero_parcela || null,
        it.numero_pedido || null, it.chave_nfe || null, it.id_conta_corrente || null
      ])
    }
    console.log(`  CR upserted: ${crTodos.length}`)
  }
}

await db.query('SELECT pg_advisory_unlock(20260626)')
await db.end()
console.log('\nSync financeiro concluido.')
