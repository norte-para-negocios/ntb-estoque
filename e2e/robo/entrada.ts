// Robô da nota de entrada e do custo médio (ticket 04). Primeiro robô que ESCREVE na cópia local, e só pela tela do ERP,
// como uma pessoa: lança notas de teste (digitada e XML), confere saldo, custo médio e título a pagar contra o gabarito
// (e2e/robo/custo-gabarito.ts, conta independente) e, no fim, volta a cópia ao estado inicial (`local.sh resetar`) e prova
// que voltou. O banco é lido SÓ para ler documentos (sessão read-only); nunca escreve. Nunca chama o Omie: a trava
// NTB_OMIE_BLOQUEADO=1 do ERP é conferida antes e o navegador só fala com a cópia local.
// Uso: npm run robo:entrada   (saída em .local-data/robo-entrada/<rodada>/, fora do git)
// Variáveis: ROBO_CENARIOS=19-manual,15-xml (filtra), ROBO_SEM_RESET=1 (não reseta no fim; a prova de reset fica pendente).
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import pg from 'pg'
import { chromium, type Page, type BrowserContext } from 'playwright'
import { validarUrlBase, validarAmbienteLocal, PORTA_ERP_LOCAL } from './trava-url.ts'
import { formatarListaFalhas, ordenarFalhas, ehPaginaNaoEncontrada, type Falha, type TipoFalha } from './relatorio.ts'
import { parseDec, fmtDec } from './saldo-gabarito.ts'
import { custoUnitarioBase, novoEstado, quantidadeBase, titulosEsperados, valorEmEstoqueCent, arredondarTexto, type ItemNota } from './custo-gabarito.ts'
import { montarXmlAssinado } from './entrada-xml.ts'

const RAIZ = path.resolve(import.meta.dirname, '..', '..')
const PORTA_PG_LOCAL = 54420
const FORNECEDOR = { nome: 'ROBO FORNECEDOR ENTRADA (TESTE)', cnpj: '12345678000195' }

function sair(msg: string): never {
  console.error(`ROBÔ RECUSOU RODAR: ${msg}`)
  process.exit(2)
}

// ---- Trava: só a cópia local, com a trava do Omie ligada ----
const v = validarUrlBase(process.env.ROBO_URL_BASE ?? `http://127.0.0.1:${PORTA_ERP_LOCAL}`)
if (!v.ok) sair(v.motivo)
const ORIGEM = v.origem
const envLocal = path.join(RAIZ, '.env.local')
if (!fs.existsSync(envLocal)) sair('.env.local da cópia local não existe')
const va = validarAmbienteLocal(fs.readFileSync(envLocal, 'utf8'))
if (!va.ok) sair(va.motivo)
const senhaPg = fs.readFileSync(path.join(RAIZ, '.local-data', 'env'), 'utf8').match(/^POSTGRES_PASSWORD=(.*)$/m)?.[1]?.trim()
if (!senhaPg) sair('POSTGRES_PASSWORD ausente em .local-data/env')

function lerLogins() {
  const m = new Map<number, { email: string; senha: string }>()
  for (const l of fs.readFileSync(path.join(RAIZ, '.local-data', 'logins.txt'), 'utf8').split('\n')) {
    const x = l.match(/^(\S+@ntb-teste\.local)\s+(\S+)\s+loja=(\d+)\s+cargo=dono/)
    if (x) m.set(Number(x[3]), { email: x[1], senha: x[2] })
  }
  return m
}
let logins = lerLogins()

const ID_RODADA = process.env.ROBO_RODADA ?? new Date().toISOString().replace(/[:.]/g, '-')
const SAIDA = path.join(RAIZ, '.local-data', 'robo-entrada', ID_RODADA)
fs.mkdirSync(path.join(SAIDA, 'prints'), { recursive: true })

async function abrirBanco() {
  const c = new pg.Client({ host: '127.0.0.1', port: PORTA_PG_LOCAL, user: 'postgres', password: senhaPg, database: 'postgres', options: '-c default_transaction_read_only=on' })
  await c.connect()
  return c
}
let db = await abrirBanco()
const q = async <T = Record<string, string>>(sql: string, args: unknown[] = []) => (await db.query({ text: sql, values: args })).rows as T[]

// ---- Datas (America/Sao_Paulo) ----
const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
const somaDias = (iso: string, n: number) => { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10) }
const dataBR = (iso: string) => iso.split('-').reverse().join('/')
const toBR = (s: string) => s.replace('.', ',')
const brl = (c: bigint | number) => { const n = Number(c); const a = Math.abs(n); return `${n < 0 ? '-' : ''}R$ ${Math.floor(a / 100).toLocaleString('pt-BR')},${String(a % 100).padStart(2, '0')}` }

// ---- Foto do banco: provar que a cópia voltou ao estado inicial ----
const TABELAS_FOTO = ['compras_proprio', 'compras_proprio_itens', 'compras_proprio_eventos', 'estoque_movimentos', 'estoque_lotes', 'estoque_lote_movimentos', 'notas_fiscais', 'nota_fiscal_items',
  'fin_titulos_pagar', 'fin_eventos', 'fornecedores', 'fornecedor_produto_depara', 'sefaz_documentos', 'integration_attempts', 'movimentos', 'posicao_estoques', 'produtos', 'estoque_correcao_custo', 'estoque_mov_revisao']
