// Valida o roundtrip de criptografia da senha do certificado (mesma lógica de
// lib/cripto.ts), usando a chave real do .env.local.
import crypto from 'node:crypto'
import fs from 'node:fs'
const env = {}
for (const line of fs.readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
  if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '')
}
const chave = () => crypto.createHash('sha256').update(env.SUPABASE_SERVICE_ROLE_KEY).digest()
const cript = (t) => { const iv = crypto.randomBytes(12); const c = crypto.createCipheriv('aes-256-gcm', chave(), iv); const e = Buffer.concat([c.update(t, 'utf8'), c.final()]); return Buffer.concat([iv, c.getAuthTag(), e]).toString('base64') }
const decript = (b64) => { const b = Buffer.from(b64, 'base64'); const d = crypto.createDecipheriv('aes-256-gcm', chave(), b.subarray(0, 12)); d.setAuthTag(b.subarray(12, 28)); return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8') }
const orig = 'Senha#Cert@2026!'
const enc = cript(orig)
const dec = decript(enc)
console.log('cripto (base64):', enc.slice(0, 36) + '...')
console.log('em claro no banco? ', enc.includes(orig) ? 'SIM (RUIM)' : 'não (ok)')
console.log('roundtrip OK:', dec === orig)
