// Robô da Norte Cozinha oficial (ticket 11): a área /cozinha dentro do ERP. SÓ LÊ (nenhum clique em botão que grava).
// Entra como dono em cada loja (4 Sertão, 15 ODARA, 19 laboratório), passa por TODAS as telas da área (início, insumos,
// preparações, pratos e cada ficha, guia, cardápios, estoque, eventos, Pacioli, configurações, mais os PDFs) e confere o custo do
// prato, o CMV, o preço para a meta, o CMV do prato típico, o valor em estoque e o custo do evento contra um gabarito independente
// (e2e/robo/cozinha-gabarito.ts: ficha x custo médio dos insumos, só função pura; o banco é lido em sessão read-only e a conta é
// refeita aqui, sem função, view nem RPC do ERP). Registra erro de console, tela quebrada, valor inválido e 404/500.
// Depois de rodar prova, por foto antes/depois do banco, que a cópia ficou como estava (o robô não grava).
// Uso: npm run robo:cozinha   (saída em .local-data/robo-cozinha/<rodada>/, fora do git)
// Variáveis: ROBO_LOJAS=15,19 (filtra), ROBO_INSUMOS_DETALHE=25 (quantas fichas de insumo abrir por loja; 0 = nenhuma).
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import pg from 'pg'
import { chromium, type Page, type BrowserContext } from 'playwright'
import { verificarTravaLocal } from './trava.ts'
import { PORTA_PG_LOCAL, ORIGEM_API_LOCAL } from './base.ts'
import { coletar } from './coletor.ts'
import { formatarListaFalhas, ordenarFalhas, ehPaginaNaoEncontrada, valoresInvalidos, gravidadeDoTipo, type Falha, type TipoFalha } from './relatorio.ts'
import {
  custoDoPrato, cmvDoPrato, precoSugeridoSalao, precoSugeridoDelivery, sobraSalao, situacaoDoPrato, medianaCmv, custoSuspeitoGab,
  custoPorPessoaEvento, valorEmEstoqueGab, cabeNaEscala, decGab, textoGab, precoReal, type FichaGab, type SituacaoGab,
} from './cozinha-gabarito.ts'

const RAIZ = path.resolve(import.meta.dirname, '..', '..')
const sair = (msg: string): never => { console.error(`ROBÔ RECUSOU RODAR: ${msg}`); process.exit(2) }

// ---- Trava ----
const trava = await verificarTravaLocal(RAIZ)
if (!trava.ok) sair(trava.motivo)
const ORIGEM = trava.origem
const envLocal = path.join(RAIZ, '.env.local')
const envTexto = trava.envTexto
const ORIGEM_API = ORIGEM_API_LOCAL
const senhaPg = fs.readFileSync(path.join(RAIZ, '.local-data', 'env'), 'utf8').match(/^POSTGRES_PASSWORD=(.*)$/m)?.[1]?.trim()
if (!senhaPg) sair('POSTGRES_PASSWORD ausente em .local-data/env')

const logins = new Map<number, { email: string; senha: string }>()
for (const l of fs.readFileSync(path.join(RAIZ, '.local-data', 'logins.txt'), 'utf8').split('\n')) {
  const x = l.match(/^(\S+@ntb-teste\.local)\s+(\S+)\s+loja=(\d+)\s+cargo=dono/)
  if (x) logins.set(Number(x[3]), { email: x[1], senha: x[2] })
}
const NOMES: Record<number, string> = { 4: 'Sertão', 15: 'ODARA', 19: 'Loja 19' }
const lojasRodar = (process.env.ROBO_LOJAS ?? '4,15,19').split(',').map((s) => Number(s.trim())).filter((n) => logins.has(n))
const MAX_INSUMOS = Number(process.env.ROBO_INSUMOS_DETALHE ?? 25)

const ID_RODADA = process.env.ROBO_RODADA ?? new Date().toISOString().replace(/[:.]/g, '-')
const SAIDA = path.join(RAIZ, '.local-data', 'robo-cozinha', ID_RODADA)
fs.mkdirSync(path.join(SAIDA, 'prints'), { recursive: true })

const db = new pg.Client({ host: '127.0.0.1', port: PORTA_PG_LOCAL, user: 'postgres', password: senhaPg, database: 'postgres', options: '-c default_transaction_read_only=on' })
await db.connect()
const q = async <T = Record<string, string>>(sql: string, args: unknown[] = []) => (await db.query({ text: sql, values: args })).rows as T[]

// ---- Foto do banco (prova de que o robô não gravou) ----
const TABELAS_FOTO = ['custo_cardapio_config', 'custo_cardapios', 'custo_cardapio_itens', 'custo_eventos', 'custo_evento_itens', 'custo_receita_info', 'fichas_tecnicas', 'ficha_tecnica_itens',
  'produtos', 'estoque_movimentos', 'estoque_saldos', 'estoque_custos', 'estrutura_produto_cache', 'posicao_estoques', 'notas_fiscais', 'integration_attempts', 'movimentos']
async function foto(): Promise<Record<string, string>> {
  const f: Record<string, string> = {}
  for (const t of TABELAS_FOTO) {
    if (!(await q('select to_regclass($1)::text r', [`public.${t}`]))[0].r) continue
    f[t] = (await q(`select count(*)::text c from public.${t}`))[0].c
  }
  f.custo_hash = (await q("select md5(coalesce((select string_agg(t::text, ',' order by t::text) from public.custo_eventos t),'') || coalesce((select string_agg(t::text, ',' order by t::text) from public.custo_evento_itens t),'') || coalesce((select string_agg(t::text, ',' order by t::text) from public.custo_receita_info t),'')) c"))[0].c
  f.estoque_hash = (await q("select md5(coalesce(string_agg(concat_ws('|',loja_id,codigo_local_estoque,codigo_produto,saldo), ',' order by loja_id,codigo_local_estoque,codigo_produto),'')) c from public.estoque_saldos"))[0].c
  f.custos_hash = (await q("select md5(coalesce(string_agg(concat_ws('|',loja_id,codigo_produto,cmc,ultimo_custo), ',' order by loja_id,codigo_produto),'')) c from public.estoque_custos"))[0].c
  return f
}

// ---- Falhas e conferências ----
const falhas: Falha[] = []
const evid: string[] = []
const achados: string[] = []
let conferencias = 0
let lojaAtual = ''
const falha = (tipo: TipoFalha, tela: string, passo: string, esperado: string, mostrado: string, print = '') =>
  falhas.push({ tipo, gravidade: gravidadeDoTipo(tipo), loja: lojaAtual, cargo: 'dono', tela, passo, esperado, mostrado, print })