async function foto(): Promise<Record<string, string>> {
  const f: Record<string, string> = {}
  for (const t of TABELAS_FOTO) {
    if (!(await q('select to_regclass($1)::text r', [`public.${t}`]))[0].r) continue
    f[t] = (await q(`select count(*)::text c from public.${t}`))[0].c
  }
  f.estoque_saldos = (await q("select count(*)::text || ':' || coalesce(md5(string_agg(concat_ws('|',loja_id,codigo_local_estoque,codigo_produto,saldo), ',' order by loja_id,codigo_local_estoque,codigo_produto)),'-') c from public.estoque_saldos"))[0].c
  f.estoque_custos = (await q("select count(*)::text || ':' || coalesce(md5(string_agg(concat_ws('|',loja_id,codigo_produto,cmc,saldo_total,ultimo_custo), ',' order by loja_id,codigo_produto)),'-') c from public.estoque_custos"))[0].c
  return f
}
const lojaExtra = async (loja: number) => (await q(
  `select (select count(*) from notas_fiscais where loja_id=$1)::text notas, (select count(*) from compras_proprio where loja_id=$1)::text compras, (select count(*) from estoque_movimentos where loja_id=$1)::text movimentos_ledger,
          (select count(*) from movimentos where loja_id=$1)::text movimentos_omie, (select count(*) from integration_attempts where loja_id=$1)::text tentativas_omie, (select count(*) from fin_titulos_pagar where loja_id=$1)::text titulos,
          (select coalesce(sum(saldo),0) from estoque_saldos where loja_id=$1)::text saldo_total, (select count(*) from posicao_estoques where loja_id=$1)::text posicao`, [loja]))[0]

// ---- Cenários ----
type ItemCenario = { codigo: string; unidadeNota: string; quantidade: string; valorUnitario: string; desconto?: string; fator: string }
type Cenario = {
  id: string; loja: number; nome: string; via: 'manual' | 'xml'; local: string; numero: string; itens: ItemCenario[]
  frete?: string; descontoNota?: string; duplicatasDias?: number[]; ligado: boolean; destinatarioCnpj?: string; nota: string
}
const CENARIOS: Cenario[] = [
  { id: '19-manual', loja: 19, nome: 'Loja 19', via: 'manual', local: 'Estoque Geral', numero: 'RB190', ligado: true,
    itens: [
      { codigo: '90018', unidadeNota: 'UN', quantidade: '48', valorUnitario: '1.80', fator: '1' },
      { codigo: '90019', unidadeNota: 'UN', quantidade: '12', valorUnitario: '2.90', fator: '1' },
    ], frete: '12', descontoNota: '2', nota: 'Compra digitada, 2 itens com frete e desconto da nota, em loja de estoque próprio com a chave do título ligada.' },
  { id: '19-xml', loja: 19, nome: 'Loja 19', via: 'xml', local: 'Estoque Geral', numero: '7019', ligado: true, duplicatasDias: [30, 60],
    itens: [
      { codigo: '80034', unidadeNota: 'KG', quantidade: '3', valorUnitario: '42.00', fator: '1000' },
      { codigo: '80044', unidadeNota: 'L', quantidade: '2', valorUnitario: '9.50', desconto: '1.00', fator: '1000' },
    ], nota: 'XML com conversão KG para G e L para ML (fator 1000), desconto no item e 2 duplicatas; custo médio parte de saldo zero.' },
  { id: '15-manual', loja: 15, nome: 'ODARA', via: 'manual', local: 'Depósito', numero: 'RB150', ligado: false,
    itens: [
      { codigo: '60028', unidadeNota: 'UN', quantidade: '24', valorUnitario: '7.95', fator: '1' },
      { codigo: '80056', unidadeNota: 'ML', quantidade: '750', valorUnitario: '0.045', fator: '1' },
    ], frete: '15.50', nota: 'Compra digitada na ODARA (chave do título desligada): custo médio ponderado sobre saldo existente.' },
  { id: '15-xml', loja: 15, nome: 'ODARA', via: 'xml', local: 'Depósito', numero: '7015', ligado: false,
    itens: [
      { codigo: '80040', unidadeNota: 'L', quantidade: '4', valorUnitario: '19.50', fator: '1000' },
      { codigo: '80043', unidadeNota: 'KG', quantidade: '2', valorUnitario: '33.00', fator: '1000' },
    ], nota: 'XML na ODARA: L para ML sobre saldo NEGATIVO (leite de coco) e KG para G sobre saldo positivo.' },
]
const filtro = (process.env.ROBO_CENARIOS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
const cenariosRodar = CENARIOS.filter((c) => !filtro.length || filtro.includes(c.id))
const rodarOmie = !filtro.length || filtro.includes('4-omie')

// ---- Falhas, contadores, achados ----
const falhas: Falha[] = []
const achados: string[] = []
const provas: string[] = []
let conferencias = 0
function falha(loja: string, tela: string, passo: string, esperado: string, mostrado: string, print: string, tipo: TipoFalha = 'conta-divergente') {
  falhas.push({ tipo, gravidade: tipo === 'tela-quebrada' ? 2 : 1, loja, cargo: 'dono', tela, passo, esperado, mostrado, print })
}
function conferir(loja: string, tela: string, passo: string, esperado: string, mostrado: string, print: string, tipo: TipoFalha = 'conta-divergente') {
  conferencias++
  if (esperado !== mostrado) falha(loja, tela, passo, esperado, mostrado, print, tipo)
}

// ---- Navegador ----
const externos: string[] = []
async function novoContexto(browser: Awaited<ReturnType<typeof chromium.launch>>): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', reducedMotion: 'reduce' })
  await ctx.route('**/*', (rota) => {
    const u = new URL(rota.request().url())
    if (u.protocol === 'data:' || u.protocol === 'blob:' || u.origin === ORIGEM || u.origin === 'http://127.0.0.1:54421') return rota.continue()
    externos.push(`${rota.request().method()} ${u.origin}${u.pathname}`)
    return rota.abort('blockedbyclient')
  })
  return ctx
}
async function entrar(page: Page, loja: number) {
  const lg = logins.get(loja)
  if (!lg) throw new Error(`sem login dono para a loja ${loja}`)
  await page.goto(`${ORIGEM}/login`, { waitUntil: 'domcontentloaded', timeout: 90000 })
  await page.fill('#email', lg.email)
  await page.fill('#password', lg.senha)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/(home|resumo|central|entrar|porta)/, { timeout: 90000 })
}
async function abrir(page: Page, rota: string) {
  const r = await page.goto(`${ORIGEM}${rota}`, { waitUntil: 'domcontentloaded', timeout: 90000 })
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {})
  await page.waitForTimeout(1000)
  const texto = await page.evaluate(() => ((document.querySelector('main') ?? document.body) as HTMLElement).innerText)
  const noindex = (await page.locator('meta[name=robots][content*=noindex]').count()) > 0
  return { texto, status: r?.status() ?? 0, noindex }
}
let nPrint = 0
const print = async (page: Page, nome: string) => {
  const rel = `prints/${String(++nPrint).padStart(2, '0')}-${nome.replace(/[^a-z0-9]+/gi, '-')}.png`
  await page.screenshot({ path: path.join(SAIDA, rel) }).catch(() => {})
  return rel
}

