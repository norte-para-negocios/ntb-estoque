// Robô do inventário e do ajuste (ticket 06). ESCREVE na cópia local, e só pela tela do ERP, como uma pessoa: abre um
// inventário (contagem) em Inventários, soma os produtos, digita a quantidade contada de cada um e conclui. Depois confere
// que o ajuste gerado leva o saldo ao valor contado, com o custo certo, contra o gabarito (e2e/robo/inventario-gabarito.ts,
// conta independente: ajuste = contado - saldo do gabarito; valor = diferença x custo médio; o saldo "antes" sai da soma
// dos movimentos do ledger, não de estoque_saldos). Lojas: 19 (laboratório) e 15 (ODARA), estoque próprio; e 4 (Sertão), com
// Omie, onde o envio do ajuste é barrado pela trava NTB_OMIE_BLOQUEADO=1 e o robô só registra o que o ERP faz localmente.
// Depois de cada loja a cópia volta ao estado inicial (`local.sh resetar`) e o robô prova isso (foto antes/depois).
// O banco é lido SÓ para ler documentos (sessão read-only); nunca escreve. Nunca chama o Omie.
// Uso: npm run robo:inventario   (saída em .local-data/robo-inventario/<rodada>/, fora do git)
// Variáveis: ROBO_CENARIOS=19,15,4 (filtra), ROBO_SEM_RESET=1 (não reseta; a prova de volta ao estado inicial fica pendente).
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import pg from 'pg'
import { chromium, type Page, type BrowserContext } from 'playwright'
import { validarUrlBase, validarAmbienteLocal, PORTA_ERP_LOCAL } from './trava-url.ts'
import { formatarListaFalhas, ordenarFalhas, ehPaginaNaoEncontrada, type Falha, type TipoFalha } from './relatorio.ts'
import { parseDec, fmtDec, saldoPorLedger, type MovLedger } from './saldo-gabarito.ts'
import { arredondarTexto } from './custo-gabarito.ts'
import { ajusteEsperado, exigeMotivoEsperado } from './inventario-gabarito.ts'

const RAIZ = path.resolve(import.meta.dirname, '..', '..')
const PORTA_PG_LOCAL = 54420

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
const SAIDA = path.join(RAIZ, '.local-data', 'robo-inventario', ID_RODADA)
fs.mkdirSync(path.join(SAIDA, 'prints'), { recursive: true })

async function abrirBanco() {
  const c = new pg.Client({ host: '127.0.0.1', port: PORTA_PG_LOCAL, user: 'postgres', password: senhaPg, database: 'postgres', options: '-c default_transaction_read_only=on' })
  await c.connect()
  return c
}
let db = await abrirBanco()
const q = async <T = Record<string, string>>(sql: string, args: unknown[] = []) => (await db.query({ text: sql, values: args })).rows as T[]
const dormir = (ms: number) => new Promise((s) => setTimeout(s, ms))

const hoje = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
const toBR = (s: string) => s.replace('.', ',')
const brl = (c: bigint | number) => { const n = Number(c); const a = Math.abs(n); return `${n < 0 ? '-' : ''}R$ ${Math.floor(a / 100).toLocaleString('pt-BR')},${String(a % 100).padStart(2, '0')}` }
const numBR = (t: string) => fmtDec(parseDec(t.replace(/ /g, ' ').trim().replace(/\./g, '').replace(',', '.')))
const centDe = (t: string): bigint | null => { const m = t.replace(/ /g, ' ').match(/(-)?\s*R\$\s*(-)?\s*([\d.]+),(\d{2})/); return m ? BigInt((m[1] || m[2] ? '-' : '') + m[3].replace(/\./g, '') + m[4]) : null }
const abs = (d: bigint) => (d < 0n ? -d : d)

// ---- Foto do banco: provar que a cópia voltou ao estado inicial ----
const TABELAS_FOTO = ['inventarios', 'inventario_items', 'estoque_movimentos', 'estoque_lotes', 'estoque_lote_movimentos', 'estoque_mov_revisao', 'movimentos', 'integration_attempts', 'posicao_estoques', 'produtos',
  'estoque_correcao_custo', 'notas_fiscais', 'compras_proprio', 'fin_titulos_pagar', 'fin_eventos', 'vendas_integracao_fila', 'venda_op_vinculo', 'ordens_producao', 'ordens_producao_proprio', 'op_historico', 'estoque_config', 'sync_trava']
async function foto(): Promise<Record<string, string>> {
  const f: Record<string, string> = {}
  for (const t of TABELAS_FOTO) {
    if (!(await q('select to_regclass($1)::text r', [`public.${t}`]))[0].r) continue
    f[t] = (await q(`select count(*)::text c from public.${t}`))[0].c
  }
  f.estoque_saldos = (await q("select count(*)::text || ':' || coalesce(md5(string_agg(concat_ws('|',loja_id,codigo_local_estoque,codigo_produto,saldo), ',' order by loja_id,codigo_local_estoque,codigo_produto)),'-') c from public.estoque_saldos"))[0].c
  f.estoque_custos = (await q("select count(*)::text || ':' || coalesce(md5(string_agg(concat_ws('|',loja_id,codigo_produto,cmc,saldo_total,ultimo_custo), ',' order by loja_id,codigo_produto)),'-') c from public.estoque_custos"))[0].c
  f.lojas_chaves = (await q("select count(*) filter (where integracao_api_key is not null)::text || ':' || count(*) filter (where omie_app_key is not null)::text c from public.lojas"))[0].c
  return f
}
const lojaExtra = async (loja: number) => (await q(
  `select (select count(*) from inventarios where loja_id=$1)::text inventarios, (select count(*) from inventario_items where loja_id=$1)::text itens, (select count(*) from estoque_movimentos where loja_id=$1)::text movimentos_ledger,
          (select count(*) from movimentos where loja_id=$1)::text movimentos_omie, (select count(*) from integration_attempts where loja_id=$1)::text tentativas_omie,
          (select coalesce(sum(saldo),0) from estoque_saldos where loja_id=$1)::text saldo_total, (select count(*) from posicao_estoques where loja_id=$1)::text posicao`, [loja]))[0]

