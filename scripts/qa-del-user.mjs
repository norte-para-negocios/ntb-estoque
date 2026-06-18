// Remove uma conta de TESTE (QA) via Supabase Admin API (cascade apaga profile,
// vinculos de loja, permissoes). Uso: node scripts/qa-del-user.mjs <email>
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const env = {}
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}

const email = process.argv[2]
if (!email) { console.error('uso: node scripts/qa-del-user.mjs <email>'); process.exit(1) }

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

let userId = null
for (let page = 1; page <= 20 && !userId; page++) {
  const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 })
  if (error) { console.error(error.message); process.exit(1) }
  const u = (data.users || []).find((x) => (x.email || '').toLowerCase() === email.toLowerCase())
  if (u) userId = u.id
  if (!data.users || data.users.length < 200) break
}

if (!userId) { console.log('nao encontrado (ja removido?):', email); process.exit(0) }

const { error } = await supabase.auth.admin.deleteUser(userId)
if (error) { console.error(error.message); process.exit(1) }
console.log('OK removido', email)