async function escolherProduto(li: ReturnType<Page['locator']>, page: Page, codigo: string) {
  if (await li.getByLabel('Trocar produto').count()) {
    if ((await li.innerText()).includes(codigo)) return
    await li.getByLabel('Trocar produto').click()
  }
  const campo = li.getByPlaceholder('Buscar produto por nome ou código')
  const opcao = li.locator('button', { hasText: new RegExp(`${codigo}\\s*·`) }).first()
  // a página pode ainda não ter hidratado quando o primeiro texto é digitado: repete até a lista aparecer
  for (let t = 0; t < 4; t++) {
    await campo.fill('')
    await campo.pressSequentially(codigo, { delay: 40 })
    if (await opcao.waitFor({ timeout: 6000 }).then(() => true, () => false)) break
  }
  await opcao.waitFor({ timeout: 10000 })
  await opcao.click()
  void page
}

async function lancarManual(page: Page, c: Cenario, obs: string): Promise<{ toast: string; erro: string | null }> {
  await page.goto(`${ORIGEM}/nota-fiscal/nova`, { waitUntil: 'domcontentloaded', timeout: 90000 })
  await page.getByText('Lançar compra sem XML').first().waitFor({ timeout: 30000 })
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {})
  const forn = page.locator('section[aria-label="Fornecedor"]')
  const ins = forn.locator('input')
  await ins.nth(0).fill(FORNECEDOR.nome)
  await ins.nth(1).fill(FORNECEDOR.cnpj)
  await ins.nth(2).fill(c.numero)
  await ins.nth(3).fill(hoje)
  await forn.locator('select').selectOption({ label: c.local })
  const itens = page.locator('section[aria-label="Itens"] ul > li')
  for (const [i, it] of c.itens.entries()) {
    if (i > 0) await page.getByRole('button', { name: 'Adicionar item' }).click()
    const li = itens.nth(i)
    await escolherProduto(li, page, it.codigo)
    await li.getByPlaceholder('0', { exact: true }).fill(toBR(it.quantidade))
    await li.getByPlaceholder('0,00').fill(toBR(it.valorUnitario))
  }
  const tot = page.locator('section[aria-label="Totais"] input')
  if (c.frete) await tot.nth(0).fill(toBR(c.frete))
  if (c.descontoNota) await tot.nth(1).fill(toBR(c.descontoNota))
  await tot.nth(2).fill(obs)
  await print(page, `${c.id}-formulario`)
  await page.getByRole('button', { name: 'Lançar compra no estoque' }).click()
  let toast = ''
  try {
    await page.locator('[data-sonner-toast]').first().waitFor({ timeout: 30000 })
    toast = (await page.locator('[data-sonner-toast]').first().innerText()).replace(/\s+/g, ' ')
  } catch { /* segue: a navegação decide */ }
  await page.waitForURL((u) => !u.pathname.endsWith('/nova'), { timeout: 30000 }).catch(() => {})
  return { toast, erro: page.url().endsWith('/nova') ? `a tela ficou em /nova (${toast || 'sem aviso'})` : null }
}

async function lancarXml(page: Page, c: Cenario, xml: string): Promise<{ toast: string; erro: string | null }> {
  await page.goto(`${ORIGEM}/nota-fiscal/importar`, { waitUntil: 'domcontentloaded', timeout: 90000 })
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {})
  await page.waitForTimeout(1500) // hidratação da página antes de enviar o arquivo
  await page.locator('input[type=file]').setInputFiles({ name: `nfe-${c.numero}.xml`, mimeType: 'text/xml', buffer: Buffer.from(xml, 'utf8') })
  const sec = page.locator('section[aria-label="Itens da nota"]')
  const toastPrevia = page.locator('[data-sonner-toast]').first()
  const quem = await Promise.race([sec.waitFor({ timeout: 60000 }).then(() => 'itens' as const, () => 'nada' as const), toastPrevia.waitFor({ timeout: 60000 }).then(() => 'aviso' as const, () => 'nada' as const)])
  if (quem === 'nada') { const pe = await print(page, `${c.id}-previa-sem-resposta`); return { toast: '', erro: `a prévia do XML não apareceu em 60 s (print ${pe})` } }
  if (quem === 'aviso' && !(await sec.count())) return { toast: (await toastPrevia.innerText()).replace(/\s+/g, ' '), erro: 'a prévia do XML não abriu (a tela recusou a nota)' }
  const itens = sec.locator('ul > li')
  for (const [i, it] of c.itens.entries()) {
    const li = itens.nth(i)
    await escolherProduto(li, page, it.codigo)
    const fator = li.locator('input[inputmode=decimal]')
    await fator.waitFor({ timeout: 15000 })
    await fator.fill(toBR(it.fator))
    await li.locator('select').selectOption({ label: c.local }) // "Local deste item": como a pessoa, escolhe o local da nota
  }
  await page.locator('section[aria-label="Lançamento"] select').selectOption({ label: c.local })
  await print(page, `${c.id}-previa-xml`)
  await page.getByRole('button', { name: /^Lançar \d+ iten/ }).click()
  let toast = ''
  try {
    await page.locator('[data-sonner-toast]').first().waitFor({ timeout: 45000 })
    toast = (await page.locator('[data-sonner-toast]').first().innerText()).replace(/\s+/g, ' ')
  } catch { /* segue */ }
  await page.waitForURL((u) => !u.pathname.endsWith('/importar'), { timeout: 30000 }).catch(() => {})
  return { toast, erro: page.url().endsWith('/importar') ? `a tela ficou em /importar (${toast || 'sem aviso'})` : null }
}

