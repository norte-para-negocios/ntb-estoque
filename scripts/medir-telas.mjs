// Fase 12 (velocidade): mede as telas do dia a dia como usuário logado e guarda o texto principal de cada uma, para
// comparar antes × depois de um deploy (mesmo resultado na tela, só mais rápido). Só abre telas: não clica em nada.
//
//   QA_SENHA=... PLAYWRIGHT=/caminho/playwright/index.mjs node scripts/medir-telas.mjs antes  <pasta-fora-do-repo>
//   QA_SENHA=... PLAYWRIGHT=...                           node scripts/medir-telas.mjs depois <pasta-fora-do-repo>
//   node scripts/medir-telas.mjs comparar <pasta-fora-do-repo>
//
// A pasta guarda o texto das telas (dado da loja): nunca dentro do repo (ele é público). Mede a loja atual da conta QA.
// Variáveis: BASE (padrão produção), QA_EMAIL (padrão conta QA), TELAS (lista separada por vírgula), N (padrão 3).
import fs from 'node:fs'
import path from 'node:path'

const [modo, pasta] = process.argv.slice(2)
if (!['antes', 'depois', 'comparar'].includes(modo) || !pasta) {
  console.error('uso: node scripts/medir-telas.mjs antes|depois|comparar <pasta-fora-do-repo>')
  process.exit(1)
}
const arquivo = (tag) => path.join(pasta, `medida-${tag}.json`)

if (modo === 'comparar') {
  const a = JSON.parse(fs.readFileSync(arquivo('antes'), 'utf8'))
  const d = JSON.parse(fs.readFileSync(arquivo('depois'), 'utf8'))
  // Números que mudam sozinhos (hora, "há N min") atrapalham; a comparação é do texto inteiro, e a diferença é mostrada.
  for (const t of Object.keys(a.textos)) {
    const ta = a.textos[t]?.texto ?? ''
    const td = d.textos[t]?.texto ?? ''
    const med = (r) => [...r].sort((x, y) => x - y)[Math.floor(r.length / 2)]
    const igual = ta === td
    console.log(`${t.padEnd(36)} antes ${String(med(a.tempos[t])).padStart(5)} ms  depois ${String(med(d.tempos[t] ?? [0])).padStart(5)} ms  texto ${igual ? 'igual' : 'DIFERENTE'}`)
    if (!igual) {
      const la = ta.split('\n'), ld = td.split('\n')
      for (let i = 0; i < Math.max(la.length, ld.length); i++) if (la[i] !== ld[i]) { console.log(`   1ª diferença na linha ${i + 1}:\n   - ${la[i]}\n   + ${ld[i]}`); break }
    }
  }
  process.exit(0)
}

const { chromium } = await import(process.env.PLAYWRIGHT ?? 'playwright')
const senha = process.env.QA_SENHA
if (!senha) { console.error('defina QA_SENHA'); process.exit(1) }
const BASE = process.env.BASE ?? 'https://app-estoque.norteparanegocios.com.br'
const telas = (process.env.TELAS ?? '/home,/estoque,/estoque/kardex,/movimentacoes,/ordem-producao,/nota-fiscal,/financeiro/dre,/financeiro/fluxo-caixa,/relatorio-cmv,/financeiro/contas-pagar').split(',')
const N = Number(process.env.N ?? 3)

fs.mkdirSync(pasta, { recursive: true })
const b = await chromium.launch({ headless: true })
const pg = await (await b.newContext()).newPage()
await pg.goto(BASE + '/login')
await pg.fill('input[name=email]', process.env.QA_EMAIL ?? 'claude.qa@ntb-estoque.dev')
await pg.fill('input[name=password]', senha)
await Promise.all([pg.waitForURL((u) => !u.pathname.startsWith('/login'), { timeout: 30000 }), pg.click('button[type=submit]')])
const tempos = {}
const textos = {}
for (const t of telas) {
  tempos[t] = []
  for (let i = 0; i < N; i++) {
    const t0 = Date.now()
    const r = await pg.goto(BASE + t, { waitUntil: 'domcontentloaded', timeout: 60000 })
    tempos[t].push(Date.now() - t0)
    if (i === N - 1) {
      try { await pg.waitForLoadState('networkidle', { timeout: 15000 }) } catch {}
      const texto = await pg.locator('main').first().innerText().catch(() => pg.locator('body').innerText())
      textos[t] = { status: r?.status(), url: pg.url().replace(BASE, ''), texto }
    }
  }
  console.log(t.padEnd(36), tempos[t].join(' / '), 'ms')
}
fs.writeFileSync(arquivo(modo), JSON.stringify({ em: new Date().toISOString(), tempos, textos }, null, 1), { mode: 0o600 })
await b.close()
