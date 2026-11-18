// Confere o login de todos os usuários de teste contra o GoTrue local (não imprime senhas).
import fs from 'node:fs'
import path from 'node:path'
const dados = path.resolve(import.meta.dirname, '..', '..', '.local-data')
const env = Object.fromEntries(fs.readFileSync(path.join(dados, 'env'), 'utf8').split('\n').filter(Boolean).map((l) => l.split(/=(.*)/s)))
let falhas = 0
for (const l of fs.readFileSync(path.join(dados, 'logins.txt'), 'utf8').split('\n')) {
  const m = l.match(/^(\S+@ntb-teste\.local)\s+(\S+)\s+loja=(\d+)\s+cargo=(\w+)/)
  if (!m) continue
  const r = await fetch('http://127.0.0.1:54421/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: env.ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: m[1], password: m[2] }) })
  console.log(m[1], r.status)
  if (r.status !== 200) falhas++
}
process.exit(falhas ? 1 : 0)
