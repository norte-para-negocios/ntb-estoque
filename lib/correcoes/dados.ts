// Central de correções (14/10/2026): lê tudo o que o classificador precisa, em paralelo, e devolve os problemas com o
// estado de cada um. Regras em lib/correcoes/central-puro.ts e cupons-sem-op-puro.ts (puras, testadas).
// Meta: < 1 s no servidor. Duas ondas de leituras paralelas (páginas em ondas, nada de consulta por produto em laço);
// os cupons de 14 dias vêm do Contabo junto com a 1ª onda.
import { createClient } from '@/lib/supabase/server'
import { lerEmOndas } from '@/lib/supabase/ler-em-ondas'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { addDias } from '@/lib/estoque/espelho-lojas'
import { getPermissoesNomes } from '@/lib/auth'
import { carregarFichasAtivas } from '@/lib/estoque/receita-db'
import { negativoDesde, oscilacoesContagem, cmcPorLocalAtual, insumosSemCustoNoLocal, rotuloNegativoDesde, ultimoCmcAnterior, type MovSaldo } from '@/lib/estoque/saude-puro'
import { itensDaOPGravada } from '@/lib/estoque/ops-tela-puro'
import { diaDoMovimento } from '@/lib/estoque/quem-mexeu-puro'
import { buscarFatCupomItens, buscarFatCupons } from '@/lib/faturamento-frio'
import { carregarEstoqueOmieComPosicoes } from '@/app/(app)/estoque/dados-omie'
import { carregarEstoque } from '@/app/(app)/estoque/dados'
import { carregarOPsAbertas } from '@/app/(app)/estoque/dados-ops'
import { emLotes, historicoKardexDesde } from '@/app/(app)/estoque/dados-comum'
import {
  classificarProblemas, comecePorAqui, estadoEfetivo, ordenarGrupos, resumoDoDia,
  type EntradaCentral, type Grupo, type ItemFichaC, type OPAbertaC, type Problema, type ProblemaComEstado, type ProdutoC, type RegistroEstado,
} from './central-puro'
import { cuponsSemOP, ehOPdoPDV, resumoCuponsPorDia, type ItemCupom } from './cupons-sem-op-puro'
import { ligarRoboAosProdutos } from './robo'

export type { ProblemaComEstado }
export type LinhaRobo = {
  id: number; lote: string; modulo: string; acao: string; produto_cod: string; produto_desc: string | null; data_ref: string
  quantidade: number | null; de_valor: number | null; para_valor: number | null; status: string; motivo: string | null; origem_ts: string
}
export type ProdutoMini = { nome: string; cod: string; un: string; tipo: string | null; saldo: number; cmc: number }
export type DadosCentral = {
  lojaId: number; lojaNome: string; isTest: boolean; modo: 'omie' | 'proprio'; hoje: string
  itens: ProblemaComEstado[]; comece: string[]; ordem: Grupo[]; resumo: ReturnType<typeof resumoDoDia>
  produtos: Record<number, ProdutoMini>; nomesLocais: Record<number, string>; cuponsPorDia: { data: string; cupons: number; itens: number }[]
  robo: LinhaRobo[]; roboPorProduto: Record<number, number[]>
  avisos: string[]; podeExecutar: boolean; tempos: Record<string, number>
}

const DIAS_CUPOM = 14
const DIAS_PDV = 60
const DIAS_CONTAGEM = 120
const DIAS_CUSTO = 14
const DIAS_NEGATIVO = 60
const ATRASO_PDV_MS = 2 * 3_600_000

type Res<T> = { data: T[] | null; error: { message: string } | null }
const tudo = <T,>(montar: (from: number, to: number) => PromiseLike<Res<T>>, onErro: (m: string) => void) => lerEmOndas<T>(montar, onErro)

/** 'YYYY-MM-DDTHH:MM:SS' no fuso da Bahia. */
function instanteBahia(ms: number): string {
  return new Date(ms).toLocaleString('sv-SE', { timeZone: 'America/Bahia', hour12: false }).replace(' ', 'T')
}
export const diaBahia = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: 'America/Bahia' })

