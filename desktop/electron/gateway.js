// Gateway do app desktop: única porta que a janela e o Next local usam (127.0.0.1:54398).
//   /rest/v1/*  -> PostgREST local (troca a chave anon do build pelo JWT anon local; só aceita JWT
//                  assinado com o segredo desta instalação)
//   /auth/v1/*  -> login local (online confere no servidor; offline confere a senha guardada)
//   /__ntb/*    -> motor de sincronização (rotas internas exigem o token do processo Next)
//   rotas só-online (DANFE/XML, sync manual) -> servidor de produção com o token do usuário
//   resto       -> Next local
const http = require('http')
const fs = require('fs')
const crypto = require('crypto')
const auth = require('./auth-local')
const { ErroRede } = require('./remoto')

const ROTAS_SO_ONLINE = ['/api/nota-fiscal/', '/api/sync/', '/api/relatorio-mensal/']
const TRINTA_DIAS = 30 * 86400_000

function lerCorpo(req, limite = 30 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const partes = []
    let tam = 0
    req.on('data', (c) => {
      tam += c.length
      if (tam > limite) {
        reject(new Error('corpo grande demais'))
        req.destroy()
      } else partes.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(partes)))
    req.on('error', reject)
  })
}

function json(res, status, dado, extra = {}) {
  const corpo = JSON.stringify(dado)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra })
  res.end(corpo)
}

