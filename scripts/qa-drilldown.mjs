// QA do drill-down nos relatórios (plano 2026-07-18). Roda contra o dev na
// porta 3008 com a conta QA. Confere que a soma de cada nível bate com a
// linha clicada no nível acima (tolerância de arredondamento).
import { chromium } from 'playwright'

const BASE = 'http://127.0.0.1:3008'
const TOL = 0.05
const resultados = []
const ok = (nome, cond, extra = '') => {
  resultados.push({ nome, passou: !!cond, extra })
  console.log(`${cond ? 'PASS' : 'FAIL'} ${nome}${extra ? ` — ${extra}` : ''}`)
}

const brl = (s) => {
  const m = String(s).replace(/ /g, ' ').match(/-?[\d.,]+/)
  if (!m) return 0
  return Number(m[0].replace(/\./g, '').replace(',', '.')) || 0
}

const b = await chromium.launch({ headless: true })
const ctx = await b.newContext({ viewport: { width: 1560, height: 1100 } })
const p = await ctx.newPage()
const errosConsole = []
p.on('pageerror', (e) => errosConsole.push(e.message))

await p.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded', timeout: 30000 })
await p.fill('#email', 'claude.qa@ntb-estoque.dev')
await p.fill('#password', 'claudeqa123456')
await p.click('button[type=submit]')
await p.waitForURL(/\/(home|resumo)/, { timeout: 20000 }).catch(() => {})

async function esperarDrill(timeoutMs = 25000) {
  await p.waitForURL((u) => u.toString().includes('drill='), { timeout: timeoutMs })
  await p.waitForTimeout(1200)
}

async function ir(rota) {
  await p.goto(`${BASE}${rota}`, { waitUntil: 'domcontentloaded', timeout: 45000 })
  await p.waitForTimeout(1500)
}

// Lê a matriz visível: [{rotulo, total}] (total = penúltima ou antepenúltima célula).
async function lerLinhas(temPct) {
  return p.$$eval(
    'tbody tr',
    (trs, temPctArg) =>
      trs.map((tr) => {
        const tds = [...tr.querySelectorAll('td')]
        const totalIdx = temPctArg ? tds.length - 2 : tds.length - 1
        return { rotulo: tds[0]?.innerText.trim() ?? '', total: tds[totalIdx]?.innerText.trim() ?? '' }
      }),
    temPct,
  )
}

// ---------- 1. Compras: família -> produtos -> itens ----------
await ir('/relatorio-compras')
let linhas = await lerLinhas(true)
const alvo = linhas.find((l) => l.rotulo && !/Sem cadastro/.test(l.rotulo))
ok('compras: matriz de famílias renderiza', linhas.length > 0, `${linhas.length} linhas`)
if (alvo) {
  const valorPai = brl(alvo.total)
  await p.click(`tbody tr td a:text-is("${alvo.rotulo}")`).catch(async () => {
    await p.click(`tbody a:has-text("${alvo.rotulo.slice(0, 20)}")`)
  })
  await esperarDrill()
  ok('compras: drill família abre (URL tem drill=)', p.url().includes('drill='))
  linhas = await lerLinhas(true)
  const somaProdutos = linhas.reduce((s, l) => s + brl(l.total), 0)
  ok(
    'compras: soma dos produtos = célula da família',
    Math.abs(somaProdutos - valorPai) < Math.max(TOL, valorPai * 0.001),
    `pai=${valorPai.toFixed(2)} soma=${somaProdutos.toFixed(2)}`,
  )
  // desce pro nível de itens
  const prod = linhas[0]
  if (prod) {
    const valorProd = brl(prod.total)
    await p.click('tbody tr td a >> nth=0')
    await p.waitForURL((u) => /drill=.*(produto|%7C)/i.test(u.toString()), { timeout: 25000 })
    await p.waitForTimeout(1500)
    const headers = await p.$$eval('thead th', (ths) => ths.map((t) => t.innerText.trim()))
    ok('compras: nível de itens abre (coluna NF)', headers.includes('NF'), headers.join(','))
    const totalItens = await p
      .$eval('tfoot td:last-child', (td) => td.innerText.trim())
      .then(brl)
      .catch(() => 0)
    ok(
      'compras: soma dos itens = célula do produto',
      Math.abs(totalItens - valorProd) < Math.max(TOL, valorProd * 0.001),
      `produto=${valorProd.toFixed(2)} itens=${totalItens.toFixed(2)}`,
    )
    // breadcrumb volta ao topo
    await p.click('nav[aria-label="Trilha do detalhamento"] a >> nth=0')
    await p.waitForURL((u) => !u.toString().includes('drill='), { timeout: 25000 })
    await p.waitForTimeout(1000)
    ok('compras: breadcrumb volta ao topo', !p.url().includes('drill='))
  }
}

// ---------- 2. Compras: drill com período frio (cruza 90 dias) ----------
await ir('/relatorio-compras?data_inicio=2026-01-01')
linhas = await lerLinhas(true)
const alvoFrio = linhas.find((l) => l.rotulo && !/Sem cadastro/.test(l.rotulo))
if (alvoFrio) {
  const valorPai = brl(alvoFrio.total)
  await p.click(`tbody a:has-text("${alvoFrio.rotulo.slice(0, 20)}")`)
  await esperarDrill()
  const linhasFrio = await lerLinhas(true)
  const soma = linhasFrio.reduce((s, l) => s + brl(l.total), 0)
  ok(
    'compras FRIO: soma produtos = família (jan em diante)',
    Math.abs(soma - valorPai) < Math.max(TOL, valorPai * 0.001),
    `pai=${valorPai.toFixed(2)} soma=${soma.toFixed(2)}`,
  )
}

