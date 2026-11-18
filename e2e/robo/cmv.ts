// Robô do faturamento e do CMV (ticket 08): confere as telas de relatório do ERP (Faturamento mensal e "Por dia", CMV/CPV, Lucro) de cada
// loja (4 Sertão/Omie, 15 ODARA, 19 laboratório) contra o gabarito (e2e/robo/cmv-gabarito.ts), feito direto nos documentos de origem:
// vendas_proprio(+itens) na loja de estoque próprio; fat_cupons/fat_cupom_itens do banco frio na loja Omie; fichas técnicas; série de custo
// do ledger. SÓ LÊ (sessões read-only no banco, só navega nas telas, nenhum clique que grave). Nunca chama o Omie.
// Uso: npm run robo:cmv   (saída em .local-data/robo-cmv/<rodada>/, fora do git)
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import pg from 'pg'
import { chromium, type Page } from 'playwright'
import { validarUrlBase, validarAmbienteLocal, PORTA_ERP_LOCAL } from './trava-url.ts'
import { formatarListaFalhas, ordenarFalhas, valoresInvalidos, ehPaginaNaoEncontrada, type Falha } from './relatorio.ts'
import { lerNumeroBR, type Dec } from './saldo-gabarito.ts'
import {
  faturamentoPorDia, faturamentoPorMes, cmvPorRotulo, custoMedioDeHoje, cmvEstimado, decompor, somar, texto, dec, centavos, modulo,
  type Venda, type LinhaVenda, type Fichas, type SerieCusto, type LinhaResultado, type ItemCupom, type LinhaEstimada,
} from './cmv-gabarito.ts'

const RAIZ = path.resolve(import.meta.dirname, '..', '..')
const LOJAS = [
  { id: 4, nome: 'Sertão', modo: 'omie' as const, meses: ['2025-07', '2025-08', '2025-09', '2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10', '2026-11'], diario: [['2025-07-01', '2026-06-30'], ['2026-07-01', 'HOJE']] },
  { id: 15, nome: 'ODARA', modo: 'proprio' as const, meses: ['2026-10', '2026-11'], diario: [['2026-10-01', 'HOJE']] },
  { id: 19, nome: 'Loja 19', modo: 'proprio' as const, meses: ['2026-10', '2026-11'], diario: [['2026-10-01', 'HOJE']] },
]
const PORTA_PG_LOCAL = 54420
const TOL_FAT = dec('0.01')
const TOL_CMV_TOTAL = dec('0.10')
const TOL_CMV_LINHA = dec('0.05')
const LIMITE_LINHAS_TELA = 500

function sair(msg: string): never {
  console.error(`ROBÔ RECUSOU RODAR: ${msg}`)
  process.exit(2)
}

// ---- Trava: só a cópia local ----
const v = validarUrlBase(process.env.ROBO_URL_BASE ?? `http://127.0.0.1:${PORTA_ERP_LOCAL}`)
if (!v.ok) sair(v.motivo)
const ORIGEM = v.origem
const envLocal = path.join(RAIZ, '.env.local')
if (!fs.existsSync(envLocal)) sair('.env.local da cópia local não existe')
const va = validarAmbienteLocal(fs.readFileSync(envLocal, 'utf8'))
if (!va.ok) sair(va.motivo)
const senhaPg = fs.readFileSync(path.join(RAIZ, '.local-data', 'env'), 'utf8').match(/^POSTGRES_PASSWORD=(.*)$/m)?.[1]?.trim()
if (!senhaPg) sair('POSTGRES_PASSWORD ausente em .local-data/env')

const logins = new Map<number, { email: string; senha: string }>()
for (const l of fs.readFileSync(path.join(RAIZ, '.local-data', 'logins.txt'), 'utf8').split('\n')) {
  const m = l.match(/^(\S+@ntb-teste\.local)\s+(\S+)\s+loja=(\d+)\s+cargo=dono/)
  if (m) logins.set(Number(m[3]), { email: m[1], senha: m[2] })
}

const ID_RODADA = process.env.ROBO_RODADA ?? new Date().toISOString().replace(/[:.]/g, '-')
const SAIDA = path.join(RAIZ, '.local-data', 'robo-cmv', ID_RODADA)
fs.mkdirSync(path.join(SAIDA, 'prints'), { recursive: true })
const HOJE = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bahia' })

// ---- Bancos (somente leitura): principal e frio (histórico de faturamento do frio-api) ----
const conectar = async (database: string) => {
  const c = new pg.Client({ host: '127.0.0.1', port: PORTA_PG_LOCAL, user: 'postgres', password: senhaPg, database, options: '-c default_transaction_read_only=on' })
  await c.connect()
  return c
}
const db = await conectar('postgres')
const frio = await conectar('frio')
const q = async <T = Record<string, any>>(c: pg.Client, sql: string, args: unknown[] = []) => (await c.query({ text: sql, values: args })).rows as T[]

async function digital(loja: number) {
  const a = (await q(db, 'select (select count(*) from vendas_proprio where loja_id=$1)::text v, (select count(*) from estoque_movimentos where loja_id=$1)::text m, (select count(*) from estoque_mov_revisao)::text r', [loja]))[0]
  const f = (await q(frio, 'select count(*)::text c, coalesce(sum(valor),0)::text s from fat_cupons where loja_id=$1', [loja]))[0]
  return JSON.stringify([a, f])
}

