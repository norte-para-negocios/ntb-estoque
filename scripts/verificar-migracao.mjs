import pg from 'pg'

const OLD = { host: 'aws-1-sa-east-1.pooler.supabase.com', port: 5432, user: 'postgres.ocpytiqhjfxfqcosytdx', password: 'rscarneiro3484*', database: 'postgres', ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 }
const NEW = { host: 'aws-1-sa-east-1.pooler.supabase.com', port: 5432, user: 'postgres.waubqgkftwrufepwhctc', password: 'rscarneiro3484*', database: 'postgres', ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 }

async function count(cfg, table, extra = '') {
  const c = new pg.Client(cfg); await c.connect()
  const r = await c.query(`SELECT COUNT(*) AS n FROM ${table}${extra}`)
  await c.end(); return parseInt(r.rows[0].n)
}

// Tabelas com filtro de data (copiamos apenas ultimos 12 meses)
const CUTOFF = '2025-06-26'
const CUTOFF14D = `NOW() - INTERVAL '14 days'`

const tabelas = [
  { nome: 'produtos',             filtro: '' },
  { nome: 'lojas',                filtro: '' },
  { nome: 'local_estoques',       filtro: '' },
  { nome: 'cargos',               filtro: '' },
  { nome: 'cargo_permissao',      filtro: '' },
  { nome: 'permissoes',           filtro: '' },
  { nome: 'familias',             filtro: '' },
  { nome: 'etiqueta_config',      filtro: '' },
  { nome: 'loja_user',            filtro: '' },
  { nome: 'local_estoque_user',   filtro: '' },
  { nome: 'convites',             filtro: '' },
  { nome: 'fornecedores',         filtro: '' },
  { nome: 'clientes',             filtro: '' },
  { nome: 'posicao_estoques',     filtro: ` WHERE updated_at >= ${CUTOFF14D}`, nota: '(14 dias)' },
  { nome: 'movimentos',           filtro: '' },
  { nome: 'ordens_producao',      filtro: ` WHERE created_at >= '${CUTOFF}'`, nota: '(12m)' },
  { nome: 'movimentos_historico', filtro: ` WHERE created_at >= '${CUTOFF}'`, nota: '(12m)' },
  { nome: 'inventarios',          filtro: '' },
  { nome: 'inventario_items',     filtro: '' },
  { nome: 'permissao_user',       filtro: '' },
  { nome: 'profiles',             filtro: '' },
  { nome: 'previsao_venda',       filtro: '' },
  { nome: 'transferencias',       filtro: '' },
  { nome: 'notas_fiscais',        filtro: '' },
  { nome: 'nota_fiscal_items',    filtro: '' },
  { nome: 'faturamento_importado',filtro: ` WHERE created_at >= '${CUTOFF}'`, nota: '(12m)' },
  { nome: 'margem_importada',     filtro: ` WHERE created_at >= '${CUTOFF}'`, nota: '(12m)' },
  { nome: 'movimentacao_importada',filtro: ` WHERE created_at >= '${CUTOFF}'`, nota: '(12m)' },
  { nome: 'impressao_etiquetas',  filtro: '' },
]

console.log('\n=== VERIFICAÇÃO COMPLETA ANTIGO vs NOVO ===\n')
console.log('Tabela'.padEnd(32) + 'Antigo'.padEnd(10) + 'Novo'.padEnd(10) + 'Status')
console.log('-'.repeat(70))

let ok = 0, diff = 0, erros = 0
for (const t of tabelas) {
  try {
    const a = await count(OLD, t.nome, t.filtro)
    const n = await count(NEW, t.nome, t.filtro)
    const igual = a === n
    if (igual) ok++; else diff++
    const label = (t.nome + (t.nota ? ' ' + t.nota : '')).padEnd(32)
    console.log(label + String(a).padEnd(10) + String(n).padEnd(10) + (igual ? '✓' : `✗ FALTA ${a - n}`))
  } catch(e) {
    erros++
    console.log(t.nome.padEnd(32) + '---'.padEnd(10) + '---'.padEnd(10) + `! ${e.message.slice(0,40)}`)
  }
}

// auth
const aAuth = await count(OLD, 'auth.users')
const nAuth = await count(NEW, 'auth.users')
const aIdent = await count(OLD, 'auth.identities')
const nIdent = await count(NEW, 'auth.identities')
console.log('auth.users'.padEnd(32) + String(aAuth).padEnd(10) + String(nAuth).padEnd(10) + (aAuth===nAuth ? '✓' : `✗ FALTA ${aAuth-nAuth}`))
console.log('auth.identities'.padEnd(32) + String(aIdent).padEnd(10) + String(nIdent).padEnd(10) + (aIdent===nIdent ? '✓' : `✗ FALTA ${aIdent-nIdent}`))
if (aAuth===nAuth) ok++; else diff++
if (aIdent===nIdent) ok++; else diff++

console.log('-'.repeat(70))
console.log(`\nTotal: ${ok} OK  |  ${diff} com diferença  |  ${erros} erros de tabela\n`)
