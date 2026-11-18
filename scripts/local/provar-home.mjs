// Prova que o ERP local (porta 3107) abre a home logado em cada loja/cargo: login no GoTrue local, cookie de sessão
// no formato do @supabase/ssr e GET /home. Não imprime senhas. Uso: node scripts/local/provar-home.mjs
import fs from 'node:fs'
import path from 'node:path'
const dados = path.resolve(import.meta.dirname, '..', '..', '.local-data')
const env = Object.fromEntries(fs.readFileSync(path.join(dados, 'env'), 'utf8').split('\n').filter(Boolean).map((l) => l.split(/=(.*)/s)))
const APP = 'http://127.0.0.1:3107'
const NOMES = { 4: 'Sertão', 15: 'ODARA', 19: 'Loja 19' }
let falhas = 0
for (const l of fs.readFileSync(path.join(dados, 'logins.txt'), 'utf8').split('\n')) {
  const m = l.match(/^(\S+@ntb-teste\.local)\s+(\S+)\s+loja=(\d+)\s+cargo=(\w+)/)
  if (!m) continue
  const r = await fetch('http://127.0.0.1:54421/auth/v1/token?grant_type=password', { method: 'POST', headers: { apikey: env.ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: m[1], password: m[2] }) })
  const sessao = await r.json()
  const valor = 'base64-' + Buffer.from(JSON.stringify(sessao)).toString('base64url')
  const nome = 'sb-127-auth-token'
  const partes = valor.match(/.{1,3180}/g)
  const cookie = partes.length === 1 ? `${nome}=${valor}` : partes.map((p, i) => `${nome}.${i}=${p}`).join('; ')
  const t0 = Date.now()
  const h = await fetch(`${APP}/home`, { headers: { cookie }, redirect: 'manual' })
  const corpo = await h.text()
  const ok = h.status === 200 && !/Application error|Internal Server Error/.test(corpo) && /ODARA|AMJ|ZZ NORTE|Sair|Teste /i.test(corpo)
  const titulo = (corpo.match(/<title>([^<]*)<\/title>/) || [])[1]
  console.log(`${ok ? 'OK ' : 'FALHA'} loja ${m[3]} (${NOMES[m[3]]}) cargo=${m[4].padEnd(10)} GET /home -> ${h.status}${h.headers.get('location') ? ' -> ' + h.headers.get('location') : ''} ${Date.now() - t0}ms | ${titulo} | ${corpo.length} bytes`)
  if (!ok) falhas++
}
process.exit(falhas ? 1 : 0)
