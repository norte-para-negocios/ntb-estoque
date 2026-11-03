// Aplica UMA migration no Postgres de producao (Contabo, container supabase-db) por SSH + docker exec psql.
// Antes (ate 03/11/2026) apontava para o pooler do Supabase cloud, ja desligado: nao servia mais.
//
//   NORTE_DB_SSH=root@servidor [NORTE_DB_SSH_KEY=~/.ssh/chave] node scripts/aplicar-migration.mjs 309_controle_migrations.sql
//   ... --seco   roda tudo numa transacao e termina em ROLLBACK (nada fica gravado)
//
// Regras: recusa versao ja registrada em public.schema_migrations; embrulha em transacao (begin/commit) e registra a versao
// na mesma transacao; arquivos que controlam a propria transacao ou usam CREATE INDEX CONCURRENTLY (ou a marca
// `-- sem-transacao`) rodam como estao e so entao registram; termina com NOTIFY pgrst 'reload schema'. Antes da 309 a
// tabela de controle nao existe: aplica sem registrar. Producao so de madrugada, pelo controlador (plano da Fase 1).
// A montagem dos comandos esta em lib/migrations/runner-puro.ts (testada); aqui so ha I/O.
import fs from 'node:fs'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { versaoDoArquivo, montarAplicacao, montarSsh, SQL_CONSULTA_CONTROLE } from '../lib/migrations/runner-puro.ts'

const args = process.argv.slice(2)
const seco = args.includes('--seco')
const arquivo = args.find((a) => !a.startsWith('--'))
if (!arquivo) {
  console.error('uso: node scripts/aplicar-migration.mjs NNN_nome.sql [--seco]')
  process.exit(2)
}

function psql(sql) {
  const r = spawnSync('ssh', montarSsh(process.env), { input: sql, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (r.status !== 0) {
    console.error(r.stderr || r.stdout || `ssh saiu com ${r.status}`)
    process.exit(1)
  }
  return r.stdout
}

try {
  const versao = versaoDoArquivo(arquivo)
  const caminho = new URL(`../supabase/migrations/${arquivo}`, import.meta.url)
  const sql = fs.readFileSync(caminho, 'utf8')

  // 1) so leitura: o controle existe? essa versao ja foi aplicada?
  const linha = psql(SQL_CONSULTA_CONTROLE(versao)).split('\n').map((l) => l.trim()).filter(Boolean).pop() ?? ''
  const [controleExiste, jaAplicada] = linha.split('|').map((v) => v === 't')
  if (jaAplicada) {
    console.error(`${arquivo}: versao ${versao} ja consta em schema_migrations. Nada a fazer.`)
    process.exit(1)
  }
  if (!controleExiste) console.warn('AVISO: public.schema_migrations ainda nao existe (antes da 309); aplicando sem registrar.')

  // 2) monta e roda (real ou a seco)
  const por = `${os.userInfo().username}${seco ? '-seco' : ''}`
  const { sql: comando, embrulhada } = montarAplicacao({ arquivo, sql, modo: seco ? 'seco' : 'real', controleExiste, por })
  console.log(`${seco ? 'A SECO (rollback)' : 'APLICANDO'}: ${arquivo} | versao ${versao} | ${embrulhada ? 'em transacao' : 'sem transacao do runner'}`)
  const saida = psql(comando).trim()
  if (saida) console.log(saida.split('\n').slice(-20).join('\n'))
  console.log(seco ? 'OK a seco: nada foi gravado.' : 'MIGRATION APLICADA.')
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e))
  process.exit(1)
}
