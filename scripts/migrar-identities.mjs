// Copia auth.identities do projeto antigo para o novo
import pg from 'pg'

const OLD = { host: 'aws-1-sa-east-1.pooler.supabase.com', port: 5432, user: 'postgres.ocpytiqhjfxfqcosytdx', password: 'rscarneiro3484*', database: 'postgres', ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 30000 }
const NEW = { host: 'aws-1-sa-east-1.pooler.supabase.com', port: 5432, user: 'postgres.waubqgkftwrufepwhctc', password: 'rscarneiro3484*', database: 'postgres', ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 30000 }

function log(msg) { console.log(`[${new Date().toISOString().slice(11,19)}] ${msg}`) }

// Ver quais colunas existem nas identities de cada banco
const cOld = new pg.Client(OLD); await cOld.connect()
const cNew = new pg.Client(NEW); await cNew.connect()

const colsOldR = await cOld.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='auth' AND table_name='identities' ORDER BY ordinal_position`)
const colsNewR = await cNew.query(`SELECT column_name, column_default, is_nullable FROM information_schema.columns WHERE table_schema='auth' AND table_name='identities' ORDER BY ordinal_position`)

log('Colunas no antigo: ' + colsOldR.rows.map(r=>r.column_name).join(', '))
log('Colunas no novo: ' + colsNewR.rows.map(r=>`${r.column_name}(null:${r.is_nullable})`).join(', '))

// Pegar dados do antigo
const identR = await cOld.query(`SELECT * FROM auth.identities ORDER BY created_at`)
log(`${identR.rows.length} identities encontradas`)

// Ver o que existe no novo
const existeR = await cNew.query(`SELECT COUNT(*) AS n FROM auth.identities`)
log(`Ja existem ${existeR.rows[0].n} identities no novo`)

await cOld.end()
await cNew.end()

if (identR.rows.length === 0) { log('Nada a copiar.'); process.exit(0) }

log('Amostra da primeira identity:')
const sample = identR.rows[0]
log(JSON.stringify(sample, null, 2))

// Agora inserir com as colunas corretas
// No novo Supabase: provider_id e obrigatorio (nao nullable)
// Para auth email: provider_id = email do usuario
// identity_data tipico: {"sub":"uuid","email":"...","email_verified":false,...}

for (const i of identR.rows) {
  const client = new pg.Client(NEW)
  await client.connect()
  try {
    // Derivar provider_id: para email=provider, e o email; para outros e o sub
    let provider_id = i.provider_id
    if (!provider_id) {
      if (i.provider === 'email' && i.email) provider_id = i.email
      else if (i.identity_data?.sub) provider_id = i.identity_data.sub
      else provider_id = i.user_id
    }

    // Montar INSERT com apenas as colunas que existem no antigo + provider_id
    const hasProvId = 'provider_id' in i

    if (hasProvId) {
      await client.query(`
        INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT (id) DO NOTHING
      `, [i.id, i.user_id, JSON.stringify(i.identity_data), i.provider, provider_id, i.last_sign_in_at, i.created_at, i.updated_at])
    } else {
      await client.query(`
        INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT (id) DO NOTHING
      `, [i.id, i.user_id, JSON.stringify(i.identity_data), i.provider, provider_id, i.last_sign_in_at, i.created_at, i.updated_at])
    }
    log(`  OK: ${i.email || provider_id}`)
  } catch(e) {
    log(`  ERRO: ${e.message.slice(0,150)}`)
  } finally {
    await client.end()
  }
}

const finalCount = (await (async () => { const c = new pg.Client(NEW); await c.connect(); const r = await c.query('SELECT COUNT(*) AS n FROM auth.identities'); await c.end(); return r })()).rows[0].n
log(`Total identities no novo banco: ${finalCount}`)
log('=== FIM ===')