// ---- Cenários ----
type Caso = 'maior' | 'menor' | 'igual' | 'zerar' | 'motivo'
type ItemCenario = { codigo: string; caso: Caso; contado: string; motivo?: string }
type Cenario = { id: string; loja: number; nome: string; omie: boolean; local: string; itens: ItemCenario[]; nota: string }
const CENARIOS: Cenario[] = [
  { id: '19', loja: 19, nome: 'Loja 19', omie: false, local: 'Estoque Geral',
    itens: [
      { codigo: '80074', caso: 'maior', contado: '2.5' },   // saldo 1,3 KG: soma 1,2
      { codigo: '90019', caso: 'menor', contado: '7' },     // saldo 10 UN: tira 3
      { codigo: '90018', caso: 'igual', contado: '258' },   // saldo 258 UN: sem ajuste
      { codigo: '90066', caso: 'zerar', contado: '0' },     // saldo 12 UN, sob o limite de motivo: zera
      { codigo: '80033', caso: 'motivo', contado: '2', motivo: 'Quebra de sacos na recepção (teste do robô)' }, // saldo 9 KG a R$ 9,00: passa do limite e exige motivo
    ], nota: 'Loja 19 (estoque próprio): contado maior, menor, igual, zerar e uma diferença que passa do limite e exige motivo.' },
  { id: '15', loja: 15, nome: 'ODARA', omie: false, local: 'Depósito',
    itens: [
      { codigo: '60176', caso: 'maior', contado: '30' },    // saldo 25 UN: soma 5
      { codigo: '60232', caso: 'menor', contado: '1' },     // saldo 3 UN: tira 2
      { codigo: '60136', caso: 'igual', contado: '5' },     // saldo 5 UN: sem ajuste
      { codigo: '60039', caso: 'zerar', contado: '0' },     // saldo 5 L a R$ 4,806: zera
      { codigo: '60221', caso: 'maior', contado: '62' },    // saldo 50 UN a R$ 0,77: soma 12
    ], nota: 'ODARA (estoque próprio, outra loja real): contado maior (2 itens), menor, igual e zerar, com custo médio de 6 casas.' },
  { id: '4', loja: 4, nome: 'Sertão', omie: true, local: 'DEPOSITO',
    itens: [
      { codigo: '60004', caso: 'maior', contado: '10' },    // posição do Omie 8
      { codigo: '60009', caso: 'menor', contado: '10' },    // posição do Omie 14
      { codigo: '60034', caso: 'igual', contado: '9' },     // posição do Omie 9
      { codigo: '60358', caso: 'zerar', contado: '0' },     // posição do Omie 18
    ], nota: 'Sertão (modo Omie): a contagem é feita pela tela e o envio do ajuste ao Omie é barrado pela trava; o robô registra o que o ERP faz localmente.' },
]
const filtro = (process.env.ROBO_CENARIOS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
const cenariosRodar = CENARIOS.filter((c) => !filtro.length || filtro.includes(c.id))

// ---- Falhas, contadores, achados ----
const falhas: Falha[] = []
const achados: string[] = []
const provas: string[] = []
let conferencias = 0
function falha(loja: string, tela: string, passo: string, esperado: string, mostrado: string, print: string, tipo: TipoFalha = 'conta-divergente') {
  falhas.push({ tipo, gravidade: tipo === 'tela-quebrada' || tipo === 'erro-http-pagina' ? 2 : 1, loja, cargo: 'dono', tela, passo, esperado, mostrado, print })
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
const textoToasts = async (page: Page) => (await page.locator('[data-sonner-toast]').allInnerTexts().catch(() => [])).join(' | ').replace(/\s+/g, ' ')

// ---- Passos da tela ----
async function criarInventario(page: Page, c: Cenario): Promise<{ id: number; limiteTela: string | null; erro: string | null }> {
  const lista = await abrir(page, '/inventario')
  await print(page, `${c.id}-lista-inventarios`)
  // o limite de motivo aparece na própria tela (loja de estoque próprio)
  let limiteTela: string | null = null
  if (!c.omie && /Quando a diferença exige motivo/.test(lista.texto)) limiteTela = await page.getByLabel('Limite em reais').inputValue().catch(() => null)
  await page.getByRole('button', { name: /Novo inventário/ }).click()
  const dialogo = page.getByRole('dialog')
  await dialogo.waitFor({ timeout: 15000 })
  await dialogo.getByRole('combobox').click()
  await page.getByRole('option', { name: c.local, exact: true }).click()
  await print(page, `${c.id}-novo-inventario`)
  await dialogo.getByRole('button', { name: /Criar e contar/ }).click()
  try { await page.waitForURL(/\/inventario\/\d+\/contagem/, { timeout: 30000 }) } catch { return { id: 0, limiteTela, erro: `o inventário não abriu (${await textoToasts(page) || 'sem aviso'})` } }
  const id = Number(page.url().match(/\/inventario\/(\d+)\/contagem/)![1])
  await page.getByPlaceholder('Buscar produto por nome ou código...').waitFor({ timeout: 30000 })
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {})
  await page.waitForTimeout(1500) // hidratação
  return { id, limiteTela, erro: null }
}

async function adicionarProduto(page: Page, codigo: string, descricao: string): Promise<string | null> {
  const campo = page.getByPlaceholder('Buscar produto por nome ou código...')
  void descricao // a lista mostra o nome já formatado (maiúsculas/minúsculas e acento mudam): o código basta
  const opcao = page.locator('button', { hasText: codigo }).first()
  for (let t = 0; t < 4; t++) {
    await campo.fill('')
    await campo.pressSequentially(codigo, { delay: 40 })
    if (await opcao.waitFor({ timeout: 6000 }).then(() => true, () => false)) break
  }
  if (!(await opcao.count())) return 'o produto não apareceu na busca'
  await opcao.click()
  await page.locator('main ul > li', { hasText: codigo }).first().waitFor({ timeout: 15000 }).catch(() => {})
  return (await page.locator('main ul > li', { hasText: codigo }).count()) ? null : 'o produto não entrou na lista da contagem'
}

const STATUS_FINAIS = ['Concluido', 'Aguardando motivo', 'Erro', 'Sem CMC']
async function esperarStatusItem(inventario: number, produto: string, timeout = 60000) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeout) {
    const r = (await q('select status, descricao_status, quan::text quan, diferenca::text dif, valor::text valor, id_ajuste::text aj from inventario_items where inventario_id=$1 and produto_codigo_produto=$2', [inventario, produto]))[0]
    if (r && r.quan !== null && STATUS_FINAIS.includes(r.status)) return r
    await dormir(500)
  }
  return null
}