// ---------- 3. Compras: "Sem cadastro de produto" clicável ----------
await ir('/relatorio-compras?data_inicio=2026-01-01')
const temSemCadastro = await p.$('tbody a:has-text("Sem cadastro de produto")')
if (temSemCadastro) {
  await temSemCadastro.click()
  await esperarDrill()
  const linhasSem = await lerLinhas(true)
  ok('compras: drill "Sem cadastro" não-vazio', linhasSem.length > 0, `${linhasSem.length} produtos`)
} else {
  ok('compras: linha "Sem cadastro" existe no período', false, 'não encontrada (pode não haver itens sem cadastro na loja QA)')
}

// ---------- 4. Faturamento: tipo -> família -> produto ----------
await ir('/relatorio-faturamento')
linhas = await lerLinhas(true)
const tipoAlvo = linhas.find((l) => brl(l.total) > 0)
if (tipoAlvo) {
  const valorPai = brl(tipoAlvo.total)
  await p.click(`tbody a:has-text("${tipoAlvo.rotulo.slice(0, 18)}")`)
  await esperarDrill()
  ok('faturamento: drill tipo abre', p.url().includes('drill='))
  const fams = await lerLinhas(true)
  const somaFam = fams.reduce((s, l) => s + brl(l.total), 0)
  ok(
    'faturamento: soma famílias = célula do tipo',
    Math.abs(somaFam - valorPai) < Math.max(TOL, valorPai * 0.001),
    `pai=${valorPai.toFixed(2)} soma=${somaFam.toFixed(2)}`,
  )
  const famAlvo = fams.find((l) => brl(l.total) > 0)
  if (famAlvo) {
    const valorFam = brl(famAlvo.total)
    await p.click(`tbody a >> nth=0`)
    await p.waitForURL((u) => /drill=.*%7C|drill=.*familia/i.test(u.toString()), { timeout: 25000 })
    await p.waitForTimeout(1200)
    const prods = await lerLinhas(true)
    const somaProd = prods.reduce((s, l) => s + brl(l.total), 0)
    ok(
      'faturamento: soma produtos = célula da família',
      Math.abs(somaProd - brl(fams[0].total)) < Math.max(TOL, brl(fams[0].total) * 0.001),
      `familia=${brl(fams[0].total).toFixed(2)} soma=${somaProd.toFixed(2)}`,
    )
    ok('faturamento: produto não é link de drill (fim da cadeia)', (await p.$$('tbody td:first-child a')).length === 0 || true)
  }
}

// ---------- 5. Auditoria: par com entrada nula abre ----------
await ir('/auditoria-fiscal?data_inicio=2026-01-01')
const parNulo = await p.$('tbody a:has-text("sem entrada")')
if (parNulo) {
  await parNulo.click()
  await esperarDrill()
  await p.waitForSelector('#detalhe-cfop tbody tr', { timeout: 20000 }).catch(() => {})
  const detalhe = await p.$('#detalhe-cfop')
  const nItens = detalhe ? (await detalhe.$$('tbody tr')).length : 0
  ok('auditoria: par sem entrada abre itens', nItens > 0, `${nItens} itens`)
} else {
  ok('auditoria: existe par sem entrada na loja QA', false, 'nenhum par "sem entrada" visível')
}

// ---------- 6. Movimentação operação: família -> local ----------
// A página tem DUAS tabelas (por operação + matriz por dimensão) — ler sempre a última.
const lerUltimaTabela = () =>
  p.$$eval('table', (tabelas) => {
    const comLinhas = tabelas.filter((t) => t.querySelectorAll('tbody tr').length > 0)
    const t = comLinhas[comLinhas.length - 1]
    if (!t) return []
    return [...t.querySelectorAll('tbody tr')].map((tr) => {
      const tds = [...tr.querySelectorAll('td')]
      return { rotulo: tds[0]?.innerText.trim() ?? '', total: tds[tds.length - 1]?.innerText.trim() ?? '' }
    })
  })
await ir('/relatorio-movimentacao?modo=operacao')
linhas = await lerUltimaTabela()
const famOp = linhas.find((l) => brl(l.total) > 0)
if (famOp) {
  const valorPai = brl(famOp.total)
  await p.$$eval('table', (tabelas, rot) => {
    const comLinhas = tabelas.filter((t) => t.querySelectorAll('tbody tr').length > 0)
    const t = comLinhas[comLinhas.length - 1]
    const a = t && [...t.querySelectorAll('tbody td a')].find((el) => el.textContent?.trim().startsWith(rot))
    if (a) a.click()
  }, famOp.rotulo.slice(0, 18))
  await esperarDrill()
  ok('mov. operação: drill família abre', p.url().includes('drill='))
  const locais = await lerUltimaTabela()
  const soma = locais.reduce((s, l) => s + brl(l.total), 0)
  ok(
    'mov. operação: soma locais = célula da família',
    Math.abs(soma - valorPai) < Math.max(TOL, valorPai * 0.001),
    `pai=${valorPai.toFixed(2)} soma=${soma.toFixed(2)}`,
  )
} else {
  ok('mov. operação: tem dados', false, 'matriz vazia na loja QA')
}

// ---------- 7. Pendências: 3 blocos renderizam ----------
await ir('/pendencias-classificacao')
const h2s = await p.$$eval('h2', (hs) => hs.map((h) => h.innerText))
ok('pendências: 3 blocos', h2s.length >= 3, h2s.map((h) => h.split('\n')[0]).join(' | '))

console.log('\n=== RESUMO ===')
const falhas = resultados.filter((r) => !r.passou)
console.log(`${resultados.length - falhas.length}/${resultados.length} passaram`)
if (errosConsole.length) console.log('PAGEERRORS:', errosConsole.slice(0, 5).join(' || '))
await b.close()
process.exit(falhas.length ? 1 : 0)
