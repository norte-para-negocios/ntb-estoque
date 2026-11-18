// Gera (uma vez) os segredos da cópia local em .local-data/env e o .env.local do ERP. Tudo fica fora do git.
// Idempotente: se .local-data/env já existe, só reescreve o .env.local a partir dele.
import fs from 'node:fs'
import crypto from 'node:crypto'
import path from 'node:path'

const raiz = path.resolve(import.meta.dirname, '..', '..')
const dados = path.join(raiz, '.local-data')
const arq = path.join(dados, 'env')
fs.mkdirSync(dados, { recursive: true })

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url')
const jwt = (payload, secret) => {
  const d = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64(payload)}`
  return `${d}.${crypto.createHmac('sha256', secret).update(d).digest('base64url')}`
}
const lerEnv = (f) => Object.fromEntries(fs.readFileSync(f, 'utf8').split('\n').filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]))

let e
if (fs.existsSync(arq)) e = lerEnv(arq)
else {
  const rnd = (n = 24) => crypto.randomBytes(n).toString('hex')
  const JWT_SECRET = rnd(32)
  const exp = Math.floor(Date.now() / 1000) + 10 * 365 * 86400
  e = {
    POSTGRES_PASSWORD: rnd(),
    JWT_SECRET,
    ANON_KEY: jwt({ role: 'anon', iss: 'supabase', exp }, JWT_SECRET),
    SERVICE_ROLE_KEY: jwt({ role: 'service_role', iss: 'supabase', exp }, JWT_SECRET),
    FRIO_API_KEY: rnd(),
    CRON_SECRET: rnd(),
  }
  fs.writeFileSync(arq, Object.entries(e).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600 })
}

const envLocal = `# GERADO por scripts/local/gerar-env.mjs -- cópia local de teste. Fora do git (.env*).
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54421
NEXT_PUBLIC_SUPABASE_ANON_KEY=${e.ANON_KEY}
SUPABASE_SERVICE_ROLE_KEY=${e.SERVICE_ROLE_KEY}
SUPABASE_DB_URL=postgres://postgres:${e.POSTGRES_PASSWORD}@127.0.0.1:54420/postgres
CRON_SECRET=${e.CRON_SECRET}
NTB_FRIO_API_URL=http://127.0.0.1:54422
NTB_FRIO_API_KEY=${e.FRIO_API_KEY}
NEXT_PUBLIC_APP_URL=http://127.0.0.1:3107
# Trava: nenhuma chamada ao Omie sai (lib/omie/bloqueio-ambiente.ts) e os crons financeiros ficam desligados.
NTB_OMIE_BLOQUEADO=1
OMIE_FIN_DESLIGADO=1
NTB_VENDAS_INTERNAL_URL=
`
fs.writeFileSync(path.join(raiz, '.env.local'), envLocal, { mode: 0o600 })
console.log('env ok: .local-data/env e .env.local')