// ---- Gabarito: documentos de origem ----
const arred2 = (d: Dec): Dec => centavos(d) * 10n ** 7n
const brl = (d: Dec) => { const c = centavos(d); const neg = c < 0n; const a = neg ? -c : c; return `${neg ? '-' : ''}${(a / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${(a % 100n).toString().padStart(2, '0')}` }
const MES_ABREV: Record<string, string> = { jan: '01', fev: '02', mar: '03', abr: '04', mai: '05', jun: '06', jul: '07', ago: '08', set: '09', out: '10', nov: '11', dez: '12' }
const fimDoMes = (m: string) => { const [a, mm] = m.split('-').map(Number); return `${m}-${String(new Date(a, mm, 0).getDate()).padStart(2, '0')}` }

type ProdutoCad = { codigo: string; descricao: string; tipo: string }
async function produtos(loja: number) {
  const m = new Map<string, ProdutoCad>()
  for (const r of await q(db, 'select codigo_produto::text c, codigo, descricao, coalesce(tipo_item,\'\') t from produtos where loja_id=$1', [loja])) m.set(r.c, { codigo: r.codigo ?? '', descricao: r.descricao ?? '', tipo: r.t })
  return m
}

type GabProprio = { vendas: Venda[]; linhas: LinhaVenda[]; fichas: Fichas; serie: SerieCusto; servicos: Set<string>; rotulo: (l: LinhaVenda) => string; prods: Map<string, ProdutoCad>; faturamentoItens: Map<string, Dec> }
async function carregarProprio(loja: number): Promise<GabProprio> {
  const prods = await produtos(loja)
  const servicos = new Set([...prods].filter(([, p]) => p.tipo === '09').map(([c]) => c))
  const vs = await q(db, 'select id, data::text d, pedido_ref, valor::text valor, cancelado, devolvido from vendas_proprio where loja_id=$1', [loja])
  const vendas: Venda[] = vs.map((r) => ({ data: r.d, valor: r.valor, cancelado: r.cancelado, devolvido: r.devolvido }))
  const validas = new Map(vs.filter((r) => !r.cancelado && !r.devolvido).map((r) => [Number(r.id), r]))
  // movimentos de venda por pedido: primeiro id (instante da venda) e quais produtos o ERP baixou
  const movs = await q(db, "select v.id vid, m.codigo_produto::text cp, m.id mid from vendas_proprio v join estoque_movimentos m on m.loja_id=v.loja_id and m.origem='VENDA' and m.ref=v.pedido_ref where v.loja_id=$1", [loja])
  const primeiro = new Map<number, number>()
  const baixados = new Map<number, Set<string>>()
  for (const m of movs) {
    const id = Number(m.vid), mid = Number(m.mid)
    primeiro.set(id, Math.min(primeiro.get(id) ?? Infinity, mid))
    ;(baixados.get(id) ?? baixados.set(id, new Set()).get(id)!).add(m.cp)
  }
  const its = await q(db, 'select i.venda_id, i.linha, i.codigo_produto::text cp, coalesce(i.nome,\'\') nome, i.quantidade::text qtd, i.valor::text valor, coalesce(i.componentes::text[], \'{}\') comp from vendas_proprio_itens i join vendas_proprio v on v.id=i.venda_id where v.loja_id=$1 order by i.venda_id, i.linha', [loja])
  const linhas: LinhaVenda[] = []
  const faturamentoItens = new Map<string, Dec>()
  for (const i of its) {
    const vd = validas.get(Number(i.venda_id))
    if (!vd) continue
    const codigos = [...(i.cp ? [i.cp] : []), ...i.comp]
    const bx = baixados.get(Number(i.venda_id))
    linhas.push({
      vendaId: Number(i.venda_id), data: vd.d, marco: { d: vd.d, id: primeiro.get(Number(i.venda_id)) ?? 1e15 },
      codigo: i.cp, nome: i.nome, quantidade: i.qtd, valor: i.valor, componentes: i.comp,
      taxa: /^taxa de servi/i.test(i.nome), semBaixa: !codigos.some((c) => bx?.has(c)),
    })
    const mes = vd.d.slice(0, 7)
    faturamentoItens.set(mes, (faturamentoItens.get(mes) ?? 0n) + dec(i.valor))
  }
  // fichas ativas
  const fichas: Fichas = new Map()
  const porId = new Map<string, string>()
  for (const f of await q(db, 'select id::text, codigo_produto::text cp, rendimento::text r, expandir_na_venda ex from fichas_tecnicas where loja_id=$1 and ativa', [loja])) { fichas.set(f.cp, { rendimento: f.r, expandir: f.ex, itens: [] }); porId.set(f.id, f.cp) }
  for (const i of await q(db, 'select ficha_id::text fid, codigo_insumo::text ci, quantidade_liquida::text l, fator_correcao::text f, perda_pct::text p from ficha_tecnica_itens where loja_id=$1', [loja])) {
    const cp = porId.get(i.fid)
    if (cp) fichas.get(cp)!.itens.push({ insumo: i.ci, liquida: i.l, fator: i.f, perda: i.p })
  }
  // série de custo médio vigente: a última revisão de cada movimento vale (data efetiva e custo médio revisados)
  const serie: SerieCusto = new Map()
  const sm = await q(db, `select m.id::text id, m.codigo_produto::text cp, coalesce(r.data_efetiva, m.data_ref)::text d, coalesce(r.cmc_apos, m.cmc_apos)::text cmc
    from estoque_movimentos m left join lateral (select x.data_efetiva, x.cmc_apos from estoque_mov_revisao x where x.movimento_id=m.id order by x.id desc limit 1) r on true
    where m.loja_id=$1 and coalesce(r.cmc_apos, m.cmc_apos) is not null order by 3, m.id`, [loja])
  for (const r of sm) (serie.get(r.cp) ?? serie.set(r.cp, []).get(r.cp)!).push({ d: r.d, id: Number(r.id), cmc: r.cmc })
  const rotulo = (l: LinhaVenda) => (l.codigo ? (prods.get(l.codigo)?.descricao || l.nome) : l.nome) || 'Produto não identificado'
  return { vendas, linhas, fichas, serie, servicos, rotulo, prods, faturamentoItens }
}

