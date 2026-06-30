// Arquiva ordens_producao concluídas fora da janela quente (default 3 meses) para o
// Supabase Storage (arquivo-morto/ordens_producao/YYYY-MM.json.gz) e apaga do Postgres.
// Usa o mesmo protocolo de lib/arquivo-morto.ts: marca d'água ANTES do delete.
//
// Uso:
//   node scripts/arquivar-ops.mjs              → simula (dry run)
//   node scripts/arquivar-ops.mjs --executar   → arquiva e apaga de verdade
//   node scripts/arquivar-ops.mjs --meses=6    → janela de 6 meses (default 3)
//
import fs from 'node:fs'
import { gzipSync } from 'node:zlib'
import { createClient } from '@supabase/supabase-js'
import pg from 'pg'

const PROJ = process.cwd()
const env = {}
for (const line of fs.readFileSync(`${PROJ}/.env.local`, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}

const DRY_RUN = !process.argv.includes('--executar')
const mesesArg = process.argv.find(a => a.startsWith('--meses='))
const MESES = mesesArg ? Number(mesesArg.split('=')[1]) : 3

// Corte: primeiro dia do mês MESES atrás
const hoje = new Date()
const corte = new Date(Date.UTC(hoje.getUTCFullYear(), hoje.getUTCMonth() - MESES, 1))
  .toISOString().slice(0, 10)

console.log(`Arquivar OPs concluídas com dt_conclusao_real < ${corte} (janela ${MESES} meses)`)
console.log(DRY_RUN ? 'MODO: SIMULAÇÃO (--executar para rodar de verdade)\n' : 'MODO: EXECUTAR (apaga do banco após arquivar)\n')

const supabase = createClient(
  env.NEXT_PUBLIC_SUPABASE_URL,
  env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
)

const u = new URL(env.SUPABASE_DB_URL)
const senha = decodeURIComponent(u.password)
const ref = u.hostname.replace(/^db\./, '').replace(/\.supabase\.co$/, '')
const [hh, pp] = fs.readFileSync(`${PROJ}/scripts/.pooler-host`, 'utf8').trim().split(':')
const db = new pg.Client({
  host: hh, port: Number(pp), user: `postgres.${ref}`,
  password: senha, database: 'postgres', ssl: { rejectUnauthorized: false },
})
await db.connect()

// Lista meses arquiváveis (com linhas)
const { rows: meses } = await db.query(`
  SELECT to_char(dt_conclusao_real, 'YYYY-MM') AS periodo, count(*) AS linhas
  FROM ordens_producao
  WHERE dt_conclusao_real IS NOT NULL AND dt_conclusao_real < $1
  GROUP BY 1 ORDER BY 1
`, [corte])

if (!meses.length) {
  console.log('Nada a arquivar.')
  await db.end(); process.exit(0)
}

console.log(`${meses.length} meses para arquivar:`)
let totalLinhas = 0
for (const m of meses) {
  console.log(`  ${m.periodo}: ${Number(m.linhas).toLocaleString('pt-BR')} OPs`)
  totalLinhas += Number(m.linhas)
}
console.log(`  TOTAL: ${totalLinhas.toLocaleString('pt-BR')} OPs\n`)

if (DRY_RUN) {
  const mbEstimado = (totalLinhas * 912 / 1048576).toFixed(0)
  console.log(`Estimativa de espaço liberado: ~${mbEstimado} MB`)
  await db.end(); process.exit(0)
}

// Arquiva mês a mês
const BUCKET = 'arquivo-morto'
let arquivados = 0

for (const { periodo } of meses) {
  const [ano, mes] = periodo.split('-').map(Number)
  const ini = new Date(Date.UTC(ano, mes - 1, 1)).toISOString().slice(0, 10)
  const fim = new Date(Date.UTC(ano, mes, 1)).toISOString().slice(0, 10)
  const path = `ordens_producao/${periodo}.json.gz`

  // Já arquivado?
  const { data: existente } = await supabase
    .from('arquivos_mortos')
    .select('id')
    .eq('tabela', 'ordens_producao')
    .eq('periodo', periodo)
    .maybeSingle()
  if (existente) {
    console.log(`  ${periodo}: já arquivado, pulando`)
    continue
  }

  // Lê as linhas do mês (paginando de 1000 em 1000)
  const linhas = []
  for (let off = 0; ; off += 1000) {
    const { data, error } = await supabase
      .from('ordens_producao')
      .select('*')
      .gte('dt_conclusao_real', ini)
      .lt('dt_conclusao_real', fim)
      .order('dt_conclusao_real', { ascending: true })
      .range(off, off + 999)
    if (error) { console.error(`  ${periodo}: erro ao ler: ${error.message}`); break }
    if (!data?.length) break
    linhas.push(...data)
    if (data.length < 1000) break
  }

  if (!linhas.length) { console.log(`  ${periodo}: vazio`); continue }

  // Comprime
  const buf = gzipSync(Buffer.from(JSON.stringify(linhas)))
  const kbGz = (buf.byteLength / 1024).toFixed(0)

  // Upload para Storage
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, buf, {
    contentType: 'application/gzip',
    upsert: true,
  })
  if (upErr) { console.error(`  ${periodo}: erro upload: ${upErr.message}`); continue }

  // Marca d'água ANTES do delete
  const { error: insErr } = await supabase.from('arquivos_mortos').insert({
    tabela: 'ordens_producao',
    periodo,
    path,
    linhas: linhas.length,
    bytes: buf.byteLength,
  })
  if (insErr) { console.error(`  ${periodo}: erro marcação: ${insErr.message}`); continue }

  // Apaga do banco
  const { error: delErr } = await supabase
    .from('ordens_producao')
    .delete()
    .gte('dt_conclusao_real', ini)
    .lt('dt_conclusao_real', fim)
  if (delErr) {
    console.error(`  ${periodo}: upload ok, delete falhou: ${delErr.message}`)
    continue
  }

  arquivados += linhas.length
  console.log(`  ${periodo}: ${linhas.length.toLocaleString('pt-BR')} OPs → ${kbGz} KB gzip ✓`)
}

console.log(`\nArquivadas: ${arquivados.toLocaleString('pt-BR')} OPs`)

if (arquivados > 0) {
  console.log('\nExecutando VACUUM FULL ANALYZE em ordens_producao (pode demorar ~1 min)...')
  await db.query('VACUUM FULL ANALYZE ordens_producao')
  console.log('VACUUM concluído.')
}

const { rows: [{ mb }] } = await db.query(
  'SELECT pg_database_size(current_database()) / 1048576.0 AS mb'
)
console.log(`Banco após arquivamento + vacuum: ${Number(mb).toFixed(1)} MB`)
await db.end()
