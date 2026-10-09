// Cliente do canal /api/offline do servidor de produção. Guarda e renova a sessão real do usuário
// (só neste processo; o Next local nunca vê esse token).
const zlib = require('zlib')

class ErroRede extends Error {}
class ErroSessao extends Error {}
class ErroVersao extends Error {}

function criarRemoto({ base, versao, cofre, log = () => {} }) {
  let renovando = null

  function sessao() {
    return cofre.ler('sessaoRemota') ?? null
  }

  async function chamar(caminho, { metodo = 'GET', corpo, headers = {}, semAuth = false, timeoutMs = 120_000 } = {}) {
    const h = { 'x-ntb-versao': versao, accept: 'application/json', 'accept-encoding': 'gzip', ...headers }
    if (corpo !== undefined) h['content-type'] = 'application/json'
    if (!semAuth) {
      const s = await sessaoValida()
      h.authorization = `Bearer ${s.access_token}`
      const lojas = cofre.ler('lojasSync')
      if (Array.isArray(lojas) && lojas.length && !h['x-ntb-lojas']) h['x-ntb-lojas'] = lojas.join(',')
    }
    let r
    try {
      r = await fetch(`${base}${caminho}`, {
        method: metodo,
        headers: h,
        body: corpo === undefined ? undefined : JSON.stringify(corpo),
        signal: AbortSignal.timeout(timeoutMs),
      })
    } catch (e) {
      throw new ErroRede(`sem conexão com o servidor (${e.message})`)
    }
    if (r.status === 426) throw new ErroVersao('Atualize o app Norte Estoque.')
    if (r.status === 401 && !semAuth) throw new ErroSessao('Sessão expirada.')
    if (r.status >= 502 && r.status <= 504) throw new ErroRede(`servidor indisponível (${r.status})`)
    const buf = Buffer.from(await r.arrayBuffer())
    let texto = buf
    // fetch já descomprime quando o servidor manda content-encoding; isto cobre proxies que não mandam
    if (buf[0] === 0x1f && buf[1] === 0x8b) texto = zlib.gunzipSync(buf)
    let json
    try {
      json = JSON.parse(texto.toString('utf8'))
    } catch {
      json = { ok: false, erro: `Resposta inválida do servidor (${r.status}).` }
    }
    return { status: r.status, json, resposta: r, corpo: buf }
  }

  async function sessaoValida() {
    const s = sessao()
    if (!s) throw new ErroSessao('Sem sessão.')
    // Folga de 2 min: o servidor nunca precisa girar o refresh token (ver proxy.ts).
    if (s.expires_at && s.expires_at * 1000 - Date.now() > 120_000) return s
    if (!renovando) {
      renovando = (async () => {
        const { status, json } = await chamar('/api/offline/sessao', { metodo: 'POST', corpo: { acao: 'renovar', refresh: s.refresh_token }, semAuth: true })
        if (status === 401 || status === 403) {
          // Servidor recusou (usuário bloqueado, senha trocada): acaba também o acesso local e o
          // login offline; só um novo login com internet volta a liberar.
          cofre.gravar('sessaoRemota', undefined)
          cofre.gravar('refreshLocal', undefined)
          const u = cofre.ler('usuario')
          if (u) cofre.gravar('usuario', { ...u, verificador: null })
          throw new ErroSessao(json.erro ?? 'Sessão expirada. Entre de novo com internet.')
        }
        if (!json.ok) throw new ErroRede(json.erro ?? 'falha ao renovar sessão')
        cofre.gravar('sessaoRemota', json.sessao)
        marcarValidacao()
        return json.sessao
      })().finally(() => {
        renovando = null
      })
    }
    return renovando
  }

  function marcarValidacao() {
    const u = cofre.ler('usuario')
    if (u) cofre.gravar('usuario', { ...u, ultimaValidacao: Date.now() })
  }

  async function entrar(email, senha) {
    const { status, json } = await chamar('/api/offline/sessao', { metodo: 'POST', corpo: { acao: 'entrar', email, senha }, semAuth: true })
    return { status, json }
  }

  return {
    base,
    chamar,
    entrar,
    sessaoValida,
    marcarValidacao,
    get: (caminho, opts) => chamar(caminho, { ...opts, metodo: 'GET' }),
    post: (caminho, corpo, opts) => chamar(caminho, { ...opts, metodo: 'POST', corpo }),
    temSessao: () => Boolean(sessao()),
  }
}

module.exports = { criarRemoto, ErroRede, ErroSessao, ErroVersao }