type GabOmie = { cupons: Venda[]; itens: (ItemCupom & { data: string })[]; custo: Map<string, Dec>; foto: string | null; prods: Map<string, ProdutoCad> }
async function carregarOmie(loja: number): Promise<GabOmie> {
  const prods = await produtos(loja)
  const cs = await q(frio, 'select n_id_cupom::text id, data::text d, valor::text valor, cancelado, devolvido from fat_cupons where loja_id=$1', [loja])
  const validos = new Map(cs.filter((c) => !c.cancelado).map((c) => [c.id, c.d]))
  const cupons: Venda[] = cs.map((c) => ({ data: c.d, valor: c.valor, cancelado: c.cancelado, devolvido: c.devolvido }))
  const its = await q(frio, 'select n_id_cupom::text id, id_produto::text p, coalesce(x_prod,\'\') x, quant::text q, v_unit::text u, v_desc::text d, v_item::text v from fat_cupom_itens where loja_id=$1', [loja])
  const itens: (ItemCupom & { data: string })[] = []
  for (const i of its) {
    const data = validos.get(i.id)
    if (!data) continue
    // valor do item: o líquido gravado; se vier zerado, preço x quantidade - desconto
    const valor = dec(i.v) !== 0n ? i.v : texto(dec(i.u) * dec(i.q) / 10n ** 9n - dec(i.d))
    const cad = i.p ? prods.get(i.p) : undefined
    itens.push({ data, produto: i.p || null, rotulo: cad?.descricao || cad?.codigo || i.x || 'Produto não identificado', quantidade: i.q, valor })
  }
  const foto = (await q(db, 'select max(data_posicao)::text d from posicao_estoques where loja_id=$1 and codigo_local_estoque<>0', [loja]))[0]?.d ?? null
  const fotoRows = foto ? await q(db, 'select n_cod_prod::text p, codigo_local_estoque::text l, coalesce(n_saldo,0)::text s, coalesce(n_cmc,0)::text c from posicao_estoques where loja_id=$1 and data_posicao=$2', [loja, foto]) : []
  const custo = custoMedioDeHoje(fotoRows.map((r) => ({ produto: r.p, local: Number(r.l), saldo: r.s, cmc: r.c })))
  return { cupons, itens, custo, foto, prods }
}

// ---- Leitura das telas, como pessoa ----
async function entrar(page: Page, loja: number) {
  const lg = logins.get(loja)
  if (!lg) throw new Error(`sem login dono para a loja ${loja}`)
  await page.goto(`${ORIGEM}/login`, { waitUntil: 'domcontentloaded', timeout: 90000 })
  await page.fill('#email', lg.email)
  await page.fill('#password', lg.senha)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/(home|resumo|central|entrar|porta)/, { timeout: 90000 })
}
async function abrir(page: Page, url: string, print: string) {
  await page.goto(`${ORIGEM}${url}`, { waitUntil: 'domcontentloaded', timeout: 120000 })
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {})
  await page.waitForSelector('main table tbody tr, main [role=status], main h1', { timeout: 30000 }).catch(() => {})
  await page.screenshot({ path: path.join(SAIDA, 'prints', print) }).catch(() => {})
  const txt = await page.evaluate(() => (document.querySelector('main') as HTMLElement | null)?.innerText ?? document.body.innerText)
  return txt
}
const norm = (t: string) => t.replace(/[\s\u00a0]+/g, ' ').trim()
const moeda = (t: string): Dec => lerNumeroBR(t.replace(/R\$/g, '').replace(/[\s ]/g, '').replace(/^-?$/, '0'))
const tabela = (page: Page) => page.evaluate(() => {
  const t = document.querySelector('main table')
  if (!t) return null
  const cab = [...t.querySelectorAll('thead th')].map((h) => (h as HTMLElement).innerText.trim())
  const linhas = [...t.querySelectorAll('tbody tr, tfoot tr')].map((tr) => [...tr.querySelectorAll('td,th')].map((c) => (c as HTMLElement).innerText.trim()))
  return { cab, linhas }
})
const cartao = (txt: string, rotulo: string): Dec | null => {
  const m = txt.match(new RegExp(`${rotulo}\\s*\\n\\s*(-?R\\$\\s*[\\d.,]+)`))
  return m ? moeda(m[1]) : null
}

