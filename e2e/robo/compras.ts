// Robô das compras (ticket 07): pedido de compra de teste criado, enviado para aprovação, aprovado e recebido (com a nota) SÓ pela tela,
// como uma pessoa. Confere a etapa do pedido em cada passo, o estoque e o custo médio contra o gabarito independente
// (e2e/robo/pedido-gabarito.ts e custo-gabarito.ts), a regra "pedido recebido não se cancela" e que nada sai para fornecedor ou Omie.
// Escreve na cópia local; no fim roda local.sh resetar e prova a volta ao estado inicial. O banco é lido só em sessão read-only.
// Uso: npm run robo:compras   (saída em .local-data/robo-compras/<rodada>/, fora do git)
// Variáveis: ROBO_CENARIOS=19,15,4 (filtra), ROBO_SEM_RESET=1 (não reseta no fim; a prova de reset fica pendente).
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import pg from 'pg'
import { chromium, type Page, type BrowserContext } from 'playwright'
import { verificarTravaLocal } from './trava.ts'
import { PORTA_PG_LOCAL, ORIGEM_API_LOCAL } from './base.ts'
import { formatarListaFalhas, ordenarFalhas, ehPaginaNaoEncontrada, type Falha, type TipoFalha } from './relatorio.ts'
import { parseDec, fmtDec } from './saldo-gabarito.ts'
import { custoUnitarioBase, novoEstado, quantidadeBase, titulosEsperados, valorEmEstoqueCent, arredondarTexto, type ItemNota } from './custo-gabarito.ts'
import { totalPedido, proximaEtapa, recebimento, situacaoNaNota, type EtapaGravada, type NotaItemPedido } from './pedido-gabarito.ts'
import { montarXmlAssinado } from './entrada-xml.ts'

const RAIZ = path.resolve(import.meta.dirname, '..', '..')

function sair(msg: string): never {
  console.error(`ROBÔ RECUSOU RODAR: ${msg}`)
  process.exit(2)
}

// ---- Trava: só a cópia local, com a trava do Omie ligada ----
const trava = await verificarTravaLocal(RAIZ)
if (!trava.ok) sair(trava.motivo)
const ORIGEM = trava.origem
const envLocal = path.join(RAIZ, '.env.local')
const envTexto = trava.envTexto
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
const SAIDA = path.join(RAIZ, '.local-data', 'robo-compras', ID_RODADA)
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
  'fin_titulos_pagar', 'fin_eventos', 'fornecedores', 'fornecedor_produto_depara', 'sefaz_documentos', 'integration_attempts', 'movimentos', 'posicao_estoques', 'produtos', 'estoque_correcao_custo', 'estoque_mov_revisao',
  'pedidos_compra', 'pedidos_compra_itens', 'pedidos_compra_eventos', 'pedidos_compra_vinculos', 'pedidos_compra_omie', 'historico_alteracoes', 'audit_log']
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
    if (u.protocol === 'data:' || u.protocol === 'blob:' || u.origin === ORIGEM || u.origin === ORIGEM_API_LOCAL) return rota.continue()
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

async function lancarManual(page: Page, c: NotaCenario, obs: string): Promise<{ toast: string; erro: string | null }> {
  await page.goto(`${ORIGEM}/nota-fiscal/nova`, { waitUntil: 'domcontentloaded', timeout: 90000 })
  await page.getByText('Lançar compra sem XML').first().waitFor({ timeout: 30000 })
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {})
  const forn = page.locator('section[aria-label="Fornecedor"]')
  const ins = forn.locator('input')
  await ins.nth(0).fill(c.fornecedor.nome)
  await ins.nth(1).fill(c.fornecedor.cnpj)
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

