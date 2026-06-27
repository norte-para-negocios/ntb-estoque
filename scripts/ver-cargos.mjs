import fs from 'node:fs'; import pg from 'pg'
const PROJ = process.cwd(); const env = {}
for (const line of fs.readFileSync(`${PROJ}/.env.local`, 'utf8').split(/\r?\n/)) { const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/); if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '') }
const u = new URL(env.SUPABASE_DB_URL); const senha = decodeURIComponent(u.password)
const ref = u.hostname.replace(/^db\./, '').replace(/\.supabase\.co$/, '')
const [hh, pp] = fs.readFileSync(`${PROJ}/scripts/.pooler-host`, 'utf8').trim().split(':')
const db = new pg.Client({ host: hh, port: Number(pp), user: `postgres.${ref}`, password: senha, database: 'postgres', ssl: { rejectUnauthorized: false } })
await db.connect()
const { rows } = await db.query(`select c.nome, count(cp.permissao_id) n from cargos c left join cargo_permissao cp on cp.cargo_id=c.id group by c.nome order by n desc`)
console.log('Cargos seedados:'); for (const r of rows) console.log(`  ${r.nome}: ${r.n} permissões`)
const { rows: ger } = await db.query(`select p.nome from cargo_permissao cp join cargos c on c.id=cp.cargo_id join permissoes p on p.id=cp.permissao_id where c.nome='Gerente' order by p.nome`)
console.log('\nGerente tem:', ger.map(r=>r.nome).join(', '))
await db.end()