type Tela = { texto: string; erro: string | null }
async function lerFaturamentoMensal(page: Page, loja: number, query: string, print: string) {
  const texto = await abrir(page, `/relatorio-faturamento${query}`, print)
  const t = await tabela(page)
  const meses = new Map<string, Dec>()
  if (t) {
    const total = t.linhas.find((l) => l[0] === 'Total')
    if (total) t.cab.forEach((h, i) => { const m = h.match(/^([a-zç]{3})\/(\d{2})$/); if (m && MES_ABREV[m[1]]) meses.set(`20${m[2]}-${MES_ABREV[m[1]]}`, moeda(total[i])) })
  }
  return { texto, meses, temTabela: !!t, total: cartao(texto, 'Total faturado') }
}
async function lerDiario(page: Page, ini: string, fim: string, print: string) {
  const texto = await abrir(page, `/relatorio-faturamento?ver=diario&data_inicio=${ini}&data_final=${fim}`, print)
  const t = await tabela(page)
  const dias = new Map<string, Dec>()
  for (const l of t?.linhas ?? []) {
    const m = l[0]?.match(/^(\d{2})\/(\d{2})\/(\d{4})/)
    if (m && l[1]) dias.set(`${m[3]}-${m[2]}-${m[1]}`, moeda(l[1]))
  }
  return { texto, dias, temTabela: !!t, total: cartao(texto, 'Faturado no período') }
}
type LinhaCmvTela = { rotulo: string; quantidade: Dec; faturamento: Dec; cmv: Dec }
async function lerCmv(page: Page, mes: string, print: string) {
  const texto = await abrir(page, `/relatorio-cmv?mes=${mes}`, print)
  const t = await tabela(page)
  const linhas: LinhaCmvTela[] = []
  if (t) {
    const iF = t.cab.indexOf('Faturamento'), iC = t.cab.indexOf('CMV'), iQ = t.cab.indexOf('Quantidade')
    for (const l of t.linhas) if (l.length > iC && iF >= 0) linhas.push({ rotulo: norm(l[0].split('\n')[0]), quantidade: lerNumeroBR(l[iQ].replace(/[\s ]/g, '') || '0'), faturamento: moeda(l[iF]), cmv: moeda(l[iC]) })
  }
  const mostrando = texto.match(/Mostrando (\d+) de ([\d.]+) linhas/)
  return { texto, linhas, faturamento: cartao(texto, 'Faturamento'), cmv: cartao(texto, 'CMV \\(custo das vendas\\)'), mostrando: mostrando ? Number(mostrando[2].replace(/\./g, '')) : linhas.length, temTabela: !!t, fonte: texto.match(/(Estimado: [^\n]*|Custo real de cada baixa[^\n]*|Kardex do Omie[^\n]*)/)?.[1] ?? '' }
}
async function lerLucro(page: Page, dim: 'mes' | 'dia', ini: string, fim: string, print: string) {
  const texto = await abrir(page, `/relatorio-lucro?dim=${dim}&data_inicio=${ini}&data_final=${fim}`, print)
  const t = await tabela(page)
  const linhas = new Map<string, { faturamento: Dec; cmv: Dec }>()
  if (t) {
    const iF = t.cab.indexOf('Faturamento'), iC = t.cab.indexOf('Custo')
    for (const l of t.linhas) { const m = l[0].match(/^(\d{4}-\d{2}(?:-\d{2})?)/); if (m && iF >= 0) linhas.set(m[1], { faturamento: moeda(l[iF]), cmv: moeda(l[iC]) }) }
  }
  return { texto, linhas, temTabela: !!t, faturamento: cartao(texto, 'Faturamento'), cmv: cartao(texto, 'Custo \\(CMV\\)'), semBaixa: Number(texto.match(/(\d+) itens? vendidos? não baixaram/)?.[1] ?? 0) }
}

// ---- Execução ----
const t0 = Date.now()
const browser = await chromium.launch()
const falhas: Falha[] = []
const resumoLojas: Record<string, unknown>[] = []
const comparacao: string[] = ['# Comparação tela × gabarito (faturamento e CMV)', '']
const decomposicoes: string[] = ['# Decomposição das diferenças de CMV (tela − gabarito, por produto)', '']
let visitas = 0
const f = (o: Omit<Falha, 'gravidade' | 'cargo'> & { gravidade?: 1 | 2 | 3 }) => falhas.push({ gravidade: 1, cargo: 'dono', ...o })
const nomeMoeda = (d: Dec | null) => (d === null ? 'ausente' : `R$ ${brl(d)}`)

