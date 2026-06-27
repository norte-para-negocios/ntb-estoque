// Recopia produtos (com JSONB correto) e movimentos (sem FK quebrado)
import pg from 'pg'

const OLD = { host: 'aws-1-sa-east-1.pooler.supabase.com', port: 5432, user: 'postgres.ocpytiqhjfxfqcosytdx', password: 'rscarneiro3484*', database: 'postgres', ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000, statement_timeout: 60000 }
const NEW = { host: 'aws-1-sa-east-1.pooler.supabase.com', port: 5432, user: 'postgres.waubqgkftwrufepwhctc', password: 'rscarneiro3484*', database: 'postgres', ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000, statement_timeout: 120000 }

function log(msg) { console.log(`[${new Date().toISOString().slice(11,19)}] ${msg}`) }

async function qOld(sql, p) { const c = new pg.Client(OLD); await c.connect(); const r = await c.query(sql,p); await c.end(); return r }
async function qNew(sql, p) { const c = new pg.Client(NEW); await c.connect(); const r = await c.query(sql,p); await c.end(); return r }

const BATCH = 500

async function copiar(nome, sql, cols, serialJson) {
  const jatem = parseInt((await qNew(`SELECT COUNT(*) AS n FROM ${nome}`)).rows[0].n)
  const total = parseInt((await qOld(`SELECT COUNT(*) AS n FROM (${sql}) t`)).rows[0].n)
  log(`${nome}: ${jatem} no novo / ${total} no antigo`)
  if (jatem >= total) { log('  completo.'); return }

  let offset = jatem, inseridos = 0, erros = 0
  while (true) {
    const r = await qOld(`${sql} LIMIT ${BATCH} OFFSET ${offset}`)
    if (!r.rows.length) break
    const params = r.rows.flatMap(row => cols.map(c => {
      const v = row[c]
      if (v === null || v === undefined) return null
      if (serialJson?.includes(c)) return JSON.stringify(v)
      if (typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) return JSON.stringify(v)
      return v
    }))
    const vals = r.rows.map((_, i) => `(${cols.map((_,j) => `$${i*cols.length+j+1}`).join(',')})`).join(',')
    try {
      await qNew(`INSERT INTO ${nome} (${cols.join(',')}) VALUES ${vals} ON CONFLICT DO NOTHING`, params)
      inseridos += r.rows.length
    } catch(e) {
      erros += r.rows.length
      log(`  ERRO offset ${offset}: ${e.message.slice(0,120)}`)
    }
    offset += r.rows.length
    process.stdout.write(`\r  ${offset}/${total} (${erros} erros)...`)
    if (r.rows.length < BATCH) break
  }
  console.log(`\r  Concluido: ${inseridos} inseridos, ${erros} erros.   `)
}

log('=== CORRIGINDO PRODUTOS E MOVIMENTOS ===')

// Produtos -- campos_editados e JSONB, serializar explicitamente
const colsProd = ['id','loja_id','codigo_produto','codigo','descricao','codigo_familia','descricao_familia','tipo_item','unidade','valor_unitario','created_at','updated_at','estoque_minimo','inativo','bloqueado','ncm','ean','campos_editados']
await copiar('produtos',
  `SELECT ${colsProd.join(',')} FROM produtos ORDER BY id`,
  colsProd, ['campos_editados']
)

// Movimentos -- copiar sem transferencia_id (FK que quebra)
const colsMov = ['id','loja_id','tipo','motivo','produto_id','produto_codigo','produto_descricao','quantidade','local_origem_id','local_destino_id','observacao','status','erro','created_at','updated_at','user_id']
const colsMovExist = (await qOld(`SELECT column_name FROM information_schema.columns WHERE table_name='movimentos' ORDER BY ordinal_position`)).rows.map(r=>r.column_name).filter(c => c !== 'transferencia_id')
await copiar('movimentos',
  `SELECT ${colsMovExist.join(',')} FROM movimentos ORDER BY id`,
  colsMovExist, []
)

log('=== FIM ===')
