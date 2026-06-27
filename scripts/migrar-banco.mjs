// Migra dados do banco antigo (ocpytiqhjfxfqcosytdx) para o novo (waubqgkftwrufepwhctc).
// Aplica todas as migrations, depois copia os dados ja limpos (sem full_object gordo).
// Uso: node scripts/migrar-banco.mjs

import fs from 'node:fs'
import path from 'node:path'
import pg from 'pg'

const PROJ = process.cwd()
const MIGRATIONS_DIR = path.join(PROJ, 'supabase/migrations')

// ── Banco ANTIGO (leitura) ─────────────────────────────────────────────────
const OLD = new pg.Pool({
  host: 'aws-1-sa-east-1.pooler.supabase.com',
  port: 5432,
  user: 'postgres.ocpytiqhjfxfqcosytdx',
  password: 'rscarneiro3484*',
  database: 'postgres',
  ssl: { rejectUnauthorized: false },
  max: 3,
  connectionTimeoutMillis: 15000,
  statement_timeout: 60000,
})

// ── Banco NOVO (escrita) ───────────────────────────────────────────────────
const NEW = new pg.Pool({
  host: 'aws-1-sa-east-1.pooler.supabase.com',
  port: 5432,
  user: 'postgres.waubqgkftwrufepwhctc',
  password: 'rscarneiro3484*',
  database: 'postgres',
  ssl: { rejectUnauthorized: false },
  max: 3,
  connectionTimeoutMillis: 15000,
  statement_timeout: 120000,
})

async function queryOld(sql, params) {
  return OLD.query(sql, params)
}

async function queryNew(sql, params) {
  return NEW.query(sql, params)
}

function log(msg) { console.log(`[${new Date().toISOString().slice(11,19)}] ${msg}`) }

// ── FASE 1: Aplicar migrations ─────────────────────────────────────────────
async function aplicarMigrations() {
  log('=== FASE 1: Aplicando migrations no novo banco ===')
  const arquivos = fs.readdirSync(MIGRATIONS_DIR)
    .filter(f => f.endsWith('.sql'))
    .sort()

  for (const arquivo of arquivos) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, arquivo), 'utf8')
    try {
      await queryNew(sql)
      log(`  OK: ${arquivo}`)
    } catch (e) {
      if (e.message.includes('already exists') || e.message.includes('duplicate')) {
        log(`  JA EXISTE (ok): ${arquivo}`)
      } else {
        log(`  ERRO em ${arquivo}: ${e.message.slice(0, 120)}`)
      }
    }
  }
  log('Migrations concluidas.')
}

// ── FASE 2: Copiar dados ───────────────────────────────────────────────────
const BATCH = 2000
const DOZE_MESES_ATRAS = new Date()
DOZE_MESES_ATRAS.setFullYear(DOZE_MESES_ATRAS.getFullYear() - 1)
const DATA_CORTE = DOZE_MESES_ATRAS.toISOString().slice(0, 10)

async function copiarTabela(nome, { sql, colunas, descricao }) {
  log(`  Copiando ${nome} (${descricao})...`)
  let offset = 0, total = 0

  while (true) {
    const r = await queryOld(`${sql} LIMIT ${BATCH} OFFSET ${offset}`)
    if (r.rows.length === 0) break

    const rows = r.rows
    const cols = colunas || Object.keys(rows[0])
    const vals = rows.map((row, i) =>
      `(${cols.map((_, j) => `$${i * cols.length + j + 1}`).join(',')})`
    ).join(',')
    const params = rows.flatMap(row => cols.map(c => row[c]))

    const insertSql = `INSERT INTO ${nome} (${cols.join(',')}) VALUES ${vals} ON CONFLICT DO NOTHING`
    try {
      await queryNew(insertSql, params)
    } catch (e) {
      log(`    ERRO batch offset ${offset}: ${e.message.slice(0, 100)}`)
    }

    total += r.rows.length
    offset += BATCH
    process.stdout.write(`\r    ${total} linhas...`)
    if (r.rows.length < BATCH) break
  }
  console.log(`\r    ${total} linhas copiadas.`)
}

