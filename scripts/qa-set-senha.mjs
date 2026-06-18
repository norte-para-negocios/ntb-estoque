// Define uma senha conhecida para uma conta de TESTE (QA), via Supabase Admin API.
// Uso: node scripts/qa-set-senha.mjs <email> <novaSenha>
// So mexe na conta indicada; nao toca em nada do sistema. Para testar login no link.
import fs from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const env = {}
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}

const email = process.argv[2]
const senha = process.argv[3]
if (!email || !senha) {
  console.error('uso: node scripts/qa-set-senha.mjs <email> <novaSenha>')
  process.exit(1)
}

const supabase = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
})

// Acha o user por email (lista paginada).
let userId = null
for (let page = 1; page <= 20 && !userId; page++) {
  const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 })
  if (error) { console.error(error.message); process.exit(1) }
  const u = (data.users || []).find((x) => (x.email || '').toLowerCase() === email.toLowerCase())
  if (u) userId = u.id
  if (!data.users || data.users.length < 200) break
}

if (!userId) { console.error('Usuario nao encontrado:', email); process.exit(1) }

const { error } = await supabase.auth.admin.updateUserById(userId, { password: senha })
if (error) { console.error(error.message); process.exit(1) }
console.log('OK senha definida para', email, '(', userId, ')')
