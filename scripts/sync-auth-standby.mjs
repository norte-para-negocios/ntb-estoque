// Sincroniza auth.users/auth.identities do Supabase real pro Postgres do
// stack self-hosted no Contabo -- NAO usa replicacao logica nativa pro
// schema auth (GoTrue e dono desse schema e roda suas proprias migrations,
// acoplar replicacao logica na estrutura interna dele e fragil). Rodar
// periodicamente via cron (Task 7 documenta a frequencia recomendada).
//
// Le auth.users/auth.identities DIRETO do Postgres do Supabase real via
// `pg` (mesmo padrao de scripts/db.mjs e scripts/migrar-usuarios.mjs), NAO
// via `supabase.auth.admin.listUsers()` da lib `@supabase/supabase-js`:
// essa API de admin nao devolve `encrypted_password` (GoTrue omite o hash
// por seguranca no endpoint REST) -- sem o hash certo, login por senha no
// standby nunca funcionaria de verdade em caso de failover. Ler a tabela
// direto via SQL e o unico jeito de replicar o hash.
import fs from 'node:fs'
import pg from 'pg'

const PROJ = process.cwd()
const env = {}
for (const line of fs.readFileSync(`${PROJ}/.env.local`, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}

const dbUrl = new URL(env.SUPABASE_DB_URL)
const senhaOrigem = decodeURIComponent(dbUrl.password)
const ref = dbUrl.hostname.replace(/^db\./, '').replace(/\.supabase\.co$/, '')

// A conexao "db direct" do Supabase e IPv6-only (nao roteia desta rede);
// o caminho que funciona e sempre via um dos poolers regionais -- mesmo
// problema e mesma solucao que scripts/db.mjs e scripts/aplicar-migration.mjs
// ja resolveram para este projeto. Cacheia o host que funcionar por ultimo
// em scripts/.pooler-host (arquivo local, sem segredo) pra pular a varredura
// nas proximas execucoes (util rodando em cron a cada poucos minutos).
const POOLER_HOST_FILE = `${PROJ}/scripts/.pooler-host`
const PREFIXOS = ['aws-1', 'aws-0']
const REGIOES = [
  'sa-east-1', 'us-east-1', 'us-east-2', 'us-west-1',
  'eu-central-1', 'eu-west-1', 'ap-southeast-1', 'ca-central-1',
]

async function conectarOrigem() {
  const candidatos = []
  try {
    const saved = fs.readFileSync(POOLER_HOST_FILE, 'utf8').trim()
    const [h, p] = saved.split(':')
    if (h) candidatos.push({ host: h, port: Number(p) || 5432 })
  } catch {}
  for (const pre of PREFIXOS) {
    for (const reg of REGIOES) {
      candidatos.push({ host: `${pre}-${reg}.pooler.supabase.com`, port: 5432 })
    }
  }

  for (const { host, port } of candidatos) {
    const client = new pg.Client({
      host,
      port,
      user: `postgres.${ref}`,
      password: senhaOrigem,
      database: 'postgres',
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 7000,
    })
    try {
      await client.connect()
      fs.writeFileSync(POOLER_HOST_FILE, `${host}:${port}`)
      return client
    } catch {
      try { await client.end() } catch {}
    }
  }
  throw new Error('Nenhum pooler do Supabase respondeu (origem) -- ver scripts/aplicar-migration.mjs pro mesmo padrao de varredura')
}

async function main() {
  const origem = await conectarOrigem()

  // Conexao direta com o Postgres do stack self-hosted no Contabo (Task 3),
  // via o pooler supavisor -- exige usuario qualificado por tenant
  // (`postgres.<POOLER_TENANT_ID>`, default 'postgres' so serve se rodado
  // via loopback direto no container, nunca pelo IP publico :54322).
  const standby = new pg.Client({
    host: process.env.STANDBY_HOST || '127.0.0.1',
    port: Number(process.env.STANDBY_PORT || 54322),
    user: process.env.STANDBY_PG_USER || 'postgres',
    password: process.env.STANDBY_PG_PASSWORD,
    database: 'postgres',
  })
  await standby.connect()

  let usuariosSincronizados = 0
  let identidadesSincronizadas = 0

  try {
    // 1. auth.users
    const { rows: users } = await origem.query(`
      select instance_id, id, aud, role, email, encrypted_password,
             email_confirmed_at, invited_at, last_sign_in_at,
             raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
             is_sso_user, is_anonymous, banned_until, deleted_at,
             phone, phone_confirmed_at,
             coalesce(confirmation_token, '') as confirmation_token,
             coalesce(recovery_token, '') as recovery_token,
             coalesce(email_change, '') as email_change,
             coalesce(email_change_token_new, '') as email_change_token_new
      from auth.users
      order by created_at
    `)

    for (const u of users) {
      await standby.query(
        `insert into auth.users (
           instance_id, id, aud, role, email, encrypted_password,
           email_confirmed_at, invited_at, last_sign_in_at,
           raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
           is_sso_user, is_anonymous, banned_until, deleted_at,
           phone, phone_confirmed_at,
           confirmation_token, recovery_token, email_change, email_change_token_new
         )
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
         on conflict (id) do update set
           email = excluded.email,
           encrypted_password = excluded.encrypted_password,
           email_confirmed_at = excluded.email_confirmed_at,
           invited_at = excluded.invited_at,
           last_sign_in_at = excluded.last_sign_in_at,
           raw_app_meta_data = excluded.raw_app_meta_data,
           raw_user_meta_data = excluded.raw_user_meta_data,
           updated_at = excluded.updated_at,
           is_sso_user = excluded.is_sso_user,
           is_anonymous = excluded.is_anonymous,
           banned_until = excluded.banned_until,
           deleted_at = excluded.deleted_at,
           phone = excluded.phone,
           phone_confirmed_at = excluded.phone_confirmed_at,
           confirmation_token = excluded.confirmation_token,
           recovery_token = excluded.recovery_token,
           email_change = excluded.email_change,
           email_change_token_new = excluded.email_change_token_new`,
        [
          u.instance_id, u.id, u.aud, u.role, u.email, u.encrypted_password,
          u.email_confirmed_at, u.invited_at, u.last_sign_in_at,
          u.raw_app_meta_data != null ? JSON.stringify(u.raw_app_meta_data) : null,
          u.raw_user_meta_data != null ? JSON.stringify(u.raw_user_meta_data) : null,
          u.created_at, u.updated_at, u.is_sso_user, u.is_anonymous,
          u.banned_until, u.deleted_at, u.phone, u.phone_confirmed_at,
          // GoTrue tem um bug conhecido: essas 4 colunas texto precisam ser
          // '' (string vazia), nunca NULL -- senao "Database error querying
          // schema" (500) ao fazer scan da linha no login. A query ja
          // aplica coalesce na origem; o `?? ''` aqui e so uma segunda
          // camada de protecao caso o valor chegue nulo por outro caminho
          // (ex.: se um dia a query for reescrita sem o coalesce).
          u.confirmation_token ?? '', u.recovery_token ?? '',
          u.email_change ?? '', u.email_change_token_new ?? '',
        ]
      )
      usuariosSincronizados++
    }

    // 2. auth.identities (necessario pra login funcionar de verdade, nao so
    // o usuario existir -- mesma licao ja documentada em
    // scripts/migrar-usuarios.mjs deste repo)
    const { rows: identities } = await origem.query(`
      select id, user_id, identity_data, provider, provider_id,
             last_sign_in_at, created_at, updated_at
      from auth.identities
      order by created_at
    `)

    for (const i of identities) {
      // `email` NAO entra no INSERT -- e coluna gerada (stored generated,
      // `lower(identity_data->>'email')`) no schema do GoTrue instalado
      // pelo stack self-hosted; confirmado via pg_attribute.attgenerated.
      // provider_id e NOT NULL; deriva se a origem nao tiver (idem
      // migrar-identities.mjs).
      const providerId = i.provider_id || i.identity_data?.sub || i.user_id
      await standby.query(
        `insert into auth.identities (
           id, user_id, identity_data, provider, provider_id,
           last_sign_in_at, created_at, updated_at
         )
         values ($1,$2,$3,$4,$5,$6,$7,$8)
         on conflict (id) do update set
           identity_data = excluded.identity_data,
           provider = excluded.provider,
           provider_id = excluded.provider_id,
           last_sign_in_at = excluded.last_sign_in_at,
           updated_at = excluded.updated_at`,
        [
          i.id, i.user_id, JSON.stringify(i.identity_data), i.provider, providerId,
          i.last_sign_in_at, i.created_at, i.updated_at,
        ]
      )
      identidadesSincronizadas++
    }
  } finally {
    await origem.end()
    await standby.end()
  }

  console.log(`OK: ${usuariosSincronizados} usuarios e ${identidadesSincronizadas} identities sincronizados`)
}

main().catch((e) => {
  console.error('ERRO na sincronizacao de auth:', e)
  process.exit(1)
})