async function contar(page: Page, inventario: number, codigo: string, produto: string, contado: string) {
  const li = page.locator('main ul > li', { hasText: codigo }).first()
  const campo = li.locator('input[inputmode=decimal]')
  await campo.fill(toBR(contado))
  await campo.press('Tab') // sair do campo envia a contagem
  const r = await esperarStatusItem(inventario, produto)
  await page.waitForTimeout(800)
  return { banco: r, toast: await textoToasts(page), linha: ((await li.innerText().catch(() => '')) || '').replace(/\s+/g, ' ') }
}

type TelaProduto = { saldoTotal: string | null; custoMedio: { valor: string; casas: number } | null; valorCent: bigint | null; locais: Map<string, string> }
const moedaCasas = (t: string | null) => {
  const m = (t ?? '').replace(/ /g, ' ').match(/(-)?\s*R\$\s*(-)?\s*([\d.]+),(\d+)/)
  return m ? { valor: `${m[1] || m[2] ? '-' : ''}${m[3].replace(/\./g, '')}.${m[4]}`, casas: m[4].length } : null
}
function lerProduto(texto: string): TelaProduto {
  const L = texto.replace(/ /g, ' ').split('\n').map((l) => l.trim()).filter(Boolean)
  const antes = (rot: string) => { const i = L.findIndex((l) => l === rot); return i > 0 ? L[i - 1] : null }
  const st = antes('Saldo total')
  const locais = new Map<string, string>()
  const i0 = L.indexOf('Saldo por local'), i1 = L.findIndex((l, i) => i > i0 && l === 'Custo do produto')
  if (i0 >= 0) for (let i = i0 + 1; i < (i1 > 0 ? i1 : L.length); i++) {
    const m = L[i].match(/^(-?[\d.]+(?:,\d+)?)\s+\S+$/)
    if (m && i >= 2) locais.set(L[i - 2], numBR(m[1]))
  }
  const sm = st?.match(/^(-?[\d.]+(?:,\d+)?)\s+\S+$/)
  return { saldoTotal: sm ? numBR(sm[1]) : null, custoMedio: moedaCasas(antes('Custo médio')), valorCent: antes('Valor em estoque') ? centDe(antes('Valor em estoque')!) : null, locais }
}

/** Linhas da tela Ajustes de estoque (uma por movimento): células da tabela. */
async function lerAjustes(page: Page): Promise<string[][]> {
  return (await page.evaluate(() => [...document.querySelectorAll('main table tbody tr')].map((r) => [...r.querySelectorAll('td')].map((td) => (td as HTMLElement).innerText.replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim())))) as string[][]
}

// ---- Leitura do ledger (independente de estoque_saldos) ----
async function ledgerLocal(loja: number, local: string, produto: string): Promise<string> {
  const movs = await q<{ quantidade: string }>('select quantidade::text quantidade from estoque_movimentos where loja_id=$1 and codigo_local_estoque=$2 and codigo_produto=$3', [loja, local, produto])
  const s = saldoPorLedger(movs.map((m) => ({ produto: Number(produto), local: Number(local), quantidade: m.quantidade }) as MovLedger))
  return fmtDec([...s.values()][0] ?? 0n)
}

