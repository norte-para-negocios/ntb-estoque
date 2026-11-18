// Robô da venda do Norte Vendas (ticket 05). Simula o Vendas chamando a API de integração do ERP (POST /api/integracao/ordem-producao,
// GET .../status e POST /api/integracao/venda/estornar, com a chave por loja) e confere a baixa de estoque e a ordem de produção
// contra o gabarito independente (e2e/robo/venda-gabarito.ts: ficha x quantidade vendida, função pura testada à mão). Lê o resultado
// na TELA do ERP (Movimentações e Ordens de Produção), como uma pessoa, e também no banco (sessão read-only).
// Escreve na cópia local SÓ para: (1) gravar uma chave de integração de teste por loja, (2) provocar uma falha local e depois
// desfazê-la (mapa de local inexistente) e (3) dar uma chave Omie FALSA à loja 4 para exercitar a fila (a trava
// NTB_OMIE_BLOQUEADO=1 barra antes de qualquer chamada; nunca é desligada). Tudo some no `local.sh resetar` do fim, que o robô prova.
// Uso: npm run robo:venda   (saída em .local-data/robo-venda/<rodada>/, fora do git)
// Variáveis: ROBO_CENARIOS=odara,sertao (filtra), ROBO_SEM_RESET=1 (não reseta no fim; prova do reset fica pendente).
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import pg from 'pg'
import { chromium, type Page, type BrowserContext } from 'playwright'
import { validarUrlBase, validarAmbienteLocal, PORTA_ERP_LOCAL } from './trava-url.ts'
import { formatarListaFalhas, ordenarFalhas, type Falha, type TipoFalha } from './relatorio.ts'
import { parseDec, fmtDec, lerNumeroBR } from './saldo-gabarito.ts'
import { movimentosEsperados, saldoLiquido, resolverLocal, consumoDaFicha, type FichaGab, type ItemVendaGab, type LojaGab, type MovEsperado } from './venda-gabarito.ts'

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
const envTexto = fs.readFileSync(envLocal, 'utf8')
const va = validarAmbienteLocal(envTexto)
if (!va.ok) sair(va.motivo)
const CRON_SECRET = envTexto.match(/^CRON_SECRET=(.*)$/m)?.[1]?.trim().replace(/^["']|["']$/g, '')
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
const SAIDA = path.join(RAIZ, '.local-data', 'robo-venda', ID_RODADA)
fs.mkdirSync(path.join(SAIDA, 'prints'), { recursive: true })
const SUF = crypto.randomBytes(3).toString('hex')

async function abrirBanco(somenteLeitura: boolean) {
  const c = new pg.Client({ host: '127.0.0.1', port: PORTA_PG_LOCAL, user: 'postgres', password: senhaPg, database: 'postgres', ...(somenteLeitura ? { options: '-c default_transaction_read_only=on' } : {}) })
  await c.connect()
  return c
}
let db = await abrirBanco(true)
const q = async <T = Record<string, string>>(sql: string, args: unknown[] = []) => (await db.query({ text: sql, values: args })).rows as T[]
// Banco de ESCRITA: usado só pelas 4 funções abaixo (chave de integração, falha local, chave Omie falsa, adiantar a fila).
let dbw = await abrirBanco(false)
const escrever = async (sql: string, args: unknown[] = []) => { await dbw.query({ text: sql, values: args }) }

const brl = (n: number) => n.toLocaleString('pt-BR')
const chaveIntegracao = new Map<number, string>()
async function gerarChaveDeTeste(loja: number) {
  const k = `robo-venda-${loja}-${crypto.randomBytes(8).toString('hex')}`
  await escrever('update lojas set integracao_api_key = $2 where id = $1', [loja, k])
  chaveIntegracao.set(loja, k)
}

// ---- Falhas, contadores, achados ----
const falhas: Falha[] = []
const achados: string[] = []
const provas: string[] = []
let conferencias = 0
function falha(loja: string, tela: string, passo: string, esperado: string, mostrado: string, print: string, tipo: TipoFalha = 'conta-divergente') {
  falhas.push({ tipo, gravidade: tipo === 'tela-quebrada' || tipo === 'erro-http-requisicao' ? 2 : 1, loja, cargo: 'dono', tela, passo, esperado, mostrado, print })
}
function conferir(loja: string, tela: string, passo: string, esperado: string, mostrado: string, print = 'prints/(sem print)', tipo: TipoFalha = 'conta-divergente') {
  conferencias++
  if (esperado !== mostrado) falha(loja, tela, passo, esperado, mostrado, print, tipo)
}

// ---- API de integração (o mesmo que o Norte Vendas chama) ----
type Resp = { status: number; json: any }
async function api(loja: number, metodo: 'GET' | 'POST', rota: string, corpo?: unknown): Promise<Resp> {
  const r = await fetch(`${ORIGEM}${rota}`, {
    method: metodo,
    headers: { authorization: `Bearer ${chaveIntegracao.get(loja)}`, ...(corpo ? { 'content-type': 'application/json' } : {}) },
    body: corpo ? JSON.stringify(corpo) : undefined,
    signal: AbortSignal.timeout(180000),
  })
  return { status: r.status, json: await r.json().catch(() => null) }
}
const enviarVenda = (loja: number, corpo: unknown) => api(loja, 'POST', '/api/integracao/ordem-producao', corpo)
const estornarVenda = (loja: number, pedidoRef: string) => api(loja, 'POST', '/api/integracao/venda/estornar', { pedidoRef })
async function cron(rota: string): Promise<Resp> {
  const r = await fetch(`${ORIGEM}${rota}`, { headers: { authorization: `Bearer ${CRON_SECRET}` }, signal: AbortSignal.timeout(280000) })
  return { status: r.status, json: await r.json().catch(() => null) }
}

// ---- Documentos lidos do banco (entradas do gabarito, não a conta) ----
type LojaCfg = LojaGab & { id: number }
async function lojaCfg(loja: number): Promise<LojaCfg> {
  const r = (await q<any>('select local_estoque_cozinha_codigo c, local_estoque_bar_codigo b, local_estoque_por_setor s, local_estoque_por_produto p from lojas where id=$1', [loja]))[0]
  const pad = (await q<any>("select codigo_local_estoque c from local_estoques where loja_id=$1 and padrao='S' order by id limit 1", [loja]))[0]
  return { id: loja, padrao: pad ? Number(pad.c) : null, cozinha: r.c ? Number(r.c) : null, bar: r.b ? Number(r.b) : null, porSetor: r.s, porProduto: r.p }
}
const produtoPorCodigo = async (loja: number, codigo: string) => (await q<any>('select codigo, codigo_produto::text id, tipo_item, descricao from produtos where loja_id=$1 and codigo=$2', [loja, codigo]))[0]
async function fichaDe(loja: number, codigo: string): Promise<FichaGab | undefined> {
  const rows = await q<any>(`select f.rendimento::text rend, pi.codigo ins, i.quantidade_liquida::text liq, i.fator_correcao::text fator, i.perda_pct::text perda
    from produtos p join fichas_tecnicas f on f.loja_id=p.loja_id and f.codigo_produto=p.codigo_produto and f.ativa
    join ficha_tecnica_itens i on i.ficha_id=f.id join produtos pi on pi.loja_id=f.loja_id and pi.codigo_produto=i.codigo_insumo
    where p.loja_id=$1 and p.codigo=$2 order by i.ordem, i.id`, [loja, codigo])
  if (!rows.length) return undefined
  return { rendimento: rows[0].rend, itens: rows.map((r) => ({ insumo: r.ins, liquida: r.liq, fator: r.fator, perda: r.perda })) }
}
const locaisDesc = async (loja: number) => new Map((await q<any>('select codigo_local_estoque::text c, descricao from local_estoques where loja_id=$1', [loja])).map((r) => [Number(r.c), r.descricao as string]))

// Saldos por "codigo:local" de uma lista de produtos (estado do banco, como foto antes/depois).
async function saldos(loja: number, codigos: string[], locais: number[]): Promise<Map<string, string>> {
  const rows = await q<any>(`select p.codigo, s.codigo_local_estoque::text l, s.saldo::text saldo from estoque_saldos s join produtos p on p.loja_id=s.loja_id and p.codigo_produto=s.codigo_produto
    where s.loja_id=$1 and p.codigo = any($2) and s.codigo_local_estoque = any($3::bigint[])`, [loja, codigos, locais])
  const m = new Map<string, string>()
  for (const c of codigos) for (const l of locais) m.set(`${c}:${l}`, '0')
  for (const r of rows) m.set(`${r.codigo}:${r.l}`, r.saldo)
  return m
}
const dif = (a: string, b: string) => fmtDec(parseDec(a) - parseDec(b))

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
let nPrint = 0
const print = async (page: Page, nome: string) => {
  const rel = `prints/${String(++nPrint).padStart(2, '0')}-${nome.replace(/[^a-z0-9]+/gi, '-')}.png`
  await page.screenshot({ path: path.join(SAIDA, rel) }).catch(() => {})
  return rel
}
async function abrir(page: Page, rota: string) {
  await page.goto(`${ORIGEM}${rota}`, { waitUntil: 'domcontentloaded', timeout: 90000 })
  await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {})
  await page.waitForTimeout(800)
}

// Linha da tela Movimentações (loja de estoque próprio): colunas Data, Tipo (+selo), Produto (nome / "código · obs"), Quantidade, Local, Origem, ...
type LinhaTela = { tipo: string; selo: string; codigo: string; obs: string; quantidade: string; local: string; origem: string }
async function lerMovimentacoes(page: Page, termo: string): Promise<{ linhas: LinhaTela[]; total: number | null; print: string }> {
  await abrir(page, `/movimentacoes?produto=${encodeURIComponent(termo)}`)
  const celulas: string[][] = await page.evaluate(() => [...document.querySelectorAll('main tbody tr')].map((tr) => [...tr.querySelectorAll('td')].map((td, i) => i === 1
    ? [...td.querySelectorAll('span > span')].map((s) => (s as HTMLElement).innerText.trim()).join('\n') // tipo e selo vêm em spans colados no texto da célula
    : (td as HTMLElement).innerText.trim())))
  const corpo = await page.evaluate(() => ((document.querySelector('main') ?? document.body) as HTMLElement).innerText)
  const total = corpo.match(/(\d[\d.]*)\s+movimentos?\b/)?.[1]
  const linhas = celulas.filter((c) => c.length >= 6).map((c): LinhaTela => {
    const [tipo, ...selo] = c[1].split('\n').map((s) => s.trim()).filter(Boolean)
    const prod = c[2].split('\n').map((s) => s.trim())
    const det = (prod[1] ?? '').split(' · ')
    const qt = c[3].match(/^([+\-−]?)\s*([\d.,]+)/)
    const num = qt ? fmtDec(lerNumeroBR(qt[2])) : '?'
    return { tipo, selo: selo.join(' '), codigo: det[0] ?? '', obs: det.slice(1).join(' · '), quantidade: qt && (qt[1] === '-' || qt[1] === '−') ? `-${num}` : num, local: c[4].trim(), origem: c[5].split('\n')[0].trim() }
  })
  return { linhas, total: total ? Number(total.replace(/\./g, '')) : null, print: await print(page, `mov-${termo.slice(0, 24)}`) }
}
const chaveTela = (l: { codigo: string; local: string; tipo: string; quantidade: string }) => `${l.codigo}|${l.local}|${l.tipo}|${l.quantidade}`
const multiset = (ks: string[]) => [...ks].sort().join(' ; ')

type OpsTela = { total: number | null; concluidas: number | null; doVendas: number; print: string }
async function lerOps(page: Page, termo: string): Promise<OpsTela> {
  await abrir(page, `/ordem-producao?q=${encodeURIComponent(termo)}`)
  const corpo = await page.evaluate(() => ((document.querySelector('main') ?? document.body) as HTMLElement).innerText)
  const total = corpo.match(/(\d+)\s+OP\(s\) na busca/)?.[1]
  const conc = corpo.match(/(\d+)\s+concluída\(s\)/)?.[1]
  return { total: total ? Number(total) : 0, concluidas: conc ? Number(conc) : 0, doVendas: (corpo.match(/Veio do Norte Vendas/g) ?? []).length, print: await print(page, `ops-${termo.slice(0, 24)}`) }
}

// ---- Cenário ODARA (estoque próprio) ----
type ItemApi = { codigo: string; quantidade: number; destination?: 'kitchen' | 'bar'; setor?: string; localEstoque?: number }
async function montarGabarito(loja: LojaCfg, itens: ItemApi[]): Promise<{ itens: ItemVendaGab[]; esperados: MovEsperado[]; ops: number }> {
  const g: ItemVendaGab[] = []
  for (const it of itens) {
    const p = await produtoPorCodigo(loja.id, it.codigo)
    const local = resolverLocal(loja, it)
    if (local == null) throw new Error(`sem local para ${it.codigo}`)
    if (p.tipo_item === '09') { g.push({ codigo: it.codigo, quantidade: String(it.quantidade), local, servico: true }); continue }
    g.push({ codigo: it.codigo, quantidade: String(it.quantidade), local, ficha: await fichaDe(loja.id, it.codigo) })
  }
  return { itens: g, esperados: movimentosEsperados(g), ops: g.filter((x) => x.ficha).length }
}

type Ledger = { id: string; codigo: string; local: number; origem: string; ref: string; quantidade: string; reverses: string | null }
async function ledgerDaVenda(loja: number, pedido: string): Promise<{ linhas: Ledger[]; opRefs: string[]; opNums: string[] }> {
  const ops = await q<any>('select producao_ref, identificacao_c_num_op num from ordens_producao where loja_id=$1 and venda_ref like $2', [loja, `${pedido}|%`])
  const opRefs = ops.map((o) => o.producao_ref).filter(Boolean)
  const rows = await q<any>(`select m.id::text id, p.codigo, m.codigo_local_estoque::text l, m.origem, m.ref, m.quantidade::text qtd, m.reverses_id::text rev
    from estoque_movimentos m join produtos p on p.loja_id=m.loja_id and p.codigo_produto=m.codigo_produto
    where m.loja_id=$1 and (m.ref = $2 or m.ref = any($3)) order by m.id`, [loja, pedido, opRefs])
  return { linhas: rows.map((r) => ({ id: r.id, codigo: r.codigo, local: Number(r.l), origem: r.origem, ref: r.ref, quantidade: fmtDec(parseDec(r.qtd)), reverses: r.rev })), opRefs, opNums: ops.map((o) => o.num) }
}
const tipoLedger = (origem: string) => (origem === 'VENDA' ? 'Saída' : origem === 'PRODUCAO' ? 'Produção' : origem)

const ctxOdara = { loja: 15, nome: 'ODARA' }
let pagina: Page
const locDescOdara = new Map<number, string>()

async function custos(loja: number, codigos: string[]): Promise<Map<string, string>> {
  const rows = await q<any>(`select p.codigo, c.cmc::text cmc, c.saldo_total::text st from estoque_custos c join produtos p on p.loja_id=c.loja_id and p.codigo_produto=c.codigo_produto where c.loja_id=$1 and p.codigo = any($2)`, [loja, codigos])
  return new Map(rows.map((r) => [r.codigo, `${fmtDec(parseDec(r.cmc ?? '0'))}`]))
}
type Rodada = { ref: string; itens: ItemApi[]; gab: Awaited<ReturnType<typeof montarGabarito>>; antes: Map<string, string>; custoAntes: Map<string, string>; produtos: string[]; locais: number[] }
async function prepararRodada(cfg: LojaCfg, ref: string, itens: ItemApi[]): Promise<Rodada> {
  const gab = await montarGabarito(cfg, itens)
  const produtos = [...new Set(gab.esperados.map((m) => m.codigo).concat(itens.map((i) => i.codigo)))]
  const locais = [...new Set(gab.itens.map((i) => i.local))]
  return { ref, itens, gab, antes: await saldos(cfg.id, produtos, locais), custoAntes: await custos(cfg.id, produtos), produtos, locais }
}

async function conferirSaldos(nome: string, passo: string, cfg: LojaCfg, r: Rodada, esperadoDelta: Map<string, string>) {
  const depois = await saldos(cfg.id, r.produtos, r.locais)
  for (const [k, esperado] of esperadoDelta) {
    const real = dif(depois.get(k) ?? '0', r.antes.get(k) ?? '0')
    conferir(nome, 'banco (saldo por produto e local)', `${passo}: variação de ${k}`, esperado, real)
  }
  // nenhum outro produto/local da rodada pode ter mexido
  for (const k of depois.keys()) if (!esperadoDelta.has(k)) conferir(nome, 'banco (saldo por produto e local)', `${passo}: variação de ${k} (fora do gabarito)`, '0', dif(depois.get(k) ?? '0', r.antes.get(k) ?? '0'))
}

async function conferirLedgerETela(nome: string, passo: string, cfg: LojaCfg, r: Rodada, esperados: MovEsperado[]) {
  const desc = locDescOdara
  const led = await ledgerDaVenda(cfg.id, r.ref)
  const originais = led.linhas.filter((l) => !l.reverses)
  const esp = multiset(esperados.map((e) => `${e.codigo}|${e.local}|${e.tipo}|${e.quantidade}`))
  conferir(nome, 'banco (movimentos do estoque)', `${passo}: movimentos da venda (produto|local|tipo|quantidade)`, esp, multiset(originais.map((l) => `${l.codigo}|${l.local}|${tipoLedger(l.origem)}|${l.quantidade}`)))
  // Tela Movimentações: busca pelo pedido (saídas) e por cada OP (produção)
  const lidas: LinhaTela[] = []
  const prints: string[] = []
  for (const termo of [r.ref, ...led.opRefs]) {
    const t = await lerMovimentacoes(pagina, termo)
    prints.push(t.print)
    for (const l of t.linhas) if (l.tipo === 'Saída' || l.tipo === 'Produção') lidas.push(l)
  }
  const espTela = multiset(esperados.map((e) => chaveTela({ codigo: e.codigo, local: desc.get(e.local) ?? String(e.local), tipo: e.tipo, quantidade: e.quantidade })))
  const vistasTela = multiset(lidas.map(chaveTela))
  conferir(nome, 'Movimentações (tela)', `${passo}: linhas na tela (produto|local|tipo|quantidade)`, espTela, vistasTela, prints[0])
  return led
}

async function odara(browser: Awaited<ReturnType<typeof chromium.launch>>) {
  const cfg = await lojaCfg(15)
  for (const [c, d] of await locaisDesc(15)) locDescOdara.set(c, d)
  const nome = 'ODARA'
  const ctx = await novoContexto(browser)
  pagina = await ctx.newPage()
  await entrar(pagina, 15)
  await gerarChaveDeTeste(15)

  // ===== A: venda completa =====
  const refA = `robo-a-${SUF}`
  const itensA: ItemApi[] = [
    { codigo: '90017', quantidade: 3, destination: 'bar' },       // Aperol: ficha de 3 insumos
    { codigo: '90017', quantidade: 1, destination: 'bar' },       // mesmo prato de novo no pedido (2ª ocorrência, OP própria)
    { codigo: '80077', quantidade: 140, destination: 'kitchen' }, // acarajé: rendimento 70, local Cozinha
    { codigo: '90059', quantidade: 2, localEstoque: 8000000000004 }, // cerveja sem ficha, local escolhido no Vendas (Bar)
    { codigo: '50001', quantidade: 1 },                           // taxa de serviço
  ]
  const rA = await prepararRodada(cfg, refA, itensA)
  const dA = saldoLiquido(rA.gab.esperados)
  const respA = await enviarVenda(15, { pedidoRef: refA, itens: itensA })
  conferir(nome, 'API venda', 'A: HTTP da venda', '200', String(respA.status))
  const resA = (respA.json?.resultados ?? []) as any[]
  conferir(nome, 'API venda', 'A: itens ok', '5/5', `${resA.filter((x) => x.ok).length}/${resA.length}`)
  conferir(nome, 'API venda', 'A: itens com OP criada', String(rA.gab.ops), String(resA.filter((x) => x.op === 'criada').length))
  provas.push(`ODARA A: resposta da API ${JSON.stringify(resA.map((x) => ({ c: x.codigo, op: x.op, baixa: x.baixa })))}`)
  await conferirSaldos(nome, 'A', cfg, rA, new Map([...dA].map(([k, v]) => [k, v])))
  const ledA = await conferirLedgerETela(nome, 'A', cfg, rA, rA.gab.esperados)

  // OPs no banco (quantidade, local, itens consumidos) e na tela
  const opsA = await q<any>(`select o.identificacao_c_num_op num, o.concluida, o.identificacao_n_qtde::text qtd, p.codigo, op.local_consumo::text lc, op.id::text opid
    from ordens_producao o join produtos p on p.loja_id=o.loja_id and p.codigo_produto=o.identificacao_n_cod_produto left join ordens_producao_proprio op on op.loja_id=o.loja_id and op.ref=o.producao_ref
    where o.loja_id=15 and o.venda_ref like $1 order by o.venda_ref`, [`${refA}|%`])
  const espOps = rA.gab.itens.filter((i) => i.ficha).map((i) => `${i.codigo}|${fmtDec(parseDec(i.quantidade))}|${i.local}|true`)
  conferir(nome, 'banco (ordens de produção)', 'A: OPs da venda (prato|quantidade|local de consumo|concluída)', multiset(espOps), multiset(opsA.map((o) => `${o.codigo}|${fmtDec(parseDec(o.qtd))}|${o.lc}|${o.concluida}`)))
  for (const o of opsA) {
    const it = rA.gab.itens.find((i) => i.ficha && i.codigo === o.codigo && fmtDec(parseDec(i.quantidade)) === fmtDec(parseDec(o.qtd)))
    if (!it?.ficha) continue
    const esperado = multiset(consumoDaFicha(it.ficha, it.quantidade).map((c) => `${c.insumo}|${fmtDec(parseDec(c.quantidade))}`))
    const real = (await q<any>('select p.codigo, i.quantidade::text qtd from ordens_producao_proprio_itens i join produtos p on p.loja_id=15 and p.codigo_produto=i.codigo_insumo where i.ordem_id=$1', [o.opid])).map((x) => `${x.codigo}|${fmtDec(parseDec(x.qtd))}`)
    conferir(nome, 'banco (itens da OP)', `A: insumos consumidos pela OP ${o.num} (${o.codigo} x ${o.qtd})`, esperado, multiset(real))
  }
  const opsTelaA = await lerOps(pagina, refA)
  conferir(nome, 'Ordens de Produção (tela)', 'A: OPs que a busca pela venda acha', String(rA.gab.ops), String(opsTelaA.total), opsTelaA.print)
  conferir(nome, 'Ordens de Produção (tela)', 'A: OPs concluídas', String(rA.gab.ops), String(opsTelaA.concluidas), opsTelaA.print)
  conferir(nome, 'Ordens de Produção (tela)', 'A: OPs marcadas "Veio do Norte Vendas"', String(rA.gab.ops), String(opsTelaA.doVendas), opsTelaA.print)
  const stA = await api(15, 'GET', `/api/integracao/ordem-producao/status?pedidoRef=${refA}`)
  conferir(nome, 'API status', 'A: consulta de status diz processado', 'true', String(stA.json?.processado))

  // ===== C1: estorno de A =====
  const nVendaA = rA.gab.esperados.filter((m) => m.tipo === 'Saída').length
  const estA = await estornarVenda(15, refA)
  conferir(nome, 'API estorno', 'A: estorno ok', 'true', String(estA.json?.ok))
  conferir(nome, 'API estorno', 'A: saídas desfeitas', String(nVendaA), String(estA.json?.ajustesExcluidos))
  conferir(nome, 'API estorno', 'A: OPs excluídas', String(rA.gab.ops), String(estA.json?.opsExcluidas))
  conferir(nome, 'API estorno', 'A: falhas do estorno', '0', String(estA.json?.falhas))
  await conferirSaldos(nome, 'A depois do estorno', cfg, rA, new Map([...dA].map(([k]) => [k, '0'])))
  await conferirCustos(nome, 'A', cfg, rA)
  await telaAposEstorno(nome, 'A', cfg, rA, ledA)
  const estA2 = await estornarVenda(15, refA)
  if (Number(estA2.json?.ajustesExcluidos) !== 0) achados.push(`ODARA: o 2º estorno da mesma venda respondeu "ajustesExcluidos: ${estA2.json?.ajustesExcluidos}" (contou de novo as saídas já estornadas). O estoque NÃO foi devolvido duas vezes (saldos conferidos logo abaixo), então é só o contador da resposta que engana.`)
  await conferirSaldos(nome, 'A depois do 2º estorno', cfg, rA, new Map([...dA].map(([k]) => [k, '0'])))

  // ===== B: falha temporária, nova tentativa sem duplicar =====
  const refB = `robo-b-${SUF}`
  const itensB: ItemApi[] = [
    { codigo: '90017', quantidade: 2, destination: 'bar' },
    { codigo: '90059', quantidade: 1, localEstoque: 8000000000004 },
    { codigo: '90018', quantidade: 4 }, // água: vai falhar na 1ª vez
  ]
  const rB = await prepararRodada(cfg, refB, itensB)
  const dB = saldoLiquido(rB.gab.esperados)
  const orig = (await q<any>('select local_estoque_por_produto p from lojas where id=15'))[0].p
  await escrever('update lojas set local_estoque_por_produto = $1::jsonb where id=15', [JSON.stringify({ ...(orig ?? {}), '90018': 999999999 })])
  const b1 = await enviarVenda(15, { pedidoRef: refB, itens: itensB })
  await escrever('update lojas set local_estoque_por_produto = $1::jsonb where id=15', [orig == null ? null : JSON.stringify(orig)])
  const r1 = (b1.json?.resultados ?? []) as any[]
  conferir(nome, 'API venda', 'B1: HTTP da venda com falha em 1 item', '200', String(b1.status))
  conferir(nome, 'API venda', 'B1: item da água não foi gravado (ok=false, op=pulada)', 'false/pulada', `${r1[2]?.ok}/${r1[2]?.op}`)
  conferir(nome, 'API venda', 'B1: demais itens ok', 'true/true', `${r1[0]?.ok}/${r1[1]?.ok}`)
  provas.push(`ODARA B1 (falha provocada: local inexistente no mapa por produto, depois desfeita): ${JSON.stringify(r1.map((x) => ({ c: x.codigo, ok: x.ok, op: x.op, erro: x.erro })))}`)
  const ledB1 = await ledgerDaVenda(15, refB)
  conferir(nome, 'banco (movimentos do estoque)', 'B1: água ainda sem movimento depois da falha', '0', String(ledB1.linhas.filter((l) => l.codigo === '90018').length))
  const b2 = await enviarVenda(15, { pedidoRef: refB, itens: itensB })
  const r2 = (b2.json?.resultados ?? []) as any[]
  conferir(nome, 'API venda', 'B2: nova tentativa grava a água', 'true', String(r2[2]?.ok))
  conferir(nome, 'API venda', 'B2: itens já gravados voltam como duplicado, sem baixar de novo', 'true/true', `${r2[0]?.duplicado}/${r2[1]?.duplicado}`)
  await conferirSaldos(nome, 'B depois da nova tentativa', cfg, rB, new Map([...dB]))
  const nLinhasB2 = (await ledgerDaVenda(15, refB)).linhas.length
  const b3 = await enviarVenda(15, { pedidoRef: refB, itens: itensB })
  const r3 = (b3.json?.resultados ?? []) as any[]
  conferir(nome, 'API venda', 'B3: 3ª tentativa: todos duplicado', 'true/true/true', r3.map((x) => x.duplicado).join('/'))
  const ledB = await conferirLedgerETela(nome, 'B depois de 3 envios', cfg, rB, rB.gab.esperados)
  conferir(nome, 'banco (movimentos do estoque)', 'B3: nenhuma linha nova na 3ª tentativa', String(nLinhasB2), String(ledB.linhas.length))
  await conferirSaldos(nome, 'B depois de 3 envios', cfg, rB, new Map([...dB]))
  conferir(nome, 'banco (ordens de produção)', 'B: uma só OP do Aperol depois de 3 envios', '1', String((await q<any>('select count(*)::text c from ordens_producao where loja_id=15 and venda_ref like $1', [`${refB}|%`]))[0].c))
  const stB = await api(15, 'GET', `/api/integracao/ordem-producao/status?pedidoRef=${refB}`)
  conferir(nome, 'API status', 'B: status mostra os 3 envios', '3', String((stB.json?.envios ?? []).length))

  // ===== C2: estorno de B =====
  const nVendaB = rB.gab.esperados.filter((m) => m.tipo === 'Saída').length
  const estB = await estornarVenda(15, refB)
  conferir(nome, 'API estorno', 'B: estorno ok', 'true', String(estB.json?.ok))
  conferir(nome, 'API estorno', 'B: saídas desfeitas', String(nVendaB), String(estB.json?.ajustesExcluidos))
  conferir(nome, 'API estorno', 'B: OPs excluídas', '1', String(estB.json?.opsExcluidas))
  await conferirSaldos(nome, 'B depois do estorno', cfg, rB, new Map([...dB].map(([k]) => [k, '0'])))
  await conferirCustos(nome, 'B', cfg, rB)
  await telaAposEstorno(nome, 'B', cfg, rB, ledB)
  await ctx.close()
}

async function conferirCustos(nome: string, passo: string, cfg: LojaCfg, r: Rodada) {
  const depois = await custos(cfg.id, r.produtos)
  for (const c of r.produtos) {
    const a = r.custoAntes.get(c) ?? '(sem custo)'
    const d = depois.get(c) ?? '(sem custo)'
    // O banco guarda o custo médio com 6 casas: diferença de 1 no último dígito é arredondamento da reconta, não conta errada; vai para os achados.
    if (a !== d && a !== '(sem custo)' && d !== '(sem custo)' && (parseDec(a) - parseDec(d) <= parseDec('0.000001') && parseDec(d) - parseDec(a) <= parseDec('0.000001'))) {
      conferencias++
      achados.push(`ODARA: depois do estorno ${passo}, o custo médio de ${c} ficou ${d} e não ${a} (diferença de 0,000001: o estorno recalcula o custo e arredonda diferente). Não afeta o saldo.`)
    } else conferir(nome, 'banco (custo médio)', `${passo}: custo médio de ${c} depois do estorno volta ao de antes da venda`, a, d)
  }
}

/** Depois do estorno, a tela mostra os movimentos originais como "estornado" e as linhas de estorno; a soma por produto e local é zero. */
async function telaAposEstorno(nome: string, passo: string, cfg: LojaCfg, r: Rodada, antes: Awaited<ReturnType<typeof ledgerDaVenda>>) {
  const termos = [r.ref, ...antes.opRefs, ...antes.opNums.map((n) => `Reversão da OP ${n}`)]
  const todas = new Map<string, LinhaTela>()
  let p0 = ''
  for (const t of termos) {
    const lidas = await lerMovimentacoes(pagina, t)
    p0 = p0 || lidas.print
    for (const l of lidas.linhas) todas.set(`${l.tipo}|${l.codigo}|${l.local}|${l.quantidade}|${l.obs}|${l.selo}`, l)
  }
  // linhas de estorno e originais (descarta duplicatas da mesma linha vista em duas buscas)
  const linhas = [...todas.values()]
  const somaPorChave = new Map<string, bigint>()
  for (const l of linhas) { const k = `${l.codigo}|${l.local}`; somaPorChave.set(k, (somaPorChave.get(k) ?? 0n) + parseDec(l.quantidade)) }
  const naoZero = [...somaPorChave].filter(([, s]) => s !== 0n).map(([k, s]) => `${k}=${fmtDec(s)}`)
  conferir(nome, 'Movimentações (tela)', `${passo}: depois do estorno a soma por produto e local é zero`, '(nenhum)', naoZero.join('; ') || '(nenhum)', p0)
  const nOrig = antes.linhas.filter((l) => !l.reverses).length
  conferir(nome, 'Movimentações (tela)', `${passo}: movimentos originais aparecem "estornado"`, String(nOrig), String(linhas.filter((l) => l.tipo !== 'Estorno' && /estornado/i.test(l.selo)).length), p0)
  conferir(nome, 'Movimentações (tela)', `${passo}: uma linha "Estorno" para cada original`, String(nOrig), String(linhas.filter((l) => l.tipo === 'Estorno').length), p0)
  const ops = await lerOps(pagina, r.ref)
  conferir(nome, 'Ordens de Produção (tela)', `${passo}: OPs da venda saem da lista depois do estorno`, '0', String(ops.total), ops.print)
}

// ---- Cenário Sertão (modo Omie, trava ligada) ----
async function sertao(browser: Awaited<ReturnType<typeof chromium.launch>>) {
  const nome = 'Sertão (Omie)'
  const cfg = await lojaCfg(4)
  const ctx = await novoContexto(browser)
  const page = await ctx.newPage()
  await entrar(page, 4)
  await gerarChaveDeTeste(4)
  const ref = crypto.randomUUID()
  const itens: ItemApi[] = [
    { codigo: '90378', quantidade: 2 },                         // local padrão (Depósito)
    { codigo: '90292', quantidade: 1, setor: 'Pizzaria' },      // setor mapeado
    { codigo: '90947', quantidade: 3, destination: 'kitchen' }, // destino cozinha
  ]
  const prod = new Map<string, string>()
  for (const i of itens) prod.set(i.codigo, (await produtoPorCodigo(4, i.codigo)).id)
  const esperados = itens.map((i) => ({ codigo: i.codigo, id: prod.get(i.codigo)!, quantidade: i.quantidade, local: resolverLocal(cfg, i)! }))
  const t0 = new Date().toISOString()
  const antesTentativas = Number((await q<any>('select count(*)::text c from integration_attempts where loja_id=4'))[0].c)

  const d = await enviarVenda(4, { pedidoRef: ref, itens })
  const rd = (d.json?.resultados ?? []) as any[]
  conferir(nome, 'API venda', 'D: HTTP da venda', '200', String(d.status))
  provas.push(`Sertão D (Omie bloqueado): resposta da API ${JSON.stringify(rd.map((x) => ({ c: x.codigo, ok: x.ok, op: x.op, baixa: x.baixa })))}`)
  const movs = await q<any>(`select m.id::text id, p.codigo, m.quan::text quan, m.codigo_local_estoque::text l, m.origem, m.motivo, m.tipo, m.status, m.descricao_status, m.tentativas, m.id_ajuste
     from movimentos m join produtos p on p.loja_id=m.loja_id and p.codigo_produto=m.id_prod where m.loja_id=4 and m.obs like $1 order by m.id`, [`%${ref}%`])
  conferir(nome, 'banco (saída de estoque pendente)', 'D: uma saída por item (produto|local|quantidade|tipo|origem)',
    multiset(esperados.map((e) => `${e.codigo}|${e.local}|-${e.quantidade}|SAI|AJU`)),
    multiset(movs.map((m) => `${m.codigo}|${m.l}|${fmtDec(parseDec(m.quan))}|${m.tipo}|${m.origem}`)))
  conferir(nome, 'banco (saída de estoque pendente)', 'D: nenhuma saída foi lançada no Omie (sem id de ajuste)', '0', String(movs.filter((m) => m.id_ajuste).length))
  const fila = await q<any>(`select id::text id, status, tentativas, ultimo_erro, payload from vendas_integracao_fila where loja_id=4 and ref=$1 order by id`, [ref])
  conferir(nome, 'banco (fila do Vendas)', 'D: uma OP na fila por item (produto|quantidade|local)',
    multiset(esperados.map((e) => `${e.id}|${e.quantidade}|${resolverLocalMapeado(cfg, itens.find((i) => i.codigo === e.codigo)!) ?? 'padrão'}`)),
    multiset(fila.map((f) => `${f.payload.codigo_produto}|${f.payload.quantidade}|${f.payload.codigoLocalEstoque ?? 'padrão'}`)))
  conferir(nome, 'banco (fila do Vendas)', 'D: filas Pendente', String(itens.length), String(fila.filter((f) => f.status === 'Pendente').length))
  const bloqueadas = fila.filter((f) => /Omie bloqueado neste ambiente \(NTB_OMIE_BLOQUEADO=1\)/.test(f.ultimo_erro ?? '')).length
  conferir(nome, 'trava do Omie', 'D: a fila guarda o erro da trava (a chamada foi barrada antes de sair)', String(itens.length), String(bloqueadas))
  conferir(nome, 'banco (ordens de produção)', 'D: nenhuma OP local criada (a OP é do Omie, bloqueado)', '0', String((await q<any>('select count(*)::text c from ordens_producao where loja_id=4 and observacao like $1', [`%${ref}%`]))[0].c))
  const tent = await q<any>('select error_message from integration_attempts where loja_id=4 and created_at >= $1', [t0])
  const forasDaTrava = tent.filter((t) => !/Omie bloqueado neste ambiente/.test(t.error_message ?? ''))
  conferir(nome, 'trava do Omie', 'D: toda tentativa registrada contra o Omie terminou na trava', '0', String(forasDaTrava.length))
  provas.push(`Sertão D: ${tent.length} tentativas ao Omie registradas, todas barradas pela trava (0 fora da trava). Total de integration_attempts antes: ${antesTentativas}.`)
  // Tela: a saída pendente aparece em Movimentações?
  await abrir(page, `/movimentacoes?produto=${encodeURIComponent(ref)}`)
  const corpo = await page.evaluate(() => ((document.querySelector('main') ?? document.body) as HTMLElement).innerText)
  const pr = await print(page, 'sertao-mov-pendente')
  const nTela = Number(corpo.match(/(\d+)\s+movimentos de/)?.[1] ?? '0')
  achados.push(`Sertão: a baixa da venda ficou como saída pendente (status Erro, sem id de ajuste) e a tela Movimentações mostrou ${nTela} movimento(s) para o pedido (${pr}). A tela só lista movimento Concluído; a venda do Vendas fica invisível para o dono até o Omie confirmar. Resposta da API ao Vendas: ok=true, op=na_fila, baixa=Erro.`)
  const op = await lerOps(page, ref)
  achados.push(`Sertão: Ordens de Produção da tela achou ${op.total} OP(s) para o pedido (a OP só nasce no Omie; ficou na fila) (${op.print}).`)

  // estorno sem chave Omie na loja (como a cópia local vem): o ERP pula
  const e0 = await estornarVenda(4, ref)
  achados.push(`Sertão: estorno ANTES de dar chave Omie à loja respondeu ${JSON.stringify(e0.json)} (a rota pula lojas sem chave Omie; nada foi desfeito localmente).`)
  conferir(nome, 'banco (saída de estoque pendente)', 'E0: estorno sem chave Omie não mexeu nas saídas', String(itens.length), String((await q<any>('select count(*)::text c from movimentos where loja_id=4 and obs like $1', [`%${ref}%`]))[0].c))

  // chave Omie FALSA só para exercitar a fila (a trava barra antes de qualquer chamada)
  await escrever("update lojas set omie_app_key='ROBO-CHAVE-FALSA', omie_app_secret='ROBO-CHAVE-FALSA' where id=4")
  try {
    await escrever("update vendas_integracao_fila set proximo_em = '1970-01-01' where loja_id=4 and ref=$1", [ref])
    const cr = await cron('/api/cron/retry-integracao-vendas')
    const minha = (cr.json?.lojas ?? []).find((l: any) => l.loja_id === 4)
    provas.push(`Sertão E: cron retry-integracao-vendas HTTP ${cr.status}, loja 4: ${JSON.stringify(minha)}`)
    const f2 = await q<any>('select status, tentativas, ultimo_erro from vendas_integracao_fila where loja_id=4 and ref=$1', [ref])
    conferir(nome, 'banco (fila do Vendas)', 'E: o cron retentou cada item (tentativas)', '2/2/2', f2.map((f) => f.tentativas).join('/'))
    conferir(nome, 'banco (fila do Vendas)', 'E: continuam Pendente (Omie ainda bloqueado)', String(itens.length), String(f2.filter((f) => f.status === 'Pendente').length))
    conferir(nome, 'trava do Omie', 'E: o erro da nova tentativa é o da trava', String(itens.length), String(f2.filter((f) => /NTB_OMIE_BLOQUEADO=1/.test(f.ultimo_erro ?? '')).length))
    const cr2 = await cron('/api/cron/retry-ajustes-movimentos')
    provas.push(`Sertão E: cron retry-ajustes-movimentos HTTP ${cr2.status}: ${JSON.stringify(cr2.json).slice(0, 300)}`)
    const vinc = Number((await q<any>('select count(*)::text c from venda_op_vinculo where loja_id=4 and pedido_ref=$1', [ref]))[0].c)
    conferir(nome, 'banco (vínculo venda e OP)', 'E: um vínculo por item depois da nova tentativa', String(itens.length), String(vinc))
    // o Vendas reenvia o mesmo pedido
    const filaAntes = Number((await q<any>('select count(*)::text c from vendas_integracao_fila where loja_id=4 and ref=$1', [ref]))[0].c)
    const rr = await enviarVenda(4, { pedidoRef: ref, itens })
    const nMovs = Number((await q<any>('select count(*)::text c from movimentos where loja_id=4 and obs like $1', [`%${ref}%`]))[0].c)
    conferir(nome, 'banco (saída de estoque pendente)', 'E: reenvio do mesmo pedido não duplica a baixa (saídas)', String(itens.length), String(nMovs))
    conferir(nome, 'banco (vínculo venda e OP)', 'E: reenvio não cria outro vínculo', String(itens.length), String((await q<any>('select count(*)::text c from venda_op_vinculo where loja_id=4 and pedido_ref=$1', [ref]))[0].c))
    const filaDepois = Number((await q<any>('select count(*)::text c from vendas_integracao_fila where loja_id=4 and ref=$1', [ref]))[0].c)
    provas.push(`Sertão E: reenvio do mesmo pedido: HTTP ${rr.status}, linhas na fila ${filaAntes} -> ${filaDepois}`)
    if (filaDepois !== filaAntes) achados.push(`Sertão: reenviar o mesmo pedido enquanto a OP ainda está na fila criou ${filaDepois - filaAntes} linha(s) a mais na fila (de ${filaAntes} para ${filaDepois}). A baixa de estoque NÃO duplicou (saídas e vínculos iguais); o Omie recusa o 2º cCodIntOP igual, e o cron trata "já existe" como feito.`)
    // estorno com chave Omie (a trava barra o que seria chamada ao Omie)
    const e1 = await estornarVenda(4, ref)
    provas.push(`Sertão E: estorno com chave Omie falsa: HTTP ${e1.status} ${JSON.stringify(e1.json)}`)
    conferir(nome, 'banco (saída de estoque pendente)', 'E: estorno desfez as saídas pendentes da venda', '0', String((await q<any>('select count(*)::text c from movimentos where loja_id=4 and obs like $1', [`%${ref}%`]))[0].c))
    conferir(nome, 'banco (fila do Vendas)', 'E: estorno tirou da fila o que não foi enviado', '0', String((await q<any>("select count(*)::text c from vendas_integracao_fila where loja_id=4 and ref=$1 and status='Pendente'", [ref]))[0].c))
    achados.push(`Sertão: estorno com Omie bloqueado: saídas locais ${e1.json?.ajustesExcluidos} desfeitas, fila cancelada ${e1.json?.filaCancelada}, OPs excluídas ${e1.json?.opsExcluidas}, falhas ${e1.json?.falhas} (${(e1.json?.detalhes ?? []).join(' | ').slice(0, 200)}). A falha é esperada: o ERP tenta consultar a OP no Omie, e a trava barra.`)
    const tentFim = await q<any>('select error_message from integration_attempts where loja_id=4 and created_at >= $1', [t0])
    conferir(nome, 'trava do Omie', 'E: depois de tudo, nenhuma tentativa ao Omie escapou da trava', '0', String(tentFim.filter((t) => !/Omie bloqueado neste ambiente/.test(t.error_message ?? '') && !/^\s*$/.test(t.error_message ?? '')).length))
  } finally {
    await escrever('update lojas set omie_app_key=null, omie_app_secret=null where id=4')
  }
  await ctx.close()
}

// Local que vai no payload da OP do Omie: só o mapeado (produto, escolhido, setor, cozinha/bar); sem mapa, o Omie usa o padrão.
function resolverLocalMapeado(cfg: LojaCfg, item: ItemApi): string | undefined {
  const l = resolverLocal({ ...cfg, padrao: null }, item)
  return l == null ? undefined : String(l)
}

// ---- Foto do banco: provar que a cópia voltou ao estado inicial ----
const TABELAS_FOTO = ['estoque_movimentos', 'estoque_lotes', 'estoque_lote_movimentos', 'estoque_mov_revisao', 'ordens_producao', 'ordens_producao_proprio', 'ordens_producao_proprio_itens', 'op_historico',
  'movimentos', 'vendas_integracao_fila', 'venda_op_vinculo', 'venda_integracao_pedidos', 'produto_sem_estrutura', 'integration_attempts', 'vendas_proprio', 'vendas_proprio_itens', 'posicao_estoques', 'produtos']
async function foto(): Promise<Record<string, string>> {
  const f: Record<string, string> = {}
  for (const t of TABELAS_FOTO) {
    if (!(await q('select to_regclass($1)::text r', [`public.${t}`]))[0].r) continue
    f[t] = (await q(`select count(*)::text c from public.${t}`))[0].c
  }
  f.estoque_saldos = (await q("select count(*)::text || ':' || coalesce(md5(string_agg(concat_ws('|',loja_id,codigo_local_estoque,codigo_produto,saldo), ',' order by loja_id,codigo_local_estoque,codigo_produto)),'-') c from public.estoque_saldos"))[0].c
  f.estoque_custos = (await q("select count(*)::text || ':' || coalesce(md5(string_agg(concat_ws('|',loja_id,codigo_produto,cmc,saldo_total,ultimo_custo), ',' order by loja_id,codigo_produto)),'-') c from public.estoque_custos"))[0].c
  f.lojas_chaves = (await q("select count(*) filter (where integracao_api_key is not null)::text || ':' || count(*) filter (where omie_app_key is not null)::text || ':' || md5(string_agg(coalesce(local_estoque_por_produto::text,'-'), ',' order by id)) c from public.lojas"))[0].c
  return f
}
const lojaExtra = async (loja: number) => (await q(
  `select (select count(*) from estoque_movimentos where loja_id=$1)::text ledger, (select count(*) from movimentos where loja_id=$1)::text movimentos_omie, (select count(*) from ordens_producao where loja_id=$1)::text ops,
          (select count(*) from vendas_integracao_fila where loja_id=$1)::text fila, (select count(*) from integration_attempts where loja_id=$1)::text tentativas_omie, (select coalesce(sum(saldo),0) from estoque_saldos where loja_id=$1)::text saldo_total`, [loja]))[0]

// ---- Execução ----
const filtro = (process.env.ROBO_CENARIOS ?? '').split(',').map((s) => s.trim()).filter(Boolean)
const rodarOdara = !filtro.length || filtro.includes('odara')
const rodarSertao = !filtro.length || filtro.includes('sertao')
const t0 = Date.now()
const fotoAntes = await foto()
const extraAntes = Object.fromEntries(await Promise.all([4, 15, 19].map(async (l) => [l, await lojaExtra(l)])))
fs.writeFileSync(path.join(SAIDA, 'foto-antes.json'), JSON.stringify({ fotoAntes, extraAntes }, null, 1))
console.log(`foto do estado inicial guardada (${Object.keys(fotoAntes).length} itens)`)

const browser = await chromium.launch()
if (rodarOdara) {
  console.log('cenário ODARA (15, estoque próprio): venda completa, falha com nova tentativa e estorno')
  try { await odara(browser) } catch (e) { falha('ODARA', '(robô)', 'cenário ODARA', 'executar sem erro', String(e instanceof Error ? e.stack : e).slice(0, 400), 'prints/(sem print)', 'tela-quebrada') }
}
if (rodarSertao) {
  console.log('cenário Sertão (4, Omie bloqueado): fila, nova tentativa e estorno')
  try { await sertao(browser) } catch (e) { falha('Sertão (Omie)', '(robô)', 'cenário Sertão', 'executar sem erro', String(e instanceof Error ? e.stack : e).slice(0, 400), 'prints/(sem print)', 'tela-quebrada') }
}
await browser.close()
const omieExterno = externos.filter((e) => /omie/i.test(e))
conferir('geral', 'navegador', 'nenhuma requisição do navegador para o Omie', '0', String(omieExterno.length))
provas.push(`Requisições externas do navegador bloqueadas: ${externos.length} (para o Omie: ${omieExterno.length}). O robô só fala com ${ORIGEM} e com a API local.`)
const fotoDepoisTeste = await foto()
const mudou = Object.keys(fotoDepoisTeste).filter((k) => fotoDepoisTeste[k] !== fotoAntes[k])
console.log(`o teste gravou na cópia (tabelas diferentes da foto inicial): ${mudou.join(', ') || 'nada'}`)
await db.end()
await dbw.end()

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
      try { db = await abrirBanco(true); await q('select 1'); ok = true } catch { await new Promise((s) => setTimeout(s, 3000)) }
    }
    if (!ok) { resetProvado = false; detalheReset = 'banco não voltou depois do resetar' }
    else {
      const depois = await foto()
      const extraDepois = Object.fromEntries(await Promise.all([4, 15, 19].map(async (l) => [l, await lojaExtra(l)])))
      const d = Object.keys({ ...fotoAntes, ...depois }).filter((k) => fotoAntes[k] !== depois[k])
      const dl = [4, 15, 19].flatMap((l) => Object.keys(extraAntes[l]).filter((k) => (extraAntes[l] as Record<string, string>)[k] !== (extraDepois[l] as Record<string, string>)[k]).map((k) => `loja ${l} ${k}`))
      resetProvado = d.length === 0 && dl.length === 0
      detalheReset = resetProvado
        ? `a cópia voltou ao estado inicial: ${Object.keys(depois).length} contagens/impressões digitais (tabelas, saldos, custos, chaves das lojas) e totais das lojas 4, 15 e 19 iguais aos de antes do teste (${mudou.length} tabelas tinham mudado durante o teste: ${mudou.join(', ') || 'nenhuma'})`
        : `DIFERENÇAS depois do resetar: ${[...d, ...dl].join(', ')}`
      await db.end()
      logins = lerLogins()
    }
  }
}
console.log(detalheReset)