export async function carregarCentral(lojaId: number, modo: 'omie' | 'proprio'): Promise<DadosCentral> {
  const t0 = performance.now()
  const tempos: Record<string, number> = {}
  const supabase = await createClient()
  const hoje = hojeBahiaISO()
  const avisos: string[] = []
  const erro = (onde: string) => (m: string) => { avisos.push(`Não foi possível ler ${onde}: ${m}`) }

  // ---------------------------------------------------------------- onda 1
  type EstadoRow = RegistroEstado
  type NaoRow = { codigo_produto: number }
  const comuns = Promise.all([
    supabase.from('lojas').select('id, nome, nome_fantasia, is_test').eq('id', lojaId).maybeSingle(),
    getPermissoesNomes(lojaId),
    tudo<EstadoRow>((f, t) => supabase.from('central_problema_estado').select('id, chave, estado, motivo, mensagem, acao, ate, assinatura, user_nome, atualizado_em').eq('loja_id', lojaId).order('id').range(f, t) as unknown as PromiseLike<Res<EstadoRow>>, () => avisos.push('A Central ainda não foi ativada neste banco (migration 171): o estado dos problemas não fica guardado.')),
    supabase.from('estoque_nao_controla').select('codigo_produto').eq('loja_id', lojaId).limit(5000),
    supabase.from('correcoes_automaticas').select('id, lote, modulo, acao, produto_cod, produto_desc, data_ref, quantidade, de_valor, para_valor, status, motivo, origem_ts')
      .eq('loja_id', lojaId).gte('data_ref', addDias(hoje, -6)).order('origem_ts', { ascending: false }).limit(300),
  ])

  const entrada = modo === 'omie' ? await entradaOmie(lojaId, hoje, avisos, erro, tempos) : await entradaProprio(lojaId, hoje, avisos, erro)
  const [lojaRes, perms, estados, naoRes, roboRes] = await comuns
  tempos.total_leitura = Math.round(performance.now() - t0)

  entrada.naoControla = new Set(((naoRes.data ?? []) as NaoRow[]).map((r) => Number(r.codigo_produto)))
  const problemas: Problema[] = classificarProblemas(entrada)
  const regPorChave = new Map(estados.map((r) => [r.chave, r]))
  const itens: ProblemaComEstado[] = problemas.map((p) => ({ p, e: estadoEfetivo(regPorChave.get(p.chave), p, hoje, diaBahia) }))
  const detectadas = new Set(problemas.map((p) => p.chave))
  const sumidosHoje = estados.filter((r) => r.estado === 'resolvido' && !detectadas.has(r.chave) && diaBahia(r.atualizado_em) === hoje).length

  // Produtos que a tela precisa (nomes, saldo, custo): os dos problemas, insumos das OPs e pratos citados.
  const usados = new Set<number>()
  for (const p of problemas) {
    if (p.d.produto != null) usados.add(p.d.produto)
    for (const i of p.d.op?.insumos ?? []) usados.add(i.produto)
    for (const x of p.d.pratos ?? []) usados.add(x)
    for (const i of p.d.cupom?.itens ?? []) usados.add(i.produto)
  }
  const produtos: Record<number, ProdutoMini> = {}
  const porCod = new Map<string, number>()
  for (const p of entrada.produtos) {
    porCod.set(p.cod, p.codigo)
    porCod.set(String(p.codigo), p.codigo)
    if (usados.has(p.codigo)) produtos[p.codigo] = { nome: p.nome, cod: p.cod, un: p.unidade, tipo: p.tipo, saldo: p.saldo, cmc: p.cmc }
  }
  let robo: LinhaRobo[] = []
  if (roboRes.error) { if (!/correcoes_automaticas|42P01|does not exist/i.test(roboRes.error.message)) avisos.push(`Não foi possível ler o log do robô: ${roboRes.error.message}`) }
  else robo = (roboRes.data ?? []) as LinhaRobo[]
  const roboPorProduto = Object.fromEntries(ligarRoboAosProdutos(robo, porCod))

  const loja = lojaRes.data as { nome: string | null; nome_fantasia: string | null; is_test: boolean } | null
  tempos.total = Math.round(performance.now() - t0)
  console.log(`central-correcoes: loja ${lojaId} ${JSON.stringify(tempos)} problemas=${problemas.length}`)
  return {
    lojaId, lojaNome: loja?.nome_fantasia || loja?.nome || `Loja ${lojaId}`, isTest: !!loja?.is_test, modo, hoje,
    itens, comece: comecePorAqui(itens).map((p) => p.chave), ordem: ordenarGrupos(itens), resumo: resumoDoDia(itens, sumidosHoje),
    produtos, nomesLocais: Object.fromEntries(entrada.nomesLocais), cuponsPorDia: resumoCuponsPorDia(entrada.cuponsSemOP),
    robo, roboPorProduto, avisos,
    podeExecutar: modo === 'omie' && (perms.has('*') || perms.has('Correcoes - Executar')),
    tempos,
  }
}

