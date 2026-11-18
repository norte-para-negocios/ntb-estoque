// Robô do financeiro (ticket 09): refaz do zero, direto no banco local (só leitura) os títulos a pagar e a receber, as baixas e
// os saldos de conta das lojas 4 (Sertão), 15 (ODARA) e 19, e compara com as telas do financeiro como o dono vê.
// Nunca clica em botão, nunca escreve no banco, nunca chama o Omie. Recusa rodar fora de http://127.0.0.1:3107.
// Uso: npm run robo:financeiro   (saída em .local-data/robo-financeiro/<rodada>/, fora do git)
import fs from 'node:fs'
import path from 'node:path'
import { chromium, type Page } from 'playwright'
import { validarUrlBase, validarAmbienteLocal, PORTA_API_LOCAL, PORTA_ERP_LOCAL } from './trava-url.ts'
import { formatarListaFalhas, gravidadeDoTipo, ordenarFalhas, ehPaginaNaoEncontrada, type Falha, type TipoFalha } from './relatorio.ts'
import { criarLeitor } from './financeiro/banco.ts'
import {
  cent, hojeBahia, titulosPagarEsperados, calcularTitulosPagar, totaisPagar, conferirTitulosDasNotas, titulosReceberEsperados, conferirReceber,
  totaisReceber, saldosDasContas, conferirStatusOmie, brl, type CompraDoc, type Divergencia, type MovimentoDoc,
} from './financeiro/gabarito-puro.ts'
import { lerCartoesPagar, lerCartoesReceber, lerContas } from './financeiro/tela-puro.ts'

const RAIZ = path.resolve(import.meta.dirname, '..', '..')
const LOJAS = [{ id: 4, nome: 'Sertão' }, { id: 15, nome: 'ODARA' }, { id: 19, nome: 'Loja 19' }]
// Instante mais cedo em que o gatilho da nota existia com a chave da loja 19 ligada: commit 8844f481 (05/11/2026 19:49 -03:00).
const CHAVE_LIGADA_DESDE: Record<number, string> = { 19: '2026-11-05T22:49:00Z' }

const sair = (m: string): never => { console.error(`ROBÔ RECUSOU RODAR: ${m}`); process.exit(2) }
const v = validarUrlBase(process.env.ROBO_URL_BASE ?? `http://127.0.0.1:${PORTA_ERP_LOCAL}`)
if (!v.ok) sair(v.motivo)
const ORIGEM = (v as { origem: string }).origem
const envLocal = path.join(RAIZ, '.env.local')
if (!fs.existsSync(envLocal)) sair('.env.local da cópia local não existe')
const va = validarAmbienteLocal(fs.readFileSync(envLocal, 'utf8'))
if (!va.ok) sair(va.motivo)
const ORIGEM_API = `http://127.0.0.1:${PORTA_API_LOCAL}`

const ID = process.env.ROBO_RODADA ?? new Date().toISOString().replace(/[:.]/g, '-')
const SAIDA = path.join(RAIZ, '.local-data', 'robo-financeiro', ID)
fs.mkdirSync(path.join(SAIDA, 'prints'), { recursive: true })

const consultar = criarLeitor(RAIZ)
const hoje = hojeBahia()
const falhas: Falha[] = []
const comparados: Record<string, Record<string, number>> = {}
const conta = (loja: string, k: string, n = 1) => { comparados[loja] ??= {}; comparados[loja][k] = (comparados[loja][k] ?? 0) + n }
const notas: string[] = []

type Login = { email: string; senha: string; loja: number }
const logins: Login[] = []
for (const l of fs.readFileSync(path.join(RAIZ, '.local-data', 'logins.txt'), 'utf8').split('\n')) {
  const m = l.match(/^(dono\.\S+@ntb-teste\.local)\s+(\S+)\s+loja=(\d+)\s+cargo=dono/)
  if (m) logins.push({ email: m[1], senha: m[2], loja: Number(m[3]) })
}

