// Baixa os binários que vão dentro do app (PostgREST e Postgres) para vendor/<plataforma>-<arch>.
// Versões e sha256 fixos: se o arquivo baixado não bater, o build para.
// Uso: node scripts/baixar-binarios.mjs [win32-x64|darwin-arm64]
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { execFileSync } from 'node:child_process'

const ALVO = process.argv[2] ?? `${process.platform}-${process.arch}`
const RAIZ = path.join(import.meta.dirname, '..')
const DESTINO = path.join(RAIZ, 'vendor', ALVO)

const POSTGREST = {
  'win32-x64': { url: 'https://github.com/PostgREST/postgrest/releases/download/v12.2.12/postgrest-v12.2.12-windows-x86-64.zip' },
  'darwin-arm64': { url: 'https://github.com/PostgREST/postgrest/releases/download/v12.2.12/postgrest-v12.2.12-macos-aarch64.tar.xz' },
}
const PG_NPM = { 'win32-x64': '@embedded-postgres/windows-x64@17.10.0-beta.17', 'darwin-arm64': '@embedded-postgres/darwin-arm64@17.10.0-beta.17' }
const PINS = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'binarios.sha256.json'), 'utf8'))

function sha256(arq) {
  return crypto.createHash('sha256').update(fs.readFileSync(arq)).digest('hex')
}
function conferir(arq, chave) {
  const h = sha256(arq)
  if (!PINS[chave]) {
    PINS[chave] = h
    fs.writeFileSync(path.join(import.meta.dirname, 'binarios.sha256.json'), JSON.stringify(PINS, null, 2) + '\n')
    console.log(`sha256 fixado para ${chave}: ${h}`)
  } else if (PINS[chave] !== h) {
    throw new Error(`sha256 não bate para ${chave}: ${h} (esperado ${PINS[chave]})`)
  }
}

if (!POSTGREST[ALVO]) throw new Error(`plataforma não suportada: ${ALVO}`)
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ntb-bin-'))
fs.rmSync(DESTINO, { recursive: true, force: true })
fs.mkdirSync(DESTINO, { recursive: true })

// PostgREST
const arqPgrst = path.join(tmp, path.basename(POSTGREST[ALVO].url))
execFileSync('curl', ['-fsSL', '-o', arqPgrst, POSTGREST[ALVO].url], { stdio: 'inherit' })
conferir(arqPgrst, `postgrest-${ALVO}`)
if (arqPgrst.endsWith('.zip')) execFileSync('unzip', ['-q', '-o', arqPgrst, '-d', DESTINO])
else execFileSync('tar', ['-xJf', arqPgrst, '-C', DESTINO])

// Postgres (binários do pacote npm do embedded-postgres)
execFileSync('npm', ['pack', PG_NPM[ALVO], '--pack-destination', tmp, '--silent'], { stdio: 'inherit' })
const tgz = fs.readdirSync(tmp).find((f) => f.endsWith('.tgz'))
conferir(path.join(tmp, tgz), `postgres-${ALVO}`)
execFileSync('tar', ['-xzf', path.join(tmp, tgz), '-C', tmp])
// O pacote do macOS guarda os links das bibliotecas num json (o npm não preserva symlink).
if (fs.existsSync(path.join(tmp, 'package', 'scripts', 'hydrate-symlinks.js'))) {
  execFileSync(process.execPath, ['scripts/hydrate-symlinks.js'], { cwd: path.join(tmp, 'package'), stdio: 'inherit' })
}
fs.cpSync(path.join(tmp, 'package', 'native'), path.join(DESTINO, 'pgsql'), { recursive: true, verbatimSymlinks: true })

fs.rmSync(tmp, { recursive: true, force: true })
console.log(`binários prontos em ${DESTINO}:`, fs.readdirSync(DESTINO))
