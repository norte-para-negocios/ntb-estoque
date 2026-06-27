// Copia os registros que estao no antigo mas nao no novo, por ID
import pg from 'pg'

const OLD = { host: 'aws-1-sa-east-1.pooler.supabase.com', port: 5432, user: 'postgres.ocpytiqhjfxfqcosytdx', password: 'rscarneiro3484*', database: 'postgres', ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000, statement_timeout: 90000 }
const NEW = { host: 'aws-1-sa-east-1.pooler.supabase.com', port: 5432, user: 'postgres.waubqgkftwrufepwhctc', password: 'rscarneiro3484*', database: 'postgres', ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000, statement_timeout: 120000 }

function log(msg) { console.log(`[${new Date().toISOString().slice(11,19)}] ${msg}`) }
async function q(cfg, sql, p) { const c = new pg.Client(cfg); await c.connect(); const r = await c.query(sql, p); await c.end(); return r }

const BATCH = 300

async function copiarFaltantes(tabela, colsExplicit, serialJson = [], filtroOld = '') {
  log(`\n--- ${tabela} ---`)

  // Descobrir colunas se nao passadas
  const cols = colsExplicit || (await q(OLD, `SELECT column_name FROM information_schema.columns WHERE table_name='${tabela}' AND table_schema='public' ORDER BY ordinal_position`)).rows.map(r => r.column_name)
  log(`Colunas: ${cols.join(', ')}`)

  // Pegar IDs que existem no antigo mas nao no novo
  const faltamR = await q(OLD, `
    SELECT id FROM ${tabela} ${filtroOld}
    EXCEPT
    SELECT id FROM dblink('host=aws-1-sa-east-1.pooler.supabase.com port=5432 user=postgres.waubqgkftwrufepwhctc password=rscarneiro3484* dbname=postgres sslmode=require', 'SELECT id FROM ${tabela}') AS t(id int)
    ORDER BY 1
  `)

  if (!faltamR.rows.length) { log('  Nada faltando.'); return }

  const idsQueFaltam = faltamR.rows.map(r => r.id)
  log(`  Faltam ${idsQueFaltam.length} registros no novo banco`)

  let inseridos = 0, erros = 0
  for (let i = 0; i < idsQueFaltam.length; i += BATCH) {
    const batch = idsQueFaltam.slice(i, i + BATCH)
    const placeholders = batch.map((_, j) => `$${j+1}`).join(',')
    const rows = await q(OLD, `SELECT ${cols.join(',')} FROM ${tabela} WHERE id IN (${placeholders}) ORDER BY id`, batch)
    if (!rows.rows.length) continue

    const vals = rows.rows.map((_, ri) => `(${cols.map((_, ci) => `$${ri*cols.length+ci+1}`).join(',')})`).join(',')
    const params = rows.rows.flatMap(row => cols.map(c => {
      const v = row[c]
      if (v === null || v === undefined) return null
      if (serialJson?.includes(c)) return JSON.stringify(v)
      if (typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) return JSON.stringify(v)
      return v
    }))
    try {
      await q(NEW, `INSERT INTO ${tabela} (${cols.join(',')}) VALUES ${vals} ON CONFLICT (id) DO NOTHING`, params)
      inseridos += rows.rows.length
    } catch(e) {
      erros += rows.rows.length
      log(`  ERRO batch ${i}: ${e.message.slice(0, 150)}`)
    }
    process.stdout.write(`\r  ${Math.min(i+BATCH, idsQueFaltam.length)}/${idsQueFaltam.length}...`)
  }
  console.log()

  const totalNovo = parseInt((await q(NEW, `SELECT COUNT(*) AS n FROM ${tabela}`)).rows[0].n)
  const totalAntigo = parseInt((await q(OLD, `SELECT COUNT(*) AS n FROM ${tabela} ${filtroOld}`)).rows[0].n)
  log(`  Resultado: ${inseridos} inseridos, ${erros} erros. Novo: ${totalNovo}, Antigo(filtrado): ${totalAntigo}`)
}