function falha(loja: string, tela: string, passo: string, esperado: string, mostrado: string, print: string, tipo: TipoFalha = 'conta-divergente') {
  falhas.push({ tipo, gravidade: gravidadeDoTipo(tipo), loja, cargo: 'dono', tela, passo, esperado, mostrado, print })
}
const divergencias = (loja: string, tela: string, passo: string, ds: Divergencia[], print: string) => {
  for (const d of ds) falha(loja, tela, `${passo}: ${d.chave}`, d.esperado, d.mostrado, print)
}

// ---------------------------------------------------------------------------------------- gabarito (só leitura do banco)
function montarGabarito(loja: number) {
  const L = consultar(`select modo_estoque, is_test, fin_cp_da_nota_ativo cp, fin_cr_vendas_ativo cr from lojas where id=${loja}`)[0]
  const compras = consultar(`select c.id, c.nota_fiscal_id, c.status, c.lancada_em, c.emissao, c.valor_total,
      (select count(*) from compras_proprio_itens i where i.compra_id=c.id) itens,
      (select count(*) from compras_proprio_itens i where i.compra_id=c.id and i.gera_conta_pagar) itens_geram
    from compras_proprio c where c.loja_id=${loja}`)
  const nfs = consultar(`select id, d_emissao_nfe, n_valor_nfe, full_object, deleted_at from notas_fiscais where loja_id=${loja} and id in (select nota_fiscal_id from compras_proprio where loja_id=${loja} and nota_fiscal_id is not null)`)
  const nfPorId = new Map(nfs.map((n) => [Number(n.id), n]))
  const docs: CompraDoc[] = compras.map((c) => {
    const n = c.nota_fiscal_id ? nfPorId.get(Number(c.nota_fiscal_id)) : null
    return {
      compraId: Number(c.id), notaId: c.nota_fiscal_id ? Number(c.nota_fiscal_id) : null, status: c.status, lancadaEm: c.lancada_em, emissaoCompra: c.emissao,
      valorTotalCompra: c.valor_total, temItens: Number(c.itens) > 0, algumItemGeraConta: Number(c.itens_geram) > 0,
      nota: n ? { emissao: n.d_emissao_nfe, valorNfe: n.n_valor_nfe, fullObject: n.full_object, apagada: !!n.deleted_at } : null,
    }
  })
  const regra = { ligada: !!L && L.cp === true && L.modo_estoque === 'proprio', ligadaDesde: process.env.ROBO_SEM_CORTE === '1' ? null : (CHAVE_LIGADA_DESDE[loja] ?? null) } // ROBO_SEM_CORTE=1: sensibilidade, ignora a data em que a chave ligou
  const pagarEsp = titulosPagarEsperados(docs, regra, hoje)
  const pagarAtual = consultar(`select id, valor, data_vencimento, status, origem_tipo, origem_id, parcela, cancelado_em from fin_titulos_pagar where loja_id=${loja} order by id`)
    .map((t) => ({ id: Number(t.id), valorCent: cent(t.valor), vencimento: String(t.data_vencimento).slice(0, 10), cancelado: t.status === 'cancelado' || !!t.cancelado_em, origemTipo: t.origem_tipo, origemId: t.origem_id ? Number(t.origem_id) : null, parcela: Number(t.parcela) }))
  const pagtos = consultar(`select titulo_id, valor_principal, estornado_em from fin_pagamentos where loja_id=${loja}`)
    .map((p) => ({ tituloId: Number(p.titulo_id), principalCent: cent(p.valor_principal), estornado: !!p.estornado_em }))
  const calc = calcularTitulosPagar(pagarAtual, pagtos, hoje)

  const pg = consultar(`select v.id venda_id, v.data, g.metodo, g.bandeira, g.valor, v.cancelado, v.devolvido from vendas_proprio v join vendas_proprio_pagamentos g on g.venda_id=v.id where v.loja_id=${loja}`)
    .map((p) => ({ vendaId: Number(p.venda_id), data: String(p.data).slice(0, 10), metodo: p.metodo, bandeira: p.bandeira, valorCent: cent(p.valor), cancelada: !!p.cancelado, devolvida: !!p.devolvido }))
  const recEsp = titulosReceberEsperados(pg, !!L && L.cr === true && L.modo_estoque === 'proprio' && loja !== 4)
  const recAtual = consultar(`select data_venda, forma, quantidade, valor_bruto, status from fin_titulos_receber where loja_id=${loja}`)
    .map((t) => ({ dataVenda: String(t.data_venda).slice(0, 10), forma: t.forma, quantidade: Number(t.quantidade), brutoCent: cent(t.valor_bruto), cancelado: t.status === 'cancelado' }))

  const contas = consultar(`select id, nome, saldo_inicial, ativa from fin_contas_correntes where loja_id=${loja} order by id`)
    .map((c) => ({ id: Number(c.id), nome: c.nome as string, saldoInicialCent: cent(c.saldo_inicial), ativa: !!c.ativa }))
  const movs: MovimentoDoc[] = []
  for (const p of consultar(`select conta_id, valor_pago, estornado_em from fin_pagamentos where loja_id=${loja}`)) movs.push({ tipo: 'pagamento', contaId: Number(p.conta_id), valorCent: cent(p.valor_pago), estornado: !!p.estornado_em })
  for (const r of consultar(`select conta_id, valor_recebido, estornado_em from fin_recebimentos where loja_id=${loja}`)) movs.push({ tipo: 'recebimento', contaId: Number(r.conta_id), valorCent: cent(r.valor_recebido), estornado: !!r.estornado_em })
  for (const a of consultar(`select l.conta_id, l.tipo, l.valor, exists(select 1 from fin_lancamentos e where e.estorno_de=l.id) estornado from fin_lancamentos l where l.loja_id=${loja} and l.origem_tipo='manual'`)) movs.push({ tipo: 'avulso', contaId: Number(a.conta_id), sentido: a.tipo, valorCent: cent(a.valor), estornado: !!a.estornado })
  for (const t of consultar(`select conta_origem_id, conta_destino_id, valor, estornada_em from fin_transferencias where loja_id=${loja}`)) movs.push({ tipo: 'transferencia', origemId: Number(t.conta_origem_id), destinoId: Number(t.conta_destino_id), valorCent: cent(t.valor), estornada: !!t.estornada_em })
  const saldos = saldosDasContas(contas, movs)
  // contra-prova: o extrato do ledger (fin_lancamentos) tem de dar o mesmo saldo que os documentos
  const ledger = new Map(consultar(`select c.id, c.saldo_inicial + coalesce(sum(case l.tipo when 'entrada' then l.valor else -l.valor end),0) saldo from fin_contas_correntes c left join fin_lancamentos l on l.conta_id=c.id where c.loja_id=${loja} group by c.id, c.saldo_inicial`).map((r) => [Number(r.id), cent(r.saldo)]))
  return { L, pagarEsp, pagarAtual, calc, recEsp, recAtual, contas, saldos, ledger, movs, baixas: pagtos.length + movs.filter((m) => m.tipo === 'recebimento').length }
}