// ---- Leitura da tela do produto ----
const numeroBR = (t: string) => fmtDec(parseDec(t.replace(/\./g, '').replace(',', '.')))
const centDe = (t: string): bigint | null => { const m = t.replace(/ /g, ' ').match(/(-)?\s*R\$\s*(-)?\s*([\d.]+),(\d{2})/); return m ? BigInt((m[1] || m[2] ? '-' : '') + m[3].replace(/\./g, '') + m[4]) : null }
/** "R$ 0,0481" -> { valor: '0.0481', casas: 4 } (a tela mostra mais casas em custo pequeno). */
const moedaCasas = (t: string | null): { valor: string; casas: number } | null => {
  const m = (t ?? '').replace(/ /g, ' ').match(/(-)?\s*R\$\s*(-)?\s*([\d.]+),(\d+)/)
  return m ? { valor: `${m[1] || m[2] ? '-' : ''}${m[3].replace(/\./g, '')}.${m[4]}`, casas: m[4].length } : null
}
type Moeda = { valor: string; casas: number } | null
type TelaProduto = { saldoTotal: string | null; custoMedio: Moeda; valorCent: bigint | null; locais: Map<string, string>; entradas: { origem: string; quantidade: string; custo: Moeda; cmc: Moeda }[] }
function lerProduto(texto: string): TelaProduto {
  const L = texto.replace(/ /g, ' ').split('\n').map((l) => l.trim()).filter(Boolean)
  const antes = (rot: string) => { const i = L.findIndex((l) => l === rot); return i > 0 ? L[i - 1] : null }
  const st = antes('Saldo total')
  const locais = new Map<string, string>()
  const i0 = L.indexOf('Saldo por local'), i1 = L.findIndex((l, i) => i > i0 && l === 'Custo do produto')
  if (i0 >= 0) for (let i = i0 + 1; i < (i1 > 0 ? i1 : L.length); i++) {
    const m = L[i].match(/^(-?[\d.]+(?:,\d+)?)\s+\S+$/)
    if (m && i >= 2) locais.set(L[i - 2], numeroBR(m[1]))
  }
  const entradas: TelaProduto['entradas'] = []
  for (const linha of texto.split('\n')) {
    const cel = linha.split('\t').map((s) => s.trim())
    if (cel.length >= 6 && /^COMPRA\b/.test(cel[2])) {
      const qm = cel[3].match(/^\+?(-?[\d.]+(?:,\d+)?)/)
      entradas.push({ origem: cel[2], quantidade: qm ? numeroBR(qm[1]) : cel[3], custo: moedaCasas(cel[4]), cmc: moedaCasas(cel[5]) })
    }
  }
  const sm = st?.match(/^(-?[\d.]+(?:,\d+)?)\s+\S+$/)
  return { saldoTotal: sm ? numeroBR(sm[1]) : null, custoMedio: moedaCasas(antes('Custo médio')), valorCent: antes('Valor em estoque') ? centDe(antes('Valor em estoque')!) : null, locais, entradas }
}

type EstadoBanco = { saldoTotal: string; cmc: string; ultimoCusto: string; locais: Map<number, string> }
async function estadoBanco(loja: number, produto: string): Promise<EstadoBanco> {
  const c = (await q('select saldo_total::text s, cmc::text m, coalesce(ultimo_custo,0)::text u from estoque_custos where loja_id=$1 and codigo_produto=$2', [loja, produto]))[0]
  const locais = new Map<number, string>()
  for (const r of await q('select codigo_local_estoque::text l, saldo::text s from estoque_saldos where loja_id=$1 and codigo_produto=$2', [loja, produto])) locais.set(Number(r.l), fmtDec(parseDec(r.s)))
  return { saldoTotal: fmtDec(parseDec(c?.s ?? '0')), cmc: fmtDec(parseDec(c?.m ?? '0')), ultimoCusto: fmtDec(parseDec(c?.u ?? '0')), locais }
}

async function titulosDoBanco(loja: number, numero: string) {
  return (await q('select parcela::text p, total_parcelas::text t, data_vencimento::text v, valor::text x, status, origem_tipo from fin_titulos_pagar where loja_id=$1 and documento=$2 order by parcela, id', [loja, `NF ${numero}`]))
}

