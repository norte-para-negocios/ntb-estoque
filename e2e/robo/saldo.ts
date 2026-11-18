// Robô do saldo de estoque (ticket 03): confere a tela Estoque (/estoque) de cada item, nas lojas 4 Sertão, 15 ODARA e 19,
// contra o gabarito (e2e/robo/saldo-gabarito.ts), feito direto nos documentos do banco local. SÓ LÊ o banco (sessão read-only)
// e só navega na tela. Nunca chama o Omie. Uso: npm run robo:saldo   (saída em .local-data/robo-saldo/<rodada>/, fora do git)
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import pg from 'pg'
import { chromium, type Page } from 'playwright'
import { verificarTravaLocal } from './trava.ts'
import { PORTA_PG_LOCAL, ORIGEM_API_LOCAL } from './base.ts'
import { formatarListaFalhas, ordenarFalhas, type Falha } from './relatorio.ts'
import { saldoPorLedger, saldoPorKardex, somarLocais, compararSaldos, lerNumeroBR, fmtDec, parseDec, type Dec, type MovKardex } from './saldo-gabarito.ts'

const RAIZ = path.resolve(import.meta.dirname, '..', '..')
const LOJAS = [
  { id: 4, nome: 'Sertão', modo: 'omie' as const },
  { id: 15, nome: 'ODARA', modo: 'proprio' as const },
  { id: 19, nome: 'Loja 19', modo: 'proprio' as const },
]
const POR_PAGINA = 50

function sair(msg: string): never {
  console.error(`ROBÔ RECUSOU RODAR: ${msg}`)
  process.exit(2)
}

// ---- Trava: só a cópia local ----
const trava = await verificarTravaLocal(RAIZ)
if (!trava.ok) sair(trava.motivo)
const ORIGEM = trava.origem
const envLocal = path.join(RAIZ, '.env.local')
const envTexto = trava.envTexto
const senhaPg = fs.readFileSync(path.join(RAIZ, '.local-data', 'env'), 'utf8').match(/^POSTGRES_PASSWORD=(.*)$/m)?.[1]?.trim()
if (!senhaPg) sair('POSTGRES_PASSWORD ausente em .local-data/env')

const logins = new Map<number, { email: string; senha: string }>()
for (const l of fs.readFileSync(path.join(RAIZ, '.local-data', 'logins.txt'), 'utf8').split('\n')) {
  const m = l.match(/^(\S+@ntb-teste\.local)\s+(\S+)\s+loja=(\d+)\s+cargo=dono/)
  if (m) logins.set(Number(m[3]), { email: m[1], senha: m[2] })
}

const ID_RODADA = process.env.ROBO_RODADA ?? new Date().toISOString().replace(/[:.]/g, '-')
const SAIDA = path.join(RAIZ, '.local-data', 'robo-saldo', ID_RODADA)
fs.mkdirSync(path.join(SAIDA, 'prints'), { recursive: true })

// ---- Leitura do banco (somente leitura) ----
const db = new pg.Client({ host: '127.0.0.1', port: PORTA_PG_LOCAL, user: 'postgres', password: senhaPg, database: 'postgres', options: '-c default_transaction_read_only=on' })
await db.connect()
const q = async <T = Record<string, string>>(sql: string, args: unknown[] = []) => (await db.query({ text: sql, values: args })).rows as T[]

type Produto = { codigo: string; descricao: string; inativo: boolean }
async function produtos(loja: number) {
  const m = new Map<number, Produto>()
  for (const r of await q('select codigo_produto::text, codigo, descricao, coalesce(inativo,false) as inativo from produtos where loja_id=$1', [loja]))
    m.set(Number(r.codigo_produto), { codigo: r.codigo ?? '', descricao: r.descricao ?? '', inativo: r.inativo as unknown as boolean })
  return m
}
/** Impressão digital dos documentos lidos: se mudar entre o início e o fim, alguém gravou durante a rodada. */
async function digital(loja: number, modo: 'omie' | 'proprio') {
  const r = modo === 'proprio'
    ? await q('select count(*)::text c, coalesce(max(id),0)::text m, coalesce(sum(quantidade),0)::text s from estoque_movimentos where loja_id=$1', [loja])
    : await q("select (select count(*) from kardex_omie where loja_id=$1)::text c, (select max(carregado_em) from kardex_omie where loja_id=$1)::text m, (select max(updated_at) from posicao_estoques where loja_id=$1)::text s", [loja])
  return JSON.stringify(r[0])
}

