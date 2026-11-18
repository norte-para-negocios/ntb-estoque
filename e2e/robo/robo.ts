// Robô de passeio (ticket 02): entra com cada cargo em cada loja da cópia local e SÓ NAVEGA/LÊ cada endereço do menu.
// Nunca clica em botão: botões de gravação são apenas inventariados. Recusa rodar fora de http://127.0.0.1:3107.
// Uso: npm run robo   (saída em .local-data/robo/<rodada>/, fora do git)
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { chromium, type BrowserContext, type Page } from 'playwright'
import { validarUrlBase, validarAmbienteLocal, PORTA_API_LOCAL, PORTA_ERP_LOCAL } from './trava-url.ts'
import { coletar } from './coletor.ts'
import {
  gravidadeDoTipo, formatarListaFalhas, formatarInventario, valoresInvalidos, ehPaginaNaoEncontrada, ordenarFalhas,
  type Falha, type TipoFalha, type TelaInventario, type Acao,
} from './relatorio.ts'

const RAIZ = path.resolve(import.meta.dirname, '..', '..')
const NOMES_LOJA: Record<string, string> = { '4': 'Sertão', '15': 'ODARA', '19': 'Loja 19' }
const GRUPOS_MENU = ['Operação', 'Cadastros', 'Administração']

function sair(msg: string, codigo = 2): never {
  console.error(`ROBÔ RECUSOU RODAR: ${msg}`)
  process.exit(codigo)
}

// ---- 1) Trava: URL base local, ambiente local, Omie bloqueado ----
const urlBase = process.env.ROBO_URL_BASE ?? `http://127.0.0.1:${PORTA_ERP_LOCAL}`
const v = validarUrlBase(urlBase)
if (!v.ok) sair(v.motivo)
const ORIGEM = v.origem
const envLocal = path.join(RAIZ, '.env.local')
if (!fs.existsSync(envLocal)) sair('.env.local da cópia local não existe (rode scripts/local/local.sh subir)')
const va = validarAmbienteLocal(fs.readFileSync(envLocal, 'utf8'))
if (!va.ok) sair(va.motivo)
const ORIGEM_API = `http://127.0.0.1:${PORTA_API_LOCAL}`

// ---- 2) Rotas do menu real (extraídas do código) ----
const { NAV_ITEMS } = (await import('../../components/shell/NavItems.ts')) as { NAV_ITEMS: { href: string }[] }
const ROTAS_NAV = [...new Set(NAV_ITEMS.map((i) => i.href))].sort()

// ---- 3) Logins de teste ----
type Login = { email: string; senha: string; loja: string; lojaNome: string; cargo: string }
const logins: Login[] = []
for (const l of fs.readFileSync(path.join(RAIZ, '.local-data', 'logins.txt'), 'utf8').split('\n')) {
  const m = l.match(/^(\S+@ntb-teste\.local)\s+(\S+)\s+loja=(\d+)\s+cargo=(\w+)/)
  if (m) logins.push({ email: m[1], senha: m[2], loja: m[3], lojaNome: NOMES_LOJA[m[3]] ?? `Loja ${m[3]}`, cargo: m[4] })
}
if (!logins.length) sair('.local-data/logins.txt sem logins de teste')
const filtro = process.env.ROBO_SO // ex.: ROBO_SO=dono.sertao (depuração)
const alvo = filtro ? logins.filter((l) => l.email.startsWith(filtro)) : logins

const ID_RODADA = process.env.ROBO_RODADA ?? new Date().toISOString().replace(/[:.]/g, '-')
const SAIDA = path.join(RAIZ, '.local-data', 'robo', ID_RODADA)
fs.mkdirSync(path.join(SAIDA, 'prints'), { recursive: true })