// ------------------------------------------------------------------------------------------------------ leitura das telas
async function abrir(page: Page, rota: string) {
  const r = await page.goto(`${ORIGEM}${rota}`, { waitUntil: 'domcontentloaded', timeout: 90000 })
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(1200)
  const info = await page.evaluate(() => ({ texto: ((document.querySelector('main') ?? document.body) as HTMLElement).innerText, caminho: location.pathname }))
  return { ...info, status: r?.status() ?? 0 }
}

async function rodarLogin(browser: Awaited<ReturnType<typeof chromium.launch>>, lg: Login) {
  const loja = LOJAS.find((l) => l.id === lg.loja)!
  const nome = loja.nome
  const g = montarGabarito(lg.loja)
  conta(nome, 'compras_lancadas_lidas', g.pagarEsp.esperados.length + g.pagarEsp.semGerar.length)
  const antes = g.pagarEsp.semGerar.filter((x) => x.motivo.startsWith('lançada antes da chave')).length
  if (antes) notas.push(`${nome}: ${antes} compra(s) lançada(s) antes de 05/11/2026 19:49 (-03), hora do commit que ligou a chave; sem carga retroativa, o gabarito não espera conta a pagar para elas. A hora real em que a migration foi aplicada não está provada localmente (ROBO_SEM_CORTE=1 roda sem esse corte).`)
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, locale: 'pt-BR', timezoneId: 'America/Sao_Paulo', reducedMotion: 'reduce' })
  await ctx.route('**/*', (rota) => {
    const u = new URL(rota.request().url())
    return u.protocol === 'data:' || u.protocol === 'blob:' || u.origin === ORIGEM || u.origin === ORIGEM_API ? rota.continue() : rota.abort('blockedbyclient')
  })
  const page = await ctx.newPage()
  page.setDefaultTimeout(30000)
  await page.goto(`${ORIGEM}/login`, { waitUntil: 'domcontentloaded', timeout: 90000 })
  await page.fill('#email', lg.email)
  await page.fill('#password', lg.senha)
  await page.click('button[type=submit]')
  await page.waitForURL(/\/(home|resumo|central|entrar|porta)/, { timeout: 90000 })
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
  const png = (r: string) => `prints/${lg.loja}-${r.replace(/[^a-z0-9]+/gi, '-')}.png`
  const rotas = ['/financeiro/contas-pagar', '/financeiro/contas-receber', '/financeiro/contas-correntes']
  const lidas: Record<string, Awaited<ReturnType<typeof abrir>>> = {}
  for (const rota of rotas) {
    lidas[rota] = await abrir(page, rota)
    await page.screenshot({ path: path.join(SAIDA, png(rota)) }).catch(() => {})
  }
  const contasLi = await page.evaluate(() => [...document.querySelectorAll('main ul > li')].map((li) => (li as HTMLElement).innerText)).catch(() => [])
  // (a leitura das contas correntes é a última página aberta, então contasLi vem dela)
  await ctx.close()

  if (g.L?.modo_estoque !== 'proprio') {
    // Loja Omie: o financeiro do ERP só existe em loja de estoque próprio; as telas têm de estar bloqueadas.
    for (const rota of rotas) {
      const l = lidas[rota]
      conta(nome, 'telas_lidas')
      const bloqueada = l.status >= 400 || ehPaginaNaoEncontrada(l.texto) || l.caminho !== rota
      if (!bloqueada) falha(nome, rota, `abrir ${rota}`, 'tela bloqueada (loja Omie não tem financeiro próprio)', 'a tela abriu', png(rota), 'tela-quebrada')
    }
    notas.push(`${nome}: as 3 telas do financeiro estão bloqueadas (404) para loja Omie, como projetado; não existe tela para comparar com o gabarito.`)
    return g
  }

  // ---- contas a pagar
  const p = lidas['/financeiro/contas-pagar']
  conta(nome, 'telas_lidas')
  const cp = lerCartoesPagar(p.texto)
  if (!cp) falha(nome, '/financeiro/contas-pagar', 'ler os cartões', 'cartões Títulos/Falta pagar/Atrasado/Já pago', `não consegui ler (caminho ${p.caminho}, HTTP ${p.status})`, png('/financeiro/contas-pagar'), 'tela-quebrada')
  else {
    const t = totaisPagar(g.calc)
    const cmp: [string, number, number][] = [['Títulos no filtro', t.quantidade, cp.quantidade], ['Falta pagar', t.faltaPagarCent, cp.faltaPagarCent], ['Atrasado (qtd)', t.quantidadeAtrasada, cp.quantidadeAtrasada], ['Atrasado (valor)', t.atrasadoCent, cp.atrasadoCent], ['Já pago', t.jaPagoCent, cp.jaPagoCent]]
    for (const [rot, esp, got] of cmp) {
      conta(nome, 'totais_pagar_comparados')
      if (esp !== got) falha(nome, '/financeiro/contas-pagar', `cartão "${rot}"`, rot.includes('qtd') || rot.startsWith('Títulos') ? String(esp) : brl(esp), rot.includes('qtd') || rot.startsWith('Títulos') ? String(got) : brl(got), png('/financeiro/contas-pagar'))
    }
    conta(nome, 'titulos_pagar_gabarito', g.calc.length)
    conta(nome, 'titulos_pagar_na_tela', cp.quantidade)
  }
  // títulos que as notas deveriam ter gerado × os que existem
  conta(nome, 'titulos_esperados_das_notas', g.pagarEsp.esperados.length)
  divergencias(nome, '/financeiro/contas-pagar', 'título da nota', conferirTitulosDasNotas(g.pagarEsp.esperados, g.pagarAtual), png('/financeiro/contas-pagar'))
  conta(nome, 'baixas_lidas', g.baixas)

  // ---- contas a receber
  const r = lidas['/financeiro/contas-receber']
  conta(nome, 'telas_lidas')
  const cr = lerCartoesReceber(r.texto)
  if (!cr) falha(nome, '/financeiro/contas-receber', 'ler os cartões', 'cartões Vendido no filtro', `não consegui ler (caminho ${r.caminho}, HTTP ${r.status})`, png('/financeiro/contas-receber'), 'tela-quebrada')
  else {
    const t = totaisReceber(g.recAtual)
    conta(nome, 'totais_receber_comparados', 2)
    if (t.quantidade !== cr.quantidade) falha(nome, '/financeiro/contas-receber', 'cartão "contas"', String(t.quantidade), String(cr.quantidade), png('/financeiro/contas-receber'))
    if (t.brutoCent !== cr.brutoCent) falha(nome, '/financeiro/contas-receber', 'cartão "Vendido no filtro"', brl(t.brutoCent), brl(cr.brutoCent), png('/financeiro/contas-receber'))
    conta(nome, 'titulos_receber_na_tela', cr.quantidade)
  }
  conta(nome, 'titulos_receber_esperados_das_vendas', g.recEsp.length)
  divergencias(nome, '/financeiro/contas-receber', 'título das vendas', conferirReceber(g.recEsp, g.recAtual), png('/financeiro/contas-receber'))

  // ---- saldos de conta
  const cc = lerContas(contasLi)
  conta(nome, 'telas_lidas')
  conta(nome, 'contas_no_gabarito', g.contas.length)
  conta(nome, 'contas_na_tela', cc.length)
  if (cc.length !== g.contas.length) falha(nome, '/financeiro/contas-correntes', 'quantidade de contas', String(g.contas.length), String(cc.length), png('/financeiro/contas-correntes'))
  for (const c of g.contas) {
    const naTela = cc.find((x) => x.nome === c.nome)
    const esp = g.saldos.get(c.id) ?? 0
    conta(nome, 'saldos_comparados')
    if (!naTela) falha(nome, '/financeiro/contas-correntes', `conta ${c.nome}`, `saldo ${brl(esp)}`, 'conta não aparece', png('/financeiro/contas-correntes'))
    else if (naTela.saldoCent !== esp) falha(nome, '/financeiro/contas-correntes', `saldo da conta ${c.nome}`, brl(esp), brl(naTela.saldoCent), png('/financeiro/contas-correntes'))
    if (g.ledger.get(c.id) !== esp) falha(nome, '/financeiro/contas-correntes', `saldo da conta ${c.nome} (documentos × extrato)`, brl(esp), brl(g.ledger.get(c.id) ?? 0), png('/financeiro/contas-correntes'))
  }
  return g
}