type Gabarito = { itens: Map<number, Dec>; omie: Map<number, Dec> | null; semGabarito: Set<number>; foto: string | null }
async function gabarito(loja: number, modo: 'omie' | 'proprio'): Promise<Gabarito> {
  if (modo === 'proprio') {
    const rows = await q('select codigo_produto::text p, codigo_local_estoque::text l, quantidade::text q from estoque_movimentos where loja_id=$1', [loja])
    return { itens: somarLocais(saldoPorLedger(rows.map((r) => ({ produto: Number(r.p), local: Number(r.l), quantidade: r.q })))), omie: null, semGabarito: new Set(), foto: null }
  }
  const rows = await q<Record<string, string | boolean | null>>('select n_cod_prod::text p, codigo_local_estoque::text l, data_mov::text d, id_mov::text i, quantidade::text q, saldo_apos::text s, cancelado from kardex_omie where loja_id=$1', [loja])
  const movs: MovKardex[] = rows.map((r) => ({ produto: Number(r.p), local: Number(r.l), dataMov: r.d as string, idMov: Number(r.i), quantidade: r.q as string, saldoApos: (r.s as string | null) ?? '0', cancelado: r.cancelado === true }))
  const itens = somarLocais(saldoPorKardex(movs))
  const comKardex = new Set(movs.map((m) => m.produto))
  // Espelho local do Omie: a foto de posição (posicao_estoques) com locais reais, a mais recente (a mesma que a tela usa).
  const f = (await q("select max(data_posicao)::text d from posicao_estoques where loja_id=$1 and codigo_local_estoque<>0", [loja]))[0].d
  const omie = new Map<number, Dec>()
  for (const r of await q("select n_cod_prod::text p, coalesce(n_saldo,0)::text s from posicao_estoques where loja_id=$1 and data_posicao=$2 and codigo_local_estoque<>0", [loja, f]))
    omie.set(Number(r.p), (omie.get(Number(r.p)) ?? 0n) + parseDec(r.s))
  return { itens, omie, semGabarito: new Set([...omie.keys()].filter((p) => !comKardex.has(p) && omie.get(p) !== 0n)), foto: f }
}

// ---- Leitura da tela, como pessoa: entra, abre Estoque, percorre as páginas ----
type Linha = { id: number; saldoTexto: string; pagina: number }
async function lerTela(page: Page, loja: (typeof LOJAS)[number]): Promise<{ linhas: Linha[]; total: number; paginas: number; erro: string | null }> {
  const lg = logins.get(loja.id)
  if (!lg) return { linhas: [], total: 0, paginas: 0, erro: `sem login dono para a loja ${loja.id}` }
  await page.goto(`${ORIGEM}/login`, { waitUntil: 'domcontentloaded', timeout: 90000 })
  await page.fill('#email', lg.email)
  await page.fill('#password', lg.senha)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/(home|resumo|central|entrar|porta)/, { timeout: 90000 })
  const linhas: Linha[] = []
  let total = 0
  let pagina = 1
  for (; ; pagina++) {
    await page.goto(`${ORIGEM}/estoque?ord=descricao&dir=asc&page=${pagina}`, { waitUntil: 'domcontentloaded', timeout: 90000 })
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {})
    await page.waitForSelector('main table tbody tr', { timeout: 30000 }).catch(() => {})
    const lido = await page.evaluate(() => {
      const t = document.querySelector('main table')
      const texto = (document.querySelector('main') as HTMLElement).innerText
      if (!t) return { linhas: [] as { id: number; saldoTexto: string }[], total: null as number | null, texto: texto.slice(0, 200) }
      const ths = [...t.querySelectorAll('thead th')].map((h) => (h as HTMLElement).innerText.trim())
      const iSaldo = ths.findIndex((h) => h.startsWith('Saldo'))
      const out: { id: number; saldoTexto: string }[] = []
      for (const tr of t.querySelectorAll('tbody tr')) {
        const a = tr.querySelector('a[href^="/estoque/produto/"]')
        const cel = tr.querySelectorAll('td')[iSaldo] as HTMLElement | undefined
        if (!a || !cel) continue
        out.push({ id: Number(a.getAttribute('href')!.split('/').pop()), saldoTexto: cel.innerText.trim().split(/\s+/)[0] })
      }
      const m = texto.match(/\d+\s*[–-]\s*\d+\s+de\s+([\d.]+)/)
      return { linhas: out, total: m ? Number(m[1].replace(/\./g, '')) : null, texto: '' }
    })
    if (pagina === 1) total = lido.total ?? lido.linhas.length
    await page.screenshot({ path: path.join(SAIDA, 'prints', `${loja.id}-estoque-p${pagina}.png`) }).catch(() => {})
    if (!lido.linhas.length && pagina === 1) return { linhas, total, paginas: 0, erro: `tela Estoque sem tabela (${lido.texto.replace(/\s+/g, ' ')})` }
    for (const l of lido.linhas) linhas.push({ ...l, pagina })
    if (pagina * POR_PAGINA >= total || !lido.linhas.length) break
  }
  return { linhas, total, paginas: pagina, erro: null }
}

// ---- Execução ----
const t0 = Date.now()
const browser = await chromium.launch()
const falhas: Falha[] = []
const resumoLojas: Record<string, unknown>[] = []
const csv: string[] = ['loja;produto_id;codigo;descricao;esperado;mostrado;omie;origem;resultado']
let paginasTotal = 0

