// Copia auth.users + profiles + permissao_user preservando IDs e senhas
import pg from 'pg'

const OLD = { host: 'aws-1-sa-east-1.pooler.supabase.com', port: 5432, user: 'postgres.ocpytiqhjfxfqcosytdx', password: 'rscarneiro3484*', database: 'postgres', ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 }
const NEW = { host: 'aws-1-sa-east-1.pooler.supabase.com', port: 5432, user: 'postgres.waubqgkftwrufepwhctc', password: 'rscarneiro3484*', database: 'postgres', ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 15000 }

function log(msg) { console.log(`[${new Date().toISOString().slice(11,19)}] ${msg}`) }
async function qOld(sql) { const c = new pg.Client(OLD); await c.connect(); const r = await c.query(sql); await c.end(); return r }
async function qNew(sql, p) { const c = new pg.Client(NEW); await c.connect(); await c.query('SET default_transaction_read_only = off'); const r = await c.query(sql, p); await c.end(); return r }

log('=== MIGRANDO USUARIOS ===')

// 1. auth.users
const users = (await qOld(`
  SELECT instance_id, id, aud, role, email, encrypted_password,
         email_confirmed_at, last_sign_in_at, raw_app_meta_data,
         raw_user_meta_data, created_at, updated_at, is_sso_user, is_anonymous
  FROM auth.users ORDER BY created_at
`)).rows

log(`${users.length} usuarios encontrados`)

for (const u of users) {
  try {
    await qNew(`
      INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password,
        email_confirmed_at, last_sign_in_at, raw_app_meta_data, raw_user_meta_data,
        created_at, updated_at, is_sso_user, is_anonymous)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      ON CONFLICT (id) DO NOTHING
    `, [
      u.instance_id, u.id, u.aud, u.role, u.email, u.encrypted_password,
      u.email_confirmed_at, u.last_sign_in_at,
      JSON.stringify(u.raw_app_meta_data), JSON.stringify(u.raw_user_meta_data),
      u.created_at, u.updated_at, u.is_sso_user, u.is_anonymous
    ])
    log(`  OK: ${u.email}`)
  } catch(e) {
    log(`  ERRO ${u.email}: ${e.message.slice(0,100)}`)
  }
}

// 2. auth.identities (necessario para login funcionar)
log('Copiando identities...')
const identities = (await qOld(`
  SELECT id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at, email
  FROM auth.identities ORDER BY created_at
`)).rows

for (const i of identities) {
  try {
    // email é coluna gerada automaticamente no Supabase novo -- nao incluir no INSERT
    await qNew(`
      INSERT INTO auth.identities (id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT (id) DO NOTHING
    `, [i.id, i.user_id, JSON.stringify(i.identity_data), i.provider, i.last_sign_in_at, i.created_at, i.updated_at])
    log(`  identity OK: ${i.email}`)
  } catch(e) {
    log(`  identity ERRO ${i.email}: ${e.message.slice(0,100)}`)
  }
}

// 3. profiles (tabela publica ligada ao auth.users)
log('Copiando profiles...')
const profiles = (await qOld(`SELECT * FROM profiles ORDER BY created_at`)).rows
for (const p of profiles) {
  const cols = Object.keys(p)
  const vals = cols.map((_,i) => `$${i+1}`).join(',')
  const params = cols.map(c => {
    const v = p[c]
    if (v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)) return JSON.stringify(v)
    return v
  })
  try {
    await qNew(`INSERT INTO profiles (${cols.join(',')}) VALUES (${vals}) ON CONFLICT DO NOTHING`, params)
    log(`  profile OK: ${p.email || p.id}`)
  } catch(e) {
    log(`  profile ERRO: ${e.message.slice(0,100)}`)
  }
}

// 4. permissao_user
log('Copiando permissao_user...')
const perms = (await qOld(`SELECT * FROM permissao_user`)).rows
for (const p of perms) {
  const cols = Object.keys(p)
  const vals = cols.map((_,i) => `$${i+1}`).join(',')
  try {
    await qNew(`INSERT INTO permissao_user (${cols.join(',')}) VALUES (${vals}) ON CONFLICT DO NOTHING`, cols.map(c => p[c]))
  } catch(e) {}
}
const total = (await qNew(`SELECT COUNT(*) AS n FROM permissao_user`)).rows[0].n
log(`permissao_user: ${total} registros no novo banco`)

log('=== FIM ===')
