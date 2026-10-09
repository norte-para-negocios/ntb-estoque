// JWT local (HS256) para o PostgREST do desktop e verificação de senha offline (scrypt).
const crypto = require('crypto')

const b64url = (buf) => Buffer.from(buf).toString('base64url')

function assinar(payload, segredo) {
  const cab = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const corpo = b64url(JSON.stringify(payload))
  const sig = crypto.createHmac('sha256', segredo).update(`${cab}.${corpo}`).digest('base64url')
  return `${cab}.${corpo}.${sig}`
}

/** Devolve o payload se a assinatura bate e não expirou; senão null. */
function verificar(token, segredo) {
  if (typeof token !== 'string') return null
  const partes = token.split('.')
  if (partes.length !== 3) return null
  const esperado = crypto.createHmac('sha256', segredo).update(`${partes[0]}.${partes[1]}`).digest()
  let recebido
  try {
    recebido = Buffer.from(partes[2], 'base64url')
  } catch {
    return null
  }
  if (recebido.length !== esperado.length || !crypto.timingSafeEqual(recebido, esperado)) return null
  let payload
  try {
    const cab = JSON.parse(Buffer.from(partes[0], 'base64url').toString())
    if (cab.alg !== 'HS256') return null
    payload = JSON.parse(Buffer.from(partes[1], 'base64url').toString())
  } catch {
    return null
  }
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null
  return payload
}

const agora = () => Math.floor(Date.now() / 1000)

function tokenServico(segredo) {
  return assinar({ role: 'service_role', iss: 'ntb-desktop', iat: agora(), exp: agora() + 10 * 365 * 86400 }, segredo)
}
function tokenAnon(segredo) {
  return assinar({ role: 'anon', iss: 'ntb-desktop', iat: agora(), exp: agora() + 10 * 365 * 86400 }, segredo)
}
function tokenUsuario(usuario, segredo, validadeSeg = 3600) {
  return assinar(
    {
      sub: usuario.id,
      email: usuario.email,
      role: 'authenticated',
      aud: 'authenticated',
      iss: 'ntb-desktop',
      iat: agora(),
      exp: agora() + validadeSeg,
      session_id: crypto.randomUUID(),
    },
    segredo,
  )
}

function verificadorSenha(senha) {
  const sal = crypto.randomBytes(16)
  const hash = crypto.scryptSync(String(senha), sal, 64, { N: 16384, r: 8, p: 1 })
  return { sal: sal.toString('base64'), hash: hash.toString('base64') }
}

function conferirSenha(senha, verificador) {
  if (!verificador?.sal || !verificador?.hash) return false
  const hash = crypto.scryptSync(String(senha), Buffer.from(verificador.sal, 'base64'), 64, { N: 16384, r: 8, p: 1 })
  const esperado = Buffer.from(verificador.hash, 'base64')
  return hash.length === esperado.length && crypto.timingSafeEqual(hash, esperado)
}

module.exports = { assinar, verificar, tokenServico, tokenAnon, tokenUsuario, verificadorSenha, conferirSenha }