// dblink pode nao estar disponivel -- usar abordagem alternativa sem dblink
async function copiarFaltantesSemDblink(tabela, colsExplicit, serialJson = [], filtroOld = '') {
  log(`\n--- ${tabela} ---`)

  const cols = colsExplicit || (await q(OLD, `SELECT column_name FROM information_schema.columns WHERE table_name='${tabela}' AND table_schema='public' ORDER BY ordinal_position`)).rows.map(r => r.column_name)

  // Pegar todos os IDs do antigo e do novo separadamente
  const idsOldR = await q(OLD, `SELECT id FROM ${tabela} ${filtroOld} ORDER BY id`)
  const idsNewR = await q(NEW, `SELECT id FROM ${tabela} ORDER BY id`)

  const idsOld = new Set(idsOldR.rows.map(r => String(r.id)))
  const idsNew = new Set(idsNewR.rows.map(r => String(r.id)))
  const faltam = idsOldR.rows.map(r => r.id).filter(id => !idsNew.has(String(id)))

  if (!faltam.length) { log(`  Completo (${idsNew.size} registros).`); return }
  log(`  Faltam ${faltam.length} dos ${idsOld.size} registros`)

  let inseridos = 0, erros = 0
  for (let i = 0; i < faltam.length; i += BATCH) {
    const batch = faltam.slice(i, i + BATCH)
    const placeholders = batch.map((_, j) => `$${j+1}`).join(',')
    const rows = await q(OLD, `SELECT ${cols.join(',')} FROM ${tabela} WHERE id IN (${placeholders}) ORDER BY id`, batch)
    if (!rows.rows.length) continue

    const vals = rows.rows.map((_, ri) => `(${cols.map((_, ci) => `$${ri*cols.length+ci+1}`).join(',')})`).join(',')
    const params = rows.rows.flatMap(row => cols.map(c => {
      const v = row[c]
      if (v === null || v === undefined) return null
      if (serialJson?.includes(c)) return JSON.stringify(v)
      if (typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) return JSON.stringify(v)
      return v
    }))
    try {
      await q(NEW, `INSERT INTO ${tabela} (${cols.join(',')}) VALUES ${vals} ON CONFLICT (id) DO NOTHING`, params)
      inseridos += rows.rows.length
    } catch(e) {
      erros += rows.rows.length
      log(`  ERRO batch ${i}: ${e.message.slice(0, 150)}`)
    }
    process.stdout.write(`\r  ${Math.min(i+BATCH, faltam.length)}/${faltam.length}...`)
  }
  console.log()
  const totalNovo = parseInt((await q(NEW, `SELECT COUNT(*) AS n FROM ${tabela}`)).rows[0].n)
  log(`  Resultado: ${inseridos} inseridos, ${erros} erros. Total novo: ${totalNovo}`)
}

// Copiar tabelas simples sem filtro (sem PK int -- usar INSERT direto)
async function copiarSimples(tabela, colsExplicit, serialJson = []) {
  log(`\n--- ${tabela} (simples) ---`)
  const cols = colsExplicit || (await q(OLD, `SELECT column_name FROM information_schema.columns WHERE table_name='${tabela}' AND table_schema='public' ORDER BY ordinal_position`)).rows.map(r => r.column_name)
  const rows = await q(OLD, `SELECT ${cols.join(',')} FROM ${tabela}`)
  log(`  ${rows.rows.length} registros no antigo`)
  if (!rows.rows.length) return
  for (const row of rows.rows) {
    const vals = cols.map((_, i) => `$${i+1}`).join(',')
    const params = cols.map(c => {
      const v = row[c]
      if (v === null || v === undefined) return null
      if (serialJson?.includes(c)) return JSON.stringify(v)
      if (typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) return JSON.stringify(v)
      return v
    })
    try {
      await q(NEW, `INSERT INTO ${tabela} (${cols.join(',')}) VALUES (${vals}) ON CONFLICT DO NOTHING`, params)
    } catch(e) {
      log(`  ERRO: ${e.message.slice(0,150)}`)
    }
  }
  const n = parseInt((await q(NEW, `SELECT COUNT(*) AS n FROM ${tabela}`)).rows[0].n)
  log(`  Total no novo: ${n}`)
}

log('=== MIGRANDO FALTANTES ===')