function produtoC(l: { codigoProduto: number; codigo: string; descricao: string; unidade: string; tipoItem: string | null; saldo: number; cmc: number; custoSuspeito?: boolean; locais: { codigoLocal: number; saldo: number }[] }): ProdutoC {
  return {
    codigo: l.codigoProduto, cod: l.codigo, nome: l.descricao, unidade: l.unidade, tipo: l.tipoItem, saldo: l.saldo, cmc: l.cmc,
    custoSuspeito: l.custoSuspeito, locais: l.locais.map((x) => ({ local: x.codigoLocal, saldo: x.saldo })),
  }
}

const vazia = (hoje: string, modo: 'omie' | 'proprio'): EntradaCentral => ({
  hoje, modo, produtos: [], nomesLocais: new Map(), desde: new Map(), custoHist: new Map(), fichas: new Map(), cmcLocal: new Map(), semCusto: [],
  insumosInativos: new Set(), opsAbertas: [], contagens: [], cuponsSemOP: [], notasPendentes: new Map(), naoControla: new Set(),
})

async function entradaOmie(lojaId: number, hoje: string, avisos: string[], erro: (o: string) => (m: string) => void, tempos: Record<string, number>): Promise<EntradaCentral> {
  const supabase = await createClient()
  const t1 = performance.now()
  type FRow = { codigo_produto: number; codigo_produto_insumo: number; quantidade: number | null; percentual_perda: number | null; codigo_local_estoque: number | null }
  type SRow = { id: number; id_prod: number; codigo_local_estoque: number; data: string; quan: number }
  type NFRow = { id: number; c_numero_nfe: string | null }
  type CupRow = { n_id_cupom: number; num: string | null; data: string; hora: string | null; cancelado: boolean }
  let freioOk = true
  const corte = instanteBahia(Date.now() - ATRASO_PDV_MS)
  const [{ visao, posicoes }, opsRes, cobertura, fichas, sld, inativos, notas, pdvRes, cupons, itensCup] = await Promise.all([
    carregarEstoqueOmieComPosicoes(lojaId),
    carregarOPsAbertas(lojaId, 'omie'),
    historicoKardexDesde(lojaId),
    tudo<FRow>((f, t) => supabase.from('estrutura_produto_cache').select('id, codigo_produto, codigo_produto_insumo, quantidade, percentual_perda, codigo_local_estoque').eq('loja_id', lojaId).order('id').range(f, t) as unknown as PromiseLike<Res<FRow>>, erro('as fichas')),
    tudo<SRow>((f, t) => supabase.from('movimentos').select('id, id_prod, codigo_local_estoque, data, quan').eq('loja_id', lojaId).eq('tipo', 'SLD').gte('data', `${addDias(hoje, -DIAS_CONTAGEM)}T00:00:00Z`).order('id').range(f, t), erro('as contagens')),
    tudo<{ codigo_produto: number }>((f, t) => supabase.from('produtos').select('id, codigo_produto').eq('loja_id', lojaId).eq('inativo', true).order('id').range(f, t), erro('os produtos inativos')),
    supabase.from('notas_fiscais').select('id, c_numero_nfe').eq('loja_id', lojaId).eq('c_etapa', '40').is('deleted_at', null).gte('d_emissao_nfe', addDias(hoje, -30)).order('id').limit(200),
    supabase.rpc('central_ops_pdv', { p_loja_id: lojaId, p_ini_cobertura: addDias(hoje, -DIAS_CUPOM), p_ini_produtos: addDias(hoje, -DIAS_PDV) }),
    buscarFatCupons({ lojaId, dataInicio: addDias(hoje, -(DIAS_CUPOM - 1)), dataFinal: hoje, onTruncado: () => { freioOk = false } }),
    buscarFatCupomItens({ lojaId, dataInicio: addDias(hoje, -(DIAS_CUPOM - 1)), dataFinal: hoje, onTruncado: () => { freioOk = false } }),
  ])
  tempos.onda1 = Math.round(performance.now() - t1)
  const e = vazia(hoje, 'omie')
  e.produtos = visao.linhas.map(produtoC)
  e.nomesLocais = new Map(visao.locais.map((l) => [l.codigoLocal, l.descricao]))
  const prod = new Map(e.produtos.map((p) => [p.codigo, p]))

  // Fichas e insumo sem custo no local.
  for (const f of fichas) {
    const pr = Number(f.codigo_produto)
    const lista = e.fichas.get(pr) ?? []
    lista.push({ insumo: Number(f.codigo_produto_insumo), qtd: Number(f.quantidade ?? 0), perda: Number(f.percentual_perda ?? 0), local: f.codigo_local_estoque == null ? null : Number(f.codigo_local_estoque) } satisfies ItemFichaC)
    e.fichas.set(pr, lista)
  }
  e.cmcLocal = cmcPorLocalAtual(posicoes)
  e.semCusto = insumosSemCustoNoLocal(fichas.map((f) => ({ produto: Number(f.codigo_produto), insumo: Number(f.codigo_produto_insumo), local: f.codigo_local_estoque == null ? null : Number(f.codigo_local_estoque) })), e.cmcLocal)
  const inat = new Set(inativos.map((x) => Number(x.codigo_produto)))
  for (const itens of e.fichas.values()) for (const i of itens) if (inat.has(i.insumo)) e.insumosInativos.add(i.insumo)

  // OPs abertas.
  if (opsRes.erro) avisos.push(`Não foi possível ler as OPs abertas: ${opsRes.erro}`)
  if (!opsRes.completa) avisos.push('Esta loja não tem o espelho completo das OPs: a lista de OPs abertas pode estar incompleta.')
  e.opsAbertas = opsRes.ops.map((o): OPAbertaC => ({
    id: Number(o.id), nCodOP: o.identificacao_n_cod_op == null ? null : Number(o.identificacao_n_cod_op),
    numero: o.identificacao_c_num_op ?? o.num_ordem ?? String(o.id),
    produto: o.identificacao_n_cod_produto == null ? null : Number(o.identificacao_n_cod_produto),
    qtd: Number(o.identificacao_n_qtde ?? o.quantidade ?? 0), local: o.identificacao_codigo_local_estoque ? Number(o.identificacao_codigo_local_estoque) : null,
    origem: o.origem_op, previsao: o.identificacao_d_dt_previsao, inclusao: o.dt_inclusao,
    cupom: (o.obs_omie ?? '').match(/Cupom\s+(\d+)/i)?.[1] ?? null,
    insumos: itensDaOPGravada(o.full_object).map((i) => ({ produto: i.insumo, qtd: i.quantidade })),
  }))

  // Contagens que oscilam (a última de cada produto/local).
  const osc = oscilacoesContagem(sld.map((s) => ({ produto: Number(s.id_prod), local: Number(s.codigo_local_estoque), data: diaDoMovimento(s.data), ordem: Number(s.id), qtd: Number(s.quan) })))
  const ultima = new Map<string, (typeof osc)[number]>()
  for (const o of osc) ultima.set(`${o.produto}:${o.local}`, o)
  e.contagens = [...ultima.values()].filter((o) => prod.has(o.produto))

  // Notas esperando entrada (c_etapa 40) → produto.
  const nf = (notas.data ?? []) as NFRow[]
  if (nf.length) {
    const its = await emLotes(nf.map((n) => n.id), 150, async (lote) => {
      const { data } = await supabase.from('nota_fiscal_items').select('nota_fiscal_id, n_id_produto').eq('loja_id', lojaId).in('nota_fiscal_id', lote).limit(5000)
      return (data ?? []) as { nota_fiscal_id: number; n_id_produto: number | null }[]
    })
    const porId = new Map(nf.map((n) => [n.id, n]))
    for (const i of its) if (i.n_id_produto) e.notasPendentes.set(Number(i.n_id_produto), { id: Number(i.nota_fiscal_id), numero: porId.get(i.nota_fiscal_id)?.c_numero_nfe ?? String(i.nota_fiscal_id) })
  }

  // Cupons sem OP (Contabo + OPs do PDV agregadas no banco).
  if (!freioOk) avisos.push('Os cupons do caixa não puderam ser lidos por completo (Contabo): a lista de cupons sem OP pode faltar itens.')
  type Pdv = { cobertura: [string, number, number][]; produtos: number[] }
  const pdv: Pdv | null = pdvRes.error ? null : (pdvRes.data as Pdv | null)
  if (pdvRes.error) avisos.push('Cupons sem OP: a função central_ops_pdv ainda não existe (migration 171). O grupo fica vazio até ela ser aplicada.')
  if (pdv) {
    const comOP = new Set<number>()
    for (const p of pdv.produtos) if (['03', '04'].includes(prod.get(Number(p))?.tipo ?? '')) comOP.add(Number(p))
    for (const [pr, itens] of e.fichas) if (itens.length && ['03', '04'].includes(prod.get(pr)?.tipo ?? '')) comOP.add(pr)
    const cab = new Map((cupons as unknown as CupRow[]).map((c) => [Number(c.n_id_cupom), c]))
    const itensC: ItemCupom[] = []
    for (const i of itensCup) {
      const c = cab.get(Number(i.n_id_cupom))
      if (!c || c.cancelado || i.id_produto == null) continue
      itensC.push({ nIdCupom: Number(i.n_id_cupom), num: c.num, data: String(c.data).slice(0, 10), hora: c.hora, produto: Number(i.id_produto), nome: prod.get(Number(i.id_produto))?.nome ?? i.x_prod ?? String(i.id_produto), quant: Number(i.quant) || 0 })
    }
    e.cuponsSemOP = cuponsSemOP(itensC, pdv.cobertura.map(([d, p, q]) => ({ data: String(d).slice(0, 10), produto: Number(p), qtd: Number(q) })), comOP, corte)
  }
  void ehOPdoPDV // a mesma regra está no SQL de central_ops_pdv (migration 171)

  // ---------------------------------------------------------------- onda 2: kardex (negativos e custo)
  const t2 = performance.now()
  type KRow = { id: number; n_cod_prod: number; codigo_local_estoque: number; data_mov: string; id_mov: number; quantidade: number; saldo_apos: number | null; cmc_apos: number | null }
  const COLS = 'id, n_cod_prod, codigo_local_estoque, data_mov, id_mov, quantidade, saldo_apos, cmc_apos'
  const negCods = e.produtos.filter((p) => p.locais.some((l) => l.saldo < 0)).map((p) => p.codigo)
  const iniNeg = cobertura.desde && cobertura.desde > addDias(hoje, -DIAS_NEGATIVO) ? cobertura.desde : addDias(hoje, -DIAS_NEGATIVO)
  const lotes: number[][] = []
  for (let i = 0; i < negCods.length; i += 60) lotes.push(negCods.slice(i, i + 60))
  const [kNeg, kEnt] = cobertura.desde ? await Promise.all([
    Promise.all(lotes.map((lote) => tudo<KRow>((f, t) => supabase.from('kardex_omie').select(COLS).eq('loja_id', lojaId).in('n_cod_prod', lote).gte('data_mov', iniNeg).eq('cancelado', false).order('id').range(f, t), erro('o kardex')))).then((x) => x.flat()),
    tudo<KRow>((f, t) => supabase.from('kardex_omie').select(COLS).eq('loja_id', lojaId).gt('quantidade', 0).gte('data_mov', addDias(hoje, -DIAS_CUSTO)).eq('cancelado', false).order('id').range(f, t), erro('as entradas do kardex')),
  ]) : [[], []]
  tempos.onda2 = Math.round(performance.now() - t2)
  const paraMov = (k: KRow) => ({ produto: Number(k.n_cod_prod), data: k.data_mov, ordem: Number(k.id_mov), local: Number(k.codigo_local_estoque), quantidade: Number(k.quantidade), saldo: k.saldo_apos == null ? null : Number(k.saldo_apos), cmc: k.cmc_apos == null ? null : Number(k.cmc_apos) })
  const porProduto = (rows: KRow[]) => {
    const m = new Map<number, (MovSaldo & { quantidade: number })[]>()
    for (const r of rows.map(paraMov)) m.set(r.produto, [...(m.get(r.produto) ?? []), r])
    return m
  }
  for (const [cod, movs] of porProduto(kNeg)) {
    const desde = negativoDesde(movs)
    const ord = [...movs].sort((a, b) => a.data.localeCompare(b.data) || a.ordem - b.ordem)
    for (const [local, data] of desde) {
      const p1 = ord.find((m) => m.local === local)
      const r = rotuloNegativoDesde({ desde: data, primeiraData: p1?.data, coberturaIni: iniNeg, saldoAntesDaPrimeira: p1 && p1.saldo != null ? p1.saldo - p1.quantidade : null })
      if (r.tipo === 'desde' && r.data) e.desde.set(`${cod}:${local}`, r.data)
    }
  }
  for (const [cod, movs] of porProduto(kEnt)) {
    let melhor: { atual: number; anterior: number | null } | null = null
    for (const h of ultimoCmcAnterior(movs).values()) if (!melhor || h.atual > melhor.atual) melhor = h
    if (melhor) e.custoHist.set(cod, melhor)
  }
  if (!cobertura.desde) avisos.push('O kardex desta loja ainda não foi lido por completo: "negativo desde" e o custo anterior ficam sem data.')
  return e
}

