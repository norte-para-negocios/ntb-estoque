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

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

// Erros transitorios do Omie que valem retry (request ainda em execucao, rate limit).
function transitorio(msg) {
  return /j[aá] existe uma requisi|consumo indevido|tente novamente|em execu/i.test(msg)
}

async function omie(key, secret, ep, call, data, tentativa = 1) {
  const r = await fetch(`https://app.omie.com.br/api/${ep}/`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ call, app_key: key, app_secret: secret, param: [data] })
  })
  const json = await r.json()
  const fault = json?.faultstring ?? json?.faultcode
  if (fault) {
    if (transitorio(String(fault)) && tentativa <= 4) {
      await sleep(1500 * tentativa) // backoff: 1.5s, 3s, 4.5s, 6s
      return omie(key, secret, ep, call, data, tentativa + 1)
    }
    throw new Error(`Omie fault: ${fault}`)
  }
  return json
}

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

// ---- Contas correntes + saldos (cabecalho do ListarExtrato) ----
const DELAY_EXTRATO = 600 // ListarExtrato e sensivel a rate limit ("consumo indevido")

async function listarCC(key, secret) {
  const items = []
  let pagina = 1, totalPags = 1
  while (pagina <= totalPags) {
    const r = await omie(key, secret, 'v1/geral/contacorrente', 'ListarContasCorrentes', { pagina, registros_por_pagina: 50 })
    totalPags = r.total_de_paginas ?? 1
    items.push(...(r?.ListarContasCorrentes ?? []))
    pagina++
    if (pagina <= totalPags) await sleep(DELAY)
  }
  return items
}

async function saldoCC(key, secret, codigoCC, dataBR) {
  // Periodo minimo (so hoje): so queremos o cabecalho com os saldos atuais.
  const r = await omie(key, secret, 'v1/financas/extrato', 'ListarExtrato', {
    nCodCC: codigoCC, dPeriodoInicial: dataBR, dPeriodoFinal: dataBR,
  })
  return {
    saldo_atual: r.nSaldoAtual ?? null,
    saldo_previsto: r.nSaldoAtualPrevisto ?? null,
    saldo_disponivel: r.nSaldoDisponivel ?? null,
    saldo_conciliado: r.nSaldoConciliado ?? null,
    inclui_fluxo_caixa: r.cFluxoCaixa === 'S',
  }
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

  // ---- Contas correntes + saldos ----
  try {
    const hojeBR = new Date().toLocaleDateString('pt-BR')
    const ccs = await listarCC(loja.k, loja.s)
    let ok = 0
    for (const cc of ccs) {
      await sleep(DELAY_EXTRATO)
      let saldos = { saldo_atual: null, saldo_previsto: null, saldo_disponivel: null, saldo_conciliado: null, inclui_fluxo_caixa: true }
      try {
        saldos = await saldoCC(loja.k, loja.s, cc.nCodCC, hojeBR)
        ok++
      } catch (e) {
        // sem saldo (ex.: tipo sem extrato); grava cadastro mesmo assim
      }
      await db.query(`
        insert into contas_correntes (loja_id, codigo_cc, descricao, tipo, tipo_descricao, codigo_banco, numero_conta, saldo_atual, saldo_previsto, saldo_disponivel, saldo_conciliado, inclui_fluxo_caixa, synced_at)
        values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now())
        on conflict (loja_id, codigo_cc) do update set
          descricao=excluded.descricao, tipo=excluded.tipo, tipo_descricao=excluded.tipo_descricao,
          codigo_banco=excluded.codigo_banco, numero_conta=excluded.numero_conta,
          saldo_atual=excluded.saldo_atual, saldo_previsto=excluded.saldo_previsto,
          saldo_disponivel=excluded.saldo_disponivel, saldo_conciliado=excluded.saldo_conciliado,
          inclui_fluxo_caixa=excluded.inclui_fluxo_caixa, synced_at=now()
      `, [
        loja.id, cc.nCodCC, cc.descricao || null, cc.tipo_conta_corrente || null, cc.cDesTipo || cc.descricao_tipo || null,
        String(cc.codigo_banco ?? ''), cc.numero_conta_corrente || null,
        saldos.saldo_atual, saldos.saldo_previsto, saldos.saldo_disponivel, saldos.saldo_conciliado,
        saldos.inclui_fluxo_caixa,
      ])
    }
    console.log(`  CC: ${ccs.length} contas (${ok} com saldo)`)
  } catch (e) {
    console.error(`  [CC ERRO] ${e.message} -- loja ${loja.id}`)
  }
}

await db.query('SELECT pg_advisory_unlock(20260626)')
await db.end()
console.log('\nSync financeiro concluido.')
