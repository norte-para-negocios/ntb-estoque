// Continua a migracao para as tabelas que nao terminaram.
// Uso: node scripts/migrar-continuacao.mjs

import pg from 'pg'

const OLD = {
  host: 'aws-1-sa-east-1.pooler.supabase.com', port: 5432,
  user: 'postgres.ocpytiqhjfxfqcosytdx', password: 'rscarneiro3484*',
  database: 'postgres', ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000, statement_timeout: 60000,
}
const NEW = {
  host: 'aws-1-sa-east-1.pooler.supabase.com', port: 5432,
  user: 'postgres.waubqgkftwrufepwhctc', password: 'rscarneiro3484*',
  database: 'postgres', ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15000, statement_timeout: 120000,
}

const DATA_CORTE = '2025-06-26'
const BATCH = 1000

function log(msg) { console.log(`[${new Date().toISOString().slice(11,19)}] ${msg}`) }

async function queryComRetry(config, sql, params, tentativas = 3) {
  for (let i = 0; i < tentativas; i++) {
    const client = new pg.Client(config)
    try {
      await client.connect()
      const r = await client.query(sql, params)
      await client.end()
      return r
    } catch (e) {
      try { await client.end() } catch {}
      if (i === tentativas - 1) throw e
      log(`    Retry ${i + 1}/${tentativas}: ${e.message.slice(0, 60)}`)
      await new Promise(r => setTimeout(r, 2000 * (i + 1)))
    }
  }
}

async function copiarTabela(nome, sqlSelect, colunasNew) {
  // Verificar quantos ja temos no novo banco
  const jatem = await queryComRetry(NEW, `SELECT COUNT(*) AS n FROM ${nome}`)
  const jaTemN = parseInt(jatem.rows[0].n)

  // Total no banco antigo
  const total = await queryComRetry(OLD, `SELECT COUNT(*) AS n FROM (${sqlSelect}) t`)
  const totalN = parseInt(total.rows[0].n)

  log(`  ${nome}: ${jaTemN} ja no novo / ${totalN} no antigo`)
  if (jaTemN >= totalN) { log(`  ${nome}: completo, pulando.`); return }

  let offset = jaTemN, copiados = 0, erros = 0

  while (offset < totalN) {
    let rows
    try {
      const r = await queryComRetry(OLD, `${sqlSelect} LIMIT ${BATCH} OFFSET ${offset}`)
      rows = r.rows
    } catch (e) {
      log(`\n    ERRO leitura offset ${offset}: ${e.message.slice(0, 80)}`)
      await new Promise(r => setTimeout(r, 3000))
      continue
    }
    if (rows.length === 0) break

    const cols = colunasNew || Object.keys(rows[0]).filter(c => c !== 'full_object')
    const vals = rows.map((_, i) =>
      `(${cols.map((_, j) => `$${i * cols.length + j + 1}`).join(',')})`
    ).join(',')
    const params = rows.flatMap(row => cols.map(c => {
      const v = row[c]
      // JSONB/JSON: se for objeto, converter para string
      if (v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) {
        return JSON.stringify(v)
      }
      return v
    }))

    try {
      await queryComRetry(NEW, `INSERT INTO ${nome} (${cols.join(',')}) VALUES ${vals} ON CONFLICT DO NOTHING`, params)
      copiados += rows.length
    } catch (e) {
      erros += rows.length
      log(`\n    ERRO insert offset ${offset}: ${e.message.slice(0, 100)}`)
    }

    offset += rows.length
    process.stdout.write(`\r    ${offset}/${totalN} (${erros > 0 ? erros + ' erros' : 'ok'})...`)
    if (rows.length < BATCH) break
  }
  console.log(`\r    Concluido: ${copiados} inseridos, ${erros} com erro.   `)
}

log('=== CONTINUACAO DA MIGRACAO ===')

// Ordens de producao -- ultimos 12 meses sem full_object
const colsOP = [
  'id','loja_id','num_ordem','validade','quantidade',
  'identificacao_n_cod_op','identificacao_c_cod_int_op','identificacao_c_num_op',
  'identificacao_n_cod_produto','identificacao_c_cod_int_prod',
  'identificacao_d_dt_previsao','identificacao_n_qtde','identificacao_codigo_local_estoque',
  'adicionais_c_etapa','adicionais_n_cod_projeto','adicionais_d_dt_inicio','adicionais_d_dt_conclusao',
  'produto_codigo','produto_descricao','produto_tipo_item','produto_unidade',
  'created_at','updated_at','concluida','dt_conclusao_real','dt_inclusao','observacao'
]
await copiarTabela(
  'ordens_producao',
  `SELECT ${colsOP.join(',')} FROM ordens_producao WHERE dt_inclusao >= '${DATA_CORTE}' ORDER BY id`,
  colsOP
)

// Movimentos historico -- tudo
await copiarTabela(
  'movimentos_historico',
  `SELECT * FROM movimentos_historico ORDER BY loja_id, cod_prod, data`,
  null
)

// Inventario items -- ultimos 12 meses
await copiarTabela(
  'inventario_items',
  `SELECT * FROM inventario_items WHERE created_at >= '${DATA_CORTE}' ORDER BY id`,
  null
)

log('=== FIM ===')
