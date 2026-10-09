// Sobe os processos locais: PostgREST, frio-api e o servidor Next (standalone). Node roda com o
// próprio executável do Electron (ELECTRON_RUN_AS_NODE), sem precisar de Node instalado.
const { spawn } = require('child_process')
const fs = require('fs')
const net = require('net')
const path = require('path')

const EXE = process.platform === 'win32' ? '.exe' : ''

function portaLivre(porta) {
  return new Promise((resolve) => {
    const s = net.createServer()
    s.once('error', () => resolve(false))
    s.once('listening', () => s.close(() => resolve(true)))
    s.listen(porta, '127.0.0.1')
  })
}

async function esperarPorta(porta, timeoutMs = 60_000) {
  const fim = Date.now() + timeoutMs
  while (Date.now() < fim) {
    const ok = await new Promise((resolve) => {
      const s = net.connect(porta, '127.0.0.1')
      s.once('connect', () => {
        s.destroy()
        resolve(true)
      })
      s.once('error', () => resolve(false))
    })
    if (ok) return
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`serviço local não respondeu na porta ${porta}`)
}

function criarProcessos({ dirVendor, dirWeb, dirDados, log }) {
  const filhos = []
  let encerrando = false

  function iniciar(nome, cmd, args, env) {
    const arqLog = fs.createWriteStream(path.join(dirDados, `${nome}.log`), { flags: 'a' })
    const p = spawn(cmd, args, { env: { ...env }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    p.stdout.pipe(arqLog)
    p.stderr.pipe(arqLog)
    p.on('exit', (code) => {
      if (!encerrando) log(`processo ${nome} saiu (código ${code})`)
    })
    filhos.push(p)
    return p
  }

  const nodeEnv = { ELECTRON_RUN_AS_NODE: '1', PATH: process.env.PATH ?? '', SystemRoot: process.env.SystemRoot ?? '' }

  return {
    async postgrest({ porta, portaDb, senhaAuthenticator, jwtSecret }) {
      const bin = path.join(dirVendor, `postgrest${EXE}`)
      iniciar('postgrest', bin, [], {
        ...nodeEnv,
        PGRST_DB_URI: `postgres://authenticator:${encodeURIComponent(senhaAuthenticator)}@127.0.0.1:${portaDb}/estoque`,
        PGRST_DB_SCHEMAS: 'public',
        PGRST_DB_ANON_ROLE: 'anon',
        PGRST_DB_MAX_ROWS: '1000',
        PGRST_DB_EXTRA_SEARCH_PATH: 'public,extensions',
        PGRST_DB_POOL: '10',
        PGRST_JWT_SECRET: jwtSecret,
        PGRST_SERVER_HOST: '127.0.0.1',
        PGRST_SERVER_PORT: String(porta),
        PGRST_LOG_LEVEL: 'error',
        PGRST_SERVER_CORS_ALLOWED_ORIGINS: 'http://127.0.0.1:54398',
      })
      await esperarPorta(porta)
    },
    async frio({ porta, portaDb, senhaAdmin, chave }) {
      iniciar('frio-api', process.execPath, [path.join(__dirname, '..', 'frio-api', 'server.js')], {
        ...nodeEnv,
        DATABASE_URL: `postgres://postgres:${encodeURIComponent(senhaAdmin)}@127.0.0.1:${portaDb}/frio`,
        API_KEY: chave,
        VENDAS_API_KEY: require('crypto').randomBytes(24).toString('hex'),
        PORT: String(porta),
      })
      await esperarPorta(porta)
    },
    async next({ porta, env }) {
      iniciar('next', process.execPath, [path.join(dirWeb, 'server.js')], {
        ...nodeEnv,
        ...env,
        NODE_ENV: 'production',
        PORT: String(porta),
        HOSTNAME: '127.0.0.1',
      })
      await esperarPorta(porta, 120_000)
    },
    encerrar() {
      encerrando = true
      for (const p of filhos) {
        try {
          p.kill("SIGKILL") // sem estado: o Postgres para à parte (pg_ctl stop)
        } catch {
          // já saiu
        }
      }
    },
  }
}

module.exports = { criarProcessos, portaLivre, esperarPorta }