// ----------------------------------------------------------------------------------- espelho do Omie (Sertão, só leitura)
function espelhoOmieSertao() {
  const nome = 'Sertão'
  const tem = consultar(`select (select count(*) from omie_fin_titulos where loja_id=4) omie_fin_titulos, (select count(*) from omie_fin_baixas where loja_id=4) omie_fin_baixas,
    (select count(*) from contas_pagar where loja_id=4) cp, (select count(*) from contas_receber where loja_id=4) cr, (select count(*) from contas_correntes where loja_id=4) cc`)[0]
  conta(nome, 'espelho_contas_pagar', Number(tem.cp)); conta(nome, 'espelho_contas_receber', Number(tem.cr)); conta(nome, 'espelho_contas_correntes', Number(tem.cc))
  notas.push(`Sertão: o espelho completo do financeiro do Omie (omie_fin_titulos/omie_fin_baixas) NÃO existe para a loja 4 na cópia local (${tem.omie_fin_titulos}/${tem.omie_fin_baixas} linhas; só a loja 5 tem). O que existe para a loja 4 é um retrato dos títulos EM ABERTO (contas_pagar ${tem.cp}, contas_receber ${tem.cr}) e das contas correntes (${tem.cc}), sem pagos e sem baixas. O robô confere esse retrato por coerência interna (status × vencimento na data da cópia, títulos repetidos, valores <= 0, saldo atual × disponível). O ERP não tem tela para o Sertão: não há comparação tela × espelho.`)
  for (const [tabela, rotulo] of [['contas_pagar', 'conta a pagar do Omie'], ['contas_receber', 'conta a receber do Omie']] as const) {
    const ts = consultar(`select id, codigo_lancamento_omie, status_titulo, data_vencimento, valor_documento, (synced_at at time zone 'America/Bahia')::date sync_dia from ${tabela} where loja_id=4`)
      .map((t) => ({ id: Number(t.id), codigo: Number(t.codigo_lancamento_omie), status: t.status_titulo, vencimento: t.data_vencimento ? String(t.data_vencimento).slice(0, 10) : null, valorCent: cent(t.valor_documento), syncDia: String(t.sync_dia).slice(0, 10) }))
    divergencias(nome, `espelho ${tabela}`, 'status × vencimento', conferirStatusOmie(ts, rotulo), '-')
    for (const t of ts) if (!(t.valorCent > 0)) falha(nome, `espelho ${tabela}`, `${rotulo} ${t.codigo}`, 'valor do documento > 0', brl(t.valorCent), '-')
    conta(nome, `espelho_${tabela}_conferidos`, ts.length)
  }
  const ccs = consultar(`select codigo_cc, descricao, saldo_atual, saldo_disponivel from contas_correntes where loja_id=4`)
  for (const c of ccs) { conta(nome, 'espelho_contas_correntes_conferidas'); if (cent(c.saldo_atual) !== cent(c.saldo_disponivel)) falha(nome, 'espelho contas_correntes', `conta ${c.descricao}`, `saldo disponível = saldo atual (${brl(cent(c.saldo_atual))})`, brl(cent(c.saldo_disponivel)), '-') }
}