function criarGateway(o) {
  const { portas, cofre, remoto, sync, anonBuild, paginaCarga, log = () => {} } = o
  const { jwtSecret } = cofre.segredosBase()
  const anonLocal = auth.tokenAnon(jwtSecret)
  const origemLocal = `http://127.0.0.1:${portas.gateway}`
  const hostsValidos = new Set([`127.0.0.1:${portas.gateway}`, `localhost:${portas.gateway}`])

  // ---------- autenticação local (imita o GoTrue) ----------
  function erroAuth(res, mensagem, status = 400) {
    json(res, status, { code: status, error: 'invalid_grant', error_code: 'invalid_credentials', msg: mensagem, message: mensagem, error_description: mensagem })
  }

  function sessaoLocal(usuario) {
    const refresh = crypto.randomBytes(32).toString('base64url')
    cofre.gravar('refreshLocal', { token: refresh, userId: usuario.id })
    const validade = 3600
    return {
      access_token: auth.tokenUsuario(usuario, jwtSecret, validade),
      token_type: 'bearer',
      expires_in: validade,
      expires_at: Math.floor(Date.now() / 1000) + validade,
      refresh_token: refresh,
      user: objetoUsuario(usuario),
    }
  }

  function objetoUsuario(u) {
    return {
      id: u.id,
      aud: 'authenticated',
      role: 'authenticated',
      email: u.email,
      app_metadata: u.app_metadata ?? {},
      user_metadata: u.user_metadata ?? {},
      created_at: u.created_at ?? new Date(0).toISOString(),
      updated_at: new Date().toISOString(),
    }
  }

  async function entrar(res, email, senha) {
    email = String(email ?? '').trim().toLowerCase()
    const atual = cofre.ler('usuario')
    let r = null
    try {
      r = await remoto.entrar(email, senha)
    } catch (e) {
      if (!(e instanceof ErroRede)) throw e
      log(`login sem internet: ${e.message}`)
    }
    if (r && r.status !== 502 && r.status !== 503 && r.status !== 500) {
      if (r.status !== 200 || !r.json.ok) return erroAuth(res, r.json.erro ?? 'E-mail ou senha inválidos.')
      const s = r.json.sessao
      if (atual && atual.id !== s.user.id) {
        if (sync.temPendencias()) {
          return erroAuth(res, `Há operações feitas sem internet por ${atual.email} neste computador. Entre com essa conta, com internet, para enviá-las antes de trocar de usuário.`)
        }
        await sync.trocarUsuario()
      }
      const usuario = {
        id: s.user.id,
        email: s.user.email,
        app_metadata: s.user.app_metadata,
        user_metadata: s.user.user_metadata,
        verificador: auth.verificadorSenha(senha),
        ultimaValidacao: Date.now(),
      }
      cofre.gravar('sessaoRemota', { access_token: s.access_token, refresh_token: s.refresh_token, expires_at: s.expires_at })
      cofre.gravar('usuario', usuario)
      sync.aoEntrar({ lojas: r.json.lojas, lojaAtual: r.json.lojaAtual })
      return json(res, 200, sessaoLocal(usuario))
    }
    // Sem internet: só o último usuário que entrou online aqui, com a senha guardada, até 30 dias.
    if (!atual || atual.email !== email) return erroAuth(res, 'Sem internet. O primeiro acesso deste usuário neste computador precisa de internet.')
    if (!auth.conferirSenha(senha, atual.verificador)) return erroAuth(res, 'E-mail ou senha inválidos.')
    if (Date.now() - (atual.ultimaValidacao ?? 0) > TRINTA_DIAS) return erroAuth(res, 'Faz mais de 30 dias que este computador não conecta. Conecte à internet para entrar.')
    return json(res, 200, sessaoLocal(atual))
  }

  async function rotaAuth(req, res, url) {
    if (url.pathname === '/auth/v1/token' && req.method === 'POST') {
      const corpo = JSON.parse((await lerCorpo(req)).toString() || '{}')
      const tipo = url.searchParams.get('grant_type')
      if (tipo === 'password') return entrar(res, corpo.email, corpo.password)
      if (tipo === 'refresh_token') {
        const atual = cofre.ler('refreshLocal')
        const usuario = cofre.ler('usuario')
        const ok = atual && usuario && cofre.ler('sessaoRemota') && usuario.verificador &&
          Date.now() - (usuario.ultimaValidacao ?? 0) <= TRINTA_DIAS &&
          typeof corpo.refresh_token === 'string' && atual.userId === usuario.id &&
          corpo.refresh_token.length === atual.token.length &&
          crypto.timingSafeEqual(Buffer.from(corpo.refresh_token), Buffer.from(atual.token))
        if (!ok) return erroAuth(res, 'Sessão expirada.')
        return json(res, 200, sessaoLocal(usuario))
      }
      return erroAuth(res, 'Tipo de login não suportado no app.')
    }
    if (url.pathname === '/auth/v1/user' && req.method === 'GET') {
      const p = auth.verificar((req.headers.authorization ?? '').replace(/^Bearer /, ''), jwtSecret)
      const usuario = cofre.ler('usuario')
      if (!p || p.role !== 'authenticated' || !usuario || p.sub !== usuario.id) return erroAuth(res, 'Sessão inválida.', 401)
      return json(res, 200, objetoUsuario(usuario))
    }
    if (url.pathname === '/auth/v1/logout') {
      cofre.gravar('refreshLocal', undefined)
      res.writeHead(204)
      return res.end()
    }
    return erroAuth(res, 'Disponível só no sistema web.', 400)
  }

  // ---------- proxies ----------
  function encaminhar(req, res, porta, caminho, headers, corpo) {
    const p = http.request(
      { host: '127.0.0.1', port: porta, method: req.method, path: caminho, headers },
      (r) => {
        res.writeHead(r.statusCode ?? 502, r.headers)
        r.pipe(res)
      },
    )
    p.on('error', (e) => {
      log(`proxy :${porta} ${caminho}: ${e.message}`)
      if (!res.headersSent) json(res, 502, { message: 'Serviço local indisponível.' })
      else res.end()
    })
    if (corpo) p.end(corpo)
    else req.pipe(p)
  }

  function rotaRest(req, res, url) {
    const headers = { ...req.headers }
    delete headers.host
    delete headers.apikey
    const bearer = (headers.authorization ?? '').replace(/^Bearer /, '')
    if (!bearer || bearer === anonBuild) {
      headers.authorization = `Bearer ${anonLocal}`
    } else if (!auth.verificar(bearer, jwtSecret)) {
      return json(res, 401, { code: 'PGRST301', message: 'JWT inválido' })
    }
    headers.host = `127.0.0.1:${portas.postgrest}`
    encaminhar(req, res, portas.postgrest, url.pathname.slice('/rest/v1'.length) + url.search, headers)
  }

  async function rotaSoOnline(req, res, url) {
    try {
      const s = await remoto.sessaoValida()
      const corpo = req.method === 'GET' || req.method === 'HEAD' ? undefined : await lerCorpo(req)
      const r = await fetch(`${remoto.base}${url.pathname}${url.search}`, {
        method: req.method,
        headers: {
          authorization: `Bearer ${s.access_token}`,
          'x-ntb-desktop': '1',
          'x-ntb-refresh': 'nao-usar',
          'content-type': req.headers['content-type'] ?? 'application/octet-stream',
        },
        body: corpo,
        redirect: 'manual',
        signal: AbortSignal.timeout(120_000),
      })
      const h = {}
      for (const k of ['content-type', 'content-disposition', 'cache-control']) if (r.headers.get(k)) h[k] = r.headers.get(k)
      res.writeHead(r.status, h)
      res.end(Buffer.from(await r.arrayBuffer()))
    } catch (e) {
      log(`só-online ${url.pathname}: ${e.message}`)
      res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' })
      res.end('Esta função precisa de internet. Conecte e tente de novo.')
    }
  }

  // ---------- API do motor ----------
  function tokenInternoOk(req) {
    const t = req.headers['x-ntb-token']
    return typeof t === 'string' && t.length === o.tokenInterno.length && crypto.timingSafeEqual(Buffer.from(t), Buffer.from(o.tokenInterno))
  }
  function pedidoDaJanelaOk(req) {
    return req.headers['x-ntb'] === '1' && req.headers.origin === origemLocal
  }

  async function rotaNtb(req, res, url) {
    const p = url.pathname
    if (p === '/__ntb/status' && req.method === 'GET') return json(res, 200, sync.status())
    if (p === '/__ntb/fila' && req.method === 'GET') return json(res, 200, sync.fila())
    if (req.method !== 'POST') return json(res, 405, {})
    if (p === '/__ntb/acao' || p === '/__ntb/resultado-local') {
      if (!tokenInternoOk(req)) return json(res, 403, {})
      const corpo = JSON.parse((await lerCorpo(req)).toString())
      if (p === '/__ntb/acao') return json(res, 200, await sync.executarAcao(corpo))
      await sync.resultadoLocal(corpo)
      return json(res, 200, { ok: true })
    }
    if (!pedidoDaJanelaOk(req)) return json(res, 403, {})
    const corpo = JSON.parse((await lerCorpo(req)).toString() || '{}')
    if (p === '/__ntb/fila/descartar') return json(res, 200, await sync.descartar(String(corpo.intentId ?? '')))
    if (p === '/__ntb/sincronizar') {
      sync.agora()
      return json(res, 200, { ok: true })
    }
    if (p === '/__ntb/apagar-dados') return json(res, 200, await sync.apagarTudo())
    return json(res, 404, {})
  }

  const servidor = http.createServer(async (req, res) => {
    try {
      if (!hostsValidos.has(req.headers.host ?? '')) {
        res.writeHead(421)
        return res.end()
      }
      const url = new URL(req.url, origemLocal)
      // Pedido vindo de outro site aberto no navegador (CSRF): nada passa. A janela do app e o
      // Next local mandam Origin local ou nenhum.
      const origem = req.headers.origin
      const site = req.headers['sec-fetch-site']
      if ((origem && origem !== origemLocal) || (site && site !== 'same-origin' && site !== 'none')) {
        res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
        return res.end('Bloqueado')
      }
      if (url.pathname.startsWith('/rest/v1/')) return rotaRest(req, res, url)
      if (url.pathname.startsWith('/auth/v1/')) return await rotaAuth(req, res, url)
      if (url.pathname.startsWith('/__ntb/')) return await rotaNtb(req, res, url)
      if (ROTAS_SO_ONLINE.some((r) => url.pathname.startsWith(r))) return await rotaSoOnline(req, res, url)

      // Primeira carga ainda rodando: páginas mostram o progresso em vez de telas vazias.
      const st = sync.status()
      const ehPagina = req.method === 'GET' && (req.headers.accept ?? '').includes('text/html')
      if (ehPagina && st.carga && !st.carga.pronta && cofre.ler('usuario') && !url.pathname.startsWith('/login')) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        return res.end(fs.readFileSync(paginaCarga))
      }
      // x-ntb-gw: o Next local só atende o que passou por aqui (proxy.ts confere).
      const headers = { ...req.headers, 'x-forwarded-host': req.headers.host, 'x-forwarded-proto': 'http', 'x-ntb-gw': o.tokenInterno }
      return encaminhar(req, res, portas.next, req.url, headers)
    } catch (e) {
      log(`gateway: ${e.stack ?? e.message}`)
      if (!res.headersSent) json(res, 500, { message: 'Erro interno do app.' })
      else res.end()
    }
  })

  return {
    escutar: () => new Promise((resolve, reject) => {
      servidor.once('error', reject)
      servidor.listen(portas.gateway, '127.0.0.1', resolve)
    }),
    // closeAllConnections: a janela mantém conexões keep-alive; sem isso o close() espera para sempre.
    fechar: () => new Promise((resolve) => {
      servidor.close(() => resolve())
      servidor.closeAllConnections()
    }),
    servidor,
  }
}

module.exports = { criarGateway }