async function copiarDados() {
  log(`=== FASE 2: Copiando dados (corte 12 meses: ${DATA_CORTE}) ===`)

  // Tabelas simples -- copiar tudo
  const tablesSimples = [
    'lojas',
    'familias',
    'local_estoques',
    'clientes',
    'fornecedores',
    'previsao_venda',
    'permissao_user',
    'movimentos',
    'movimentacao_operacao',
    'faturamento_importado',
  ]

  for (const t of tablesSimples) {
    await copiarTabela(t, {
      sql: `SELECT * FROM ${t}`,
      descricao: 'tudo',
    })
  }

  // Produtos -- copiar sem full_object
  await copiarTabela('produtos', {
    sql: `SELECT id, loja_id, codigo_produto, codigo, descricao, codigo_familia,
                descricao_familia, tipo_item, unidade, valor_unitario,
                created_at, updated_at, estoque_minimo, inativo, bloqueado,
                ncm, ean, campos_editados
          FROM produtos`,
    descricao: 'sem full_object',
  })

  // Posicao estoques -- ultimos 14 dias (dados numericos, sem full_object)
  await copiarTabela('posicao_estoques', {
    sql: `SELECT id, loja_id, codigo_local_estoque, n_cod_prod, data_posicao,
                c_cod_int, c_codigo, c_descricao, n_preco_unitario, n_saldo,
                n_cmc, n_pendente, estoque_minimo, reservado, fisico,
                created_at, updated_at
          FROM posicao_estoques
          WHERE data_posicao >= (CURRENT_DATE - interval '14 days')`,
    descricao: 'ultimos 14 dias',
  })

  // Notas fiscais -- ultimos 12 meses, sem full_object
  log('  Verificando colunas de notas_fiscais...')
  const colsNF = await queryOld(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'notas_fiscais' AND column_name != 'full_object'
    ORDER BY ordinal_position
  `)
  const nfCols = colsNF.rows.map(r => r.column_name).join(', ')
  await copiarTabela('notas_fiscais', {
    sql: `SELECT ${nfCols} FROM notas_fiscais WHERE created_at >= '${DATA_CORTE}'`,
    descricao: `ultimos 12 meses sem full_object (${colsNF.rows.length} colunas)`,
  })

  // Itens das notas fiscais -- ultimos 12 meses, sem full_object
  const colsNFI = await queryOld(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'nota_fiscal_items' AND column_name != 'full_object'
    ORDER BY ordinal_position
  `)
  const nfiCols = colsNFI.rows.map(r => r.column_name).join(', ')
  await copiarTabela('nota_fiscal_items', {
    sql: `SELECT ${nfiCols} FROM nota_fiscal_items WHERE created_at >= '${DATA_CORTE}'`,
    descricao: `ultimos 12 meses sem full_object`,
  })

  // Ordens de producao -- ultimos 12 meses, SEM full_object, COM observacao
  const colsOP = await queryOld(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'ordens_producao' AND column_name != 'full_object'
    ORDER BY ordinal_position
  `)
  const opCols = colsOP.rows.map(r => r.column_name).join(', ')
  await copiarTabela('ordens_producao', {
    sql: `SELECT ${opCols} FROM ordens_producao WHERE dt_inclusao >= '${DATA_CORTE}'`,
    descricao: `ultimos 12 meses sem full_object`,
  })

  // Movimentos historico -- ja e 12 meses, nao tem full_object
  await copiarTabela('movimentos_historico', {
    sql: `SELECT * FROM movimentos_historico`,
    descricao: 'tudo (ja e 12 meses)',
  })

  // Inventario items -- ultimos 12 meses
  await copiarTabela('inventario_items', {
    sql: `SELECT * FROM inventario_items WHERE created_at >= '${DATA_CORTE}'`,
    descricao: 'ultimos 12 meses',
  })

  // NÃO copiar: integration_attempts, webhooks, audit_log (logs/filas)
  log('  PULANDO: integration_attempts, webhooks, audit_log (logs desnecessarios)')

  log('Dados copiados.')
}

// ── Main ───────────────────────────────────────────────────────────────────
log('Iniciando migracao de banco...')
log(`Origem: ocpytiqhjfxfqcosytdx | Destino: waubqgkftwrufepwhctc`)
log(`Data de corte (12 meses): ${DATA_CORTE}`)
log('')

try {
  await aplicarMigrations()
  log('')
  await copiarDados()
  log('')
  log('=== MIGRACAO CONCLUIDA ===')
  log('Proximo passo: atualizar .env.local e variaveis do Vercel com as novas credenciais.')
} catch (e) {
  log(`ERRO FATAL: ${e.message}`)
  console.error(e)
} finally {
  await OLD.end()
  await NEW.end()
}
