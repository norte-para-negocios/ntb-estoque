import crypto from 'node:crypto'

// Criptografia simetrica (AES-256-GCM) para segredos em repouso, como a senha do
// certificado digital. So roda no servidor. A chave e derivada da service role
// (segredo que ja existe so no servidor); se um dia houver uma chave dedicada,
// trocar `chave()` por ela (ex.: process.env.CERT_KEY) sem mudar o resto.
function chave(): Buffer {
  const segredo = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!segredo) throw new Error('SUPABASE_SERVICE_ROLE_KEY ausente para cripto')
  return crypto.createHash('sha256').update(segredo).digest() // 32 bytes
}

// Retorna base64 de iv(12) + authTag(16) + ciphertext.
export function criptografar(texto: string): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', chave(), iv)
  const enc = Buffer.concat([cipher.update(texto, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, tag, enc]).toString('base64')
}

export function descriptografar(b64: string): string {
  const buf = Buffer.from(b64, 'base64')
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const enc = buf.subarray(28)
  const decipher = crypto.createDecipheriv('aes-256-gcm', chave(), iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8')
}
