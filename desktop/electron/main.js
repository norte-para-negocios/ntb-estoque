// Norte Estoque desktop: sobe banco local, PostgREST, frio-api, Next e o gateway; abre a janela
// na origem local e mantém a sincronização com a produção. Spec:
// docs/superpowers/specs/2026-10-09-estoque-desktop-offline-design.md
const { app, BrowserWindow, dialog, shell, safeStorage, Menu } = require('electron')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')
const { autoUpdater } = require('electron-updater')

const banco = require('./banco')
const auth = require('./auth-local')
const { criarCofre, caminhoPadrao } = require('./cofre')
const { criarRemoto } = require('./remoto')
const { criarFila } = require('./fila')
const { criarSync } = require('./sync')
const { criarGateway } = require('./gateway')
const { criarProcessos, portaLivre } = require('./processos')

const SERVIDOR = process.env.NTB_SERVIDOR ?? 'https://app-estoque.norteparanegocios.com.br'
const PORTAS = { gateway: 54398, next: 54397, postgrest: 54396, frio: 54395, postgres: 54394 }
// Valor fixo embutido no build do Next como NEXT_PUBLIC_SUPABASE_ANON_KEY; o gateway troca pelo JWT anon local.
const ANON_BUILD = 'ntb-desktop-anon'

if (!app.requestSingleInstanceLock()) {
  app.quit()
  process.exit(0)
}

const dirDados = app.getPath('userData')
fs.mkdirSync(dirDados, { recursive: true })
function log(msg) {
  try {
    const arq = path.join(dirDados, 'app.log')
    if (fs.existsSync(arq) && fs.statSync(arq).size > 5_000_000) fs.truncateSync(arq, 0)
    fs.appendFileSync(arq, `[${new Date().toISOString()}] ${msg}\n`)
  } catch {
    // log nunca derruba o app
  }
}

const empacotado = app.isPackaged
const dirVendor = empacotado ? path.join(process.resourcesPath, 'vendor') : path.join(__dirname, '..', 'vendor', `${process.platform}-${process.arch}`)
const dirWeb = empacotado ? path.join(process.resourcesPath, 'web') : path.join(__dirname, '..', 'web')

let janela = null
let servicos = null

async function subir() {
  for (const [nome, porta] of Object.entries(PORTAS)) {
    if (!(await portaLivre(porta))) {
      throw new Error(`A porta ${porta} (${nome}) já está em uso neste computador. Feche o outro programa que usa essa porta ou o Norte Estoque que já está aberto.`)
    }
  }
  const cofre = criarCofre({ arquivo: caminhoPadrao(dirDados), safeStorage })
  if (!cofre.persistente) log('AVISO: safeStorage indisponível, segredos só em memória')
  const seg = cofre.segredosBase()

  log('subindo banco local')
  const b = await banco.iniciar({
    dataDir: path.join(dirDados, 'banco'),
    porta: PORTAS.postgres,
    senhaAdmin: seg.senhaAdmin,
    senhaAuthenticator: seg.senhaAuthenticator,
    binDir: path.join(dirVendor, 'pgsql', 'bin'),
    log,
  })

  const processos = criarProcessos({ dirVendor, dirWeb, dirDados, log })
  await processos.postgrest({ porta: PORTAS.postgrest, portaDb: PORTAS.postgres, senhaAuthenticator: seg.senhaAuthenticator, jwtSecret: seg.jwtSecret })
  await processos.frio({ porta: PORTAS.frio, portaDb: PORTAS.postgres, senhaAdmin: seg.senhaAdmin, chave: seg.frioApiKey })

  const tokenInterno = crypto.randomBytes(32).toString('base64url') // novo a cada execução
  await processos.next({
    porta: PORTAS.next,
    env: {
      NTB_MODO_LOCAL: '1',
      NTB_GATEWAY_PORTA: String(PORTAS.gateway),
      NTB_GATEWAY_TOKEN: tokenInterno,
      SUPABASE_SERVICE_ROLE_KEY: auth.tokenServico(seg.jwtSecret),
      NTB_FRIO_API_URL: `http://127.0.0.1:${PORTAS.frio}`,
      NTB_FRIO_API_KEY: seg.frioApiKey,
      TZ: 'America/Bahia',
    },
  })

  const remoto = criarRemoto({ base: SERVIDOR, versao: app.getVersion(), cofre, log })
  const fila = criarFila(path.join(dirDados, 'fila.json'))
  const sync = criarSync({
    banco: b,
    remoto,
    cofre,
    fila,
    log,
    aoMudarEstado: () => janela?.webContents.send?.('ntb-estado'),
  })
  const gateway = criarGateway({
    portas: PORTAS,
    cofre,
    remoto,
    sync,
    anonBuild: ANON_BUILD,
    tokenInterno,
    paginaCarga: path.join(__dirname, '..', 'carga.html'),
    log,
  })
  await gateway.escutar()
  await sync.iniciar()
  return { b, processos, gateway, sync }
}

function criarJanela() {
  janela = new BrowserWindow({
    width: 1360,
    height: 860,
    minWidth: 1000,
    minHeight: 640,
    title: 'Norte Estoque',
    backgroundColor: '#f5f5f7',
    // Testes automatizados no Mac: sem janela na frente.
    show: process.env.NTB_JANELA_OCULTA !== '1',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  const origem = `http://127.0.0.1:${PORTAS.gateway}`
  // Navegação só na origem local; link externo abre no navegador.
  janela.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(origem)) {
      e.preventDefault()
      shell.openExternal(url)
    }
  })
  janela.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith(origem)) return { action: 'allow' }
    shell.openExternal(url)
    return { action: 'deny' }
  })
  janela.loadURL(`${origem}/home`)
}

function configurarAtualizacao() {
  if (!empacotado) return
  autoUpdater.logger = { info: (m) => log(`update: ${m}`), warn: (m) => log(`update: ${m}`), error: (m) => log(`update erro: ${m}`), debug: () => {} }
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('error', (e) => log(`update erro: ${e?.message ?? e}`))
  autoUpdater.on('update-downloaded', (info) => log(`update baixado: ${info?.version}`))
  autoUpdater.checkForUpdates().catch(() => {})
  setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 30 * 60_000)
}

app.on('second-instance', () => {
  if (janela) {
    if (janela.isMinimized()) janela.restore()
    janela.focus()
  }
})

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null)
  try {
    servicos = await subir()
    criarJanela()
    configurarAtualizacao()
  } catch (e) {
    log(`falha ao subir: ${e.stack ?? e.message}`)
    dialog.showErrorBox('Norte Estoque', `Não foi possível iniciar o app.\n\n${e.message}\n\nDetalhes em: ${path.join(dirDados, 'app.log')}`)
    await encerrar()
    app.exit(1)
  }
})

let encerrando = false
async function encerrar() {
  if (encerrando) return
  encerrando = true
  try {
    servicos?.sync.parar()
    await servicos?.gateway.fechar()
    servicos?.processos.encerrar()
    await servicos?.b.parar()
  } catch (e) {
    log(`encerrar: ${e.message}`)
  }
}

app.on('window-all-closed', async () => {
  await encerrar()
  app.quit()
})
app.on('before-quit', async (e) => {
  if (!encerrando) {
    e.preventDefault()
    await encerrar()
    app.quit()
  }
})