async function entradaProprio(lojaId: number, hoje: string, avisos: string[], erro: (o: string) => (m: string) => void): Promise<EntradaCentral> {
  const supabase = await createClient()
  const [visao, fichas] = await Promise.all([
    carregarEstoque(lojaId),
    carregarFichasAtivas(supabase, lojaId).catch((x: Error) => { avisos.push(`Não foi possível ler as fichas: ${x.message}`); return new Map() }),
  ])
  const e = vazia(hoje, 'proprio')
  e.produtos = visao.linhas.map((l) => produtoC({ ...l, custoSuspeito: false }))
  e.nomesLocais = new Map(visao.locais.map((l) => [l.codigoLocal, l.descricao]))
  for (const f of fichas.values()) {
    const rend = Number(f.rendimento) || 1
    e.fichas.set(f.codigoProduto, f.itens.map((i: { codigoInsumo: number; quantidadeLiquida: number; fatorCorrecao: number; perdaPct: number }) => ({ insumo: i.codigoInsumo, qtd: (i.quantidadeLiquida * (i.fatorCorrecao || 1)) / rend, perda: 0, local: null })))
  }
  const cmc = new Map(e.produtos.map((p) => [`${p.codigo}:0`, p.cmc]))
  e.semCusto = insumosSemCustoNoLocal([...e.fichas.entries()].flatMap(([pr, its]) => its.map((i) => ({ produto: pr, insumo: i.insumo, local: 0 }))), cmc)
  e.nomesLocais.set(0, 'qualquer local')
  // "Negativo desde" pelo ledger próprio.
  type MRow = { id: number; codigo_produto: number; codigo_local_estoque: number; data_ref: string; quantidade: number; saldo_apos: number; cmc_apos: number | null }
  const neg = e.produtos.filter((p) => p.locais.some((l) => l.saldo < 0)).map((p) => p.codigo)
  const ini = addDias(hoje, -DIAS_NEGATIVO)
  const lotes: number[][] = []
  for (let i = 0; i < neg.length; i += 60) lotes.push(neg.slice(i, i + 60))
  const rows = (await Promise.all(lotes.map((lote) => tudo<MRow>((f, t) => supabase.from('estoque_movimentos').select('id, codigo_produto, codigo_local_estoque, data_ref, quantidade, saldo_apos, cmc_apos').eq('loja_id', lojaId).in('codigo_produto', lote).gte('data_ref', ini).order('id').range(f, t), erro('os movimentos'))))).flat()
  const m = new Map<number, MovSaldo[]>()
  for (const r of rows) m.set(Number(r.codigo_produto), [...(m.get(Number(r.codigo_produto)) ?? []), { data: r.data_ref.slice(0, 10), ordem: Number(r.id), local: Number(r.codigo_local_estoque), saldo: Number(r.saldo_apos), cmc: r.cmc_apos == null ? null : Number(r.cmc_apos) }])
  for (const [cod, movs] of m) for (const [local, data] of negativoDesde(movs)) if (data > ini) e.desde.set(`${cod}:${local}`, data)
  return e
}