async function lancarXml(page: Page, c: NotaCenario, xml: string): Promise<{ toast: string; erro: string | null }> {
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

// ---- Cenários ----
type ItemCenario = { codigo: string; unidadeNota: string; quantidade: string; valorUnitario: string; desconto?: string; fator: string }
type Fornecedor = { nome: string; cnpj: string }
type NotaCenario = { id: string; fornecedor: Fornecedor; loja: number; via: 'manual' | 'xml'; local: string; numero: string; itens: ItemCenario[]; frete?: string; descontoNota?: string; duplicatasDias?: number[]; ligado: boolean }
type ItemPedido = { codigo: string; unidade: string; fator: string; quantidade: string; preco: string }
type NotaDoPedido = { via: 'manual' | 'xml'; numero: string; itens: ItemCenario[]; frete?: string; duplicatasDias?: number[] }
type CenarioPedido = { id: string; loja: number; nome: string; fornecedorLike: string; local: string; ligado: boolean; parcelas: string; itens: ItemPedido[]; notas: NotaDoPedido[]; texto: string }
const CENARIOS: CenarioPedido[] = [
  { id: '19', loja: 19, nome: 'Loja 19', fornecedorLike: 'TERWAL%', local: 'Estoque Geral', ligado: true, parcelas: '30/60',
    itens: [
      { codigo: '80034', unidade: 'KG', fator: '1000', quantidade: '3', preco: '42' },
      { codigo: '80044', unidade: 'L', fator: '1000', quantidade: '2', preco: '9.50' },
    ],
    notas: [{ via: 'xml', numero: '8019', duplicatasDias: [30, 60], itens: [
      { codigo: '80034', unidadeNota: 'KG', quantidade: '3', valorUnitario: '42.00', fator: '1000' },
      { codigo: '80044', unidadeNota: 'L', quantidade: '2', valorUnitario: '9.50', fator: '1000' }] }],
    texto: 'Loja 19 (estoque próprio, chave do título ligada): pedido com conversão KG e L (fator 1000), recebido por inteiro numa nota XML com 2 duplicatas.' },
  { id: '15', loja: 15, nome: 'ODARA', fornecedorLike: 'VILLA PESCADOS%', local: 'Depósito', ligado: false, parcelas: '',
    itens: [
      { codigo: '60028', unidade: 'UN', fator: '1', quantidade: '24', preco: '7.95' },
      { codigo: '80056', unidade: 'ML', fator: '1', quantidade: '750', preco: '0.045' },
    ],
    notas: [
      { via: 'manual', numero: 'RC151', itens: [{ codigo: '60028', unidadeNota: 'UN', quantidade: '10', valorUnitario: '7.95', fator: '1' }] },
      { via: 'manual', numero: 'RC152', frete: '15.50', itens: [
        { codigo: '60028', unidadeNota: 'UN', quantidade: '14', valorUnitario: '7.95', fator: '1' },
        { codigo: '80056', unidadeNota: 'ML', quantidade: '750', valorUnitario: '0.045', fator: '1' }] }],
    texto: 'ODARA (estoque próprio, chave do título desligada): pedido recebido em duas notas digitadas (parcial, depois o resto, com frete na 2ª).' },
]
const filtro = (process.env.ROBO_CENARIOS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
const cenariosRodar = CENARIOS.filter((c) => !filtro.length || filtro.includes(c.id))
const rodarOmie = !filtro.length || filtro.includes('4')


// ---- Leituras da tela do pedido ----
const ROTULO_ETAPA: Record<string, string> = { rascunho: 'Rascunho', aguardando_aprovacao: 'Aguardando aprovação', aprovado: 'Aprovado', recebido_parcial: 'Recebido parcial', recebido: 'Recebido', cancelado: 'Cancelado' }
const TXT_SITUACAO = { ok: 'Quantidade certa', falta: 'Veio menos', excede: 'Veio mais', nao_veio: 'Não veio nesta nota' } as const
const RE_CANCELAR = /Cancelar pedido|Encerrar o que falta receber/
const norm = (t: string) => t.replace(/ /g, ' ').replace(/\s+/g, ' ').trim()
const numTela = (t: string) => numeroBR(norm(t).replace(/[^\d.,-]/g, ''))

type PedidoTela = { etapa: string; total: bigint | null; pct: string | null; pagamento: string | null; botoes: string[]; linhas: { codigo: string; qtd: string; recebido: string; falta: string; emNota: string }[]; texto: string }
async function lerPedidoTela(page: Page, id: number): Promise<PedidoTela> {
  const t = await abrir(page, `/pedido-compra/${id}`)
  const etapa = norm(await page.locator('main span.rounded-full.size-2').first().locator('xpath=..').innerText().catch(() => ''))
  const L = t.texto.replace(/ /g, ' ').split('\n').map((l) => l.trim()).filter(Boolean)
  const apos = (rot: string) => { const i = L.findIndex((l) => l === rot); return i >= 0 ? L.slice(i + 1, i + 4) : [] }
  const total = apos('Total do pedido').map(centDe).find((x) => x !== null) ?? null
  const pct = L.find((l) => /^\d+%$/.test(l)) ?? null
  const pagamento = apos('Pagamento')[0] ?? null
  const botoes = (await page.locator('main button').allInnerTexts()).map(norm).filter(Boolean)
  const rows: string[][] = await page.evaluate(() => [...document.querySelectorAll('main table tbody tr')].map((r) => [...(r as HTMLTableRowElement).cells].map((c) => (c as HTMLElement).innerText.replace(/\s+/g, ' ').trim())))
  const linhas = rows.filter((r) => r.length >= 9).map((r) => ({ codigo: (r[1].match(/\b(\d{4,6})\b/) ?? [])[1] ?? r[1], qtd: r[2], emNota: numTela(r[6]), recebido: numTela(r[7]), falta: numTela(r[8]) }))
  return { etapa, total, pct, pagamento, botoes, linhas, texto: t.texto }
}

async function cliqueAcao(page: Page, nome: string | RegExp) {
  await page.getByRole('button', { name: nome }).first().click()
}
async function esperarEtapa(page: Page, rotulo: string) {
  for (let i = 0; i < 40; i++) {
    const e = norm(await page.locator('main span.rounded-full.size-2').first().locator('xpath=..').innerText().catch(() => ''))
    if (e === rotulo) return true
    await page.waitForTimeout(500)
  }
  return false
}

async function escolherProdutoLinha(linha: ReturnType<Page['locator']>, codigo: string) {
  const campo = linha.getByPlaceholder('Buscar produto por nome ou código')
  const opcao = linha.locator('button', { hasText: new RegExp(`${codigo}\\s*·`) }).first()
  for (let t = 0; t < 4; t++) {
    await campo.fill('')
    await campo.pressSequentially(codigo, { delay: 40 })
    if (await opcao.waitFor({ timeout: 6000 }).then(() => true, () => false)) break
  }
  await opcao.waitFor({ timeout: 10000 })
  await opcao.click()
}

async function criarPedidoPelaTela(page: Page, c: CenarioPedido, forn: { id: string }, previsao: string, obs: string): Promise<number> {
  await page.goto(`${ORIGEM}/pedido-compra/novo`, { waitUntil: 'domcontentloaded', timeout: 90000 })
  await page.getByText('Novo pedido de compra').first().waitFor({ timeout: 30000 })
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {})
  await page.waitForTimeout(1500)
  await page.locator('#pc-f').selectOption({ value: forn.id })
  await page.locator('#pc-p').fill(previsao)
  if (c.parcelas) await page.locator('#pc-cond').fill(c.parcelas)
  await page.locator('#pc-obs').fill(obs)
  const linhas = page.locator('section:has(h2:text-is("Itens")) > div.border-t')
  for (const [i, it] of c.itens.entries()) {
    if (i > 0) await page.getByRole('button', { name: 'Item', exact: true }).click()
    const li = linhas.nth(i)
    await escolherProdutoLinha(li, it.codigo)
    await li.locator('input[id^="u-"]').fill(it.unidade)
    await li.locator('input[id^="f-"]').fill(toBR(it.fator))
    await li.locator('input[id^="q-"]').fill(toBR(it.quantidade))
    await li.locator('input[id^="p-"]').fill(toBR(it.preco))
  }
  await print(page, `${c.id}-pedido-formulario`)
  await page.getByRole('button', { name: 'Criar rascunho' }).click()
  await page.waitForURL(/\/pedido-compra\/\d+$/, { timeout: 30000 })
  return Number(page.url().split('/').pop())
}

type EstadoProd = { saldo: string; cmc: string; saldoLocal: string }

async function pedidoNoBanco(id: number) {
  const cab = (await q('select id::text, numero::text n, etapa, fornecedor_cnpj, frete::text fr, outras_despesas::text od, cancelado_em::text cancelado_em from pedidos_compra where id=$1', [id]))[0]
  const its = await q('select linha::text l, codigo_produto::text p, unidade, fator::text f, quantidade::text q, preco_unitario::text pr, quantidade_base::text qb, recebido::text rc, vinculado::text vc from pedidos_compra_itens_situacao where pedido_id=$1 order by linha', [id])
  const evs = (await q('select tipo from pedidos_compra_eventos where pedido_id=$1 order by id', [id])).map((e) => e.tipo)
  return { cab, its, evs }
}

async function executarPedido(browser: Awaited<ReturnType<typeof chromium.launch>>, c: CenarioPedido) {
  const nome = c.nome
  const ctx = await novoContexto(browser)
  const page = await ctx.newPage()
  page.setDefaultTimeout(30000)
  await entrar(page, c.loja)
  const forn = (await q<{ id: string; razao_social: string; cnpj: string }>('select id::text, razao_social, regexp_replace(cnpj_cpf, \'\\D\', \'\', \'g\') cnpj from fornecedores where loja_id=$1 and razao_social ilike $2 order by id limit 1', [c.loja, c.fornecedorLike]))[0]
  if (!forn) throw new Error(`fornecedor ${c.fornecedorLike} não existe na loja ${c.loja}`)
  const fornecedor: Fornecedor = { nome: forn.razao_social, cnpj: forn.cnpj }
  const produtos = new Map<string, { id: string; descricao: string; unidade: string }>()
  for (const it of c.itens) {
    const p = (await q<{ id: string; descricao: string; unidade: string }>('select codigo_produto::text id, descricao, unidade from produtos where loja_id=$1 and codigo=$2', [c.loja, it.codigo]))[0]
    if (!p) throw new Error(`produto ${it.codigo} não existe na loja ${c.loja}`)
    produtos.set(it.codigo, p)
  }
  const local = (await q('select codigo_local_estoque::text l from local_estoques where loja_id=$1 and descricao=$2 and deleted_at is null', [c.loja, c.local]))[0]?.l
  const estado = new Map<string, EstadoProd>()
  for (const [cod, p] of produtos) {
    const e = await estadoBanco(c.loja, p.id)
    estado.set(cod, { saldo: e.saldoTotal, cmc: e.cmc, saldoLocal: e.locais.get(Number(local)) ?? '0' })
  }
  const pedidosAntes = Number((await q('select count(*)::text n from pedidos_compra where loja_id=$1', [c.loja]))[0].n)

  // ---- 1) criar o pedido pela tela ----
  const previsao = somaDias(hoje, 7)
  const obs = `ROBO-COMPRAS ${ID_RODADA} ${c.id}`
  const id = await criarPedidoPelaTela(page, c, forn, previsao, obs)
  const T = `/pedido-compra/${id}`
  const itensGab = c.itens.map((i) => ({ quantidade: i.quantidade, preco: i.preco }))
  const totalEsp = totalPedido(itensGab, '0', '0')
  let etapaGrav: EtapaGravada = 'rascunho'
  let pg = await print(page, `${c.id}-pedido-rascunho`)
  let ped = await pedidoNoBanco(id)
  conferir(nome, '/pedido-compra', 'um pedido novo criado pela tela', '1', String(Number((await q('select count(*)::text n from pedidos_compra where loja_id=$1', [c.loja]))[0].n) - pedidosAntes), pg)
  conferir(nome, T, 'etapa gravada do pedido novo (banco)', etapaGrav, ped.cab.etapa, pg)
  conferir(nome, T, 'quantidade de itens do pedido (banco)', String(c.itens.length), String(ped.its.length), pg)
  for (const [k, it] of c.itens.entries()) {
    const p = produtos.get(it.codigo)!
    const r = ped.its[k]
    conferir(nome, T, `item ${it.codigo}: produto, unidade, fator, quantidade e preço gravados`, `${p.id}|${it.unidade}|${fmtDec(parseDec(it.fator))}|${fmtDec(parseDec(it.quantidade))}|${fmtDec(parseDec(it.preco))}`,
      `${r?.p}|${r?.unidade}|${r ? fmtDec(parseDec(r.f)) : ''}|${r ? fmtDec(parseDec(r.q)) : ''}|${r ? fmtDec(parseDec(r.pr)) : ''}`, pg)
  }
  let tela = await lerPedidoTela(page, id)
  pg = await print(page, `${c.id}-pedido-rascunho-tela`)
  conferir(nome, T, 'etapa mostrada na tela do pedido novo', ROTULO_ETAPA.rascunho, tela.etapa, pg)
  conferir(nome, T, 'total do pedido na tela (mercadorias; frete e despesas zerados)', brl(BigInt(Math.round(Number(totalEsp) * 100))), tela.total === null ? 'não achei' : brl(tela.total), pg)
  conferir(nome, T, 'pagamento mostrado (parcelas do pedido)', c.parcelas ? `${c.parcelas.split('/').length}x` : 'À vista', tela.pagamento ?? 'não achei', pg)
  conferir(nome, T, 'rascunho nada recebido: Recebido 0%', '0%', tela.pct ?? 'não achei', pg)
  for (const [k, it] of c.itens.entries()) {
    const l = tela.linhas[k]
    conferir(nome, T, `item ${it.codigo} na tabela do pedido: código, recebido e falta`, `${it.codigo}|0|${fmtDec(parseDec(it.quantidade) * parseDec(it.fator) / 10n ** 9n)}`, l ? `${l.codigo}|${l.recebido}|${l.falta}` : 'linha ausente', pg)
  }
  conferir(nome, T, 'rascunho oferece Editar, Enviar para aprovação e Aprovar (e não Reabrir)', 'Editar|Enviar para aprovação|Aprovar', ['Editar', 'Enviar para aprovação', 'Aprovar'].filter((b) => tela.botoes.some((x) => x === b) || (b === 'Editar' && tela.texto.includes('Editar'))).join('|'), pg)
  const lista = await abrir(page, '/pedido-compra')
  const linhaLista = lista.texto.split('\n').map(norm).findIndex((l) => l.startsWith(`Nº ${ped.cab.n} · `))
  conferir(nome, '/pedido-compra', `pedido nº ${ped.cab.n} aparece na lista com a etapa Rascunho`, 'aparece como Rascunho', linhaLista < 0 ? 'não aparece' : norm(lista.texto).includes(`Nº ${ped.cab.n} · ${forn.razao_social}`) && /Rascunho/.test(lista.texto.split('\n').map(norm).slice(linhaLista, linhaLista + 6).join(' ')) ? 'aparece como Rascunho' : 'aparece, etapa diferente', await print(page, `${c.id}-pedido-lista`))

  // ---- 2) enviar para aprovação ----
  async function passo(acao: 'enviar' | 'aprovar', botao: string) {
    const prox = proximaEtapa(etapaGrav, acao)
    await page.goto(`${ORIGEM}${T}`, { waitUntil: 'domcontentloaded', timeout: 90000 })
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {})
    await page.waitForTimeout(1000)
    await cliqueAcao(page, new RegExp(`^${botao}$`))
    const esperadoGrav = prox.ok ? prox.etapa : etapaGrav
    let ok = await esperarEtapa(page, ROTULO_ETAPA[esperadoGrav])
    if (!ok) { // a tela não atualizou sozinha em 20 s: registra e recarrega, como a pessoa faria
      provas.push(`${c.id}: depois de "${botao}" a tela demorou mais de 20 s para atualizar a etapa; recarreguei a página`)
      await page.reload({ waitUntil: 'domcontentloaded' }); ok = await esperarEtapa(page, ROTULO_ETAPA[esperadoGrav])
    }
    const pp = await print(page, `${c.id}-pedido-${esperadoGrav}`)
    ped = await pedidoNoBanco(id)
    conferir(nome, T, `depois de "${botao}": etapa gravada (banco)`, esperadoGrav, ped.cab.etapa, pp)
    conferir(nome, T, `depois de "${botao}": etapa mostrada na tela`, ROTULO_ETAPA[esperadoGrav], ok ? ROTULO_ETAPA[esperadoGrav] : 'a etapa não mudou em 20 s', pp)
    etapaGrav = esperadoGrav
    return pp
  }
  await passo('enviar', 'Enviar para aprovação')
  tela = await lerPedidoTela(page, id)
  conferir(nome, T, 'aguardando aprovação: o botão Enviar some (enviar só vale em rascunho) e Aprovar fica', 'Aprovar sem Enviar', `${tela.botoes.includes('Aprovar') ? 'Aprovar' : 'sem Aprovar'} ${tela.botoes.includes('Enviar para aprovação') ? 'com Enviar' : 'sem Enviar'}`.replace(/^Aprovar sem Enviar$/, 'Aprovar sem Enviar').replace('sem Aprovar', 'sem Aprovar'), await print(page, `${c.id}-pedido-aguardando-botoes`))
  const antesAprovar = await print(page, `${c.id}-pedido-aguardando`)
  void antesAprovar
  await passo('aprovar', 'Aprovar')
  tela = await lerPedidoTela(page, id)
  const pa = await print(page, `${c.id}-pedido-aprovado-tela`)
  conferir(nome, T, 'aprovado sem nota: "Nenhuma nota ainda" na seção Notas do fornecedor', 'sem nota', /Nenhuma nota ainda/.test(tela.texto) ? 'sem nota' : 'mostra nota', pa)
  conferir(nome, T, 'aprovado sem nota: mostra Reabrir e Cancelar (regra: reabrir só sem nota)', 'Reabrir|Cancelar', `${tela.botoes.includes('Reabrir para editar') ? 'Reabrir' : '-'}|${tela.botoes.some((b) => RE_CANCELAR.test(b)) ? 'Cancelar' : '-'}`, pa)

  // Aba "velha": uma segunda pessoa/aba com a página do pedido aberta ANTES do recebimento (o botão de cancelar ainda aparece nela).
  const aba2 = await ctx.newPage()
  aba2.setDefaultTimeout(30000)
  await aba2.goto(`${ORIGEM}${T}`, { waitUntil: 'domcontentloaded', timeout: 90000 })
  await aba2.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {})
  await aba2.waitForTimeout(1500)

  // ---- 3) receber: uma ou mais notas, cada uma lançada pela tela e ligada ao pedido ----
  const lancadas: NotaItemPedido[][] = []
  let abortar = false
  for (const [n, nd] of c.notas.entries()) {
    if (abortar) break
    const nc: NotaCenario = { id: `${c.id}-nota${n + 1}`, fornecedor, loja: c.loja, via: nd.via, local: c.local, numero: nd.numero, itens: nd.itens, frete: nd.frete, duplicatasDias: nd.duplicatasDias, ligado: c.ligado }
    const comprasAntes = Number((await q('select count(*)::text n from compras_proprio where loja_id=$1', [c.loja]))[0].n)
    // lançar pela tela
    const duplicatas = (nc.duplicatasDias ?? []).map((d, i) => ({ nDup: String(i + 1).padStart(3, '0'), vencimento: somaDias(hoje, d), valor: '' }))
    let res: { toast: string; erro: string | null }
    if (nc.via === 'manual') res = await lancarManual(page, nc, `ROBO-COMPRAS ${ID_RODADA} ${nc.id}`)
    else {
      const liquidoTotal = nc.itens.reduce((a, i) => a + parseDec(i.quantidade) * parseDec(i.valorUnitario) / 10n ** 9n - parseDec(i.desconto ?? '0'), 0n)
      const totalCent = Number(liquidoTotal / 10n ** 7n)
      duplicatas.forEach((d, i) => { d.valor = i < duplicatas.length - 1 ? (Math.floor(totalCent / duplicatas.length) / 100).toFixed(2) : ((totalCent - Math.floor(totalCent / duplicatas.length) * (duplicatas.length - 1)) / 100).toFixed(2) })
      const cnpjLoja = ((await q('select cnpj from lojas where id=$1', [c.loja]))[0].cnpj as string).replace(/\D/g, '')
      const xml = montarXmlAssinado({
        numero: nc.numero, emissao: hoje, emitenteCnpj: fornecedor.cnpj, emitenteNome: fornecedor.nome, destinatarioCnpj: cnpjLoja, destinatarioNome: nome,
        itens: nc.itens.map((i) => ({ cProd: `RB${i.codigo}`, descricao: produtos.get(i.codigo)!.descricao, unidade: i.unidadeNota, quantidade: i.quantidade, valorUnitario: i.valorUnitario, desconto: i.desconto })),
        duplicatas,
      })
      res = await lancarXml(page, nc, xml.xml)
    }
    const pL = await print(page, `${nc.id}-depois-de-lancar`)
    provas.push(`${nc.id}: aviso da tela ao lançar a nota ${nc.numero} = "${res.toast}"`)
    if (res.erro) { falha(nome, nc.via === 'manual' ? '/nota-fiscal/nova' : '/nota-fiscal/importar', `lançar a nota ${nc.numero} pela tela`, 'nota lançada no estoque', res.erro, pL, 'tela-quebrada'); abortar = true; break }
    const compra = (await q('select id::text, status, nota_fiscal_id::text nota, chave_acesso from compras_proprio where loja_id=$1 and numero=$2 order by id desc limit 1', [c.loja, nc.numero]))[0]
    conferir(nome, '/nota-fiscal', `uma compra nova criada para a nota ${nc.numero}`, '1', String(Number((await q('select count(*)::text n from compras_proprio where loja_id=$1', [c.loja]))[0].n) - comprasAntes), pL)
    if (!compra) { falha(nome, '/nota-fiscal', `achar a compra ${nc.numero} no banco`, 'compra criada', 'nenhuma compra', pL, 'tela-quebrada'); abortar = true; break }
    conferir(nome, '/nota-fiscal', `situação da compra ${nc.numero}`, 'lancada', compra.status, pL)

    // antes de ligar ao pedido, o pedido ainda NÃO mostra recebimento (só nota ligada conta)
    const semLigar = recebimento(c.itens.map((i) => ({ quantidade: i.quantidade, fator: i.fator })), lancadas)
    ped = await pedidoNoBanco(id)
    conferir(nome, T, `nota ${nc.numero} lançada mas ainda não ligada: o recebimento do pedido não muda (banco)`, semLigar.itens.map((i) => i.recebido).join('|'), ped.its.map((r) => fmtDec(parseDec(r.rc))).join('|'), pL)

    // abrir a nota e ligar ao pedido
    if (!compra.nota) { falha(nome, '/nota-fiscal', `a compra ${nc.numero} não tem nota para abrir`, 'nota criada', 'sem nota_fiscal_id', pL, 'tela-quebrada'); abortar = true; break }
    await abrir(page, `/nota-fiscal/${compra.nota}`)
    let botao = page.getByRole('button', { name: 'Conferir com este pedido' })
    if (!(await botao.count())) { await page.getByText('Pedido e devolução').first().click().catch(() => {}); await page.waitForTimeout(800) }
    const pNota = await print(page, `${nc.id}-nota-pedido-sugestao`)
    const sugestao = (await botao.count()) > 0
    conferir(nome, `/nota-fiscal/${compra.nota}`, `a nota ${nc.numero} sugere o pedido aprovado nº ${ped.cab.n} (mesmo fornecedor e produtos)`, 'sugere', sugestao ? 'sugere' : 'não sugere', pNota, 'tela-quebrada')
    if (!sugestao) { abortar = true; break }
    const idxs = nc.itens.map((i) => c.itens.findIndex((x) => x.codigo === i.codigo))
    await botao.first().click()
    await page.getByText(/item\(ns\) ligados ao pedido/).first().waitFor({ timeout: 20000 }).catch(() => {})
    const msg = norm(await page.getByText(/item\(ns\) ligados ao pedido/).first().innerText().catch(() => ''))
    conferir(nome, `/nota-fiscal/${compra.nota}`, `mensagem ao ligar a nota ${nc.numero}: itens ligados ao pedido`, `${nc.itens.length} item(ns) ligados ao pedido.`, msg || 'sem mensagem', await print(page, `${nc.id}-nota-ligada`))
    // conferência pedido x nota x recebido na tela da nota
    await page.locator('section:has(h2:text-is("Pedido de compra")) tbody tr').first().waitFor({ timeout: 20000 }).catch(() => {})
    await page.waitForTimeout(500)
    const linhasConf: string[][] = await page.evaluate(() => [...document.querySelectorAll('section')].filter((s) => s.querySelector('h2')?.textContent === 'Pedido de compra').flatMap((s) => [...s.querySelectorAll('tbody tr')].map((r) => [...(r as HTMLTableRowElement).cells].map((x) => (x as HTMLElement).innerText.replace(/\s+/g, ' ').trim()))))
    for (const [k, it] of c.itens.entries()) {
      const jaRecebido = lancadas.flat().filter((x) => x.indice === k).reduce((a, x) => a + parseDec(x.quantidade) * parseDec(x.fator) / 10n ** 9n, 0n)
      const baseP = parseDec(it.quantidade) * parseDec(it.fator) / 10n ** 9n
      const esperadoRestante = baseP > jaRecebido ? baseP - jaRecebido : 0n
      const posNota = idxs.indexOf(k)
      const ni = posNota >= 0 ? nc.itens[posNota] : null
      const baseN = ni ? fmtDec(parseDec(ni.quantidade) * parseDec(ni.fator) / 10n ** 9n) : null
      const sit = esperadoRestante === 0n && !ni ? 'ja_atendido' : situacaoNaNota(fmtDec(esperadoRestante), baseN)
      const txtSit = sit === 'ja_atendido' ? 'Já veio em outra nota' : TXT_SITUACAO[sit]
      const desc = produtos.get(it.codigo)!.descricao
      const semAc = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim()
      const lc = linhasConf.find((r) => semAc(r[0]) === semAc(desc)) ?? linhasConf.find((r) => semAc(r[0]).startsWith(semAc(desc).split(' ')[0]))
      // F-18 corrigido de propósito: a tela da nota mostra o nome EXATO do cadastro (caixa alta e acento), sem a normalização que a busca acima usa.
      if (lc) conferir(nome, `/nota-fiscal/${compra.nota}`, `F-18: nome do item ${it.codigo} igual ao cadastro (caixa e acento)`, desc.replace(/\s+/g, ' ').trim(), lc[0].replace(/\s+/g, ' ').trim(), pNota)
      conferir(nome, `/nota-fiscal/${compra.nota}`, `conferência pedido x nota do item ${it.codigo}: pedido esperava, nota trouxe, situação`, `${fmtDec(esperadoRestante)}|${baseN ?? '—'}|${txtSit}`,
        lc ? `${numTela(lc[1])}|${lc[2] === '—' ? '—' : numTela(lc[2])}|${lc[6].replace(/ · .*$/, '')}` : 'linha ausente', pNota)
      if (ni) {
        const pc = Number(it.preco) / Number(it.fator), pn = Number(ni.valorUnitario) / Number(ni.fator)
        conferir(nome, `/nota-fiscal/${compra.nota}`, `preço do item ${it.codigo}: combinado ${pc} e na nota ${pn} (sem diferença de preço esperada)`, 'sem aviso de preço', lc && /preço diferente/.test(lc[6]) ? 'aviso de preço diferente' : 'sem aviso de preço', pNota)
      }
    }
    lancadas.push(nc.itens.map((i) => ({ indice: c.itens.findIndex((x) => x.codigo === i.codigo), quantidade: i.quantidade, fator: i.fator })))

    // estoque e custo (banco e tela do produto) contra o gabarito, encadeando sobre o estado de antes desta nota
    const itensNota: ItemNota[] = nc.itens.map((i) => ({ quantidade: i.quantidade, valorUnitario: i.valorUnitario, fator: i.fator, desconto: i.desconto }))
    const rateio = { frete: nc.frete ?? '0', descontoNota: nc.descontoNota ?? '0' }
    const totalNota = fmtDec(itensNota.reduce((a, i) => a + parseDec(fmtDec(BigInt(Math.round(Number(i.quantidade) * Number(i.valorUnitario) * 100)) * 10n ** 7n)) - parseDec(i.desconto ?? '0'), 0n) + parseDec(rateio.frete) - parseDec(rateio.descontoNota))
    for (const [k, it] of nc.itens.entries()) {
      const p = produtos.get(it.codigo)!
      const ab = estado.get(it.codigo)!
      const custo = custoUnitarioBase(itensNota[k], itensNota, rateio)!
      const qb = quantidadeBase(itensNota[k])
      const novo = novoEstado({ saldo: ab.saldo, cmc: ab.cmc }, qb, custo)
      const saldoLocal = fmtDec(parseDec(ab.saldoLocal) + parseDec(qb))
      estado.set(it.codigo, { saldo: novo.saldo, cmc: novo.cmc, saldoLocal })
      const rotulo = `${it.codigo} ${p.descricao}`
      const dep = await estadoBanco(c.loja, p.id)
      const tp = '/estoque/produto'
      conferir(nome, tp, `[nota ${nc.numero}] saldo total no banco, item ${rotulo} (${it.quantidade} ${it.unidadeNota} x ${it.fator})`, novo.saldo, dep.saldoTotal, pL, 'saldo-divergente')
      conferir(nome, tp, `[nota ${nc.numero}] saldo no local ${c.local} no banco, item ${rotulo}`, saldoLocal, dep.locais.get(Number(local)) ?? '0', pL, 'saldo-divergente')
      conferir(nome, tp, `[nota ${nc.numero}] custo médio no banco, item ${rotulo}`, novo.cmc, dep.cmc, pL)
      const itemDb = (await q('select custo_unitario_base::text c from compras_proprio_itens where compra_id=$1 and codigo_produto=$2', [compra.id, p.id]))[0]
      conferir(nome, tp, `[nota ${nc.numero}] custo da entrada (por ${p.unidade}) gravado na compra, item ${rotulo}`, custo, itemDb ? fmtDec(parseDec(itemDb.c ?? '0')) : 'sem item', pL)
      const mv = (await q("select quantidade::text q, cmc_apos::text m from estoque_movimentos where loja_id=$1 and codigo_produto=$2 and origem='COMPRA' and ref like $3 and linha=$4 and reverses_id is null order by id desc limit 1", [c.loja, p.id, `%${compra.chave_acesso ?? `compra:${compra.id}`}%`, k + 1]))[0]
      conferir(nome, tp, `[nota ${nc.numero}] movimento de entrada no ledger (quantidade), item ${rotulo}`, qb, mv ? fmtDec(parseDec(mv.q)) : 'sem movimento', pL, 'saldo-divergente')
      conferir(nome, tp, `[nota ${nc.numero}] custo médio depois do movimento, item ${rotulo}`, novo.cmc, mv ? fmtDec(parseDec(mv.m)) : 'sem movimento', pL)
      const t = await abrir(page, `/estoque/produto/${p.id}`)
      const pp = await print(page, `${nc.id}-produto-${it.codigo}`)
      const tp2 = lerProduto(t.texto)
      conferir(nome, tp, `[nota ${nc.numero}] saldo total mostrado (até 3 casas), item ${rotulo}`, arredondarTexto(novo.saldo, 3), tp2.saldoTotal === null ? 'não achei' : arredondarTexto(tp2.saldoTotal, 3), pp, 'saldo-divergente')
      conferir(nome, tp, `[nota ${nc.numero}] saldo mostrado no local ${c.local} (até 3 casas), item ${rotulo}`, arredondarTexto(saldoLocal, 3), tp2.locais.has(c.local) ? arredondarTexto(tp2.locais.get(c.local)!, 3) : 'não achei', pp, 'saldo-divergente')
      const cm = tp2.custoMedio
      conferir(nome, tp, `[nota ${nc.numero}] custo médio mostrado (nas casas da tela), item ${rotulo}`, cm ? `R$ ${arredondarTexto(novo.cmc, cm.casas)}` : 'esperado', cm ? `R$ ${arredondarTexto(cm.valor, cm.casas)}` : 'não achei', pp)
      const vEsp = valorEmEstoqueCent(novo.saldo, novo.cmc)
      const dentro = tp2.valorCent !== null && (tp2.valorCent - vEsp <= 1n && vEsp - tp2.valorCent <= 1n)
      conferir(nome, tp, `[nota ${nc.numero}] valor em estoque mostrado (tolerância 1 centavo), item ${rotulo}`, brl(vEsp), tp2.valorCent === null ? 'não achei' : dentro ? brl(vEsp) : brl(tp2.valorCent), pp)
    }

    // título a pagar gerado pelo recebimento
    const esperados = titulosEsperados({ ligado: c.ligado, entradaLancada: compra.status === 'lancada', total: totalNota, emissao: hoje, duplicatas: duplicatas.map((d) => ({ vencimento: d.vencimento, valor: d.valor })) })
    const dbT = (await titulosDoBanco(c.loja, nc.numero)).filter((t) => t.status !== 'cancelado')
    const fmtEsp = esperados.map((t) => `${t.parcela}/${t.totalParcelas} ${t.vencimento} R$ ${t.valor}`).join('; ') || 'nenhum título'
    const fmtDb = dbT.map((t) => `${t.p}/${t.t} ${t.v} R$ ${fmtDec(parseDec(t.x))}`).join('; ') || 'nenhum título'
    conferir(nome, '/financeiro/contas-pagar', `títulos a pagar gerados pelo recebimento da nota ${nc.numero} (banco; loja com chave ${c.ligado ? 'ligada' : 'desligada'})`, fmtEsp, fmtDb, pL)
    const cp = await abrir(page, '/financeiro/contas-pagar')
    const pcp = await print(page, `${nc.id}-contas-pagar`)
    if (!c.ligado) {
      conferir(nome, '/financeiro/contas-pagar', `a tela de contas a pagar não mostra título da nota ${nc.numero}`, 'nenhum', cp.texto.includes(`NF ${nc.numero}`) ? 'aparece' : 'nenhum', pcp)
      if (n === 0) achados.push(`${nome}: o recebimento NÃO gera título a pagar porque a chave lojas.fin_cp_da_nota_ativo está desligada (migration 340: só a loja 19 fica ligada até o dono liberar). O gabarito espera zero títulos, e é o que o ERP fez; a prova de título só existe na loja 19.`)
    } else {
      const linhasT = (await page.evaluate(() => [...document.querySelectorAll('main tbody tr')].map((r) => (r as HTMLElement).innerText.replace(/\s+/g, ' ')))).map((l) => l.replace(/ /g, ' ')).filter((l) => l.includes(`doc NF ${nc.numero} `) || l.includes(`doc NF ${nc.numero}·`))
      for (const t of esperados) {
        const valorTxt = `R$ ${Number(t.valor).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        const achou = linhasT.some((l) => l.includes(valorTxt) && l.includes(dataBR(t.vencimento)))
        conferir(nome, '/financeiro/contas-pagar', `título ${t.parcela}/${t.totalParcelas} da nota ${nc.numero} na tela (${valorTxt}, vence ${dataBR(t.vencimento)})`, 'aparece', achou ? 'aparece' : `não aparece (linhas da nota na tela: ${linhasT.length})`, pcp)
      }
    }

    // o pedido depois desta nota: etapa exibida, recebido, falta (banco e tela) contra o gabarito do recebimento
    const rec = recebimento(c.itens.map((i) => ({ quantidade: i.quantidade, fator: i.fator })), lancadas)
    ped = await pedidoNoBanco(id)
    tela = await lerPedidoTela(page, id)
    const pPed = await print(page, `${nc.id}-pedido-depois`)
    conferir(nome, T, `[nota ${nc.numero}] etapa gravada continua aprovado (banco; "recebido" é só o que a tela calcula)`, 'aprovado', ped.cab.etapa, pPed)
    conferir(nome, T, `[nota ${nc.numero}] etapa mostrada na tela do pedido`, ROTULO_ETAPA[rec.etapaExibida], tela.etapa, pPed)
    for (const [k, it] of c.itens.entries()) {
      const r = rec.itens[k]
      const base = parseDec(it.quantidade) * parseDec(it.fator) / 10n ** 9n
      conferir(nome, T, `[nota ${nc.numero}] item ${it.codigo}: recebido e falta no banco (view do pedido)`, `${r.recebido}|${r.falta}`, ped.its[k] ? `${fmtDec(parseDec(ped.its[k].rc))}|${fmtDec(base > parseDec(ped.its[k].rc) ? base - parseDec(ped.its[k].rc) : 0n)}` : 'sem item', pPed)
      const l = tela.linhas[k]
      conferir(nome, T, `[nota ${nc.numero}] item ${it.codigo}: recebido e falta mostrados na tabela do pedido (até 3 casas)`, `${arredondarTexto(r.recebido, 3)}|${arredondarTexto(r.falta, 3)}`, l ? `${arredondarTexto(l.recebido, 3)}|${arredondarTexto(l.falta, 3)}` : 'linha ausente', pPed)
    }
    const somaBase = rec.itens.reduce((a, i) => a + parseDec(i.pedidoBase), 0n), somaRec = rec.itens.reduce((a, i) => a + parseDec(i.recebido), 0n)
    const pctEsp = `${Math.min(100, Math.round(Number(somaRec) / Number(somaBase) * 100))}%`
    conferir(nome, T, `[nota ${nc.numero}] cartão Recebido (percentual em quantidade)`, pctEsp, tela.pct ?? 'não achei', pPed)
    const botoesCancelar = tela.botoes.filter((b) => RE_CANCELAR.test(b))
    if (rec.recebidoTotal) conferir(nome, T, `[nota ${nc.numero}] pedido recebido por completo: a tela NÃO oferece cancelar`, 'sem botão de cancelar', botoesCancelar.length ? `oferece "${botoesCancelar.join(', ')}"` : 'sem botão de cancelar', pPed)
    else conferir(nome, T, `[nota ${nc.numero}] pedido recebido em parte: a tela oferece encerrar o que falta`, 'Encerrar o que falta receber', botoesCancelar.join(', ') || 'sem botão', pPed)
    const histEsperado = ['Criado', 'Enviado para aprovação', 'Aprovado', ...Array(n + 1).fill('Nota vinculada')]
    const histTela = tela.texto.split('\n').map(norm).filter((l) => /^\d{2}\/\d{2}\/\d{4}.* · (Criado|Enviado para aprovação|Aprovado|Nota vinculada|Cancelado|Reaberto)/.test(l)).map((l) => (l.match(/ · (Criado|Enviado para aprovação|Aprovado|Nota vinculada|Cancelado|Reaberto)/) ?? [])[1])
    conferir(nome, T, `[nota ${nc.numero}] histórico do pedido na tela, em ordem`, histEsperado.join(' > '), histTela.join(' > '), pPed)
    conferir(nome, T, `[nota ${nc.numero}] eventos gravados do pedido (banco)`, ['criado', 'enviar', 'aprovar', ...Array(n + 1).fill('nota_vinculada')].join(' > '), ped.evs.join(' > '), pPed)
    const lst = await abrir(page, '/pedido-compra')
    const l0 = lst.texto.split('\n').map(norm)
    const iL = l0.findIndex((l) => l.startsWith(`Nº ${ped.cab.n} · `))
    conferir(nome, '/pedido-compra', `[nota ${nc.numero}] lista de pedidos mostra a etapa ${ROTULO_ETAPA[rec.etapaExibida]}`, ROTULO_ETAPA[rec.etapaExibida], iL < 0 ? 'pedido não aparece' : (l0.slice(iL, iL + 6).find((l) => Object.values(ROTULO_ETAPA).includes(l)) ?? 'etapa não achada'), await print(page, `${nc.id}-pedido-lista`))
  }

  // ---- 4) regra existente: pedido recebido por completo não se cancela (aba velha, aberta antes do recebimento) ----
  if (!abortar) {
    const rec = recebimento(c.itens.map((i) => ({ quantidade: i.quantidade, fator: i.fator })), lancadas)
    const gab = proximaEtapa('aprovado', 'cancelar', { recebidoTotal: rec.recebidoTotal })
    conferir(nome, T, 'gabarito: cancelar pedido recebido por completo deve ser recusado', 'recusa', gab.ok ? 'permite' : 'recusa', 'prints/(sem print)')
    // a aba velha ainda mostra o botão (a página não foi recarregada)
    const btn = aba2.getByRole('button', { name: RE_CANCELAR }).first()
    const temBtn = (await btn.count()) > 0
    conferir(nome, T, 'a aba velha (aberta antes do recebimento) ainda mostra o botão de cancelar', 'mostra', temBtn ? 'mostra' : 'não mostra', 'prints/(sem print)', 'tela-quebrada')
    if (temBtn) {
      await btn.click()
      await aba2.getByPlaceholder('Motivo do cancelamento').fill('ROBO: tentar cancelar pedido já recebido')
      await aba2.getByRole('button', { name: 'Confirmar', exact: true }).click()
      let erroTela = ''
      for (let i = 0; i < 30 && !erroTela; i++) { erroTela = norm(await aba2.locator('main p.text-err').first().innerText().catch(() => '')); if (!erroTela) await aba2.waitForTimeout(500) }
      const pr = await print(aba2, `${c.id}-cancelar-recusado`)
      provas.push(`${c.id}: tentativa de cancelar o pedido recebido (aba velha) -> mensagem da tela = "${erroTela}"`)
      conferir(nome, T, 'a tentativa de cancelar o pedido recebido é recusada com mensagem clara', 'O pedido já foi recebido por completo: não há o que cancelar', erroTela || 'sem mensagem (nada aconteceu na tela)', pr)
    }
    ped = await pedidoNoBanco(id)
    const depois = (await q('select etapa, cancelado_em::text ce, motivo_cancelamento mc from pedidos_compra where id=$1', [id]))[0]
    conferir(nome, T, 'depois da tentativa de cancelar: o pedido NÃO foi cancelado (banco)', 'aprovado|sem cancelamento', `${depois.etapa}|${depois.ce ? 'cancelado em ' + depois.ce : 'sem cancelamento'}`, 'prints/(sem print)')
    conferir(nome, T, 'depois da tentativa de cancelar: nenhum evento "cancelar" gravado', 'nenhum', ped.evs.includes('cancelar') ? 'gravou cancelar' : 'nenhum', 'prints/(sem print)')
    const fim = await lerPedidoTela(page, id)
    conferir(nome, T, 'depois da tentativa de cancelar: a tela continua mostrando Recebido', ROTULO_ETAPA.recebido, fim.etapa, await print(page, `${c.id}-pedido-final`))
  }
  await ctx.close()
}

// ---- Loja Omie (Sertão, loja 4): o pedido de compra do app só existe em estoque próprio ----
async function executarOmie(browser: Awaited<ReturnType<typeof chromium.launch>>) {
  const nome = 'Sertão'
  const antes = await q("select (select count(*) from pedidos_compra where loja_id=4)::text pedidos, (select count(*) from pedidos_compra_omie where loja_id=4)::text fila_omie, (select count(*) from integration_attempts where loja_id=4)::text tentativas, (select count(*) from compras_proprio where loja_id=4)::text compras")
  const ctx = await novoContexto(browser)
  const page = await ctx.newPage()
  page.setDefaultTimeout(30000)
  await entrar(page, 4)
  for (const rota of ['/pedido-compra', '/pedido-compra/novo', '/pedido-compra/importar', '/pedido-compra/2']) {
    const r = await abrir(page, rota)
    const bloqueada = r.noindex || ehPaginaNaoEncontrada(r.texto) || r.status >= 400
    const pr = await print(page, `4-omie-${rota.replace(/\//g, '-')}`)
    conferir(nome, rota, 'em loja Omie o pedido de compra do app dá página não encontrada (por desenho)', 'bloqueado (404)', bloqueada ? 'bloqueado (404)' : 'abriu', pr, 'furo-endereco')
  }
  const menu = await abrir(page, '/home')
  conferir(nome, '/home', 'o menu da loja Omie não oferece "Pedidos de compra"', 'sem o item', (await page.locator('a[href="/pedido-compra"]').count()) ? 'com o item' : 'sem o item', await print(page, '4-omie-menu'))
  void menu
  await ctx.close()
  const depois = await q("select (select count(*) from pedidos_compra where loja_id=4)::text pedidos, (select count(*) from pedidos_compra_omie where loja_id=4)::text fila_omie, (select count(*) from integration_attempts where loja_id=4)::text tentativas, (select count(*) from compras_proprio where loja_id=4)::text compras")
  for (const k of Object.keys(antes[0])) conferir(nome, 'banco da loja 4', `nada mudou em ${k} depois de tentar abrir pedido de compra em loja Omie`, antes[0][k], depois[0][k], 'prints/(sem print)')
  provas.push('4: /pedido-compra, /novo, /importar e /pedido-compra/2 dão página não encontrada (HTTP 200 com noindex) na loja Omie do Sertão, como o AGENTS.md diz (Fase C: só estoque próprio); nada foi gravado.')
}

// ---- Nada sai para fornecedor nem para o Omie ----
function varreduraEstatica() {
  const arquivos: string[] = []
  const andar = (d: string) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) andar(p); else if (/\.(ts|tsx)$/.test(e.name) && !/\.test\./.test(e.name)) arquivos.push(p) } }
  andar(path.join(RAIZ, 'app', '(app)', 'pedido-compra'))
  for (const f of ['lib/actions/pedido-compra.ts', 'components/compras/AcoesPedido.tsx', 'components/compras/FormPedidoCompra.tsx', 'components/nota-fiscal/PedidoDaNotaNF.tsx']) arquivos.push(path.join(RAIZ, f))
  const re = /\bfetch\(|mailto:|wa\.me|whatsapp|nodemailer|sendgrid|resend\b|smtp|twilio|axios|XMLHttpRequest|sendMail|api\.whatsapp/i
  const achados2: string[] = []
  for (const f of arquivos) fs.readFileSync(f, 'utf8').split('\n').forEach((l, i) => { if (re.test(l)) achados2.push(`${path.relative(RAIZ, f)}:${i + 1}: ${l.trim().slice(0, 140)}`) })
  return { n: arquivos.length, achados: achados2 }
}

// ---- Execução ----
const t0 = Date.now()
const fotoAntes = await foto()
const extraAntes = Object.fromEntries(await Promise.all([4, 15, 19].map(async (l) => [l, await lojaExtra(l)])))
fs.writeFileSync(path.join(SAIDA, 'foto-antes.json'), JSON.stringify({ fotoAntes, extraAntes }, null, 1))
console.log(`foto do estado inicial guardada (${Object.keys(fotoAntes).length} itens)`)
const gravarPedidosOmie = /^OMIE_GRAVAR_PEDIDOS_COMPRA=1/m.test(envTexto)
conferir('(ambiente)', '.env.local', 'OMIE_GRAVAR_PEDIDOS_COMPRA não está ligado na cópia local (pedido de loja Omie nunca é gravado no Omie)', 'desligado', gravarPedidosOmie ? 'ligado' : 'desligado', 'prints/(sem print)', 'tela-quebrada')
const varr = varreduraEstatica()
provas.push(`varredura estática do caminho criar/enviar/aprovar/receber (${varr.n} arquivos de pedido-compra, ações, formulário e conferência da nota) atrás de e-mail, WhatsApp e HTTP externo: ${varr.achados.length ? varr.achados.length + ' ocorrência(s): ' + varr.achados.join(' || ') : 'nenhuma ocorrência'}`)
conferir('(código)', 'caminho do pedido de compra', 'nenhum envio por e-mail, WhatsApp ou HTTP externo no código do pedido (varredura estática)', '0', String(varr.achados.length) + (varr.achados.length ? ': ' + varr.achados.join(' || ') : ''), 'prints/(sem print)', 'tela-quebrada')

const browser = await chromium.launch()
for (const c of cenariosRodar) {
  console.log(`cenário ${c.id}: ${c.texto}`)
  try { await executarPedido(browser, c) } catch (e) { falha(c.nome, '(robô)', `cenário ${c.id}`, 'executar sem erro', String(e instanceof Error ? e.message : e).slice(0, 300), 'prints/(sem print)', 'tela-quebrada') }
}
if (rodarOmie) {
  console.log('cenário 4: Sertão (modo Omie)')
  try { await executarOmie(browser) } catch (e) { falha('Sertão', '(robô)', 'cenário 4', 'executar sem erro', String(e instanceof Error ? e.message : e).slice(0, 300), 'prints/(sem print)', 'tela-quebrada') }
}
await browser.close()
const fotoDepoisTeste = await foto()
const mudou = Object.keys(fotoDepoisTeste).filter((k) => fotoDepoisTeste[k] !== fotoAntes[k])
console.log(`o teste gravou na cópia (tabelas diferentes da foto inicial): ${mudou.join(', ') || 'nada'}`)
// nada saiu para o Omie: nenhuma tentativa nova, nenhuma fila de pedido no Omie, nenhum documento SEFAZ, nenhuma chamada externa do navegador
for (const t of ['integration_attempts', 'pedidos_compra_omie', 'movimentos']) conferir('(ambiente)', 'banco', `nada novo em ${t} (nada saiu para o Omie)`, fotoAntes[t] ?? '-', fotoDepoisTeste[t] ?? '-', 'prints/(sem print)')
conferir('(ambiente)', 'navegador', 'nenhuma requisição do navegador para fora da cópia local', '0', String(externos.length), 'prints/(sem print)')
provas.push(`requisições externas tentadas pelo navegador (todas bloqueadas): ${externos.length}${externos.length ? ' -> ' + externos.join(', ') : ''}`)
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
const md = formatarListaFalhas(ordenadas, { visitas: conferencias, telas: 9, logins: new Set([...cenariosRodar.map((c) => c.loja), ...(rodarOmie ? [4] : [])]).size })
fs.writeFileSync(path.join(SAIDA, 'falhas.md'), md)
const evid = [`# Evidências da rodada ${ID_RODADA}`, '', `Conferências feitas: ${conferencias}. Falhas: ${ordenadas.length}.`, '', '## Provas e avisos da tela', ...provas.map((p) => `- ${p}`), '', '## Achados que não são falha do robô', ...achados.map((a) => `- ${a}`), '',
  '## Volta ao estado inicial', detalheReset, '']
fs.writeFileSync(path.join(SAIDA, 'evidencias.md'), evid.join('\n'))
fs.writeFileSync(path.join(SAIDA, 'resumo.json'), JSON.stringify({ rodada: ID_RODADA, urlBase: ORIGEM, cenarios: [...cenariosRodar.map((c) => c.id), ...(rodarOmie ? ['4'] : [])], conferencias, falhas: ordenadas.length, tabelasGravadasPeloTeste: mudou, resetProvado, detalheReset, externosBloqueados: externos.length, sha256FalhasMd: crypto.createHash('sha256').update(md).digest('hex'), segundos: Math.round((Date.now() - t0) / 1000) }, null, 1))
console.log(`conferências: ${conferencias} | falhas: ${ordenadas.length} | saída: ${SAIDA}`)
process.exit(resetProvado === false ? 1 : 0)