// ---- 5) Utilidades ----
const slug = (r: string) => r.replace(/^\//, '').replace(/[^a-z0-9]+/gi, '-') || 'raiz'
const norm = (s: string) => s.replace(/\s+/g, ' ').replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, '<uuid>').replace(/[?&][^\s"']*/g, '').slice(0, 220)
const dentroDoMenu = (h: string) => h.startsWith('/') && !h.startsWith('//') && h !== '/'
const limparHref = (h: string) => h.split('#')[0].split('?')[0].replace(/\/$/, '') || '/'

/** Espera o conteúdo parar de mudar (dados que chegam depois do carregamento), até 10 s. */
async function esperarEstabilizar(page: Page) {
  let anterior = ''
  let iguais = 0
  for (let i = 0; i < 25 && iguais < 3; i++) {
    await page.waitForTimeout(400)
    const agora = await page.evaluate(() => {
      const m = document.querySelector('main') ?? document.body
      return `${(m as HTMLElement).innerText.length}|${m.querySelectorAll('button,a[href]').length}|${document.querySelectorAll('[aria-busy=true],.animate-pulse').length}`
    }).catch(() => '')
    iguais = agora === anterior ? iguais + 1 : 0
    anterior = agora
  }
}

type Resultado = { falhas: Falha[]; inventario: TelaInventario[]; visitadas: string[]; esperadas: string[] }

async function menuDoLogin(page: Page): Promise<string[]> {
  const links = new Set<string>()
  const colher = async () => {
    for (const h of (await page.evaluate(coletar)).linksMenu) if (dentroDoMenu(h)) links.add(limparHref(h))
  }
  await colher()
  const aside = page.locator('aside:visible').first()
  for (const g of GRUPOS_MENU) {
    const b = aside.getByRole('button', { name: g, exact: true })
    if (await b.count()) {
      await b.first().click() // só abre/fecha o grupo do menu; não grava nada
      await page.waitForTimeout(250)
      await colher()
    }
  }
  return [...links]
}

async function rodarLogin(browser: Awaited<ReturnType<typeof chromium.launch>>, lg: Login): Promise<Resultado> {
  const res: Resultado = { falhas: [], inventario: [], visitadas: [], esperadas: [] }
  const ctx: BrowserContext = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', reducedMotion: 'reduce' })
  const externos = new Set<string>()
  await ctx.route('**/*', (rota) => {
    const u = new URL(rota.request().url())
    if (u.protocol === 'data:' || u.protocol === 'blob:' || u.origin === ORIGEM || u.origin === ORIGEM_API) return rota.continue()
    externos.add(u.origin)
    return rota.abort('blockedbyclient')
  })
  const page = await ctx.newPage()
  page.setDefaultTimeout(30000)
  let buf: { console: string[]; http: string[]; falhaReq: string[]; pageerror: string[] } = { console: [], http: [], falhaReq: [], pageerror: [] }
  page.on('console', (m) => {
    if (m.type() !== 'error') return
    const t = m.text()
    if (/^Failed to load resource/.test(t)) return // já entra por erro HTTP da requisição
    if (/blockedbyclient|ERR_BLOCKED_BY_CLIENT/.test(t)) return
    buf.console.push(norm(t))
  })
  page.on('pageerror', (e) => buf.pageerror.push(norm(`${e.name}: ${e.message}`)))
  page.on('response', (r) => {
    const u = new URL(r.url())
    if (r.status() >= 400 && (u.origin === ORIGEM || u.origin === ORIGEM_API)) buf.http.push(`${r.request().method()} ${u.pathname} -> ${r.status()}`)
  })
  page.on('requestfailed', (q) => {
    const err = q.failure()?.errorText ?? ''
    if (/ERR_ABORTED|blockedbyclient|BLOCKED_BY_CLIENT/.test(err)) return
    buf.falhaReq.push(`${q.method()} ${new URL(q.url()).pathname} ${err}`)
  })

  const falha = (tipo: TipoFalha, tela: string, passo: string, esperado: string, mostrado: string, print: string) =>
    res.falhas.push({ tipo, gravidade: gravidadeDoTipo(tipo), loja: lg.lojaNome, cargo: lg.cargo, tela, passo, esperado, mostrado, print })

  // Login pelo formulário (é o fluxo real)
  const pLogin = `prints/${lg.loja}-${lg.cargo}-login.png`
  try {
    await page.goto(`${ORIGEM}/login`, { waitUntil: 'domcontentloaded', timeout: 90000 })
    await page.fill('#email', lg.email)
    await page.fill('#password', lg.senha)
    await page.click('button[type=submit]')
    await page.waitForURL(/\/(home|resumo|central|entrar|porta)/, { timeout: 90000 })
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
    await page.waitForTimeout(1500)
  } catch (e) {
    await page.screenshot({ path: path.join(SAIDA, pLogin) }).catch(() => {})
    falha('tela-quebrada', '/login', `entrar como ${lg.cargo} em ${lg.lojaNome}`, 'entrar e cair na tela inicial', norm(String((e as Error).message).split('\n')[0]), pLogin)
    await ctx.close()
    return res
  }

  const noMenu = new Set(await menuDoLogin(page))
  const rotas = [...new Set([...ROTAS_NAV, ...noMenu])].sort()
  res.esperadas = rotas

  for (const rota of rotas) {
    buf = { console: [], http: [], falhaReq: [], pageerror: [] }
    const passo = `abrir ${rota}`
    const esperadoAbrir = noMenu.has(rota) ? 'abre sem erro (item aparece no menu deste cargo)' : 'bloqueia/redireciona ou abre sem erro (item não aparece no menu deste cargo)'
    const png = `prints/${lg.loja}-${lg.cargo}-${slug(rota)}.png`
    const marca = res.falhas.length
    let status = 0
    let caminhoFinal = rota
    let timeout = false
    try {
      const r = await page.goto(`${ORIGEM}${rota}`, { waitUntil: 'domcontentloaded', timeout: 90000 })
      status = r?.status() ?? 0
      await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
      await esperarEstabilizar(page)
      caminhoFinal = limparHref(new URL(page.url()).pathname)
    } catch (e) {
      timeout = true
      falha('timeout', rota, passo, esperadoAbrir, norm(String((e as Error).message).split('\n')[0]), png)
    }
    res.visitadas.push(rota)
    if (timeout) {
      await page.screenshot({ path: path.join(SAIDA, png) }).catch(() => {})
      res.inventario.push({ tela: rota, loja: lg.lojaNome, cargo: lg.cargo, noMenu: noMenu.has(rota), resultado: 'timeout', titulo: '', acoes: [] })
      continue
    }
    const info = await page.evaluate(coletar)
    const emMenu = noMenu.has(rota)
    const redirecionou = caminhoFinal !== rota
    const paraLogin = /^\/(login|entrar)/.test(caminhoFinal)
    const naoEncontrada = status < 400 && ehPaginaNaoEncontrada(info.texto)
    const resultado = status >= 400 ? `http ${status}` : naoEncontrada ? 'bloqueada (404 na tela)' : redirecionou ? `redirecionou para ${caminhoFinal}` : 'abriu'

    if (status >= 400 && (emMenu || status >= 500)) falha('erro-http-pagina', rota, passo, esperadoAbrir, `HTTP ${status}`, png)
    if (emMenu && redirecionou && (paraLogin || !caminhoFinal.startsWith(rota))) falha('tela-quebrada', rota, passo, `abrir ${rota} (item do menu)`, `foi levado para ${caminhoFinal}`, png)
    if (naoEncontrada && emMenu) falha('tela-quebrada', rota, passo, esperadoAbrir, 'o item está no menu mas a tela mostra 404 (página não encontrada)', png)
    if (info.overlay) falha('tela-quebrada', rota, passo, 'tela sem erro de execução', norm(info.overlay), png)
    const sofreu = status >= 500
    if (!sofreu && status < 400 && !redirecionou && info.texto.trim().length < 3 && !info.titulo) falha('tela-vazia', rota, passo, 'conteúdo na área principal', info.temMain ? 'área principal em branco' : 'sem área principal', png)
    for (const t of [...new Set(buf.pageerror)].sort()) falha('erro-console', rota, passo, 'nenhum erro de JavaScript', `erro de página: ${t}`, png)
    for (const t of [...new Set(buf.console)].sort()) falha('erro-console', rota, passo, 'console sem erros', t, png)
    for (const t of [...new Set(buf.http)].sort()) if (!(status >= 400 && t.includes(`GET ${rota} ->`))) falha('erro-http-requisicao', rota, passo, 'requisições sem erro HTTP', t, png)
    for (const t of [...new Set(buf.falhaReq)].sort()) falha('erro-http-requisicao', rota, passo, 'requisições sem falha de rede', t, png)
    if (status < 400) {
      const inval = valoresInvalidos(info.texto)
      if (inval.length) falha('valor-invalido', rota, passo, 'valores e contas sem NaN/undefined/Infinity', `texto na tela: ${inval.join(', ')}`, png)
      if (info.estouro) falha('estouro-horizontal', rota, passo, 'página sem rolagem horizontal em 1366x768', 'conteúdo mais largo que a janela', png)
      for (const c of info.cortados) falha('texto-cortado', rota, passo, 'texto inteiro visível (ou com reticências)', c, png)
      if (info.totalCortados > info.cortados.length) falha('texto-cortado', rota, passo, 'texto inteiro visível (ou com reticências)', `mais ${info.totalCortados - info.cortados.length} trechos cortados nesta tela`, png)
    }
    if (res.falhas.length > marca) await page.screenshot({ path: path.join(SAIDA, png) }).catch(() => {})
    res.inventario.push({ tela: rota, loja: lg.lojaNome, cargo: lg.cargo, noMenu: emMenu, resultado, titulo: info.titulo, acoes: info.acoes as Acao[] })
  }
  fs.appendFileSync(path.join(SAIDA, 'externos-bloqueados.txt'), `${lg.email.split('@')[0]}: ${[...externos].sort().join(' ') || '(nenhum)'}\n`)
  await ctx.close()
  return res
}

// ---- 6) Execução ----
const t0 = Date.now()
const browser = await chromium.launch()
const paralelo = Math.max(1, Number(process.env.ROBO_PARALELO ?? 1))
const resultados: Resultado[] = new Array(alvo.length)
let prox = 0
await Promise.all(
  Array.from({ length: paralelo }, async () => {
    while (prox < alvo.length) {
      const i = prox++
      const t = Date.now()
      resultados[i] = await rodarLogin(browser, alvo[i])
      console.log(`${alvo[i].lojaNome}/${alvo[i].cargo}: ${resultados[i].visitadas.length}/${resultados[i].esperadas.length} telas, ${resultados[i].falhas.length} falhas (${Math.round((Date.now() - t) / 1000)}s)`)
    }
  })
)
await browser.close()

const falhas = ordenarFalhas(resultados.flatMap((r) => r.falhas))
const inventario = resultados.flatMap((r) => r.inventario)
const visitas = resultados.reduce((s, r) => s + r.visitadas.length, 0)
const esperadas = resultados.reduce((s, r) => s + r.esperadas.length, 0)
const telas = new Set(inventario.map((i) => i.tela)).size
const md = formatarListaFalhas(falhas, { visitas, telas, logins: alvo.length })
fs.writeFileSync(path.join(SAIDA, 'falhas.md'), md)
fs.writeFileSync(path.join(SAIDA, 'inventario.md'), formatarInventario(inventario))
fs.writeFileSync(path.join(SAIDA, 'inventario.json'), JSON.stringify(inventario, null, 1))
const hash = crypto.createHash('sha256').update(md).digest('hex')
const por = (g: number) => falhas.filter((f) => f.gravidade === g).length
const resumo = { rodada: ID_RODADA, urlBase: ORIGEM, logins: alvo.length, telasDistintas: telas, visitas, visitasEsperadas: esperadas, falhas: falhas.length, g1: por(1), g2: por(2), g3: por(3), sha256FalhasMd: hash, segundos: Math.round((Date.now() - t0) / 1000), nav: ROTAS_NAV.length }
fs.writeFileSync(path.join(SAIDA, 'resumo.json'), JSON.stringify(resumo, null, 1))
console.log(JSON.stringify(resumo))
process.exit(visitas === esperadas ? 0 : 1)