for (const loja of LOJAS) {
  const antes = await digital(loja.id, loja.modo)
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', reducedMotion: 'reduce' })
  await ctx.route('**/*', (rota) => {
    const u = new URL(rota.request().url())
    return u.protocol === 'data:' || u.protocol === 'blob:' || u.origin === ORIGEM || u.origin === ORIGEM_API_LOCAL ? rota.continue() : rota.abort('blockedbyclient')
  })
  const page = await ctx.newPage()
  page.setDefaultTimeout(30000)
  const g = await gabarito(loja.id, loja.modo)
  const prods = await produtos(loja.id)
  const tela = await lerTela(page, loja)
  await ctx.close()
  const depois = await digital(loja.id, loja.modo)
  paginasTotal += tela.paginas

  const mostrado = new Map<number, Dec>()
  const paginaDe = new Map<number, number>()
  let duplicados = 0
  for (const l of tela.linhas) {
    if (mostrado.has(l.id)) { duplicados++; continue }
    mostrado.set(l.id, lerNumeroBR(l.saldoTexto))
    paginaDe.set(l.id, l.pagina)
  }
  const cmp = compararSaldos({ gabarito: g.itens, tela: mostrado, omie: g.omie, semGabarito: g.semGabarito })
  const rot = (p: number) => { const x = prods.get(p); return x ? `${x.codigo} ${x.descricao}` : `produto ${p}` }
  const printDe = (p: number) => `prints/${loja.id}-estoque-p${paginaDe.get(p) ?? 1}.png`

  for (const d of cmp.divergencias) {
    const inativo = prods.get(d.produto)?.inativo
    falhas.push({
      tipo: 'saldo-divergente', gravidade: 1, loja: loja.nome, cargo: 'dono', tela: '/estoque',
      passo: `conferir saldo do item ${rot(d.produto)} (id ${d.produto})${d.origem ? ` | origem da diferença: ${d.origem}${d.omie !== null ? ` (Omie informa ${fmtDec(d.omie)})` : ''}` : ''}`,
      esperado: `${fmtDec(d.esperado)} (gabarito)`,
      mostrado: d.mostrado === null ? (inativo ? 'item não aparece na tela (produto inativo, a tela Estoque oculta inativos)' : 'item não aparece na tela') : fmtDec(d.mostrado),
      print: printDe(d.produto),
    })
  }
  const divSet = new Map(cmp.divergencias.map((d) => [d.produto, d]))
  for (const p of [...new Set([...g.itens.keys(), ...mostrado.keys()])].sort((a, b) => a - b)) {
    const d = divSet.get(p)
    const nc = g.semGabarito.has(p)
    csv.push([loja.nome, p, prods.get(p)?.codigo ?? '', (prods.get(p)?.descricao ?? '').replace(/;/g, ','), fmtDec(g.itens.get(p) ?? 0n), mostrado.has(p) ? fmtDec(mostrado.get(p)!) : 'ausente', g.omie ? fmtDec(g.omie.get(p) ?? 0n) : '', d?.origem ?? '', nc ? 'nao-comparavel' : d ? 'diferente' : 'igual'].join(';'))
  }
  const porOrigem = (o: string) => cmp.divergencias.filter((d) => d.origem === o).length
  const r = {
    loja: loja.nome, modo: loja.modo, itensNaTela: mostrado.size, totalDeclaradoPelaTela: tela.total, paginasLidas: tela.paginas, linhasDuplicadas: duplicados,
    itensComSaldoNoGabarito: [...g.itens.values()].filter((x) => x !== 0n).length, itensComparados: cmp.comparados, divergencias: cmp.divergencias.length,
    ...(loja.modo === 'omie' ? { origemERP: porOrigem('ERP'), origemOmie: porOrigem('Omie'), naoComparaveisSemKardex: cmp.naoComparaveis.length, fotoOmie: g.foto } : {}),
    bancoMudouDuranteALeitura: antes !== depois, erroDeLeitura: tela.erro,
  }
  resumoLojas.push(r)
  console.log(JSON.stringify(r))
}
await browser.close()
await db.end()

const ordenadas = ordenarFalhas(falhas)
const md = formatarListaFalhas(ordenadas, { visitas: paginasTotal, telas: 1, logins: LOJAS.length })
fs.writeFileSync(path.join(SAIDA, 'falhas.md'), md)
fs.writeFileSync(path.join(SAIDA, 'itens.csv'), csv.join('\n') + '\n')
const resumo = { rodada: ID_RODADA, urlBase: ORIGEM, lojas: resumoLojas, falhas: ordenadas.length, g1: ordenadas.length, sha256FalhasMd: crypto.createHash('sha256').update(md).digest('hex'), segundos: Math.round((Date.now() - t0) / 1000) }
fs.writeFileSync(path.join(SAIDA, 'resumo.json'), JSON.stringify(resumo, null, 1))
const incompleto = resumoLojas.some((l) => l.erroDeLeitura || l.bancoMudouDuranteALeitura || l.itensNaTela !== l.totalDeclaradoPelaTela)
console.log(`falhas: ${ordenadas.length} | saída: ${SAIDA}${incompleto ? ' | ATENÇÃO: leitura incompleta ou banco mudou' : ''}`)
process.exit(incompleto ? 1 : 0)