// ---- Execução de um cenário de estoque próprio ----
async function executarProprio(browser: Awaited<ReturnType<typeof chromium.launch>>, c: Cenario) {
  const nome = c.nome
  const ctx = await novoContexto(browser)
  const page = await ctx.newPage()
  page.setDefaultTimeout(30000)
  await entrar(page, c.loja)
  const local = (await q('select codigo_local_estoque::text l from local_estoques where loja_id=$1 and descricao=$2 and deleted_at is null', [c.loja, c.local]))[0]?.l
  if (!local) throw new Error(`local ${c.local} não existe na loja ${c.loja}`)
  type Info = { it: ItemCenario; id: string; descricao: string; unidade: string; saldoAntes: string; saldoTotalAntes: string; cmc: string; esperado: ReturnType<typeof ajusteEsperado> }
  const infos: Info[] = []
  for (const it of c.itens) {
    const p = (await q('select codigo_produto::text id, descricao, unidade from produtos where loja_id=$1 and codigo=$2', [c.loja, it.codigo]))[0]
    if (!p) throw new Error(`produto ${it.codigo} não existe na loja ${c.loja}`)
    const saldoAntes = await ledgerLocal(c.loja, local, p.id)
    const cs = (await q('select saldo_total::text s, cmc::text m from estoque_custos where loja_id=$1 and codigo_produto=$2', [c.loja, p.id]))[0]
    const sl = (await q('select saldo::text s from estoque_saldos where loja_id=$1 and codigo_produto=$2 and codigo_local_estoque=$3', [c.loja, p.id, local]))[0]?.s ?? '0'
    // a conta do gabarito parte do ledger; se a foto de saldos do ERP já discorda dele ANTES do teste, avisa
    if (fmtDec(parseDec(sl)) !== saldoAntes) achados.push(`${nome}: ANTES do teste, o saldo do ${it.codigo} no local ${c.local} em estoque_saldos (${fmtDec(parseDec(sl))}) já difere da soma do ledger (${saldoAntes}).`)
    infos.push({ it, id: p.id, descricao: p.descricao, unidade: p.unidade, saldoAntes, saldoTotalAntes: fmtDec(parseDec(cs?.s ?? '0')), cmc: fmtDec(parseDec(cs?.m ?? '0')), esperado: ajusteEsperado({ saldo: saldoAntes, contado: it.contado, cmc: cs?.m ?? '0' }) })
  }

  // 1) abrir o inventário pela tela
  const inv = await criarInventario(page, c)
  const p0 = await print(page, `${c.id}-contagem-vazia`)
  if (inv.erro) { falha(nome, '/inventario', 'abrir um inventário novo pela tela', 'inventário aberto', inv.erro, p0, 'tela-quebrada'); await ctx.close(); return }
  const limite = (inv.limiteTela ?? '50').replace(',', '.')
  provas.push(`${c.id}: inventário #${inv.id} aberto no local ${c.local} pela tela; limite de motivo mostrado na tela = R$ ${limite}`)
  const invRow = (await q('select status, codigo_local_estoque::text l, data::text d from inventarios where id=$1 and loja_id=$2', [inv.id, c.loja]))[0]
  conferir(nome, '/inventario', 'inventário criado em contagem no local escolhido', `Em contagem|${local}`, invRow ? `${invRow.status}|${invRow.l}` : 'não existe', p0, 'tela-quebrada')

  // 2) somar e contar item a item, como a pessoa
  for (const x of infos) {
    const rotulo = `${x.it.codigo} ${x.descricao} (${x.it.caso}, saldo ${x.saldoAntes} -> contado ${x.it.contado})`
    const erroAdd = await adicionarProduto(page, x.it.codigo, x.descricao)
    if (erroAdd) { falha(nome, `/inventario/${inv.id}/contagem`, `adicionar ${rotulo}`, 'produto na contagem', erroAdd, await print(page, `${c.id}-add-${x.it.codigo}`), 'tela-quebrada'); continue }
    const r = await contar(page, inv.id, x.it.codigo, x.id, x.it.contado)
    const pp = await print(page, `${c.id}-contado-${x.it.codigo}`)
    provas.push(`${c.id} ${rotulo}: aviso = "${r.toast}"; linha = "${r.linha.slice(0, 200)}"`)
    if (!r.banco) { falha(nome, `/inventario/${inv.id}/contagem`, `contar ${rotulo}`, 'item processado', 'item sem resposta em 60 s', pp, 'timeout'); continue }
    const tela = `/inventario/${inv.id}/contagem`
    const exigeMotivo = exigeMotivoEsperado(x.esperado.valor, limite)
    conferir(nome, tela, `item ${rotulo}: pede motivo só quando o valor passa do limite de R$ ${limite}`, exigeMotivo ? 'Aguardando motivo' : 'Concluido', r.banco.status, pp, 'conta-divergente')
    if (r.banco.status === 'Aguardando motivo') {
      conferir(nome, tela, `item ${rotulo}: a tela mostra o campo do motivo`, 'campo de motivo', (await page.getByPlaceholder(/Motivo da diferença/).count()) ? 'campo de motivo' : 'sem campo', pp, 'tela-quebrada')
      conferir(nome, tela, `item ${rotulo}: o saldo ainda não mudou enquanto aguarda o motivo (ledger)`, x.saldoAntes, await ledgerLocal(c.loja, local, x.id), pp, 'saldo-divergente')
      if (!x.it.motivo) continue
      await page.getByPlaceholder(/Motivo da diferença/).fill(x.it.motivo)
      await page.getByRole('button', { name: 'Lançar com motivo' }).click()
      const t0 = Date.now()
      let depois = r.banco
      while (Date.now() - t0 < 60000) {
        depois = (await esperarStatusItem(inv.id, x.id, 2000)) ?? depois
        if (depois.status === 'Concluido') break
        await dormir(500)
      }
      await page.waitForTimeout(800)
      conferir(nome, tela, `item ${rotulo}: depois de informar o motivo o ajuste é lançado`, 'Concluido', depois.status, await print(page, `${c.id}-motivo-${x.it.codigo}`), 'tela-quebrada')
    }
  }

  // 3) a tela mostra a diferença certa em cada item (antes de concluir)
  for (const x of infos) {
    const linha = ((await page.locator('main ul > li', { hasText: x.it.codigo }).first().innerText().catch(() => '')) || '').replace(/\s+/g, ' ')
    const m = linha.match(/Diferença:\s*([+-]?[\d.]+(?:,\d+)?)/)
    const mostrado = m ? numBR(m[1].replace('+', '')) : (x.esperado.geraAjuste ? 'sem linha de diferença' : '0')
    conferir(nome, `/inventario/${inv.id}/contagem`, `diferença mostrada na linha do item ${x.it.codigo} ${x.descricao}`, x.esperado.diferenca, mostrado, await print(page, `${c.id}-linha-${x.it.codigo}`), 'saldo-divergente')
  }

  // 4) concluir pela tela
  const aceitar = (d: import('playwright').Dialog) => { void d.accept() }
  page.on('dialog', aceitar)
  await page.getByRole('button', { name: /Concluir inventário/ }).click()
  await page.locator('[data-sonner-toast]', { hasText: /Inventário concluído|Erro/ }).first().waitFor({ timeout: 60000 }).catch(() => {})
  await page.waitForTimeout(1500)
  page.off('dialog', aceitar)
  const pFim = await print(page, `${c.id}-concluido`)
  provas.push(`${c.id}: ao concluir, aviso = "${await textoToasts(page)}"`)
  const invFim = (await q('select status, finalizado is not null fim from inventarios where id=$1', [inv.id]))[0]
  conferir(nome, `/inventario/${inv.id}/contagem`, 'inventário concluído (status no banco)', 'Finalizado', invFim?.status ?? 'sem inventário', pFim, 'tela-quebrada')

  // 5) banco x gabarito (a prova do cálculo) e tela x gabarito (a prova do que a pessoa vê)
  const lista = await abrir(page, '/inventario')
  const pLista = await print(page, `${c.id}-lista-depois`)
  const linhaLista = lista.texto.split('\n').map((s) => s.trim()).filter(Boolean)
  const iInv = linhaLista.findIndex((l) => l.startsWith(`#${inv.id} `))
  const blocoLista = iInv >= 0 ? linhaLista.slice(iInv, iInv + 8).join(' ') : 'inventário não aparece na lista'
  conferir(nome, '/inventario', `lista de Inventários: #${inv.id} aparece Finalizado com ${infos.length}/${infos.length} lançados`, 'Finalizado, ' + `${infos.length}/${infos.length}`, `${/Finalizado/.test(blocoLista) ? 'Finalizado' : 'não finalizado'}, ${blocoLista.match(/(?<![\d/])(\d+)\/(\d+)(?![\d/])/)?.[0] ?? 'sem contagem'}`, pLista)
  await abrir(page, '/estoque/ajustes')
  const pAj = await print(page, `${c.id}-ajustes`)
  const linhasAj = await lerAjustes(page)
  for (const x of infos) {
    const rotulo = `${x.it.codigo} ${x.descricao}`
    const e = x.esperado
    const tp = '/estoque/produto'
    const saldoDepoisLedger = await ledgerLocal(c.loja, local, x.id)
    conferir(nome, tp, `saldo do local ${c.local} depois do ajuste (soma do ledger) = contado, item ${rotulo}`, e.saldoDepois, saldoDepoisLedger, pAj, 'saldo-divergente')
    const cs = (await q('select saldo_total::text s, cmc::text m from estoque_custos where loja_id=$1 and codigo_produto=$2', [c.loja, x.id]))[0]
    const sl = (await q('select saldo::text s from estoque_saldos where loja_id=$1 and codigo_produto=$2 and codigo_local_estoque=$3', [c.loja, x.id, local]))[0]?.s ?? '0'
    conferir(nome, tp, `saldo do local no banco (estoque_saldos) = contado, item ${rotulo}`, e.saldoDepois, fmtDec(parseDec(sl)), pAj, 'saldo-divergente')
    conferir(nome, tp, `saldo total no banco = saldo total de antes + ajuste, item ${rotulo}`, fmtDec(parseDec(x.saldoTotalAntes) + parseDec(e.diferenca)), fmtDec(parseDec(cs?.s ?? '0')), pAj, 'saldo-divergente')
    conferir(nome, tp, `custo médio não muda com o ajuste, item ${rotulo}`, e.cmcDepois, fmtDec(parseDec(cs?.m ?? '0')), pAj)
    const item = (await q('select status, quan::text quan, diferenca::text dif, valor::text valor, id_ajuste::text aj, descricao_status ds, motivo from inventario_items where inventario_id=$1 and produto_codigo_produto=$2', [inv.id, x.id]))[0]
    conferir(nome, 'banco (inventario_items)', `item ${rotulo}: quantidade contada gravada`, fmtDec(parseDec(x.it.contado)), item ? fmtDec(parseDec(item.quan)) : 'item sumiu', pAj, 'saldo-divergente')
    conferir(nome, 'banco (inventario_items)', `item ${rotulo}: diferença gravada = contado - saldo`, e.diferenca, item ? fmtDec(parseDec(item.dif ?? '0')) : 'item sumiu', pAj, 'saldo-divergente')
    conferir(nome, 'banco (inventario_items)', `item ${rotulo}: custo usado no item = custo médio de antes`, fmtDec(parseDec(x.cmc)), item ? fmtDec(parseDec(item.valor ?? '0')) : 'item sumiu', pAj)
    if (x.it.motivo) conferir(nome, 'banco (inventario_items)', `item ${rotulo}: o motivo informado fica gravado`, x.it.motivo, item?.motivo ?? 'sem motivo', pAj, 'tela-quebrada')
    const doItem = (await q<{ id: string; tipo: string; quantidade: string; custo: string | null; cmc_apos: string | null }>(
      "select m.id::text, m.tipo, m.quantidade::text, m.custo_unitario::text custo, m.cmc_apos::text from estoque_movimentos m join inventario_items i on m.ref like 'inv:' || i.id || ':%' where i.inventario_id=$1 and i.produto_codigo_produto=$2 and m.loja_id=$3 and m.origem='INVENTARIO' and m.reverses_id is null", [inv.id, x.id, c.loja]))
    conferir(nome, 'banco (estoque_movimentos)', `item ${rotulo}: ${e.geraAjuste ? 'um movimento de ajuste (AJU) foi gravado' : 'nenhum movimento foi gravado (contado = saldo)'}`, e.geraAjuste ? '1' : '0', String(doItem.length), pAj, 'saldo-divergente')
    if (e.geraAjuste && doItem[0]) {
      conferir(nome, 'banco (estoque_movimentos)', `item ${rotulo}: quantidade do movimento = diferença`, e.diferenca, fmtDec(parseDec(doItem[0].quantidade)), pAj, 'saldo-divergente')
      conferir(nome, 'banco (estoque_movimentos)', `item ${rotulo}: tipo do movimento`, 'AJU', doItem[0].tipo, pAj, 'saldo-divergente')
      conferir(nome, 'banco (estoque_movimentos)', `item ${rotulo}: custo do movimento = custo médio`, fmtDec(parseDec(x.cmc)), doItem[0].custo ? fmtDec(parseDec(doItem[0].custo)) : 'sem custo', pAj)
    }

    // tela Ajustes de estoque: quantidade, custo unitário e valor do ajuste
    const lin = linhasAj.find((cel) => cel.join(' ').includes(`Inventário #${inv.id}`) && cel.join(' ').includes(x.it.codigo))
    if (!e.geraAjuste) {
      conferir(nome, '/estoque/ajustes', `item ${rotulo} (igual ao saldo) não gera linha na tela de Ajustes`, 'nenhuma linha', lin ? 'tem linha' : 'nenhuma linha', pAj, 'saldo-divergente')
    } else if (!lin) {
      falha(nome, '/estoque/ajustes', `linha do ajuste do item ${rotulo} (Inventário #${inv.id})`, 'linha presente', 'não aparece', pAj, 'conta-divergente'); conferencias++
    } else {
      const cel = lin.join(' | ')
      const qtd = lin.find((s) => /^[+-]?[\d.]+(?:,\d+)?\s+\S+$/.test(s))
      const moedas = lin.map(centDe).filter((m): m is bigint => m !== null)
      conferir(nome, '/estoque/ajustes', `quantidade do ajuste na tela, item ${rotulo} (até 3 casas)`, arredondarTexto(e.diferenca, 3), qtd ? arredondarTexto(numBR(qtd.split(/\s+/)[0].replace('+', '')), 3) : `não achei (${cel.slice(0, 120)})`, pAj, 'saldo-divergente')
      conferir(nome, '/estoque/ajustes', `valor do ajuste na tela = diferença x custo médio (R$, sem sinal), item ${rotulo}`, brl(abs(e.valorCent)), moedas.length >= 2 ? brl(abs(moedas[moedas.length - 1])) : `não achei (${cel.slice(0, 120)})`, pAj)
      const custoTela = lin.map(moedaCasas).filter(Boolean)[0]
      if (custoTela) conferir(nome, '/estoque/ajustes', `custo unitário do ajuste na tela, item ${rotulo} (casas mostradas)`, `R$ ${arredondarTexto(x.cmc, custoTela.casas)}`, `R$ ${arredondarTexto(custoTela.valor, custoTela.casas)}`, pAj)
      conferir(nome, '/estoque/ajustes', `tipo do ajuste na tela, item ${rotulo}`, e.sentido === 'entrada' ? 'Entrada' : 'Saída', lin.includes('Entrada') ? 'Entrada' : lin.includes('Saída') ? 'Saída' : `não achei (${cel.slice(0, 120)})`, pAj)
    }

    // tela do produto: saldo, custo médio e valor em estoque depois do ajuste
    const t = await abrir(page, `/estoque/produto/${x.id}`)
    const pp = await print(page, `${c.id}-produto-${x.it.codigo}`)
    const tela = lerProduto(t.texto)
    const totalEsp = fmtDec(parseDec(x.saldoTotalAntes) + parseDec(e.diferenca))
    conferir(nome, tp, `saldo total mostrado (até 3 casas), item ${rotulo}`, arredondarTexto(totalEsp, 3), tela.saldoTotal === null ? 'não achei' : arredondarTexto(tela.saldoTotal, 3), pp, 'saldo-divergente')
    conferir(nome, tp, `saldo mostrado no local ${c.local} = contado (até 3 casas), item ${rotulo}`, arredondarTexto(e.saldoDepois, 3), tela.locais.has(c.local) ? arredondarTexto(tela.locais.get(c.local)!, 3) : (parseDec(e.saldoDepois) === 0n ? arredondarTexto('0', 3) + ' (local sem linha na tela)' : 'não achei'), pp, 'saldo-divergente')
    if (tela.custoMedio) conferir(nome, tp, `custo médio mostrado não mudou (casas mostradas), item ${rotulo}`, `R$ ${arredondarTexto(e.cmcDepois, tela.custoMedio.casas)}`, `R$ ${arredondarTexto(tela.custoMedio.valor, tela.custoMedio.casas)}`, pp)
    else conferir(nome, tp, `custo médio mostrado, item ${rotulo}`, 'mostrado', 'não achei', pp)
    const vEsp = BigInt(arredondarCent(parseDec(totalEsp) * parseDec(e.cmcDepois) / 10n ** 9n))
    const dentro = tela.valorCent !== null && abs(tela.valorCent - vEsp) <= 1n
    conferir(nome, tp, `valor em estoque mostrado (saldo total x custo médio, ±1 centavo), item ${rotulo}`, brl(vEsp), tela.valorCent === null ? 'não achei' : dentro ? brl(vEsp) : brl(tela.valorCent), pp)
  }
  await ctx.close()
}
/** centavos (meia para longe do zero) de um valor na escala de 9 casas */
function arredondarCent(v: bigint): bigint { const passo = 10n ** 7n; const q = (abs(v) * 2n + passo) / (passo * 2n); return v < 0n ? -q : q }