// ---- Execução de um cenário de estoque próprio ----
async function executarCenario(browser: Awaited<ReturnType<typeof chromium.launch>>, c: Cenario) {
  const nome = c.nome
  const ctx = await novoContexto(browser)
  const page = await ctx.newPage()
  page.setDefaultTimeout(30000)
  await entrar(page, c.loja)
  const produtos = new Map<string, { id: string; descricao: string; unidade: string }>()
  for (const it of c.itens) {
    const p = (await q('select codigo_produto::text id, descricao, unidade from produtos where loja_id=$1 and codigo=$2', [c.loja, it.codigo]))[0]
    if (!p) throw new Error(`produto ${it.codigo} não existe na loja ${c.loja}`)
    produtos.set(it.codigo, p)
  }
  const local = (await q('select codigo_local_estoque::text l from local_estoques where loja_id=$1 and descricao=$2 and deleted_at is null', [c.loja, c.local]))[0]?.l
  const antes = new Map<string, EstadoBanco>()
  for (const [cod, p] of produtos) antes.set(cod, await estadoBanco(c.loja, p.id))
  const comprasAntes = Number((await q('select count(*)::text n from compras_proprio where loja_id=$1', [c.loja]))[0].n)

  // 1) lançar pela tela
  const obs = `ROBO-ENTRADA ${ID_RODADA} ${c.id}`
  let res: { toast: string; erro: string | null }
  let xml: ReturnType<typeof montarXmlAssinado> | null = null
  const duplicatas = (c.duplicatasDias ?? []).map((d, i, arr) => ({ nDup: String(i + 1).padStart(3, '0'), vencimento: somaDias(hoje, d), valor: '' + i + arr.length }))
  if (c.via === 'manual') res = await lancarManual(page, c, obs)
  else {
    const cnpjLoja = ((await q('select cnpj from lojas where id=$1', [c.loja]))[0].cnpj as string).replace(/\D/g, '')
    const liquidoTotal = c.itens.reduce((a, i) => a + parseDec(i.quantidade) * parseDec(i.valorUnitario) / 10n ** 9n - parseDec(i.desconto ?? '0'), 0n)
    // duas duplicatas: metade (arredondada para baixo em centavos) e o resto
    const totalCent = Number(liquidoTotal / 10n ** 7n)
    const dups = duplicatas.map((d, i) => ({ ...d, valor: i < duplicatas.length - 1 ? (Math.floor(totalCent / duplicatas.length) / 100).toFixed(2) : ((totalCent - Math.floor(totalCent / duplicatas.length) * (duplicatas.length - 1)) / 100).toFixed(2) }))
    duplicatas.splice(0, duplicatas.length, ...dups)
    xml = montarXmlAssinado({
      numero: c.numero, emissao: hoje, emitenteCnpj: FORNECEDOR.cnpj, emitenteNome: FORNECEDOR.nome, destinatarioCnpj: cnpjLoja, destinatarioNome: nome,
      itens: c.itens.map((i) => ({ cProd: `RB${i.codigo}`, descricao: produtos.get(i.codigo)!.descricao, unidade: i.unidadeNota, quantidade: i.quantidade, valorUnitario: i.valorUnitario, desconto: i.desconto })),
      duplicatas: dups,
    })
    res = await lancarXml(page, c, xml.xml)
  }
  const pLanc = await print(page, `${c.id}-depois-de-lancar`)
  provas.push(`${c.id}: aviso da tela = "${res.toast}"`)
  if (res.erro) { falha(nome, c.via === 'manual' ? '/nota-fiscal/nova' : '/nota-fiscal/importar', `lançar a nota ${c.numero} pela tela`, 'nota lançada no estoque', res.erro, pLanc, 'tela-quebrada'); await ctx.close(); return }

  // 2) a compra no banco (documento criado pela tela)
  const compra = (await q('select id::text, status, nota_fiscal_id::text nota, valor_total::text vt, chave_acesso, estornos::text from compras_proprio where loja_id=$1 and numero=$2 order by id desc limit 1', [c.loja, c.numero]))[0]
  const novas = Number((await q('select count(*)::text n from compras_proprio where loja_id=$1', [c.loja]))[0].n) - comprasAntes
  conferir(nome, c.via === 'manual' ? '/nota-fiscal/nova' : '/nota-fiscal/importar', `uma compra nova criada para a nota ${c.numero}`, '1', String(novas), pLanc)
  if (!compra) { falha(nome, '/nota-fiscal', `achar a compra ${c.numero} no banco`, 'compra criada', 'nenhuma compra', pLanc, 'tela-quebrada'); await ctx.close(); return }
  conferir(nome, '/nota-fiscal', `situação da compra ${c.numero}`, 'lancada', compra.status, pLanc)

  // 3) gabarito
  const itensNota: ItemNota[] = c.itens.map((i) => ({ quantidade: i.quantidade, valorUnitario: i.valorUnitario, fator: i.fator, desconto: i.desconto }))
  const rateio = { frete: c.frete ?? '0', descontoNota: c.descontoNota ?? '0' }
  const totalNota = fmtDec(itensNota.reduce((a, i) => a + parseDec(fmtDec(BigInt(Math.round(Number(i.quantidade) * Number(i.valorUnitario) * 100)) * 10n ** 7n)) - parseDec(i.desconto ?? '0'), 0n) + parseDec(rateio.frete) - parseDec(rateio.descontoNota))
  const esperado = new Map<string, { custo: string; qtdBase: string; estado: { saldo: string; cmc: string }; saldoLocal: string }>()
  for (const [k, it] of c.itens.entries()) {
    const ab = antes.get(it.codigo)!
    const custo = custoUnitarioBase(itensNota[k], itensNota, rateio)!
    const qb = quantidadeBase(itensNota[k])
    const estado = novoEstado({ saldo: ab.saldoTotal, cmc: ab.cmc }, qb, custo)
    const saldoLocal = fmtDec(parseDec(ab.locais.get(Number(local)) ?? '0') + parseDec(qb))
    esperado.set(it.codigo, { custo, qtdBase: qb, estado, saldoLocal })
  }

  // 4) banco x gabarito (a prova do cálculo) e tela x gabarito (a prova do que a pessoa vê)
  for (const [k, it] of c.itens.entries()) {
    const p = produtos.get(it.codigo)!
    const e = esperado.get(it.codigo)!
    const rotulo = `${it.codigo} ${p.descricao}`
    const dep = await estadoBanco(c.loja, p.id)
    const tp = '/estoque/produto'
    conferir(nome, tp, `saldo total no banco, item ${rotulo} (${it.quantidade} ${it.unidadeNota} x ${it.fator})`, e.estado.saldo, dep.saldoTotal, pLanc, 'saldo-divergente')
    conferir(nome, tp, `saldo no local ${c.local} no banco, item ${rotulo}`, e.saldoLocal, dep.locais.get(Number(local)) ?? '0', pLanc, 'saldo-divergente')
    conferir(nome, tp, `custo médio no banco, item ${rotulo}`, e.estado.cmc, dep.cmc, pLanc)
    const itemDb = (await q('select custo_unitario_base::text c, lancado from compras_proprio_itens where compra_id=$1 and codigo_produto=$2', [compra.id, p.id]))[0]
    conferir(nome, tp, `custo da entrada (por ${p.unidade}) gravado na compra, item ${rotulo}`, e.custo, itemDb ? fmtDec(parseDec(itemDb.c ?? '0')) : 'sem item', pLanc)
    const mv = (await q("select quantidade::text q, custo_unitario::text c, cmc_apos::text m from estoque_movimentos where loja_id=$1 and codigo_produto=$2 and origem='COMPRA' and ref like $3 and linha=$4 and reverses_id is null order by id desc limit 1", [c.loja, p.id, `%${compra.chave_acesso ?? `compra:${compra.id}`}%`, k + 1]))[0]
    conferir(nome, tp, `quantidade do movimento de entrada no ledger, item ${rotulo}`, e.qtdBase, mv ? fmtDec(parseDec(mv.q)) : 'sem movimento', pLanc, 'saldo-divergente')
    conferir(nome, tp, `custo médio depois do movimento de entrada, item ${rotulo}`, e.estado.cmc, mv ? fmtDec(parseDec(mv.m)) : 'sem movimento', pLanc)

    // tela do produto
    const t = await abrir(page, `/estoque/produto/${p.id}`)
    const pp = await print(page, `${c.id}-produto-${it.codigo}`)
    const tela = lerProduto(t.texto)
    conferir(nome, tp, `saldo total mostrado (a tela mostra até 3 casas), item ${rotulo}`, arredondarTexto(e.estado.saldo, 3), tela.saldoTotal === null ? 'não achei' : arredondarTexto(tela.saldoTotal, 3), pp, 'saldo-divergente')
    conferir(nome, tp, `saldo mostrado no local ${c.local} (até 3 casas), item ${rotulo}`, arredondarTexto(e.saldoLocal, 3), tela.locais.has(c.local) ? arredondarTexto(tela.locais.get(c.local)!, 3) : 'não achei', pp, 'saldo-divergente')
    const cm = tela.custoMedio
    conferir(nome, tp, `custo médio mostrado (arredondado nas casas que a tela mostra), item ${rotulo}`, cm ? `R$ ${arredondarTexto(e.estado.cmc, cm.casas)}` : 'esperado', cm ? `R$ ${arredondarTexto(cm.valor, cm.casas)}` : 'não achei', pp)
    const vEsp = valorEmEstoqueCent(e.estado.saldo, e.estado.cmc)
    const dentro = tela.valorCent !== null && (tela.valorCent - vEsp <= 1n && vEsp - tela.valorCent <= 1n)
    conferir(nome, tp, `valor em estoque mostrado (saldo x custo médio, tolerância de 1 centavo), item ${rotulo}`, brl(vEsp), tela.valorCent === null ? 'não achei' : dentro ? brl(vEsp) : brl(tela.valorCent), pp)
    const ref = compra.chave_acesso ?? `compra:${compra.id}`
    const linha = tela.entradas.find((x) => x.origem.includes(ref))
    conferir(nome, tp, `linha "Entradas que formaram o custo atual" (quantidade, até 3 casas), item ${rotulo}`, arredondarTexto(e.qtdBase, 3), linha ? arredondarTexto(linha.quantidade, 3) : 'linha ausente na tela', pp)
    if (linha?.custo) conferir(nome, tp, `linha "Entradas..." (custo unitário, nas casas mostradas), item ${rotulo}`, `R$ ${arredondarTexto(e.custo, linha.custo.casas)}`, `R$ ${arredondarTexto(linha.custo.valor, linha.custo.casas)}`, pp)
    if (linha?.cmc) conferir(nome, tp, `linha "Entradas..." (custo médio depois, nas casas mostradas), item ${rotulo}`, `R$ ${arredondarTexto(e.estado.cmc, linha.cmc.casas)}`, `R$ ${arredondarTexto(linha.cmc.valor, linha.cmc.casas)}`, pp)
  }

  // 5) a nota aparece em Notas Fiscais com o valor certo
  const lista = await abrir(page, '/nota-fiscal?status=TODAS')
  const pn = await print(page, `${c.id}-lista-notas`)
  const totalCent = BigInt(Math.trunc(Number((parseDec(totalNota) + 5n * 10n ** 6n) / 10n ** 7n)))
  const bloco = lista.texto.split('\n').map((s) => s.trim()).filter(Boolean)
  const iNota = bloco.findIndex((l) => l === `NF ${c.numero}` || l.startsWith(`NF ${c.numero}/`))
  const valorNaLista = iNota >= 0 ? bloco.slice(iNota, iNota + 6).map(centDe).find((x) => x !== null) ?? null : null
  conferir(nome, '/nota-fiscal', `valor da nota ${c.numero} na lista de Notas Fiscais`, brl(totalCent), valorNaLista === null ? (iNota < 0 ? 'nota não aparece na lista' : 'valor não achado') : brl(valorNaLista), pn)

  // 6) título a pagar
  const esperados = titulosEsperados({ ligado: c.ligado, entradaLancada: compra.status === 'lancada', total: totalNota, emissao: hoje, duplicatas: duplicatas.map((d) => ({ vencimento: d.vencimento, valor: d.valor })) })
  const dbT = (await titulosDoBanco(c.loja, c.numero)).filter((t) => t.status !== 'cancelado')
  const fmtEsp = esperados.map((t) => `${t.parcela}/${t.totalParcelas} ${t.vencimento} R$ ${t.valor}`).join('; ') || 'nenhum título'
  const fmtDb = dbT.map((t) => `${t.p}/${t.t} ${t.v} R$ ${fmtDec(parseDec(t.x))}`).join('; ') || 'nenhum título'
  conferir(nome, '/financeiro/contas-pagar', `títulos a pagar gerados pela nota ${c.numero} (banco)`, fmtEsp, fmtDb, pn)
  const cp = await abrir(page, '/financeiro/contas-pagar')
  const pc = await print(page, `${c.id}-contas-pagar`)
  if (!c.ligado) {
    const aberta = cp.status < 400 && !ehPaginaNaoEncontrada(cp.texto) && !cp.noindex
    conferir(nome, '/financeiro/contas-pagar', `tela de contas a pagar não mostra título da nota ${c.numero}`, 'nenhum', cp.texto.includes(`NF ${c.numero}`) ? 'aparece' : 'nenhum', pc)
    achados.push(`${nome}: a nota ${c.numero} foi lançada e NÃO gerou título a pagar porque a chave lojas.fin_cp_da_nota_ativo está desligada nesta loja (migration 340: só a loja 19 fica ligada até o dono liberar). O gabarito espera zero títulos, e é isso que o ERP fez; o ticket pede título conferido, então a prova de título a pagar só existe na loja 19. Tela de contas a pagar ${aberta ? 'abre' : 'não abre (bloqueada)'} para o dono.`)
  } else {
    const linhasTela = (await page.evaluate(() => [...document.querySelectorAll('main tbody tr')].map((r) => (r as HTMLElement).innerText.replace(/\s+/g, ' ')))).map((l) => l.replace(/\u00a0/g, ' ')).filter((l) => l.includes(`doc NF ${c.numero} `) || l.includes(`doc NF ${c.numero}·`))
    for (const t of esperados) {
      const valorTxt = `R$ ${Number(t.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      const achou = linhasTela.some((l) => l.includes(valorTxt) && l.includes(dataBR(t.vencimento)))
      conferir(nome, '/financeiro/contas-pagar', `título ${t.parcela}/${t.totalParcelas} da nota ${c.numero} na tela (${valorTxt}, vence ${dataBR(t.vencimento)})`, 'aparece', achou ? 'aparece' : `não aparece (linhas da nota na tela: ${linhasTela.length})`, pc)
    }
    const qtdTela = (cp.texto.match(/Títulos no filtro\s+(\d+)/) ?? [])[1]
    conferir(nome, '/financeiro/contas-pagar', 'cartão "Títulos no filtro" depois da nota (todos os títulos da loja)', String(Number((await q("select count(*)::text n from fin_titulos_pagar where loja_id=$1 and status<>'cancelado'", [c.loja]))[0].n)), qtdTela ?? 'não achei', pc)
  }
  void xml
  await ctx.close()
}

// ---- Modo Omie (Sertão, loja 4): a tela não lança nota; conferir que o ERP trata a tentativa de forma coerente ----
async function executarOmie(browser: Awaited<ReturnType<typeof chromium.launch>>) {
  const nome = 'Sertão'
  const antes = await lojaExtra(4)
  const ctx = await novoContexto(browser)
  const page = await ctx.newPage()
  page.setDefaultTimeout(30000)
  const reqs: { url: string; status: number; corpo: string }[] = []
  page.on('response', async (r) => { if (/\/api\/sync\//.test(r.url())) reqs.push({ url: r.url().replace(ORIGEM, ''), status: r.status(), corpo: (await r.text().catch(() => '')).slice(0, 400) }) })
  await entrar(page, 4)
  const lista = await abrir(page, '/nota-fiscal')
  const p0 = await print(page, '4-omie-notas')
  conferir(nome, '/nota-fiscal', 'botão "Lançar sem XML" não existe em loja com Omie', 'ausente', /Lançar sem XML/.test(lista.texto) ? 'presente' : 'ausente', p0)
  conferir(nome, '/nota-fiscal', 'botão "Importar XML" não existe em loja com Omie', 'ausente', /Importar XML/.test(lista.texto) ? 'presente' : 'ausente', p0)
  for (const rota of ['/nota-fiscal/nova', '/nota-fiscal/importar']) {
    const r = await abrir(page, rota)
    const bloqueada = r.noindex || ehPaginaNaoEncontrada(r.texto) || r.status >= 400
    const pr = await print(page, `4-omie-${rota.split('/').pop()}`)
    conferir(nome, rota, `endereço digitado à mão é bloqueado (a nota só entra pelo Omie nesta loja)`, 'bloqueado', bloqueada ? 'bloqueado' : 'abriu', pr, 'furo-endereco')
  }
  // Tentativa que fala com o Omie: o botão "Atualizar agora" (lê notas no Omie). A trava do ambiente tem de segurar.
  await abrir(page, '/nota-fiscal')
  const botao = page.getByRole('button', { name: 'Atualizar agora' })
  if (!(await botao.count())) {
    falha(nome, '/nota-fiscal', 'achar o botão "Atualizar agora"', 'botão presente', 'ausente', p0, 'tela-quebrada')
  } else {
    await botao.click()
    await page.locator('[data-sonner-toast]').first().waitFor({ timeout: 15000 }).catch(() => {})
    await page.waitForTimeout(1500)
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {})
    const aviso = (await page.locator('[data-sonner-toast]').allInnerTexts().catch(() => [])).join(' | ').replace(/\s+/g, ' ')
    const pb = await print(page, '4-omie-atualizar-agora')
    const overlay = await page.evaluate(() => { const t = (document.querySelector('nextjs-portal') as (Element & { shadowRoot: ShadowRoot | null }) | null)?.shadowRoot?.textContent ?? ''; return /Runtime|Build Error|Unhandled|Application error/i.test(t) ? t.replace(/\s+/g, ' ').slice(0, 200) : '' })
    provas.push(`4-omie: "Atualizar agora" -> requisições ${JSON.stringify(reqs)}; aviso na tela = "${aviso}"`)
    conferir(nome, '/nota-fiscal', 'o clique em "Atualizar agora" sem Omie não derruba a tela (sem overlay de erro)', 'sem erro de tela', overlay || 'sem erro de tela', pb, 'tela-quebrada')
    conferir(nome, '/nota-fiscal', 'o ERP respondeu à tentativa (houve chamada /api/sync/notas-fiscais)', 'sim', reqs.length ? 'sim' : 'nenhuma chamada vista', pb, 'tela-quebrada')
    const msgs = reqs.map((r) => r.corpo + ' ' + aviso).join(' ')
    const trataComoBloqueio = /bloqueado|não foi enviada|erro|falh|n[ãa]o foi poss/i.test(msgs)
    conferir(nome, '/nota-fiscal', 'a tela avisa que a atualização não aconteceu (mensagem de erro/bloqueio, não "sucesso")', 'aviso de erro', trataComoBloqueio ? 'aviso de erro' : `sem aviso claro (HTTP ${reqs.map((r) => r.status).join(',') || '-'}; tela: "${aviso}")`, pb, 'tela-quebrada')
  }
  await ctx.close()
  const depois = await lojaExtra(4)
  for (const k of Object.keys(antes) as (keyof typeof antes)[]) conferir(nome, 'banco da loja 4', `nada mudou em ${k} depois de tentar entrar nota (modo Omie)`, antes[k], depois[k], 'prints/(sem print)')
  const omie = externos.filter((e) => /omie/i.test(e))
  conferir(nome, 'navegador', 'nenhuma requisição do navegador para o Omie', '0', String(omie.length), 'prints/(sem print)')
  provas.push(`4-omie: requisições externas bloqueadas no navegador: ${externos.length} (para o Omie: ${omie.length})`)
}

// ---- Execução ----
const t0 = Date.now()
const fotoAntes = await foto()
const extraAntes = Object.fromEntries(await Promise.all([4, 15, 19].map(async (l) => [l, await lojaExtra(l)])))
fs.writeFileSync(path.join(SAIDA, 'foto-antes.json'), JSON.stringify({ fotoAntes, extraAntes }, null, 1))
console.log(`foto do estado inicial guardada (${Object.keys(fotoAntes).length} itens)`)

const browser = await chromium.launch()
for (const c of cenariosRodar) {
  console.log(`cenário ${c.id}: ${c.nota}`)
  try { await executarCenario(browser, c) } catch (e) { falha(c.nome, '(robô)', `cenário ${c.id}`, 'executar sem erro', String(e instanceof Error ? e.message : e).slice(0, 300), 'prints/(sem print)', 'tela-quebrada') }
}
if (rodarOmie) {
  console.log('cenário 4-omie: Sertão (modo Omie)')
  try { await executarOmie(browser) } catch (e) { falha('Sertão', '(robô)', 'cenário 4-omie', 'executar sem erro', String(e instanceof Error ? e.message : e).slice(0, 300), 'prints/(sem print)', 'tela-quebrada') }
}
await browser.close()
const fotoDepoisTeste = await foto()
const mudou = Object.keys(fotoDepoisTeste).filter((k) => fotoDepoisTeste[k] !== fotoAntes[k])
console.log(`o teste gravou na cópia (tabelas diferentes da foto inicial): ${mudou.join(', ') || 'nada'}`)
await db.end()

// ---- Voltar ao estado inicial e provar ----
let resetProvado: boolean | null = null
let detalheReset = ''
if (process.env.ROBO_SEM_RESET === '1') {
  detalheReset = 'ROBO_SEM_RESET=1: a cópia NÃO foi resetada nesta rodada (prova de volta ao estado inicial pendente)'
} else {
  console.log('voltando a cópia ao estado inicial: scripts/local/local.sh resetar (2 a 3 min)...')
  const r = spawnSync('bash', [path.join(RAIZ, 'scripts', 'local', 'local.sh'), 'resetar'], { cwd: RAIZ, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  fs.writeFileSync(path.join(SAIDA, 'resetar.log'), `${r.stdout}\n${r.stderr}`)
  if (r.status !== 0) { resetProvado = false; detalheReset = `resetar falhou (código ${r.status}); veja resetar.log` }
  else {
    let ok = false
    for (let i = 0; i < 60 && !ok; i++) {
      try { db = await abrirBanco(); await q('select 1'); ok = true } catch { await new Promise((s) => setTimeout(s, 3000)) }
    }
    if (!ok) { resetProvado = false; detalheReset = 'banco não voltou depois do resetar' }
    else {
      const depois = await foto()
      const extraDepois = Object.fromEntries(await Promise.all([4, 15, 19].map(async (l) => [l, await lojaExtra(l)])))
      const dif = Object.keys({ ...fotoAntes, ...depois }).filter((k) => fotoAntes[k] !== depois[k])
      const difLoja = [4, 15, 19].flatMap((l) => Object.keys(extraAntes[l]).filter((k) => (extraAntes[l] as Record<string, string>)[k] !== (extraDepois[l] as Record<string, string>)[k]).map((k) => `loja ${l} ${k}`))
      resetProvado = dif.length === 0 && difLoja.length === 0
      detalheReset = resetProvado
        ? `a cópia voltou ao estado inicial: ${Object.keys(depois).length} contagens/impressões digitais de tabelas e saldos e custos por loja iguais às de antes do teste (${mudou.length} tabelas tinham mudado durante o teste: ${mudou.join(', ') || 'nenhuma'})`
        : `DIFERENÇAS depois do resetar: ${[...dif, ...difLoja].join(', ')}`
      await db.end()
      logins = lerLogins()
    }
  }
}
console.log(detalheReset)

// ---- Saídas ----
const ordenadas = ordenarFalhas(falhas)
const md = formatarListaFalhas(ordenadas, { visitas: conferencias, telas: 6, logins: new Set([...cenariosRodar.map((c) => c.loja), ...(rodarOmie ? [4] : [])]).size })
fs.writeFileSync(path.join(SAIDA, 'falhas.md'), md)
const evid = [`# Evidências da rodada ${ID_RODADA}`, '', `Conferências feitas: ${conferencias}. Falhas: ${ordenadas.length}.`, '', '## Provas e avisos da tela', ...provas.map((p) => `- ${p}`), '', '## Achados que não são falha do robô', ...achados.map((a) => `- ${a}`), '',
  '## Volta ao estado inicial', detalheReset, '']
fs.writeFileSync(path.join(SAIDA, 'evidencias.md'), evid.join('\n'))
fs.writeFileSync(path.join(SAIDA, 'resumo.json'), JSON.stringify({ rodada: ID_RODADA, urlBase: ORIGEM, cenarios: [...cenariosRodar.map((c) => c.id), ...(rodarOmie ? ['4-omie'] : [])], conferencias, falhas: ordenadas.length, tabelasGravadasPeloTeste: mudou, resetProvado, detalheReset, externosBloqueados: externos.length, sha256FalhasMd: crypto.createHash('sha256').update(md).digest('hex'), segundos: Math.round((Date.now() - t0) / 1000) }, null, 1))
console.log(`conferências: ${conferencias} | falhas: ${ordenadas.length} | saída: ${SAIDA}`)
process.exit(resetProvado === false ? 1 : 0)