for (const loja of LOJAS) {
  const antes = await digital(loja.id)
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', reducedMotion: 'reduce' })
  await ctx.route('**/*', (rota) => {
    const u = new URL(rota.request().url())
    return u.protocol === 'data:' || u.protocol === 'blob:' || u.origin === ORIGEM || u.origin === 'http://127.0.0.1:54421' ? rota.continue() : rota.abort('blockedbyclient')
  })
  const page = await ctx.newPage()
  page.setDefaultTimeout(30000)
  const consoleErros: string[] = []
  page.on('pageerror', (e) => consoleErros.push(String(e).slice(0, 160)))
  await entrar(page, loja.id)
  const proprio = loja.modo === 'proprio' ? await carregarProprio(loja.id) : null
  const omie = loja.modo === 'omie' ? await carregarOmie(loja.id) : null
  const docs: Venda[] = proprio ? proprio.vendas : omie!.cupons
  const gabDia = faturamentoPorDia(docs, loja.modo)
  const gabMes = faturamentoPorMes(gabDia)
  const canceladoMes = faturamentoPorMes(faturamentoPorDia(docs.filter((x) => x.cancelado).map((x) => ({ ...x, cancelado: false })), 'omie'))
  comparacao.push(`## ${loja.nome} (loja ${loja.id}, ${loja.modo})`, '')
  const r: Record<string, unknown> = { loja: loja.nome, modo: loja.modo, vendasNoBanco: docs.length, diasComVenda: gabDia.size, mesesComVenda: gabMes.size }

  const sanidade = (tela: string, onde: string, print: string) => {
    visitas++
    if (ehPaginaNaoEncontrada(tela)) f({ tipo: 'tela-quebrada', gravidade: 2, loja: loja.nome, tela: onde, passo: `abrir ${onde}`, esperado: 'tela do relatório', mostrado: 'página 404 (não encontrada)', print: `prints/${print}` })
    const inv = valoresInvalidos(tela)
    if (inv.length) f({ tipo: 'valor-invalido', loja: loja.nome, tela: onde, passo: `ler ${onde}`, esperado: 'números válidos', mostrado: `texto ${inv.join(', ')} na tela`, print: `prints/${print}` })
  }

  // 1) Faturamento por mês (tela padrão e, na loja Omie, o ano passado, que vem do histórico do frio)
  const consultas = [['', 'ano atual']] as [string, string][]
  if (loja.modo === 'omie') consultas.push(['?periodo=ano_passado', 'ano passado'])
  comparacao.push('### Faturamento por mês', '', '| Mês | Tela | Gabarito | Diferença | Situação |', '|---|---|---|---|---|')
  const mesesVistos = new Set<string>()
  for (const [qs, rot] of consultas) {
    const pr = `${loja.id}-faturamento-mensal${qs ? '-ano-passado' : ''}.png`
    const m = await lerFaturamentoMensal(page, loja.id, qs, pr)
    sanidade(m.texto, `/relatorio-faturamento${qs}`, pr)
    // meses que a tela deve mostrar: os do gabarito dentro do ano da consulta; e todo mês que a tela mostrar
    const ano = rot === 'ano passado' ? String(Number(HOJE.slice(0, 4)) - 1) : HOJE.slice(0, 4)
    const alvo = new Set([...gabMes.keys()].filter((k) => k.startsWith(ano) && gabMes.get(k)! !== 0n).concat([...m.meses.keys()]))
    for (const mes of [...alvo].sort()) {
      const tl = m.meses.get(mes) ?? null, g = gabMes.get(mes) ?? 0n
      mesesVistos.add(mes)
      const dif = (tl ?? 0n) - g
      const ok = modulo(dif) <= TOL_FAT
      comparacao.push(`| ${mes} | ${nomeMoeda(tl)} | ${nomeMoeda(g)} | ${brl(dif)} | ${ok ? 'bate' : 'DIVERGE'} |`)
      if (!ok) f({ tipo: 'conta-divergente', loja: loja.nome, tela: `/relatorio-faturamento${qs}`, passo: `faturamento do mês ${mes}, linha Total (${rot})`, esperado: `${nomeMoeda(g)} (soma das vendas do mês)`, mostrado: `${nomeMoeda(tl)} (diferença ${brl(dif)}${canceladoMes.get(mes) !== undefined && modulo(dif - canceladoMes.get(mes)!) <= TOL_FAT ? `; é exatamente o total dos cupons CANCELADOS do mês, R$ ${brl(canceladoMes.get(mes)!)}: a tela soma cancelado` : ''})`, print: `prints/${pr}` })
    }
    if (!m.temTabela && alvo.size) f({ tipo: 'tela-vazia', gravidade: 2, loja: loja.nome, tela: `/relatorio-faturamento${qs}`, passo: `abrir faturamento (${rot})`, esperado: `tabela com ${alvo.size} mês(es)`, mostrado: 'sem tabela', print: `prints/${pr}` })
    if (m.temTabela && m.total !== null) {
      const somaTela = somar(m.meses.values())
      if (modulo(somaTela - m.total) > TOL_FAT) f({ tipo: 'conta-divergente', loja: loja.nome, tela: `/relatorio-faturamento${qs}`, passo: `cartão Total faturado contra a soma dos meses da própria tela (${rot})`, esperado: nomeMoeda(somaTela), mostrado: nomeMoeda(m.total), print: `prints/${pr}` })
    }
  }
  comparacao.push('')

  // 2) Faturamento por dia
  comparacao.push('### Faturamento por dia', '', '| Janela | Dias na tela | Dias com diferença | Total tela | Total gabarito |', '|---|---|---|---|---|')
  let diasComparados = 0, diasDivergentes = 0
  for (const [ini0, fim0] of loja.diario) {
    const ini = ini0, fim = fim0 === 'HOJE' ? HOJE : fim0
    const pr = `${loja.id}-faturamento-diario-${ini}.png`
    const d = await lerDiario(page, ini, fim, pr)
    sanidade(d.texto, '/relatorio-faturamento?ver=diario', pr)
    let gTotal = 0n, tTotal = 0n, divs = 0
    const exemplos: string[] = []
    const dias: string[] = []
    for (let x = new Date(`${ini}T12:00:00Z`); x.toISOString().slice(0, 10) <= fim; x = new Date(x.getTime() + 864e5)) dias.push(x.toISOString().slice(0, 10))
    for (const dia of dias) {
      const g = gabDia.get(dia) ?? 0n
      const tl = d.dias.get(dia) ?? null
      gTotal += g; tTotal += tl ?? 0n
      diasComparados++
      if ((tl === null && !(g === 0n && !d.temTabela)) || (tl !== null && modulo(tl - g) > TOL_FAT)) {
        divs++; diasDivergentes++
        if (exemplos.length < 8) exemplos.push(`${dia}: tela ${nomeMoeda(tl)}, gabarito ${nomeMoeda(g)}`)
        if (divs <= 15) f({ tipo: 'conta-divergente', loja: loja.nome, tela: '/relatorio-faturamento?ver=diario', passo: `faturamento do dia ${dia}`, esperado: `${nomeMoeda(g)} (soma das vendas do dia)`, mostrado: nomeMoeda(tl), print: `prints/${pr}` })
      }
    }
    if (d.total !== null && modulo(d.total - tTotal) > TOL_FAT) f({ tipo: 'conta-divergente', loja: loja.nome, tela: '/relatorio-faturamento?ver=diario', passo: `cartão "Faturado no período" ${ini} a ${fim} contra a soma dos dias da própria tela`, esperado: nomeMoeda(tTotal), mostrado: nomeMoeda(d.total), print: `prints/${pr}` })
    if (divs > 15) f({ tipo: 'conta-divergente', loja: loja.nome, tela: '/relatorio-faturamento?ver=diario', passo: `resumo dos dias com diferença em ${ini} a ${fim}`, esperado: 'nenhum dia com diferença', mostrado: `${divs} dias com diferença (só os 15 primeiros listados individualmente); exemplos: ${exemplos.join(' | ')}`, print: `prints/${pr}` })
    comparacao.push(`| ${ini} a ${fim} | ${d.dias.size} | ${divs} | ${nomeMoeda(tTotal)} | ${nomeMoeda(gTotal)} |`)
    if (!d.temTabela && gTotal !== 0n) f({ tipo: 'tela-vazia', gravidade: 2, loja: loja.nome, tela: '/relatorio-faturamento?ver=diario', passo: `abrir Por dia ${ini} a ${fim}`, esperado: 'tabela dia a dia', mostrado: 'sem tabela', print: `prints/${pr}` })
  }
  if (omie) {
    const env = fs.readFileSync(envLocal, 'utf8')
    const val = (k: string) => env.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1]?.trim().replace(/^["']|["']$/g, '') ?? ''
    const url = val('NTB_FRIO_API_URL'), key = val('NTB_FRIO_API_KEY')
    if (/^http:\/\/(127\.0\.0\.1|localhost):54422/.test(url) && key) {
      for (const [ini0, fim0] of loja.diario) {
        const fim = fim0 === 'HOJE' ? HOJE : fim0
        const esperado = Number((await q(frio, 'select count(*)::text c from fat_cupons where loja_id=$1 and data between $2 and $3', [loja.id, ini0, fim]))[0].c)
        const ids = new Map<string, number>()
        let recebidas = 0
        for (let off = 0; off < esperado + 5000; off += 5000) {
          const resp = await fetch(`${url}/fat_cupons?loja_id=${loja.id}&data_inicio=${ini0}&data_final=${fim}&offset=${off}`, { headers: { 'X-Api-Key': key } })
          const j = (await resp.json()) as { rows: { n_id_cupom: string | number }[] }
          recebidas += j.rows.length
          for (const c of j.rows) ids.set(String(c.n_id_cupom), (ids.get(String(c.n_id_cupom)) ?? 0) + 1)
          if (j.rows.length < 5000) break
        }
        const repetidos = [...ids.values()].filter((n) => n > 1).length
        const faltando = esperado - ids.size
        ;(r.paginacaoFrio as unknown[] ?? (r.paginacaoFrio = [])).push({ janela: `${ini0} a ${fim}`, esperado, recebidas, idsDistintos: ids.size, repetidos, faltando })
        if (faltando > 0 || repetidos > 0) f({ tipo: 'conta-divergente', loja: loja.nome, tela: '/relatorio-faturamento?ver=diario (API do frio, GET /fat_cupons)', passo: `ler os cupons de ${ini0} a ${fim} em páginas de 5000 (order by data desc, sem desempate)`, esperado: `${esperado} cupons distintos`, mostrado: `${recebidas} linhas, ${ids.size} cupons distintos: ${repetidos} repetido(s) e ${faltando} faltando entre as páginas (causa da diferença nos dias acima)`, print: `prints/${loja.id}-faturamento-diario-${ini0}.png` })
        comparacao.push(`Paginação do /fat_cupons (${ini0} a ${fim}): esperados ${esperado} cupons, recebidos ${recebidas}, distintos ${ids.size}, repetidos ${repetidos}, faltando ${faltando}.`, '')
      }
    }
  }
  comparacao.push('')
  r.diasComparados = diasComparados; r.diasDivergentes = diasDivergentes

  // 3) CMV por mês (tela CMV/CPV; loja Omie sem ficha local = estimativa; loja própria = custo de cada baixa)
  comparacao.push('### CMV por mês (tela CMV/CPV)', '', '| Mês | Faturamento tela | Faturamento gabarito | CMV tela | CMV gabarito | Diferença CMV | Fonte da tela | Situação |', '|---|---|---|---|---|---|---|---|')
  let mesesCmv = 0, mesesCmvDivergentes = 0
  for (const mes of loja.meses) {
    const pr = `${loja.id}-cmv-${mes}.png`
    const c = await lerCmv(page, mes, pr)
    sanidade(c.texto, '/relatorio-cmv', pr)
    const ini = `${mes}-01`, fim = fimDoMes(mes)
    let gab = new Map<string, LinhaResultado & Partial<LinhaEstimada>>()
    if (proprio) gab = cmvPorRotulo(proprio.linhas.filter((l) => l.data >= ini && l.data <= fim), proprio.fichas, proprio.serie, proprio.servicos, proprio.rotulo)
    else gab = cmvEstimado(omie!.itens.filter((i) => i.data >= ini && i.data <= fim), omie!.custo) as never
    // rótulos iguais (produtos diferentes com o mesmo nome) somam, como na tela de loja própria
    const porRotulo = new Map<string, LinhaResultado & Partial<LinhaEstimada>>()
    for (const x0 of gab.values()) {
      const x = { ...x0, rotulo: norm(x0.rotulo) }
      const a = porRotulo.get(x.rotulo)
      if (!a) porRotulo.set(x.rotulo, { ...x })
      else { a.quantidade += x.quantidade; a.faturamento += x.faturamento; a.cmv += x.cmv; a.cmvSemBaixa += x.cmvSemBaixa; a.linhasSemBaixa += x.linhasSemBaixa; a.foraDoNormal = a.foraDoNormal || x.foraDoNormal }
    }
    for (const x of porRotulo.values()) { x.cmv = arred2(x.cmv); x.faturamento = arred2(x.faturamento); x.cmvSemBaixa = arred2(x.cmvSemBaixa) }
    const gFat = somar([...porRotulo.values()].map((x) => x.faturamento))
    const gCmv = somar([...porRotulo.values()].map((x) => x.cmv))
    const gSemBaixa = somar([...porRotulo.values()].map((x) => x.cmvSemBaixa))
    mesesCmv++
    const tFat = c.faturamento ?? 0n, tCmv = c.cmv ?? 0n
    const difCmv = tCmv - gCmv
    const okFat = modulo(tFat - gFat) <= TOL_FAT
    const okCmv = modulo(difCmv) <= TOL_CMV_TOTAL
    // linhas de produto
    const telaCmv = new Map<string, Dec>(), gabCmv = new Map<string, Dec>()
    for (const l of c.linhas) telaCmv.set(l.rotulo, (telaCmv.get(l.rotulo) ?? 0n) + l.cmv)
    for (const x of porRotulo.values()) gabCmv.set(x.rotulo, x.cmv)
    const cortada = c.mostrando > c.linhas.length
    if (cortada) { // a tela só lista 500: compara só os rótulos que ela mostra
      for (const k of [...gabCmv.keys()]) if (!telaCmv.has(k)) gabCmv.delete(k)
    }
    const causa = (rot: string, dif: Dec) => {
      const x = porRotulo.get(rot)
      if (!x) return 'produto só aparece na tela'
      if (x.foraDoNormal) return 'custo de hoje acima do preço médio: a conta estimada zera (regra do dono); o gabarito também zera'
      if (x.cmvSemBaixa > 0n && modulo(dif + x.cmvSemBaixa) <= TOL_CMV_LINHA * 4n) return `${x.linhasSemBaixa} linha(s) vendida(s) sem baixa de estoque no ERP (custo zero na tela; o gabarito custaria R$ ${brl(x.cmvSemBaixa)})`
      if (x.cmvSemBaixa > 0n) return `inclui ${x.linhasSemBaixa} linha(s) sem baixa no ERP (R$ ${brl(x.cmvSemBaixa)}); o restante é diferença de custo`
      return 'diferença de custo ou de quantidade; sem baixa faltando'
    }
    const contrib = decompor(telaCmv, gabCmv, TOL_CMV_LINHA, causa)
    const grandes = contrib.filter((x) => modulo(x.diferenca) > dec('1'))
    const linhaCmp = `| ${mes} | ${nomeMoeda(c.faturamento)} | ${nomeMoeda(gFat)} | ${nomeMoeda(c.cmv)} | ${nomeMoeda(gCmv)} | ${brl(difCmv)} | ${c.fonte.slice(0, 40)} | ${okFat && okCmv ? 'bate' : 'DIVERGE'} |`
    comparacao.push(linhaCmp)
    if (!c.temTabela && (gFat !== 0n || tFat !== 0n)) f({ tipo: 'tela-vazia', gravidade: 2, loja: loja.nome, tela: '/relatorio-cmv', passo: `CMV de ${mes}`, esperado: 'tabela de produtos', mostrado: 'sem tabela', print: `prints/${pr}` })
    if (!okFat) {
      const dc = decompor(new Map(c.linhas.map((l) => [l.rotulo, l.faturamento])), new Map([...porRotulo.values()].map((x) => [x.rotulo, x.faturamento])), TOL_FAT)
      f({ tipo: 'conta-divergente', loja: loja.nome, tela: '/relatorio-cmv', passo: `faturamento do mês ${mes} no cartão do CMV (soma dos itens vendidos)${cortada ? ' [tela lista só 500 linhas]' : ''}`, esperado: `${nomeMoeda(gFat)} (soma dos itens das vendas válidas)`, mostrado: `${nomeMoeda(c.faturamento)} (diferença ${brl(tFat - gFat)}); principais: ${dc.slice(0, 5).map((x) => `${x.rotulo} ${brl(x.diferenca)}`).join(' | ') || 'sem linha visível'}`, print: `prints/${pr}` })
    }
    if (!okCmv || grandes.length) {
      mesesCmvDivergentes++
      const top = contrib.slice(0, 6).map((x) => `${x.rotulo}: tela ${brl(x.tela)} / gabarito ${brl(x.gabarito)} (${brl(x.diferenca)}; ${x.causa})`)
      decomposicoes.push(`## ${loja.nome} ${mes}`, '', `CMV tela ${nomeMoeda(c.cmv)} | gabarito ${nomeMoeda(gCmv)} | diferença ${brl(difCmv)}. Das linhas sem baixa no ERP o gabarito custaria R$ ${brl(gSemBaixa)}.${cortada ? ` A tela lista só ${c.linhas.length} de ${c.mostrando} produtos.` : ''}`, '', '| Produto | Tela | Gabarito | Diferença | Causa |', '|---|---|---|---|---|', ...contrib.slice(0, 40).map((x) => `| ${x.rotulo.replace(/\|/g, '/')} | ${brl(x.tela)} | ${brl(x.gabarito)} | ${brl(x.diferenca)} | ${x.causa} |`), '')
      f({
        tipo: 'conta-divergente', loja: loja.nome, tela: '/relatorio-cmv',
        passo: `CMV do mês ${mes} (${c.fonte.slice(0, 60)})`,
        esperado: `${nomeMoeda(gCmv)} (${proprio ? 'vendas × ficha × custo médio vigente na hora da venda' : 'quantidade vendida × custo médio de hoje'})`,
        mostrado: `${nomeMoeda(c.cmv)} (diferença ${brl(difCmv)}${okCmv ? ', total bate mas há linhas com diferença' : ''}); decomposição: ${top.join(' || ') || 'nenhuma linha acima da tolerância na lista visível'}`,
        print: `prints/${pr}`,
      })
    }
  }
  comparacao.push('')
  r.mesesCmv = mesesCmv; r.mesesCmvDivergentes = mesesCmvDivergentes

  // 4) Tela Lucro (só loja de estoque próprio: ela lê o mesmo custo de cada baixa por dia e por mês)
  if (proprio) {
    const ini = loja.meses[0] + '-01'
    const pm = `${loja.id}-lucro-mes.png`, pd = `${loja.id}-lucro-dia.png`
    const lm = await lerLucro(page, 'mes', ini, HOJE, pm)
    const ld = await lerLucro(page, 'dia', ini, HOJE, pd)
    sanidade(lm.texto, '/relatorio-lucro', pm); sanidade(ld.texto, '/relatorio-lucro', pd)
    comparacao.push('### Lucro (por mês e por dia)', '', '| Chave | Faturamento tela | Faturamento gabarito | Custo tela | CMV gabarito | Situação |', '|---|---|---|---|---|---|')
    for (const mes of loja.meses) {
      const l = lm.linhas.get(mes)
      const ls = proprio.linhas.filter((x) => x.data.startsWith(mes))
      const gF = somar(ls.map((x) => dec(x.valor)))
      const gC = somar([...cmvPorRotulo(ls, proprio.fichas, proprio.serie, proprio.servicos, proprio.rotulo).values()].map((x) => x.cmv))
      const okF = modulo((l?.faturamento ?? 0n) - gF) <= TOL_FAT, okC = modulo((l?.cmv ?? 0n) - gC) <= TOL_CMV_TOTAL
      comparacao.push(`| ${mes} | ${nomeMoeda(l?.faturamento ?? null)} | ${nomeMoeda(gF)} | ${nomeMoeda(l?.cmv ?? null)} | ${nomeMoeda(gC)} | ${okF && okC ? 'bate' : 'DIVERGE'} |`)
      if (!okF) f({ tipo: 'conta-divergente', loja: loja.nome, tela: '/relatorio-lucro', passo: `faturamento do mês ${mes}`, esperado: nomeMoeda(gF), mostrado: nomeMoeda(l?.faturamento ?? null), print: `prints/${pm}` })
      if (!okC) f({ tipo: 'conta-divergente', loja: loja.nome, tela: '/relatorio-lucro', passo: `custo (CMV) do mês ${mes}`, esperado: nomeMoeda(gC), mostrado: `${nomeMoeda(l?.cmv ?? null)} (diferença ${brl((l?.cmv ?? 0n) - gC)}; ${lm.semBaixa} item(ns) sem baixa avisados pela tela)`, print: `prints/${pm}` })
    }
    // por dia: faturamento
    let dd = 0
    for (const dia of new Set([...ld.linhas.keys(), ...[...gabDia.keys()].filter((k) => k >= ini)])) {
      const l = ld.linhas.get(dia)?.faturamento ?? 0n, g = gabDia.get(dia) ?? 0n
      if (modulo(l - g) > TOL_FAT) { dd++; if (dd <= 10) f({ tipo: 'conta-divergente', loja: loja.nome, tela: '/relatorio-lucro', passo: `faturamento do dia ${dia} (Lucro por dia)`, esperado: nomeMoeda(g), mostrado: nomeMoeda(l), print: `prints/${pd}` }) }
    }
    comparacao.push('', `Dias com diferença de faturamento na tela Lucro: ${dd}`, '')
    r.lucroDiasDivergentes = dd
    // consistência dos documentos de origem: valor da venda x soma dos itens (informativo)
    const dif: string[] = []
    for (const mes of loja.meses) { const a = gabMes.get(mes) ?? 0n, b = proprio.faturamentoItens.get(mes) ?? 0n; if (modulo(a - b) > TOL_FAT) dif.push(`${mes}: vendas ${brl(a)} x itens ${brl(b)}`) }
    r.documentosVendaXItens = dif.length ? dif : 'iguais nos meses lidos'
  }

  const depois = await digital(loja.id)
  r.bancoMudouDuranteALeitura = antes !== depois
  r.errosDeJavascript = consoleErros.length
  if (consoleErros.length) f({ tipo: 'erro-console', gravidade: 2, loja: loja.nome, tela: 'relatórios', passo: 'ler as telas de relatório', esperado: 'sem erro de JavaScript', mostrado: consoleErros.slice(0, 3).join(' | '), print: `prints/${loja.id}-cmv-${loja.meses.at(-1)}.png` })
  await ctx.close()
  resumoLojas.push(r)
  console.log(JSON.stringify(r))
}
await browser.close()
await db.end()
await frio.end()

const ordenadas = ordenarFalhas(falhas)
const md = formatarListaFalhas(ordenadas, { visitas, telas: 4, logins: LOJAS.length })
fs.writeFileSync(path.join(SAIDA, 'falhas.md'), md)
fs.writeFileSync(path.join(SAIDA, 'comparacao.md'), comparacao.join('\n') + '\n')
fs.writeFileSync(path.join(SAIDA, 'decomposicao-cmv.md'), decomposicoes.join('\n') + '\n')
const decomp = ordenadas.filter((x) => /decomposição/.test(x.mostrado)).length
const resumo = { rodada: ID_RODADA, urlBase: ORIGEM, hoje: HOJE, lojas: resumoLojas, falhas: ordenadas.length, g1: ordenadas.filter((x) => x.gravidade === 1).length, g2: ordenadas.filter((x) => x.gravidade === 2).length, g3: ordenadas.filter((x) => x.gravidade === 3).length, falhasComDecomposicao: decomp, sha256FalhasMd: crypto.createHash('sha256').update(md).digest('hex'), segundos: Math.round((Date.now() - t0) / 1000) }
fs.writeFileSync(path.join(SAIDA, 'resumo.json'), JSON.stringify(resumo, null, 1))
const incompleto = resumoLojas.some((l) => l.bancoMudouDuranteALeitura)
console.log(`falhas: ${ordenadas.length} (g1 ${resumo.g1}, g2 ${resumo.g2}, g3 ${resumo.g3}) | saída: ${SAIDA}${incompleto ? ' | ATENÇÃO: o banco mudou durante a leitura' : ''}`)
process.exit(incompleto ? 1 : 0)
