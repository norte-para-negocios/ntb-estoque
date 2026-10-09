// Postgres local do desktop: cria o cluster na primeira vez, sobe/derruba com pg_ctl (que no
// Windows roda o postgres com token restrito, então funciona mesmo com usuário administrador)
// e carrega o esquema da produção. Escuta só em 127.0.0.1.
const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const { execFile } = require('child_process')
const { Client } = require('pg')

const EXE = process.platform === 'win32' ? '.exe' : ''
const DIR_SCHEMA = path.join(__dirname, '..', 'schema')
const ARQUIVOS_ESTOQUE = ['base.sql', 'estoque.sql', 'local.sql']
const ARQUIVOS_FRIO = ['frio.sql']

function rodar(bin, args, opts = {}) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { windowsHide: true, maxBuffer: 20 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      if (err) {
        err.message += `\n${stderr || ''}${stdout || ''}`
        reject(err)
      } else resolve(stdout)
    })
  })
}

function hashEsquema() {
  const h = crypto.createHash('sha256')
  for (const f of [...ARQUIVOS_ESTOQUE, ...ARQUIVOS_FRIO]) h.update(fs.readFileSync(path.join(DIR_SCHEMA, f)))
  return h.digest('hex').slice(0, 16)
}

function binDirPadrao() {
  // Empacotado: resources/vendor/pgsql; em desenvolvimento: desktop/vendor/<plataforma>-<arch>/pgsql.
  if (process.resourcesPath && fs.existsSync(path.join(process.resourcesPath, 'vendor', 'pgsql', 'bin'))) {
    return path.join(process.resourcesPath, 'vendor', 'pgsql', 'bin')
  }
  return path.join(__dirname, '..', 'vendor', `${process.platform}-${process.arch}`, 'pgsql', 'bin')
}

/**
 * @param {{ dataDir: string, porta: number, senhaAdmin: string, senhaAuthenticator: string, binDir?: string, log?: (m: string) => void }} o
 */
async function iniciar(o) {
  const log = o.log || (() => {})
  const binDir = o.binDir || binDirPadrao()
  const pgData = path.join(o.dataDir, 'pgdata')
  const novo = !fs.existsSync(path.join(pgData, 'PG_VERSION'))

  if (novo) {
    fs.mkdirSync(o.dataDir, { recursive: true })
    const pwfile = path.join(o.dataDir, 'pw.tmp')
    fs.writeFileSync(pwfile, o.senhaAdmin, { mode: 0o600 })
    try {
      log('Criando banco local...')
      await rodar(path.join(binDir, `initdb${EXE}`), [
        '-D', pgData, '-U', 'postgres', `--pwfile=${pwfile}`, '--auth=scram-sha-256', '-E', 'UTF8', '--locale=C',
      ])
    } finally {
      fs.rmSync(pwfile, { force: true })
    }
    // Só conexões locais, por TCP, com senha.
    fs.writeFileSync(path.join(pgData, 'pg_hba.conf'), [
      'host all all 127.0.0.1/32 scram-sha-256',
      '',
    ].join('\n'))
  }

  await rodar(path.join(binDir, `pg_ctl${EXE}`), [
    'start', '-D', pgData, '-w', '-t', '60', '-l', path.join(o.dataDir, 'postgres.log'),
    '-o', `-p ${o.porta} -c listen_addresses=127.0.0.1 -c unix_socket_directories= -c max_connections=60 -c shared_buffers=128MB`,
  ])

  const conectar = (database) => {
    const c = new Client({ host: '127.0.0.1', port: o.porta, user: 'postgres', password: o.senhaAdmin, database })
    return c.connect().then(() => c)
  }

  const adm = await conectar('postgres')
  try {
    const dbs = (await adm.query('select datname from pg_database')).rows.map((r) => r.datname)
    if (!dbs.includes('estoque')) await adm.query('create database estoque')
    if (!dbs.includes('frio')) await adm.query('create database frio')
  } finally {
    await adm.end()
  }

  const hash = hashEsquema()
  const est = await conectar('estoque')
  let esquemaAtual = null
  try {
    esquemaAtual = (await est.query("select valor->>'hash' as h from ntb_local.meta where chave = 'esquema'")).rows[0]?.h ?? null
  } catch {
    esquemaAtual = null
  }
  await est.end()

  let recriado = false
  if (esquemaAtual !== hash) {
    log(esquemaAtual ? 'Atualizando estrutura do banco local...' : 'Preparando estrutura do banco local...')
    await recriarBancos(conectar, o, hash)
    recriado = true
  }

  async function parar() {
    await rodar(path.join(binDir, `pg_ctl${EXE}`), ['stop', '-D', pgData, '-m', 'fast', '-w']).catch(() => {})
  }

  // Apaga tudo e recria a estrutura (troca de usuário, "apagar dados", esquema novo).
  async function recriar() {
    await recriarBancos(conectar, o, hash)
  }

  return { conectar, parar, recriar, recriado, hash }
}

async function recriarBancos(conectar, o, hash) {
  const adm = await conectar('postgres')
  try {
    for (const db of ['estoque', 'frio']) {
      await adm.query(`select pg_terminate_backend(pid) from pg_stat_activity where datname = $1 and pid <> pg_backend_pid()`, [db])
      await adm.query(`drop database if exists ${db}`)
      await adm.query(`create database ${db}`)
    }
  } finally {
    await adm.end()
  }

  const est = await conectar('estoque')
  try {
    for (const f of ARQUIVOS_ESTOQUE) {
      let sql = fs.readFileSync(path.join(DIR_SCHEMA, f), 'utf8')
      sql = sql.replaceAll('__SENHA_AUTHENTICATOR__', o.senhaAuthenticator.replaceAll("'", "''"))
      await est.query(sql)
    }
    await est.query('alter database estoque set search_path = "$user", public, extensions')
    await est.query('select ntb_local.instalar_rastreio()')
    const faixas = (await est.query('select ntb_local.ajustar_sequencias() as f')).rows[0].f
    await est.query(`insert into ntb_local.meta values ('faixas', $1) on conflict (chave) do update set valor = excluded.valor`, [faixas])
    await est.query(`insert into ntb_local.meta values ('esquema', $1) on conflict (chave) do update set valor = excluded.valor`, [{ hash }])
  } finally {
    await est.end()
  }

  const frio = await conectar('frio')
  try {
    for (const f of ARQUIVOS_FRIO) await frio.query(fs.readFileSync(path.join(DIR_SCHEMA, f), 'utf8'))
  } finally {
    await frio.end()
  }
}

module.exports = { iniciar, hashEsquema, binDirPadrao }
