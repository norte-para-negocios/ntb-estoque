// Cria (ou reseta) um usuario de QA/dev ja aprovado como Admin na loja 2, para
// validar telas no navegador. Usa a Admin API + REST do Supabase (nao precisa do
// Postgres direto). Uso local apenas. Requer service key no .env.local.
// Tem retry/timeout porque a rede local com o Supabase pode estar instavel.
// Uso: node scripts/criar-usuario-dev.mjs
import fs from 'node:fs'

const PROJ = process.cwd()
const env = {}
for (const line of fs.readFileSync(`${PROJ}/.env.local`, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const SUPA = env.NEXT_PUBLIC_SUPABASE_URL
const SRV = env.SUPABASE_SERVICE_ROLE_KEY
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY

const EMAIL = 'claude.qa@ntb-estoque.dev'
const PASS = 'claudeqa123456' // simples de proposito (sem caractere especial)
const NAME = 'Claude QA'
const LOJA = 2
const H = { apikey: SRV, Authorization: `Bearer ${SRV}`, 'Content-Type': 'application/json' }

async function f(url, opts = {}, tentativas = 5) {
  for (let i = 0; i < tentativas; i++) {
    try {
      return await fetch(url, { ...opts, signal: AbortSignal.timeout(30000) })
    } catch (e) {
      if (i === tentativas - 1) throw e
      console.log(`  retry ${i + 1} (${e.cause?.code || e.name})...`)
      await new Promise((r) => setTimeout(r, 3000))
    }
  }
}

// 1) cria o user (ou reseta a senha se ja existir)
let userId
const cr = await f(`${SUPA}/auth/v1/admin/users`, {
  method: 'POST',
  headers: H,
  body: JSON.stringify({ email: EMAIL, password: PASS, email_confirm: true, user_metadata: { name: NAME } }),
})
const crj = await cr.json().catch(() => ({}))
if (cr.ok && crj.id) {
  userId = crj.id
  console.log('user criado:', userId)
} else {
  const list = await f(`${SUPA}/auth/v1/admin/users?page=1&per_page=200`, { headers: H })
  const lj = await list.json().catch(() => ({}))
  const u = (lj.users || []).find((x) => (x.email || '').toLowerCase() === EMAIL)
  userId = u?.id
  if (userId) {
    await f(`${SUPA}/auth/v1/admin/users/${userId}`, {
      method: 'PUT',
      headers: H,
      body: JSON.stringify({ password: PASS, email_confirm: true }),
    })
    console.log('user existente, senha resetada:', userId)
  }
}
if (!userId) {
  console.log('FALHOU obter userId')
  process.exit(1)
}

// 2) upsert do profile: Admin, aprovado, na loja 2
const pf = await f(`${SUPA}/rest/v1/profiles?on_conflict=id`, {
  method: 'POST',
  headers: { ...H, Prefer: 'resolution=merge-duplicates,return=representation' },
  body: JSON.stringify({ id: userId, name: NAME, email: EMAIL, perfil: 'Admin', status: 'aprovado', current_loja_id: LOJA }),
})
console.log('profile upsert:', pf.status, (await pf.text()).slice(0, 200))

// 3) testar o login de verdade (token endpoint com a anon key)
const lg = await f(`${SUPA}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: ANON, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: EMAIL, password: PASS }),
})
const lgj = await lg.json().catch(() => ({}))
console.log('teste de login:', lg.status, lgj.access_token ? 'OK (token recebido)' : JSON.stringify(lgj).slice(0, 200))
console.log('\n=== LOGIN ===\n', EMAIL, '/', PASS)