// produtos -- IDs nao sequenciais, usar abordagem por diff de IDs
const colsProd = ['id','loja_id','codigo_produto','codigo','descricao','codigo_familia','descricao_familia','tipo_item','unidade','valor_unitario','created_at','updated_at','estoque_minimo','inativo','bloqueado','ncm','ean','campos_editados']
await copiarFaltantesSemDblink('produtos', colsProd, ['campos_editados'])

// ordens_producao -- 43433 faltando dentro do periodo 12m
const colsOP = (await q(OLD, `SELECT column_name FROM information_schema.columns WHERE table_name='ordens_producao' AND table_schema='public' ORDER BY ordinal_position`)).rows.map(r => r.column_name).filter(c => c !== 'full_object')
await copiarFaltantesSemDblink('ordens_producao', colsOP, [], `WHERE created_at >= '2025-06-26'`)

// nota_fiscal_items
const colsNFI = (await q(OLD, `SELECT column_name FROM information_schema.columns WHERE table_name='nota_fiscal_items' AND table_schema='public' ORDER BY ordinal_position`)).rows.map(r => r.column_name)
await copiarFaltantesSemDblink('nota_fiscal_items', colsNFI)

// Tabelas simples que faltaram totalmente
await copiarSimples('loja_user')
await copiarSimples('local_estoque_user')
await copiarSimples('etiqueta_config', null, ['configuracao'])
await copiarSimples('impressao_etiquetas')
await copiarSimples('transferencias')

// movimentos_historico -- sem coluna created_at, copiar tudo
const colsMH = (await q(OLD, `SELECT column_name FROM information_schema.columns WHERE table_name='movimentos_historico' AND table_schema='public' ORDER BY ordinal_position`)).rows.map(r => r.column_name)
log('\n--- movimentos_historico ---')
log(`Colunas: ${colsMH.join(', ')}`)
const mhOld = parseInt((await q(OLD, `SELECT COUNT(*) AS n FROM movimentos_historico`)).rows[0].n)
const mhNew = parseInt((await q(NEW, `SELECT COUNT(*) AS n FROM movimentos_historico`)).rows[0].n)
log(`  Antigo: ${mhOld}, Novo: ${mhNew}`)
if (mhNew < mhOld) {
  log('  Copiando movimentos_historico...')
  const rows = await q(OLD, `SELECT ${colsMH.join(',')} FROM movimentos_historico`)
  let ins = 0, err = 0
  for (let i = 0; i < rows.rows.length; i += 500) {
    const batch = rows.rows.slice(i, i+500)
    const vals = batch.map((_, ri) => `(${colsMH.map((_, ci) => `$${ri*colsMH.length+ci+1}`).join(',')})`).join(',')
    const params = batch.flatMap(row => colsMH.map(c => row[c]))
    try {
      await q(NEW, `INSERT INTO movimentos_historico (${colsMH.join(',')}) VALUES ${vals} ON CONFLICT DO NOTHING`, params)
      ins += batch.length
    } catch(e) {
      err += batch.length
      log(`  ERRO: ${e.message.slice(0,100)}`)
    }
  }
  log(`  Inseridos: ${ins}, Erros: ${err}`)
}

// Tabelas importadas sem created_at
for (const t of ['faturamento_importado','margem_importada','movimentacao_importada']) {
  const colsT = (await q(OLD, `SELECT column_name FROM information_schema.columns WHERE table_name='${t}' AND table_schema='public' ORDER BY ordinal_position`)).rows.map(r => r.column_name)
  log(`\n--- ${t} ---`)
  log(`Colunas: ${colsT.join(', ')}`)
  const nOld = parseInt((await q(OLD, `SELECT COUNT(*) AS n FROM ${t}`)).rows[0].n)
  const nNew = parseInt((await q(NEW, `SELECT COUNT(*) AS n FROM ${t}`)).rows[0].n)
  log(`  Antigo: ${nOld}, Novo: ${nNew}`)
  if (nNew >= nOld) { log('  OK.'); continue }
  // copiar por ID diff se tem PK
  const hasPK = colsT.includes('id')
  if (hasPK) await copiarFaltantesSemDblink(t, colsT)
  else await copiarSimples(t, colsT)
}

log('\n=== FIM ===')