// ---- Saídas ----
const ordenadas = ordenarFalhas(falhas)
const md = formatarListaFalhas(ordenadas, { visitas: conferencias, telas: 2, logins: new Set([...(rodarOdara ? [15] : []), ...(rodarSertao ? [4] : [])]).size })
fs.writeFileSync(path.join(SAIDA, 'falhas.md'), md)
const evid = [`# Evidências da rodada ${ID_RODADA}`, '', `Conferências feitas: ${conferencias}. Falhas: ${ordenadas.length}.`, '', '## Provas e respostas da API', ...provas.map((p) => `- ${p}`), '', '## Achados que não são falha do robô', ...achados.map((a) => `- ${a}`), '',
  '## Volta ao estado inicial', detalheReset, '']
fs.writeFileSync(path.join(SAIDA, 'evidencias.md'), evid.join('\n'))
fs.writeFileSync(path.join(SAIDA, 'resumo.json'), JSON.stringify({ rodada: ID_RODADA, urlBase: ORIGEM, cenarios: [...(rodarOdara ? ['odara'] : []), ...(rodarSertao ? ['sertao'] : [])], conferencias, falhas: ordenadas.length, tabelasGravadasPeloTeste: mudou, resetProvado, detalheReset, externosBloqueados: externos.length, sha256FalhasMd: crypto.createHash('sha256').update(md).digest('hex'), segundos: Math.round((Date.now() - t0) / 1000) }, null, 1))
console.log(`conferências: ${conferencias} | falhas: ${ordenadas.length} | saída: ${SAIDA}`)
void ctxOdara; void brl
process.exit(resetProvado === false ? 1 : 0)