// ---- Modo Omie (Sertão, loja 4): a contagem é feita pela tela; o envio ao Omie é barrado pela trava ----
async function executarOmie(browser: Awaited<ReturnType<typeof chromium.launch>>, c: Cenario) {
  const nome = c.nome
  const antes = await lojaExtra(c.loja)
  const t0 = new Date(Date.now() - 2000).toISOString()
  const ctx = await novoContexto(browser)
  const page = await ctx.newPage()
  page.setDefaultTimeout(30000)
  await entrar(page, c.loja)
  const local = (await q('select codigo_local_estoque::text l from local_estoques where loja_id=$1 and descricao=$2 and deleted_at is null', [c.loja, c.local]))[0]?.l
  const infos: { it: ItemCenario; id: string; descricao: string; posicao: string; cmc: string }[] = []
  for (const it of c.itens) {
    const p = (await q('select codigo_produto::text id, descricao from produtos where loja_id=$1 and codigo=$2', [c.loja, it.codigo]))[0]
    if (!p) throw new Error(`produto ${it.codigo} não existe na loja ${c.loja}`)
    const pos = (await q('select n_saldo::text s, n_cmc::text m from posicao_estoques where loja_id=$1 and n_cod_prod=$2 and codigo_local_estoque=$3 order by data_posicao desc limit 1', [c.loja, p.id, local]))[0]
    infos.push({ it, id: p.id, descricao: p.descricao, posicao: fmtDec(parseDec(pos?.s ?? '0')), cmc: fmtDec(parseDec(pos?.m ?? '0')) })
  }
  const inv = await criarInventario(page, c)
  const p0 = await print(page, `${c.id}-contagem-vazia`)
  if (inv.erro) { falha(nome, '/inventario', 'abrir um inventário novo pela tela', 'inventário aberto', inv.erro, p0, 'tela-quebrada'); await ctx.close(); return }
  provas.push(`${c.id}: inventário #${inv.id} aberto no local ${c.local} pela tela (loja com Omie: a tela de Inventários existe e abre)`)
  for (const x of infos) {
    const rotulo = `${x.it.codigo} ${x.descricao} (${x.it.caso}, posição do Omie ${x.posicao} -> contado ${x.it.contado})`
    const erroAdd = await adicionarProduto(page, x.it.codigo, x.descricao)
    if (erroAdd) { falha(nome, `/inventario/${inv.id}/contagem`, `adicionar ${rotulo}`, 'produto na contagem', erroAdd, await print(page, `${c.id}-add-${x.it.codigo}`), 'tela-quebrada'); continue }
    const r = await contar(page, inv.id, x.it.codigo, x.id, x.it.contado)
    const pp = await print(page, `${c.id}-contado-${x.it.codigo}`)
    provas.push(`${c.id} ${rotulo}: item no banco = ${JSON.stringify(r.banco)}; aviso na tela = "${r.toast}"; linha = "${r.linha.slice(0, 200)}"`)
    const tela = `/inventario/${inv.id}/contagem`
    if (!r.banco) { falha(nome, tela, `contar ${rotulo}`, 'item processado', 'item sem resposta em 60 s', pp, 'timeout'); continue }
    conferir(nome, tela, `item ${rotulo}: o ajuste NÃO é dado como lançado (Omie barrado)`, 'não lançado', r.banco.status === 'Concluido' ? 'Concluido (falso sucesso)' : 'não lançado', pp, 'tela-quebrada')
    conferir(nome, tela, `item ${rotulo}: nenhum id de ajuste gravado`, 'sem id', r.banco.aj ?? 'sem id', pp, 'tela-quebrada')
    conferir(nome, tela, `item ${rotulo}: a tela avisa que não foi lançado (aviso de erro, não de sucesso)`, 'aviso de erro', /Item integrado ao Omie/.test(r.toast) ? 'aviso de sucesso' : /Erro|Falha|bloque|Sem custo|não/i.test(r.toast + ' ' + r.linha) ? 'aviso de erro' : `sem aviso claro ("${r.toast}")`, pp, 'tela-quebrada')
  }
  const aceitar = (d: import('playwright').Dialog) => { void d.accept() }
  page.on('dialog', aceitar)
  const botao = page.getByRole('button', { name: /Concluir inventário/ })
  if (await botao.isEnabled().catch(() => false)) {
    await botao.click()
    await page.locator('[data-sonner-toast]').first().waitFor({ timeout: 30000 }).catch(() => {})
    await page.waitForTimeout(2500)
  }
  page.off('dialog', aceitar)
  const pFim = await print(page, `${c.id}-concluir`)
  const invFim = (await q('select status from inventarios where id=$1', [inv.id]))[0]
  const itensFim = await q('select p.codigo, i.status, i.descricao_status, i.id_ajuste::text aj, i.tentativas::text t from inventario_items i join produtos p on p.loja_id=i.loja_id and p.codigo_produto=i.produto_codigo_produto where i.inventario_id=$1 order by i.id', [inv.id])
  provas.push(`${c.id}: depois de "Concluir inventário": status do inventário = ${invFim?.status}; aviso = "${await textoToasts(page)}"; itens = ${JSON.stringify(itensFim)}`)
  achados.push(`Sertão: ao concluir o inventário #${inv.id} com os 4 itens barrados pela trava do Omie, o inventário ficou "${invFim?.status}" e os itens ficaram ${[...new Set(itensFim.map((i) => i.status))].join('/')} (${pFim}).`)
  await ctx.close()

  // o que o ERP fez localmente e o que saiu
  const depois = await lojaExtra(c.loja)
  conferir(nome, 'banco da loja 4', 'nenhum movimento foi gravado no ledger local (loja com Omie não usa o ledger)', antes.movimentos_ledger, depois.movimentos_ledger, pFim)
  conferir(nome, 'banco da loja 4', 'nenhuma baixa/ajuste novo na tabela de movimentos do Omie (movimentos)', antes.movimentos_omie, depois.movimentos_omie, pFim)
  conferir(nome, 'banco da loja 4', 'a posição de estoque espelhada do Omie não mudou', antes.posicao, depois.posicao, pFim)
  conferir(nome, 'banco da loja 4', 'saldo local (estoque_saldos) não mudou', antes.saldo_total, depois.saldo_total, pFim)
  const tent = await q<{ model: string | null; error_message: string | null; code: string | null }>('select model, error_message, code from integration_attempts where loja_id=$1 and created_at >= $2', [c.loja, t0])
  const fora = tent.filter((t) => !/Omie bloqueado neste ambiente/.test(t.error_message ?? ''))
  conferir(nome, 'trava do Omie', 'toda tentativa registrada contra o Omie terminou na trava (nenhuma escapou)', '0', String(fora.length), pFim, 'conta-divergente')
  provas.push(`${c.id}: ${tent.length} tentativa(s) ao Omie registradas durante o teste: ${JSON.stringify(tent.map((t) => ({ model: t.model, erro: (t.error_message ?? '').slice(0, 90) })))}`)
  const itensErro = await q<{ status: string; descricao_status: string | null }>('select status, descricao_status from inventario_items where inventario_id=$1', [inv.id])
  conferir(nome, 'trava do Omie', 'o motivo da falha dos itens é a trava do ambiente (mensagem clara)', String(itensErro.length), String(itensErro.filter((i) => /Omie bloqueado neste ambiente/.test(i.descricao_status ?? '')).length), pFim, 'tela-quebrada')
  const omie = externos.filter((e) => /omie/i.test(e))
  conferir(nome, 'navegador', 'nenhuma requisição do navegador para o Omie', '0', String(omie.length), pFim)
  provas.push(`${c.id}: requisições externas bloqueadas no navegador: ${externos.length} (para o Omie: ${omie.length})`)
}

