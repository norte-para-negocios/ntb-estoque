import { chromium } from 'playwright'
import { execSync } from 'node:child_process'

const BASE = process.env.QA_BASE || 'https://app-estoque.norteparanegocios.com.br'
const url = process.argv[2]
const lojas = [2, 3, 4, 5, 6]
const snippetChars = Number(process.argv[3] || 2200)
const QA_ID = '0c4e94fe-93be-4914-84b1-263efdbbb7f2'

function trocarLoja(loja) {
  execSync(`node scripts/db.mjs "update profiles set current_loja_id=${loja} where id='${QA_ID}'"`, { stdio: 'ignore' })
}

const browser = await chromium.launch()
const page = await browser.newPage()
let errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push(String(e)))

await page.goto(`${BASE}/login`)
await page.fill('input[type="email"]', 'claude.qa@ntb-estoque.dev')
await page.fill('input[type="password"]', 'claudeqa123456')
await page.click('button[type="submit"]')
await page.waitForTimeout(2000)

for (const loja of lojas) {
  errors = []
  trocarLoja(loja)
  await page.goto(`${BASE}${url}`, { timeout: 90000, waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle', { timeout: 90000 }).catch(() => {})
  const text = await page.locator('body').innerText()
  console.log(`\n===== LOJA ${loja} =====`)
  console.log(text.slice(0, snippetChars))
  if (errors.length) console.log('ERROS:', errors)
}

await browser.close()
trocarLoja(3)