function conferir(tela: string, passo: string, esperado: string, mostrado: string, print = '', tipo: TipoFalha = 'conta-divergente') {
  conferencias++
  if (esperado !== mostrado) falha(tipo, tela, passo, esperado, mostrado, print)
}
/** Confere um número da tela contra o exato do gabarito, na precisão que a tela mostra. */
function conferirNum(tela: string, passo: string, exato: string, tela_: bigint | null, divisor: bigint, mostradoTxt: string, fmt: (e: string) => string, print = '') {
  conferencias++
  if (tela_ == null) return falha('conta-divergente', tela, passo, fmt(exato), `não achei o valor na tela (${mostradoTxt})`, print)
  if (!cabeNaEscala(exato, tela_, divisor)) falha('conta-divergente', tela, passo, fmt(exato), mostradoTxt, print)
}
const brlFmt = (e: string) => { const cent = (decGab(e) + 5_000_000n) / 10_000_000n; return `R$ ${(cent / 100n).toLocaleString('pt-BR')},${String(cent % 100n).padStart(2, '0')} (exato ${e})` }
const pctFmt = (e: string) => `${(Number(e) * 100).toFixed(1).replace('.', ',')}% (exato ${e})`
const SP = /[  \s]+/g
const centDe = (t: string): bigint | null => { const m = t.replace(SP, ' ').match(/(-)?\s*R\$\s*(-)?\s*([\d.]+),(\d{2})(?!\d)/); return m ? BigInt((m[1] || m[2] ? '-' : '') + m[3].replace(/\./g, '') + m[4]) : null }
/** "R$ 0,0174/g" -> { tela: 174, divisor: 10000 } (as casas que a tela mostra). */
const numCasas = (t: string): { n: bigint; div: bigint } | null => {
  const m = t.replace(SP, ' ').match(/R\$\s*([\d.]+),(\d+)/)
  return m ? { n: BigInt(m[1].replace(/\./g, '') + m[2]), div: 10n ** BigInt(m[2].length) } : null
}
const pctDe = (t: string): bigint | null => { const m = t.replace(SP, ' ').match(/(-?[\d.]+),(\d)%/); return m ? BigInt(m[1].replace(/\./g, '') + m[2]) : null }
const inteiroDe = (t: string) => { const m = t.replace(SP, ' ').match(/(-?\d[\d.]*)/); return m ? Number(m[1].replace(/\./g, '')) : null }
/** Primeira linha não vazia depois de uma linha que é exatamente o rótulo. */
const depoisDe = (texto: string, rotulo: string, pulo = 1): string | null => {
  const ls = texto.split('\n').map((s) => s.trim()).filter(Boolean)
  const i = ls.findIndex((l) => l === rotulo)
  return i >= 0 ? ls[i + pulo] ?? null : null
}
const norm = (s: string) => s.replace(/\s+/g, ' ').replace(/[0-9a-f]{8}-[0-9a-f-]{27}/gi, '<uuid>').replace(/[?&][^\s"']*/g, '').slice(0, 220)
const slug = (r: string) => r.replace(/^\//, '').replace(/[^a-z0-9]+/gi, '-').slice(0, 80) || 'raiz'

// ---- Dados da loja lidos do banco (só leitura) ----
type Prod = { cod: string; texto: string; descricao: string; unidade: string | null; tipo: string | null; preco: string | null; inativo: boolean; familia: string | null }
type DadosLoja = {
  modo: string
  prods: Map<string, Prod>
  fichas: Record<string, FichaGab>
  cmc: Record<string, string>
  unidade: Record<string, string | null>
  saldo: Map<string, { saldo: string; minimo: string }>
  taxas: { meta: string; imposto: string; cartao: string; app: string; embalagem: string }
}
const limparTexto = (t: string) => t.replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')

async function carregarLoja(loja: number): Promise<DadosLoja> {
  const modo = (await q('select modo_estoque m from lojas where id=$1', [loja]))[0].m
  const prods = new Map<string, Prod>()
  for (const r of await q('select codigo_produto c, codigo t, descricao d, unidade u, tipo_item ti, valor_unitario p, inativo i, descricao_familia f from produtos where loja_id=$1', [loja]))
    prods.set(r.c, { cod: r.c, texto: r.t ?? r.c, descricao: limparTexto(r.d ?? ''), unidade: r.u, tipo: r.ti, preco: r.p != null && decGab(r.p) > 0n ? r.p : null, inativo: !!r.i, familia: r.f ? limparTexto(r.f).trim() || null : null })
  const fichas: Record<string, FichaGab> = {}
  const cmc: Record<string, string> = {}
  const unidade: Record<string, string | null> = {}
  const saldo = new Map<string, { saldo: string; minimo: string }>()
  const somar = (a: string, b: string) => textoGab(decGab(a) + decGab(b))
  if (modo === 'proprio') {
    const fs_ = await q('select id, codigo_produto c, rendimento r from fichas_tecnicas where loja_id=$1 and ativa', [loja])
    const porId = new Map<string, string>()
    for (const f of fs_) { fichas[f.c] = { rendimento: f.r, itens: [] }; porId.set(f.id, f.c) }
    for (const i of await q('select i.ficha_id f, i.codigo_insumo c, i.quantidade_liquida l, i.fator_correcao fc, i.perda_pct p from ficha_tecnica_itens i join fichas_tecnicas t on t.id=i.ficha_id where t.loja_id=$1 and t.ativa order by i.ficha_id, i.ordem', [loja]))
      fichas[porId.get(i.f)!].itens.push({ insumo: i.c, liquida: i.l, fator: i.fc, perda: i.p })
    for (const r of await q('select codigo_produto c, cmc, ultimo_custo u from estoque_custos where loja_id=$1', [loja])) {
      if (r.cmc != null && decGab(r.cmc) > 0n) cmc[r.c] = r.cmc
      else if (r.u != null && decGab(r.u) > 0n) cmc[r.c] = r.u
    }
    for (const r of await q('select codigo_produto c, saldo s, minimo m from estoque_saldos where loja_id=$1', [loja])) {
      const a = saldo.get(r.c) ?? { saldo: '0', minimo: '0' }
      saldo.set(r.c, { saldo: somar(a.saldo, r.s ?? '0'), minimo: somar(a.minimo, r.m ?? '0') })
    }
  } else {
    for (const r of await q('select codigo_produto c, codigo_produto_insumo i, quantidade q, percentual_perda p, unidade u from estrutura_produto_cache where loja_id=$1 order by id', [loja])) {
      fichas[r.c] ??= { rendimento: '1', itens: [] }
      fichas[r.c].itens.push({ insumo: r.i, liquida: r.q, fator: '1', perda: r.p ?? '0' })
      if (r.u) unidade[r.i] = r.u.toUpperCase()
    }
    const ft = (await q('select max(data_posicao)::text d from posicao_estoques where loja_id=$1', [loja]))[0].d
    if (ft) {
      const acc = new Map<string, { cons: string | null; valor: bigint; saldo: bigint; maior: bigint }>()
      for (const r of await q('select n_cod_prod c, coalesce(codigo_local_estoque,0) l, n_cmc m, n_saldo s from posicao_estoques where loja_id=$1 and data_posicao=$2 and n_cmc>0', [loja, ft])) {
        const a = acc.get(r.c) ?? { cons: null, valor: 0n, saldo: 0n, maior: 0n }
        const m = decGab(r.m); const s = decGab(r.s ?? '0')
        if (r.l === '0') a.cons = r.m
        if (s > 0n) { a.valor += m * s / 10n ** 9n; a.saldo += s }
        if (m > a.maior) a.maior = m
        acc.set(r.c, a)
      }
      for (const [c, a] of acc) cmc[c] = a.cons ?? (a.saldo > 0n ? textoGab(a.valor * 10n ** 9n / a.saldo) : textoGab(a.maior))
    }
    const fs2 = (await q('select max(data_posicao)::text d from posicao_estoques where loja_id=$1 and codigo_local_estoque<>0', [loja]))[0].d
    if (fs2) for (const r of await q('select n_cod_prod c, codigo_local_estoque l, n_saldo s, estoque_minimo m from posicao_estoques where loja_id=$1 and data_posicao=$2', [loja, fs2])) {
      const a = saldo.get(r.c) ?? { saldo: '0', minimo: '0' }
      if (!r.l || r.l === '0') saldo.set(r.c, { saldo: a.saldo, minimo: decGab(r.m ?? '0') > decGab(a.minimo) ? r.m : a.minimo })
      else saldo.set(r.c, { saldo: somar(a.saldo, r.s ?? '0'), minimo: a.minimo })
    }
  }
  for (const [c, p] of prods) if (unidade[c] == null) unidade[c] = p.unidade ? p.unidade.toUpperCase() : null
  const cfg = (await q('select meta_cmv m, imposto_pct i, taxa_cartao_pct c, taxa_delivery_pct a, embalagem e from custo_cardapio_config where loja_id=$1', [loja]))[0]
  const taxas = cfg ? { meta: cfg.m, imposto: cfg.i, cartao: cfg.c, app: cfg.a, embalagem: cfg.e } : { meta: '0.30', imposto: '0.06', cartao: '0.03', app: '0.23', embalagem: '2' }
  return { modo, prods, fichas, cmc, unidade, saldo, taxas }
}

type PratoGab = { cod: string; p: Prod; tipo: 'prato' | 'preparacao'; custo: string; semCusto: number; ciclo: boolean; suspeitos: number; folhas: string[]; cmv: string | null; sit: SituacaoGab }
function pratosDoGabarito(d: DadosLoja): PratoGab[] {
  const out: PratoGab[] = []
  for (const cod of Object.keys(d.fichas)) {
    const p = d.prods.get(cod)
    if (p?.inativo) continue
    const r = custoDoPrato(cod, d.fichas, d.cmc, d.unidade)
    const pr = p ?? { cod, texto: cod, descricao: `Produto ${cod}`, unidade: null, tipo: null, preco: null, inativo: false, familia: null }
    const preco = precoReal(pr.preco) ? pr.preco : null
    out.push({ cod, p: pr, tipo: pr.tipo === '03' ? 'preparacao' : 'prato', ...r, cmv: cmvDoPrato(r.custo, preco), sit: situacaoDoPrato(r.custo, preco, r.semCusto, r.suspeitos, d.taxas.meta) })
  }
  return out
}

// ---- Navegador ----
const externos = new Set<string>()
async function novoContexto(browser: Awaited<ReturnType<typeof chromium.launch>>): Promise<BrowserContext> {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', reducedMotion: 'reduce' })
  await ctx.route('**/*', (rota) => {
    const u = new URL(rota.request().url())
    if (u.protocol === 'data:' || u.protocol === 'blob:' || u.origin === ORIGEM || u.origin === ORIGEM_API) return rota.continue()
    externos.add(u.origin)
    return rota.abort('blockedbyclient')
  })
  return ctx
}

type Pagina = { status: number; texto: string; caminho: string; erroAbrir: boolean; linhas: string[][]; links: string[]; png: string }
const visitadas: { tela: string; resultado: string }[] = []
const fotosSemStorage = new Set<string>()
async function abrir(page: Page, rota: string, buf: { console: string[]; http: string[]; falhaReq: string[]; pageerror: string[] }, opts: { rotuloLoja: string; esperarTabela?: boolean } = { rotuloLoja: '' }): Promise<Pagina> {
  buf.console.length = buf.http.length = buf.falhaReq.length = buf.pageerror.length = 0
  const png = `prints/${opts.rotuloLoja}-${slug(rota)}.png`
  const passo = `abrir ${rota}`
  let status = 0
  let erroAbrir = false
  try {
    const r = await page.goto(`${ORIGEM}${rota}`, { waitUntil: 'domcontentloaded', timeout: 90000 })
    status = r?.status() ?? 0
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
    await page.waitForTimeout(500)
  } catch (e) {
    erroAbrir = true
    falha('timeout', rota, passo, 'a tela abre', norm(String((e as Error).message).split('\n')[0]), png)
    await page.screenshot({ path: path.join(SAIDA, png) }).catch(() => {})
    visitadas.push({ tela: `${lojaAtual} ${rota}`, resultado: 'timeout' })
    return { status, texto: '', caminho: rota, erroAbrir, linhas: [], links: [], png }
  }
  const info = await page.evaluate(coletar)
  const caminho = new URL(page.url()).pathname + new URL(page.url()).search
  const marca = falhas.length
  const naoEncontrada = status < 400 && ehPaginaNaoEncontrada(info.texto)
  if (status >= 400) falha('erro-http-pagina', rota, passo, 'a tela abre', `HTTP ${status}`, png)
  if (naoEncontrada) falha('tela-quebrada', rota, passo, 'a tela abre', 'página não encontrada (404 na tela)', png)
  if (info.overlay) falha('tela-quebrada', rota, passo, 'tela sem erro de execução', norm(info.overlay), png)
  if (status < 400 && info.texto.trim().length < 3) falha('tela-vazia', rota, passo, 'conteúdo na área principal', 'área principal em branco', png)
  for (const t of [...new Set(buf.pageerror)].sort()) falha('erro-console', rota, passo, 'nenhum erro de JavaScript', `erro de página: ${t}`, png)
  for (const t of [...new Set(buf.console)].sort()) {
    if (/cozinha-fotos: falha ao assinar URLs/.test(t)) { fotosSemStorage.add(rota.split('?')[0].split('/').slice(0, 3).join('/')); continue } // a cópia local não tem o serviço de arquivos (storage)
    falha('erro-console', rota, passo, 'console sem erros', t, png)
  }
  for (const t of [...new Set(buf.http)].sort()) if (!(status >= 400 && t.includes(`GET ${rota.split('?')[0]} ->`))) falha('erro-http-requisicao', rota, passo, 'requisições sem erro HTTP', t, png)
  for (const t of [...new Set(buf.falhaReq)].sort()) falha('erro-http-requisicao', rota, passo, 'requisições sem falha de rede', t, png)
  if (status < 400) {
    const inval = valoresInvalidos(info.texto)
    if (inval.length) falha('valor-invalido', rota, passo, 'valores e contas sem NaN/undefined/Infinity', `texto na tela: ${inval.join(', ')}`, png)
    if (info.estouro) falha('estouro-horizontal', rota, passo, 'página sem rolagem horizontal em 1366x768', 'conteúdo mais largo que a janela', png)
    for (const c of info.cortados) falha('texto-cortado', rota, passo, 'texto inteiro visível (ou com reticências)', c, png)
    if (info.totalCortados > info.cortados.length) falha('texto-cortado', rota, passo, 'texto inteiro visível (ou com reticências)', `mais ${info.totalCortados - info.cortados.length} trechos cortados nesta tela`, png)
  }
  if (falhas.length > marca) await page.screenshot({ path: path.join(SAIDA, png) }).catch(() => {})
  visitadas.push({ tela: `${lojaAtual} ${rota}`, resultado: status >= 400 ? `http ${status}` : naoEncontrada ? '404 na tela' : 'abriu' })
  const linhas = await page.$$eval('tbody tr', (trs) => trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => (td as HTMLElement).innerText)))
  const links = await page.$$eval('a[href^="/cozinha"]', (as) => [...new Set(as.map((a) => a.getAttribute('href') || ''))])
  return { status, texto: info.texto, caminho, erroAbrir, linhas, links, png }
}

const fmtBRnum = (n: number) => n.toLocaleString('pt-BR')

async function rodarLoja(browser: Awaited<ReturnType<typeof chromium.launch>>, loja: number) {
  lojaAtual = NOMES[loja] ?? `Loja ${loja}`
  const lg = logins.get(loja)!
  const d = await carregarLoja(loja)
  const pratos = pratosDoGabarito(d)
  const soPratos = pratos.filter((x) => x.tipo === 'prato')
  const preps = pratos.filter((x) => x.tipo === 'preparacao')
  const valid = soPratos.filter((x) => x.cmv != null && Number(x.custo) > 0 && (x.sit === 'ok' || x.sit === 'atencao' || x.sit === 'acima'))
  const cmvTipico = medianaCmv(valid.map((x) => x.cmv as string))
  const nAcima = soPratos.filter((x) => x.sit === 'acima').length
  const nAtencao = soPratos.filter((x) => x.sit === 'atencao').length
  const nSemPreco = soPratos.filter((x) => x.sit === 'sem_preco').length
  const nSemCustoP = soPratos.filter((x) => x.semCusto > 0).length
  const nSuspP = soPratos.filter((x) => x.suspeitos > 0).length
  evid.push(`## ${lojaAtual} (loja ${loja}, modo ${d.modo})`, '', `- Gabarito lido do banco: ${soPratos.length} pratos e ${preps.length} preparações com ficha ativa; ${Object.keys(d.cmc).length} insumos/produtos com custo; meta de CMV ${d.taxas.meta}.`)
  if (!pratos.length) achados.push(`${lojaAtual}: a cópia não tem ficha técnica nesta loja (${d.modo === 'omie' ? 'estrutura_produto_cache vazia para esta loja' : 'fichas_tecnicas sem ficha ativa'}); as telas de custo caem no aviso "nenhum prato com ficha técnica".`)

  const ctx = await novoContexto(browser)
  const page = await ctx.newPage()
  page.setDefaultTimeout(30000)
  const buf = { console: [] as string[], http: [] as string[], falhaReq: [] as string[], pageerror: [] as string[] }
  page.on('console', (m) => { if (m.type() !== 'error') return; const t = m.text(); if (/^Failed to load resource|blockedbyclient|ERR_BLOCKED_BY_CLIENT/.test(t)) return; buf.console.push(norm(t)) })
  page.on('pageerror', (e) => buf.pageerror.push(norm(`${e.name}: ${e.message}`)))
  page.on('response', (r) => { const u = new URL(r.url()); if (r.status() >= 400 && (u.origin === ORIGEM || u.origin === ORIGEM_API)) buf.http.push(`${r.request().method()} ${u.pathname} -> ${r.status()}`) })
  page.on('requestfailed', (qq) => { const e = qq.failure()?.errorText ?? ''; if (/ERR_ABORTED|blockedbyclient|BLOCKED_BY_CLIENT/.test(e)) return; buf.falhaReq.push(`${qq.method()} ${new URL(qq.url()).pathname} ${e}`) })
  const rot = String(loja)

  try {
    await page.goto(`${ORIGEM}/login`, { waitUntil: 'domcontentloaded', timeout: 90000 })
    await page.fill('#email', lg.email)
    await page.fill('#password', lg.senha)
    await page.click('button[type=submit]')
    await page.waitForURL(/\/(home|resumo|central|entrar|porta)/, { timeout: 90000 })
    await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
  } catch (e) {
    falha('tela-quebrada', '/login', `entrar como dono em ${lojaAtual}`, 'entrar e cair na tela inicial', norm(String((e as Error).message).split('\n')[0]))
    await ctx.close()
    return
  }
  // Falha de rede do próprio `next dev` (aba abortada, resposta cortada) é repetida uma vez antes de virar falha.
  const A = async (r: string) => {
    const marca = falhas.length
    const marcaVis = visitadas.length
    const p1 = await abrir(page, r, buf, { rotuloLoja: rot })
    const novas = falhas.slice(marca)
    if (novas.length && novas.every((f) => /net::ERR_(ABORTED|INCOMPLETE_CHUNKED_ENCODING|CONNECTION)/.test(f.mostrado))) {
      falhas.length = marca
      visitadas.length = marcaVis
      return abrir(page, r, buf, { rotuloLoja: rot })
    }
    return p1
  }

  // ---- Início ----
  const ini = await A('/cozinha')
  if (ini.status < 400 && pratos.length) {
    const t = ini.texto
    const cm = pctDe(depoisDe(t, 'CMV do prato típico') ?? '')
    if (cmvTipico) conferirNum('/cozinha', 'CMV do prato típico (mediana)', cmvTipico, cm, 1000n, depoisDe(t, 'CMV do prato típico') ?? '(sem)', pctFmt, ini.png)
    else conferir('/cozinha', 'CMV do prato típico sem pratos válidos', 'Ainda não dá para calcular o CMV', /Ainda não dá para calcular o CMV/.test(t) ? 'Ainda não dá para calcular o CMV' : 'mostra um número', ini.png)
    const ls = t.split('\n').map((s) => s.trim()).filter(Boolean)
    const fato = (re: RegExp) => { const i = ls.findIndex((l) => re.test(l)); return i > 0 ? inteiroDe(ls[i - 1]) : null }
    conferir('/cozinha', 'pratos acima da meta', String(nAcima), String(fato(/^pratos? acima da meta$/)), ini.png)
    conferir('/cozinha', 'dados para arrumar: insumos sem custo + pratos sem preço/custo/suspeitos', String(nSuspP + nSemCustoP + nSemPreco + gabInsumos(d, pratos).filter((i) => !i.custo).length), String(fato(/^dados para arrumar$/)), ini.png)
    const ve = centDe(depoisDe(t, 'Valor em estoque') ?? '')
    conferirNum('/cozinha', 'Valor em estoque (insumos das fichas)', valorEstoqueGab(d, pratos), ve, 100n, depoisDe(t, 'Valor em estoque') ?? '(sem)', brlFmt, ini.png)
  }

  // ---- Pratos: cartões + cada linha ----
  const lp = await A('/cozinha/pratos')
  if (lp.status < 400 && pratos.length) {
    const t = lp.texto
    if (cmvTipico) conferirNum('/cozinha/pratos', 'cartão CMV do prato típico', cmvTipico, pctDe(depoisDe(t, 'CMV do prato típico') ?? ''), 1000n, depoisDe(t, 'CMV do prato típico') ?? '(sem)', pctFmt, lp.png)
    conferir('/cozinha/pratos', 'cartão Acima da meta', String(nAcima), String(inteiroDe(depoisDe(t, 'Acima da meta') ?? '')), lp.png)
    conferir('/cozinha/pratos', 'cartão "perto do limite"', String(nAtencao), String(inteiroDe((t.match(/mais\s+(\d+)\s+perto do limite/) ?? [])[1] ?? '')), lp.png)
    conferir('/cozinha/pratos', 'cartão Custo a conferir', String(nSuspP), String(inteiroDe(depoisDe(t, 'Custo a conferir') ?? '')), lp.png)
    conferir('/cozinha/pratos', 'cartão Sem preço ou custo', String(nSemPreco + nSemCustoP), String(inteiroDe(depoisDe(t, 'Sem preço ou custo') ?? '')), lp.png)
    conferir('/cozinha/pratos', 'linhas da tabela (um por prato com ficha)', String(soPratos.length), String(lp.linhas.length), lp.png)
    const porTexto = new Map(soPratos.map((x) => [x.p.texto, x]))
    for (const l of lp.linhas) {
      const [c0, c1, c2, c3, c4, c5] = l
      const ls0 = (c0 ?? '').split('\n').map((s) => s.trim()).filter(Boolean)
      const cod = (ls0[1] ?? '').split(' · ')[0]
      const g = porTexto.get(cod)
      const nome = `${cod} ${ls0[0] ?? ''}`
      if (!g) { conferir('/cozinha/pratos', `linha ${nome} existe no gabarito`, 'prato com ficha ativa', 'linha sem ficha no gabarito', lp.png); continue }
      conferir('/cozinha/pratos', `nome de ${cod}`, g.p.descricao, ls0[0] ?? '', lp.png)
      conferirNum('/cozinha/pratos', `custo de ${nome}`, g.custo, centDe(c1 ?? ''), 100n, c1 ?? '', brlFmt, lp.png)
      conferir('/cozinha/pratos', `preço de ${nome}`, g.p.preco && precoReal(g.p.preco) ? brlFmt(g.p.preco).split(' (')[0] : '—', (c2 ?? '').replace(SP, ' ').trim(), lp.png)
      if (g.cmv != null && g.sit !== 'suspeito' && Number(g.custo) > 0) conferirNum('/cozinha/pratos', `CMV de ${nome}`, g.cmv, pctDe(c3 ?? ''), 1000n, (c3 ?? '').replace(/\s+/g, ' ').trim(), pctFmt, lp.png)
      if (Number(g.custo) > 0) {
        conferirNum('/cozinha/pratos', `preço p/ meta de ${nome}`, precoSugeridoSalao(g.custo, d.taxas.meta), centDe(c4 ?? ''), 100n, c4 ?? '', brlFmt, lp.png)
        conferirNum('/cozinha/pratos', `delivery p/ meta de ${nome}`, precoSugeridoDelivery(g.custo, d.taxas), centDe(c5 ?? ''), 100n, c5 ?? '', brlFmt, lp.png)
      }
    }
  } else if (lp.status < 400) {
    conferir('/cozinha/pratos', 'loja sem ficha: mostra o aviso', 'Nenhum prato com ficha técnica', /Nenhum prato com ficha técnica/.test(lp.texto) ? 'Nenhum prato com ficha técnica' : lp.texto.slice(0, 80), lp.png)
  }

  // ---- Preparações ----
  const lpp = await A('/cozinha/preparacoes')
  if (lpp.status < 400 && preps.length) {
    conferir('/cozinha/preparacoes', 'linhas da tabela', String(preps.length), String(lpp.linhas.length), lpp.png)
    conferir('/cozinha/preparacoes', 'cartão Preparações com ficha', String(preps.length), String(inteiroDe(depoisDe(lpp.texto, 'Preparações com ficha') ?? '')), lpp.png)
    const porTexto = new Map(preps.map((x) => [x.p.texto, x]))
    for (const l of lpp.linhas) {
      const ls0 = (l[0] ?? '').split('\n').map((s) => s.trim()).filter(Boolean)
      const cod = (ls0[1] ?? '').split(' · ')[0]
      const g = porTexto.get(cod)
      if (!g) { conferir('/cozinha/preparacoes', `linha ${cod} existe no gabarito`, 'preparação com ficha ativa', 'linha sem ficha no gabarito', lpp.png); continue }
      conferirNum('/cozinha/preparacoes', `custo de ${cod} ${g.p.descricao}`, g.custo, centDe(l[1] ?? ''), 100n, l[1] ?? '', brlFmt, lpp.png)
    }
  }

  // ---- Insumos ----
  const ins = gabInsumos(d, pratos)
  const li = await A('/cozinha/insumos')
  if (li.status < 400 && pratos.length) {
    conferir('/cozinha/insumos', 'cartão Insumos nas fichas', String(ins.length), String(inteiroDe(depoisDe(li.texto, 'Insumos nas fichas') ?? '')), li.png)
    conferir('/cozinha/insumos', 'cartão Sem custo', String(ins.filter((i) => !i.custo).length), String(inteiroDe(depoisDe(li.texto, 'Sem custo') ?? '')), li.png)
    conferir('/cozinha/insumos', 'cartão Custo a conferir', String(ins.filter((i) => i.suspeito).length), String(inteiroDe(depoisDe(li.texto, 'Custo a conferir') ?? '')), li.png)
    conferir('/cozinha/insumos', 'linhas da tabela', String(ins.length), String(li.linhas.length), li.png)
    const porTexto = new Map(ins.map((i) => [i.p?.texto ?? i.cod, i]))
    for (const l of li.linhas) {
      const ls0 = (l[0] ?? '').split('\n').map((s) => s.trim()).filter(Boolean)
      const cod = (ls0[1] ?? '').split(' · ')[0]
      const g = porTexto.get(cod)
      if (!g) { conferir('/cozinha/insumos', `linha ${cod} existe no gabarito`, 'insumo de alguma ficha', 'linha sem uso no gabarito', li.png); continue }
      if (g.custo) {
        const nc = numCasas(l[1] ?? '')
        conferirNum('/cozinha/insumos', `custo médio de ${cod} ${g.p?.descricao}`, g.custo, nc?.n ?? null, nc?.div ?? 100n, (l[1] ?? '').replace(/\s+/g, ' ').trim(), (e) => `R$ ${e}`, li.png)
      } else conferir('/cozinha/insumos', `custo de ${cod} sem custo`, 'sem custo', (l[1] ?? '').replace(/\s+/g, ' ').trim().toLowerCase().includes('sem custo') ? 'sem custo' : l[1] ?? '', li.png)
      const usado = (l[3] ?? '').replace(/\s+/g, ' ')
      const nPr = Number((usado.match(/(\d+)\s+pratos?/) ?? [])[1] ?? NaN)
      const nPp = Number((usado.match(/(\d+)\s+preparaç/) ?? [])[1] ?? 0)
      conferir('/cozinha/insumos', `usado em quantos pratos: ${cod} ${g.p?.descricao}`, String(g.pratos), String(nPr), li.png)
      conferir('/cozinha/insumos', `usado em quantas preparações: ${cod} ${g.p?.descricao}`, String(g.preps), String(nPp), li.png)
    }
  }

  // ---- Estoque ----
  const le = await A('/cozinha/estoque')
  if (le.status < 400 && pratos.length) {
    const ativos = ins.filter((i) => !i.p?.inativo)
    const sal = (i: (typeof ins)[number]) => d.saldo.get(i.cod) ?? { saldo: '0', minimo: '0' }
    conferirNum('/cozinha/estoque', 'cartão Valor em estoque', valorEstoqueGab(d, pratos), centDe(depoisDe(le.texto, 'Valor em estoque') ?? ''), 100n, depoisDe(le.texto, 'Valor em estoque') ?? '(sem)', brlFmt, le.png)
    conferir('/cozinha/estoque', 'cartão Zerados', String(ativos.filter((i) => decGab(sal(i).saldo) === 0n).length), String(inteiroDe(depoisDe(le.texto, 'Zerados') ?? '')), le.png)
    conferir('/cozinha/estoque', 'cartão Negativos', String(ativos.filter((i) => decGab(sal(i).saldo) < 0n).length), String(inteiroDe(depoisDe(le.texto, 'Negativos') ?? '')), le.png)
    conferir('/cozinha/estoque', 'cartão Abaixo do mínimo', String(ativos.filter((i) => decGab(sal(i).minimo) > 0n && (decGab(sal(i).saldo) > 0n ? decGab(sal(i).saldo) : 0n) < decGab(sal(i).minimo)).length), String(inteiroDe(depoisDe(le.texto, 'Abaixo do mínimo') ?? '')), le.png)
  }

  // ---- Telas sem número para conferir: passeio completo ----
  const fixas = ['/cozinha/guia', '/cozinha/cardapios', '/cozinha/eventos', '/cozinha/pacioli', '/cozinha/configuracoes']
  const vistos = new Set(['/cozinha', '/cozinha/pratos', '/cozinha/preparacoes', '/cozinha/insumos', '/cozinha/estoque'])
  const paginas = new Map<string, Pagina>()
  for (const r of fixas) { vistos.add(r); paginas.set(r, await A(r)) }
  // variações (filtros, ordem, abas) e fichas achadas nos links das telas
  const todosLinks = new Set<string>()
  for (const p of [ini, lp, lpp, li, le, ...paginas.values()]) for (const h of p.links) todosLinks.add(h.split('#')[0])
  const doTipo = (re: RegExp) => [...todosLinks].filter((h) => re.test(h)).sort()
  const variacoes = doTipo(/^\/cozinha\/[a-z-]+\?/).filter((h) => !/\/(pdf|ficha|foto)/.test(h))
  for (const r of variacoes) { if (vistos.has(r)) continue; vistos.add(r); await A(r) }
  const outras = doTipo(/^\/cozinha\/(guia|cardapios|eventos|estoque|configuracoes|pacioli)\/.+/).filter((h) => !/\/(pdf|ficha|foto|conversa)/.test(h) && !h.includes('?'))
  for (const r of outras) { if (vistos.has(r)) continue; vistos.add(r); await A(r) }

  // ---- Ficha de cada prato e preparação: custo, CMV, sobra, preços ----
  for (const g of pratos) {
    const r = `/cozinha/pratos/${g.cod}`
    const p = await A(r)
    if (p.status >= 400 || !p.texto) continue
    const t = p.texto
    const nome = `${g.p.texto} ${g.p.descricao}`
    conferirNum(r, `custo do prato na ficha de ${nome}`, g.custo, centDe(depoisDe(t, 'Custo do prato') ?? ''), 100n, depoisDe(t, 'Custo do prato') ?? '(sem)', brlFmt, p.png)
    if (g.tipo === 'prato' && g.p.preco && precoReal(g.p.preco) && g.sit !== 'suspeito' && g.cmv && Number(g.custo) > 0) {
      conferirNum(r, `CMV (preço no salão) na ficha de ${nome}`, g.cmv, pctDe(depoisDe(t, 'Preço no salão') ?? ''), 1000n, depoisDe(t, 'Preço no salão') ?? '(sem)', pctFmt, p.png)
      conferirNum(r, `sobra por venda na ficha de ${nome}`, sobraSalao(g.p.preco, g.custo, d.taxas), centDe(depoisDe(t, 'Sobra por venda') ?? ''), 100n, depoisDe(t, 'Sobra por venda') ?? '(sem)', brlFmt, p.png)
    }
    if (g.tipo === 'prato' && Number(g.custo) > 0) {
      const ls = t.split('\n').map((s) => s.trim()).filter(Boolean)
      const idx = ls.map((l, i) => (/^Preço para a meta/.test(l) ? i : -1)).filter((i) => i >= 0)
      if (idx.length >= 2) {
        conferirNum(r, `preço p/ meta (salão) na ficha de ${nome}`, precoSugeridoSalao(g.custo, d.taxas.meta), centDe(ls[idx[0] + 1] ?? ''), 100n, ls[idx[0] + 1] ?? '', brlFmt, p.png)
        conferirNum(r, `preço p/ meta (delivery) na ficha de ${nome}`, precoSugeridoDelivery(g.custo, d.taxas), centDe(ls[idx[1] + 1] ?? ''), 100n, ls[idx[1] + 1] ?? '', brlFmt, p.png)
      } else conferir(r, `preços para a meta na ficha de ${nome}`, 'dois "Preço para a meta" (salão e delivery)', `${idx.length} encontrado(s)`, p.png)
    }
    if (g.ciclo) conferir(r, `aviso de ciclo em ${nome}`, 'aviso de ficha em ciclo', /ciclo/.test(t) ? 'aviso de ficha em ciclo' : 'sem aviso', p.png)
  }
  // PDFs e foto: uma amostra (os 3 de maior custo) por loja
  const amostra = [...pratos].sort((a, b) => Number(b.custo) - Number(a.custo)).slice(0, 3)
  for (const g of amostra) for (const sufixo of ['ficha', 'ficha?cozinha=1', 'foto']) {
    const rota = `/cozinha/pratos/${g.cod}/${sufixo}`
    conferencias++
    const resp = await page.request.get(`${ORIGEM}${rota}`, { maxRedirects: 5, timeout: 60000 }).catch((e) => e as Error)
    if (resp instanceof Error) { falha('erro-http-requisicao', rota, 'baixar', 'resposta sem erro', norm(resp.message.split('\n')[0])); continue }
    const ct = resp.headers()['content-type'] ?? ''
    const corpo = await resp.body().catch(() => Buffer.alloc(0))
    visitadas.push({ tela: `${lojaAtual} ${rota}`, resultado: `HTTP ${resp.status()} ${ct.split(';')[0]} ${corpo.length}B` })
    if (resp.status() >= 500) falha('erro-http-requisicao', rota, 'baixar', 'resposta sem erro', `HTTP ${resp.status()}`)
    else if (sufixo.startsWith('ficha') && !(resp.status() === 200 && /pdf/.test(ct) && corpo.subarray(0, 4).toString() === '%PDF')) falha('tela-quebrada', rota, 'baixar a ficha em PDF', 'HTTP 200, application/pdf, começa com %PDF', `HTTP ${resp.status()} ${ct} ${corpo.subarray(0, 8).toString()}`)
    else if (sufixo === 'foto' && resp.status() !== 405) falha('erro-http-requisicao', rota, 'GET na rota da foto', 'HTTP 405 (a rota só aceita POST de envio de foto)', `HTTP ${resp.status()}`)
  }

  // ---- Fichas de insumo (amostra: maior uso primeiro) ----
  const insDet = [...ins].sort((a, b) => b.pratos - a.pratos).slice(0, MAX_INSUMOS)
  for (const i of insDet) {
    const r = `/cozinha/insumos/${i.cod}`
    const p = await A(r)
    if (p.status >= 400 || !p.texto) continue
    const nome = `${i.p?.texto} ${i.p?.descricao}`
    if (i.custo) { const nc = numCasas(depoisDe(p.texto, 'Custo médio') ?? ''); conferirNum(r, `custo médio na ficha do insumo ${nome}`, i.custo, nc?.n ?? null, nc?.div ?? 100n, depoisDe(p.texto, 'Custo médio') ?? '(sem)', (e) => `R$ ${e}`, p.png) }
    const usado = (depoisDe(p.texto, 'Usado em') ?? '') + ' ' + (depoisDe(p.texto, 'Usado em', 2) ?? '')
    conferir(r, `usado em quantos pratos na ficha do insumo ${nome}`, String(i.pratos), String(Number((usado.match(/(\d+)\s+pratos?/) ?? [])[1] ?? NaN)), p.png)
  }

  // ---- Eventos desta loja ----
  const evs = await q('select id, nome, convidados, preco_por_pessoa pp, coalesce(folga_pct,0) folga from custo_eventos where loja_id=$1 order by id', [loja]).catch(async () => q('select id, nome, convidados, preco_por_pessoa pp, 0 folga from custo_eventos where loja_id=$1 order by id', [loja]))
  for (const e of evs) {
    const itens = await q('select codigo_produto c, porcoes_por_convidado p from custo_evento_itens where evento_id=$1', [e.id])
    const r = `/cozinha/eventos/${e.id}`
    const p = await A(r)
    if (p.status < 400) {
      const its = itens.map((it) => { const f = d.fichas[it.c] ? custoDoPrato(it.c, d.fichas, d.cmc, d.unidade) : null; return { porcoes: it.p, custo: f?.custo ?? '0' } })
      const cpp = custoPorPessoaEvento(its, e.folga)
      const sug = precoSugeridoSalao(cpp, d.taxas.meta)
      conferirNum(r, `custo por pessoa do evento "${e.nome}"`, cpp, centDe(depoisDe(p.texto, 'Custo por pessoa') ?? ''), 100n, depoisDe(p.texto, 'Custo por pessoa') ?? '(sem)', brlFmt, p.png)
      if (Number(cpp) > 0) conferirNum(r, `preço sugerido por pessoa do evento "${e.nome}"`, sug, centDe(depoisDe(p.texto, 'Preço sugerido por pessoa (meta 30%)') ?? ''), 100n, depoisDe(p.texto, 'Preço sugerido por pessoa (meta 30%)') ?? '(sem)', brlFmt, p.png)
      const custoTotal = textoGab(decGab(cpp) * BigInt(e.convidados))
      conferirNum(r, `custo da comida do evento "${e.nome}"`, custoTotal, centDe(depoisDe(p.texto, 'Custo da comida') ?? ''), 100n, depoisDe(p.texto, 'Custo da comida') ?? '(sem)', brlFmt, p.png)
    }
    const pdf = `/cozinha/eventos/${e.id}/pdf`
    conferencias++
    const resp = await page.request.get(`${ORIGEM}${pdf}`, { timeout: 60000 }).catch((er) => er as Error)
    if (resp instanceof Error) falha('erro-http-requisicao', pdf, 'baixar', 'resposta sem erro', norm(resp.message.split('\n')[0]))
    else {
      const corpo = await resp.body().catch(() => Buffer.alloc(0))
      visitadas.push({ tela: `${lojaAtual} ${pdf}`, resultado: `HTTP ${resp.status()} ${(resp.headers()['content-type'] ?? '').split(';')[0]} ${corpo.length}B` })
      if (!(resp.status() === 200 && corpo.subarray(0, 4).toString() === '%PDF')) falha('tela-quebrada', pdf, 'baixar o PDF do evento', 'HTTP 200 com PDF', `HTTP ${resp.status()} ${corpo.subarray(0, 8).toString()}`)
    }
  }
  if (!evs.length) evid.push('- Eventos: nenhum cadastrado nesta loja na cópia (só a tela vazia foi vista).')
  const cards = await q('select id from custo_cardapios where loja_id=$1', [loja])
  if (!cards.length) evid.push('- Cardápios: nenhum cadastrado nesta loja na cópia (só a tela vazia foi vista; o CMV do cardápio não foi conferido).')

  // ---- Pacioli (modo rápido): pergunta pronta, só consulta ----
  const pac = await abrir(page, '/cozinha/pacioli', buf, { rotuloLoja: rot })
  if (pac.status < 400) {
    const btn = page.getByRole('button', { name: 'Quais pratos estão acima da meta?' })
    if (await btn.count()) {
      await btn.first().click() // pergunta pronta do assistente: só lê, não grava
      await page.waitForTimeout(3500)
      const resposta = await page.evaluate(() => ((document.querySelector('main') as HTMLElement | null)?.innerText ?? '').slice(-1500))
      evid.push(`- Pacioli (modo rápido), "Quais pratos estão acima da meta?": ${resposta.replace(/\s+/g, ' ').slice(-500)}`)
      conferencias++
      if (buf.http.length || buf.pageerror.length) falha('erro-http-requisicao', '/cozinha/pacioli', 'perguntar ao Pacioli', 'resposta sem erro', [...buf.http, ...buf.pageerror].join(' | '), pac.png)
      if (valoresInvalidos(resposta).length) falha('valor-invalido', '/cozinha/pacioli', 'perguntar ao Pacioli', 'resposta sem NaN/undefined', valoresInvalidos(resposta).join(', '), pac.png)
      const ultima = (await page.evaluate(() => ((document.querySelector('main') as HTMLElement | null)?.innerText ?? ''))).replace(/\s+/g, ' ')
      if (pratos.length) {
        // Regra única (F-12): o Pacioli diz "N pratos acima da meta" com o mesmo N do Início e da lista de Pratos (acima = mais de 5 pontos sobre a meta).
        const mAcima = /Nenhum prato acima da meta/i.test(ultima) ? '0' : (ultima.match(/(\d+)\s+pratos?\s+acima da meta/i) ?? [])[1]
        conferir('/cozinha/pacioli', 'Pacioli: pratos acima da meta (mesma regra do Início e de Pratos)', String(nAcima), String(mAcima ?? 'resposta sem número'), pac.png)
        const mFora = (ultima.match(/(\d+)\s+pratos?\s+ficaram de fora/i) ?? [])[1] ?? '0'
        conferir('/cozinha/pacioli', 'Pacioli: pratos de fora por custo não confiável', String(soPratos.filter((x) => x.semCusto > 0 || x.suspeitos > 0).length), String(mFora), pac.png)
      }
    }
  }

  evid.push(`- Telas visitadas nesta loja: ${visitadas.filter((x) => x.tela.startsWith(lojaAtual + ' ')).length}.`, '')
  await ctx.close()
}

// ---- Insumos (folhas das fichas) no gabarito ----
type InsGab = { cod: string; p: Prod | undefined; custo: string | null; suspeito: boolean; pratos: number; preps: number }
function gabInsumos(d: DadosLoja, pratos: PratoGab[]): InsGab[] {
  const usos = new Map<string, Set<string>>()
  for (const g of pratos) for (const f of g.folhas) { const s = usos.get(f) ?? new Set<string>(); s.add(g.cod); usos.set(f, s) }
  const out: InsGab[] = []
  for (const [cod, raizes] of usos) {
    const p = d.prods.get(cod)
    const custo = d.cmc[cod] ?? null
    out.push({ cod, p, custo, suspeito: custoSuspeitoGab(custo, d.unidade[cod] ?? null), pratos: [...raizes].filter((r) => d.prods.get(r)?.tipo !== '03').length, preps: [...raizes].filter((r) => d.prods.get(r)?.tipo === '03').length })
  }
  return out.filter((i) => !i.p?.inativo)
}
function valorEstoqueGab(d: DadosLoja, pratos: PratoGab[]): string {
  return valorEmEstoqueGab(gabInsumos(d, pratos).map((i) => ({ saldo: d.saldo.get(i.cod)?.saldo ?? '0', custo: i.suspeito ? null : i.custo })))
}

// ---- Execução ----
const t0 = Date.now()
const fotoAntes = await foto()
const browser = await chromium.launch()
for (const loja of lojasRodar) {
  const t = Date.now()
  const antes = falhas.length
  await rodarLoja(browser, loja)
  console.log(`${NOMES[loja] ?? loja}: ${falhas.length - antes} falhas (${Math.round((Date.now() - t) / 1000)}s)`)
}
await browser.close()
const fotoDepois = await foto()
const dif = Object.keys({ ...fotoAntes, ...fotoDepois }).filter((k) => fotoAntes[k] !== fotoDepois[k])
const copiaIntacta = dif.length === 0
fs.writeFileSync(path.join(SAIDA, 'foto-antes.json'), JSON.stringify({ fotoAntes, fotoDepois, diferencas: dif }, null, 1))
await db.end()

const ordenadas = ordenarFalhas(falhas)
const md = formatarListaFalhas(ordenadas, { visitas: visitadas.length, telas: new Set(visitadas.map((x) => x.tela.replace(/^\S+( \S+)* (?=\/)/, ''))).size, logins: lojasRodar.length })
fs.writeFileSync(path.join(SAIDA, 'falhas.md'), md)
fs.writeFileSync(path.join(SAIDA, 'visitadas.md'), ['# Telas visitadas', '', ...visitadas.map((x) => `- ${x.tela}: ${x.resultado}`), ''].join('\n'))
fs.writeFileSync(path.join(SAIDA, 'evidencias.md'), ['# Evidências do robô da Norte Cozinha', '', ...evid, '## Achados fora da lista de falhas', '', ...achados.map((a) => `- ${a}`), ...(fotosSemStorage.size ? [`- Ambiente da cópia: o console acusa "cozinha-fotos: falha ao assinar URLs ... Server Not Found" em ${[...fotosSemStorage].sort().join(', ')} (telas com foto de receita). A cópia local não sobe o serviço de arquivos (storage) do Supabase, então a foto não carrega; não é falha da área e por isso não entrou na lista de falhas.`] : []), '', `Estado da cópia depois do robô: ${copiaIntacta ? 'IGUAL ao de antes (foto de 17 tabelas e 3 impressões digitais)' : `DIFERENTE em ${dif.join(', ')}`}.`, ''].join('\n'))
const resumo = {
  rodada: ID_RODADA, urlBase: ORIGEM, lojas: lojasRodar, telasVisitadas: visitadas.length, conferencias, falhas: ordenadas.length,
  g1: ordenadas.filter((f) => f.gravidade === 1).length, g2: ordenadas.filter((f) => f.gravidade === 2).length, g3: ordenadas.filter((f) => f.gravidade === 3).length,
  copiaIntacta, diferencasNoBanco: dif, externosBloqueados: [...externos], sha256FalhasMd: crypto.createHash('sha256').update(md).digest('hex'), segundos: Math.round((Date.now() - t0) / 1000),
}
fs.writeFileSync(path.join(SAIDA, 'resumo.json'), JSON.stringify(resumo, null, 1))
console.log(JSON.stringify(resumo))
void fmtBRnum
process.exit(0)