// ---- Reset e prova ----
async function resetarEProvar(fotoAntes: Record<string, string>, extraAntes: Record<string, unknown>, mudou: string[]): Promise<{ provado: boolean | null; detalhe: string }> {
  if (process.env.ROBO_SEM_RESET === '1') return { provado: null, detalhe: 'ROBO_SEM_RESET=1: a cópia NÃO foi resetada nesta rodada (prova de volta ao estado inicial pendente)' }
  await db.end().catch(() => {})
  console.log('voltando a cópia ao estado inicial: scripts/local/local.sh resetar (2 a 3 min)...')
  const r = spawnSync('bash', [path.join(RAIZ, 'scripts', 'local', 'local.sh'), 'resetar'], { cwd: RAIZ, stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  fs.appendFileSync(path.join(SAIDA, 'resetar.log'), `${r.stdout}\n${r.stderr}\n`)
  if (r.status !== 0) return { provado: false, detalhe: `resetar falhou (código ${r.status}); veja resetar.log` }
  let ok = false
  for (let i = 0; i < 60 && !ok; i++) {
    try { db = await abrirBanco(); await q('select 1'); ok = true } catch { await dormir(3000) }
  }
  if (!ok) return { provado: false, detalhe: 'banco não voltou depois do resetar' }
  logins = lerLogins()
  const depois = await foto()
  const extraDepois = Object.fromEntries(await Promise.all([4, 15, 19].map(async (l) => [l, await lojaExtra(l)])))
  const dif = Object.keys({ ...fotoAntes, ...depois }).filter((k) => fotoAntes[k] !== depois[k])
  const difLoja = [4, 15, 19].flatMap((l) => Object.keys(extraAntes[l] as object).filter((k) => (extraAntes[l] as Record<string, string>)[k] !== (extraDepois[l] as Record<string, string>)[k]).map((k) => `loja ${l} ${k}`))
  const provado = dif.length === 0 && difLoja.length === 0
  return { provado, detalhe: provado
    ? `a cópia voltou ao estado inicial: ${Object.keys(depois).length} contagens/impressões digitais de tabelas, saldos e custos, e totais por loja 4/15/19 iguais às de antes do teste (${mudou.length} tabelas tinham mudado durante o teste: ${mudou.join(', ') || 'nenhuma'})`
    : `DIFERENÇAS depois do resetar: ${[...dif, ...difLoja].join(', ')}` }
}

// ---- Execução ----
const t0 = Date.now()
const browser = await chromium.launch()
const resets: string[] = []
let resetProvadoTudo: boolean | null = true
const tabelasGravadas = new Set<string>()
for (const c of cenariosRodar) {
  console.log(`cenário ${c.id}: ${c.nota}`)
  const fotoAntes = await foto()
  const extraAntes = Object.fromEntries(await Promise.all([4, 15, 19].map(async (l) => [l, await lojaExtra(l)])))
  fs.writeFileSync(path.join(SAIDA, `foto-antes-${c.id}.json`), JSON.stringify({ fotoAntes, extraAntes }, null, 1))
  try { await (c.omie ? executarOmie(browser, c) : executarProprio(browser, c)) } catch (e) { falha(c.nome, '(robô)', `cenário ${c.id}`, 'executar sem erro', String(e instanceof Error ? e.message : e).slice(0, 300), 'prints/(sem print)', 'tela-quebrada') }
  const fotoDepoisTeste = await foto()
  const mudou = Object.keys(fotoDepoisTeste).filter((k) => fotoDepoisTeste[k] !== fotoAntes[k])
  mudou.forEach((m) => tabelasGravadas.add(m))
  console.log(`o teste gravou na cópia (tabelas diferentes da foto inicial): ${mudou.join(', ') || 'nada'}`)
  const rp = await resetarEProvar(fotoAntes, extraAntes, mudou)
  console.log(`${c.id}: ${rp.detalhe}`)
  resets.push(`${c.id}: ${rp.detalhe}`)
  if (rp.provado === false) resetProvadoTudo = false
  else if (rp.provado === null && resetProvadoTudo !== false) resetProvadoTudo = null
}
await browser.close()
await db.end().catch(() => {})

// ---- Saídas ----
const ordenadas = ordenarFalhas(falhas)
const md = formatarListaFalhas(ordenadas, { visitas: conferencias, telas: 5, logins: cenariosRodar.length })
fs.writeFileSync(path.join(SAIDA, 'falhas.md'), md)
const evid = [`# Evidências da rodada ${ID_RODADA}`, '', `Conferências feitas: ${conferencias}. Falhas: ${ordenadas.length}.`, '', '## Provas e avisos da tela', ...provas.map((p) => `- ${p}`), '', '## Achados que não são falha do robô', ...achados.map((a) => `- ${a}`), '',
  '## Volta ao estado inicial (depois de cada loja)', ...resets.map((r) => `- ${r}`), '']
fs.writeFileSync(path.join(SAIDA, 'evidencias.md'), evid.join('\n'))
fs.writeFileSync(path.join(SAIDA, 'resumo.json'), JSON.stringify({ rodada: ID_RODADA, urlBase: ORIGEM, cenarios: cenariosRodar.map((c) => c.id), conferencias, falhas: ordenadas.length, tabelasGravadasPeloTeste: [...tabelasGravadas], resetProvado: resetProvadoTudo, resets, externosBloqueados: externos.length, sha256FalhasMd: crypto.createHash('sha256').update(md).digest('hex'), segundos: Math.round((Date.now() - t0) / 1000) }, null, 1))
console.log(`conferências: ${conferencias} | falhas: ${ordenadas.length} | saída: ${SAIDA}`)
process.exit(resetProvadoTudo === false ? 1 : 0)
void ehPaginaNaoEncontrada
