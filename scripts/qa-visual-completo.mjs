import { chromium } from 'playwright'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

const BASE = 'http://localhost:3007'
const EMAIL = 'claude.qa@ntb-estoque.dev'
const SENHA = 'claudeqa123456'
const DIR = 'C:/Users/media/AppData/Local/Temp/claude/C--Users-media/7f0ff8d4-fb4d-4f04-ac65-a7f013a68c0a/scratchpad/qa-shots'

mkdirSync(DIR, { recursive: true })

const ROTAS = [
  '/home',
  '/resumo',
  '/produto',
  '/produto/novo',
  '/familia',
  '/fornecedor',
  '/transferencia',
  '/inventario',
  '/ordem-producao',
  '/ordem-producao/nova',
  '/movimentacoes',
  '/validade',
  '/impressoes',
  '/nota-fiscal',
  '/relatorios',
  '/relatorio-compras',
  '/relatorio-estoque-valorizado',
  '/relatorio-movimentacao',
  '/relatorio-faturamento',
  '/relatorio-margem',
  '/relatorio-indicadores',
  '/usuario',
  '/cargo',
  '/local-estoque',
  '/loja',
  '/minha-loja',
  '/saude-banco',
  '/auditoria',
  '/auditoria-fiscal',
  '/log',
  '/sync-status',
  '/sintegra',
]

const erros = []
const resultados = []

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const page = await ctx.newPage()

const consoleBuffer = []
page.on('console', m => { if (m.type() === 'error') consoleBuffer.push(m.text()) })
page.on('pageerror', e => consoleBuffer.push(e.message))

// Login
await page.goto(`${BASE}/login`)
await page.fill('#email', EMAIL)
await page.fill('#password', SENHA)
await page.click('button[type=submit]')
await page.waitForURL(`${BASE}/home`, { timeout: 12000 }).catch(() => {})
if (!page.url().includes('/home')) {
  console.error('LOGIN FALHOU:', page.url())
  await browser.close()
  process.exit(1)
}
console.log('Login OK\n')

for (const rota of ROTAS) {
  consoleBuffer.length = 0
  const slug = rota.replace(/\//g, '_').replace(/^_/, '')
  const shotFile = join(DIR, `${slug}.png`)
  process.stdout.write(`-> ${rota.padEnd(40)}`)
  try {
    const resp = await page.goto(`${BASE}${rota}`, { timeout: 15000 })
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {})
    const http = resp?.status() ?? 0
    const urlFinal = page.url()
    const suffix = urlFinal.replace(BASE, '')
    const redirecionou = !suffix.startsWith(rota)
    await page.screenshot({ path: shotFile, fullPage: true }).catch(() => {})
    const bodyText = await page.evaluate(() => document.body?.innerText ?? '').catch(() => '')
    const erroVisivel = bodyText.includes('Internal Server Error') || bodyText.includes('Application error') || bodyText.includes('Unhandled Runtime Error')
    const conteudo = await page.locator('main').count().catch(() => 0)
    const status = { rota, http, urlFinal, redirecionou, erroVisivel, consoleErros: [...consoleBuffer], conteudo }
    resultados.push(status)
    const ok = http === 200 && !redirecionou && !erroVisivel && conteudo > 0
    if (!ok) {
      erros.push(status)
      console.log(`PROBLEMA http=${http} redirect=${redirecionou} erroV=${erroVisivel} conteudo=${conteudo}`)
    } else {
      console.log('OK')
    }
    if (consoleBuffer.length) console.log(`   console: ${consoleBuffer[0].slice(0, 100)}`)
  } catch (e) {
    erros.push({ rota, erro: e.message })
    resultados.push({ rota, erro: e.message })
    console.log(`EXCECAO: ${e.message.slice(0, 80)}`)
  }
}

writeFileSync(join(DIR, '_relatorio.json'), JSON.stringify({ erros, resultados }, null, 2))
console.log(`\n=== ${ROTAS.length - erros.length}/${ROTAS.length} OK | ${erros.length} problema(s) ===`)
for (const e of erros) console.log(`  X ${e.rota}: ${e.erro ?? `http=${e.http} redirect=${e.redirecionou} erroV=${e.erroVisivel}`}`)
console.log(`Screenshots: ${DIR}`)
await browser.close()