// ---------------------------------------------------------------------------------------------------------------- execução
const t0 = Date.now()
const browser = await chromium.launch()
const alvo = logins.filter((l) => LOJAS.some((x) => x.id === l.loja))
if (alvo.length !== 3) sair(`esperava 3 logins de dono (lojas 4, 15, 19), achei ${alvo.length}`)
let falhouLeitura = 0
for (const lg of alvo) {
  try { await rodarLogin(browser, lg) } catch (e) {
    falhouLeitura++
    falha(LOJAS.find((l) => l.id === lg.loja)!.nome, '/financeiro', 'rodar o login', 'ler as telas do financeiro', String((e as Error).message).split('\n')[0].slice(0, 200), '-', 'tela-quebrada')
  }
}
await browser.close()
espelhoOmieSertao()

const ordenadas = ordenarFalhas(falhas)
const md = formatarListaFalhas(ordenadas, { visitas: Object.values(comparados).reduce((s, o) => s + (o.telas_lidas ?? 0), 0), telas: 3, logins: alvo.length })
fs.writeFileSync(path.join(SAIDA, 'falhas.md'), md)
const porLoja: Record<string, number> = {}
for (const f of ordenadas) if (f.gravidade === 1) porLoja[f.loja] = (porLoja[f.loja] ?? 0) + 1
const comparacao = ['# Comparação do financeiro (gabarito × telas)', '', ...Object.entries(comparados).flatMap(([l, o]) => [`## ${l}`, ...Object.entries(o).map(([k, n]) => `- ${k}: ${n}`), `- falhas de gravidade 1: ${porLoja[l] ?? 0}`, '']), '## Notas', ...notas.map((n) => `- ${n}`), '']
fs.writeFileSync(path.join(SAIDA, 'comparacao.md'), comparacao.join('\n'))
const resumo = { rodada: ID, urlBase: ORIGEM, comparados, falhasGravidade1: ordenadas.filter((f) => f.gravidade === 1).length, falhasOutras: ordenadas.filter((f) => f.gravidade !== 1).length, porLoja, notas, segundos: Math.round((Date.now() - t0) / 1000) }
fs.writeFileSync(path.join(SAIDA, 'resumo.json'), JSON.stringify(resumo, null, 1))
console.log(JSON.stringify(resumo, null, 1))
process.exit(falhouLeitura ? 1 : 0)
