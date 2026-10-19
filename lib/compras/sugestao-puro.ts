// Sugestão de compra (Fase C, I6): a fórmula do Omie, provada na captura de 17/10/2026 da loja 5
// (~/Projects/omie-rea/telas/COM/sugestao-compra: textos de ajuda da tela + 50 linhas do grid).
// Sem imports: node --test lib/compras/sugestao-puro.test.ts.
//
//   consumo médio      = consumo total (saídas do período de análise) ÷ dias de análise
//   ponto de pedido    = estoque mínimo + consumo médio × lead time (vazio/0 = 1 dia)
//   projeção de saídas = consumo médio × dias de estimativa
//   sugestão           = máx(0, projeção + ponto de pedido − estoque atual − previsão de entradas)
//   duração do estoque = trunc(estoque atual ÷ consumo médio)            (0 sem consumo)
//   dias até o ponto   = máx(0, trunc((estoque atual − ponto) ÷ consumo médio))
//   recomendação       = sugestão 0 → não; dias até o ponto 0 → imediatamente; senão → próximos dias
// O Omie mostra consumo e saídas com sinal negativo; aqui são quantidades positivas (mesmos números).
// Cálculo em precisão cheia e cada resultado arredondado a 6 casas (como o grid do Omie: 158/30×15 = 79, não 79,000005).

export type Recomendacao = 'imediato' | 'proximos' | 'nao'
export type AcaoSugestao = 'comprar' | 'produzir'
export type BaseProjecao = 'consumo' | 'previsao'

export type EntradaSugestao = {
  consumoTotal: number
  estoqueMinimo: number
  estoqueAtual: number
  leadTime: number | null
  entradaPrevista: number
  /** Base 'previsao': saídas esperadas no período de estimativa (previsão de venda + consumo nas OPs abertas). */
  saidaPrevista?: number | null
}

export type LinhaCalculada = {
  consumoTotal: number
  consumoMedio: number
  leadTime: number
  pontoPedido: number
  saidaProjetada: number
  entradaPrevista: number
  sugestao: number
  duracao: number
  diasAtePonto: number
  recomendacao: Recomendacao
}

const r6 = (n: number) => {
  const v = Math.round(n * 1e6) / 1e6
  return Object.is(v, -0) ? 0 : v
}
const trunc = (n: number) => {
  const v = Math.trunc(n + (n >= 0 ? 1e-9 : -1e-9))
  return Object.is(v, -0) ? 0 : v
}
const num = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? n : 0)

function diaUTC(iso: string): number {
  return Date.parse(`${iso.slice(0, 10)}T12:00:00Z`)
}
function iso(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/** Dias do período contando as duas pontas (0 se o fim é antes do início). */
export function diasInclusivos(ini: string, fim: string): number {
  const d = Math.round((diaUTC(fim) - diaUTC(ini)) / 86_400_000) + 1
  return Number.isFinite(d) && d > 0 ? d : 0
}

/** Padrão do Omie: análise = mês anterior inteiro; estimativa = hoje até o último dia do mês. */
export function periodosPadrao(hoje: string): { analise: { ini: string; fim: string }; estimativa: { ini: string; fim: string } } {
  const [a, m] = hoje.slice(0, 7).split('-').map(Number)
  const iniMes = Date.UTC(a, m - 1, 1, 12)
  const fimMesAnterior = iniMes - 86_400_000
  const iniMesAnterior = Date.UTC(new Date(fimMesAnterior).getUTCFullYear(), new Date(fimMesAnterior).getUTCMonth(), 1, 12)
  const fimMes = Date.UTC(a, m, 1, 12) - 86_400_000
  return {
    analise: { ini: iso(iniMesAnterior), fim: iso(fimMesAnterior) },
    estimativa: { ini: hoje.slice(0, 10), fim: iso(fimMes) },
  }
}

export function calcularSugestao(e: EntradaSugestao, p: { diasAnalise: number; diasEstimativa: number; base: BaseProjecao }): LinhaCalculada {
  const consumoTotal = Math.max(0, num(e.consumoTotal))
  const medio = p.diasAnalise > 0 ? consumoTotal / p.diasAnalise : 0
  const lead = e.leadTime != null && e.leadTime > 0 ? e.leadTime : 1
  const minimo = num(e.estoqueMinimo)
  const estoque = num(e.estoqueAtual)
  const entrada = num(e.entradaPrevista)
  const ponto = minimo + medio * lead
  const saida = p.base === 'previsao' && e.saidaPrevista != null ? Math.max(0, num(e.saidaPrevista)) : medio * p.diasEstimativa
  const sugestao = Math.max(0, saida + ponto - estoque - entrada)
  const duracao = medio > 0 ? trunc(estoque / medio) : 0
  const diasAtePonto = medio > 0 ? Math.max(0, trunc((estoque - ponto) / medio)) : 0
  const sug = r6(sugestao)
  return {
    consumoTotal: r6(consumoTotal),
    consumoMedio: r6(medio),
    leadTime: lead,
    pontoPedido: r6(ponto),
    saidaProjetada: r6(saida),
    entradaPrevista: r6(entrada),
    sugestao: sug,
    duracao,
    diasAtePonto,
    recomendacao: sug <= 0 ? 'nao' : diasAtePonto === 0 ? 'imediato' : 'proximos',
  }
}

/** Hipótese H2: produto acabado/em processo (tipo 04/03) ou com ficha técnica se produz; o resto se compra. */
export function acaoDoProduto(tipoItem: string | null, temFicha: boolean): AcaoSugestao {
  return temFicha || tipoItem === '04' || tipoItem === '03' ? 'produzir' : 'comprar'
}

/** Hipótese H3: ativo imobilizado (08), serviço (09) e outras (99, ex.: "Taxa de Serviço") ficam fora por padrão. */
export function tipoPadraoIncluido(tipoItem: string | null): boolean {
  return !['08', '09', '99'].includes(tipoItem ?? '')
}

/** Produto entra na lista se tem consumo, mínimo, saldo ou entrada prevista. */
export function deveListar(e: { consumoTotal: number; estoqueMinimo: number; estoqueAtual: number; entradaPrevista: number }): boolean {
  return num(e.consumoTotal) !== 0 || num(e.estoqueMinimo) !== 0 || num(e.estoqueAtual) !== 0 || num(e.entradaPrevista) !== 0
}

export function rotuloRecomendacao(r: Recomendacao, a: AcaoSugestao): string {
  const verbo = a === 'produzir' ? 'Produzir' : 'Comprar'
  if (r === 'imediato') return `${verbo} imediatamente`
  if (r === 'proximos') return `${verbo} nos próximos dias`
  return `Não ${verbo.toLowerCase()}`
}

/** Saídas esperadas na base 'previsao': previsão de venda por dia × dias de estimativa + consumo nas OPs abertas. */
export function saidaPrevistaPelaPrevisao(previsaoQtde: number, previsaoDias: number, diasEstimativa: number, consumoOps: number): number | null {
  const temPrevisao = previsaoDias > 0 && previsaoQtde > 0
  if (!temPrevisao && !(consumoOps > 0)) return null
  return r6((temPrevisao ? (previsaoQtde / previsaoDias) * diasEstimativa : 0) + Math.max(0, consumoOps))
}

// ---------------------------------------------------------------------------------------------------------------
// Despacho por modo e montagem das linhas da tela (a partir do jsonb das funções da migration 201).

export type ModoLoja = 'omie' | 'proprio' | 'nenhum'

/** Cada modo lê a sua função; loja sem estoque não tem sugestão. Nada do modo próprio passa pela função do Omie e vice-versa. */
export function rpcDaSugestao(modo: ModoLoja): 'sugestao_compra_omie' | 'sugestao_compra_proprio' | null {
  return modo === 'omie' ? 'sugestao_compra_omie' : modo === 'proprio' ? 'sugestao_compra_proprio' : null
}

export type LinhaBruta = {
  codigo_produto: number; codigo: string | null; descricao: string | null; unidade: string | null; tipo_item: string | null; familia: string | null
  consumo_total: number; estoque_atual: number; estoque_minimo: number; lead_time: number | null
  entrada_nf: number; entrada_ops: number; entrada_pedidos: number; consumo_ops: number; previsao_qtde: number; previsao_dias: number
  tem_ficha: boolean; fornecedor_id: number | null; fornecedor_nome: string | null; fornecedor_cnpj: string | null
  ultimo_custo: number | null; ultima_compra: string | null
  /** custo médio do produto (Omie: CMC da foto; próprio: estoque_custos) */
  cmc?: number | null
}

export type LinhaSugestao = LinhaCalculada & {
  codigoProduto: number; codigo: string; descricao: string; unidade: string; tipoItem: string | null; familia: string
  acao: AcaoSugestao; rotulo: string; estoqueMinimo: number; estoqueAtual: number; leadTimeInformado: boolean
  entradaNf: number; entradaOps: number; entradaPedidos: number; previsaoVenda: number | null; consumoOps: number
  fornecedorId: number | null; fornecedorNome: string | null; fornecedorCnpj: string | null
  ultimoCusto: number | null; ultimaCompra: string | null; custoMedio: number | null; valorEstimado: number
}

const n0 = (v: unknown) => {
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}

export function montarLinhasSugestao(
  brutas: LinhaBruta[],
  p: { diasAnalise: number; diasEstimativa: number; base: BaseProjecao; pedidosExtra?: Map<number, number> },
): LinhaSugestao[] {
  return brutas.map((b) => {
    const entradaPedidos = n0(b.entrada_pedidos) + (p.pedidosExtra?.get(Number(b.codigo_produto)) ?? 0)
    const entrada = n0(b.entrada_nf) + n0(b.entrada_ops) + entradaPedidos
    const prevVenda = n0(b.previsao_dias) > 0 && n0(b.previsao_qtde) > 0 ? r6((n0(b.previsao_qtde) / n0(b.previsao_dias)) * p.diasEstimativa) : null
    const calc = calcularSugestao({
      consumoTotal: n0(b.consumo_total), estoqueMinimo: n0(b.estoque_minimo), estoqueAtual: n0(b.estoque_atual),
      leadTime: b.lead_time == null ? null : n0(b.lead_time), entradaPrevista: entrada,
      saidaPrevista: saidaPrevistaPelaPrevisao(n0(b.previsao_qtde), n0(b.previsao_dias), p.diasEstimativa, n0(b.consumo_ops)),
    }, p)
    const acao = acaoDoProduto(b.tipo_item, !!b.tem_ficha)
    const custo = b.ultimo_custo == null ? null : n0(b.ultimo_custo)
    const cmc = b.cmc == null ? null : n0(b.cmc)
    // valor estimado pelo custo médio (no Omie a conversão de unidade da nota às vezes vem errada); sem ele, o último custo
    const custoRef = cmc ?? custo
    return {
      ...calc,
      codigoProduto: Number(b.codigo_produto), codigo: b.codigo ?? String(b.codigo_produto), descricao: b.descricao ?? '(sem descrição)',
      unidade: b.unidade ?? 'UN', tipoItem: b.tipo_item, familia: b.familia ?? 'Sem família', acao, rotulo: rotuloRecomendacao(calc.recomendacao, acao),
      estoqueMinimo: n0(b.estoque_minimo), estoqueAtual: n0(b.estoque_atual), leadTimeInformado: b.lead_time != null && n0(b.lead_time) > 0,
      entradaNf: n0(b.entrada_nf), entradaOps: n0(b.entrada_ops), entradaPedidos, previsaoVenda: prevVenda, consumoOps: n0(b.consumo_ops),
      fornecedorId: b.fornecedor_id == null ? null : Number(b.fornecedor_id), fornecedorNome: b.fornecedor_nome, fornecedorCnpj: b.fornecedor_cnpj,
      ultimoCusto: custo, ultimaCompra: b.ultima_compra, custoMedio: cmc,
      valorEstimado: custoRef != null && acao === 'comprar' ? Math.round(calc.sugestao * custoRef * 100) / 100 : 0,
    }
  })
}

export type FiltroSugestao = { q?: string; tipos?: string[]; familia?: string; ver?: string; acao?: string; fornecedor?: string }

const semAcento = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
const ORDEM_REC: Record<Recomendacao, number> = { imediato: 0, proximos: 1, nao: 2 }

/** Filtros da tela; ver = 'acao' (padrão: comprar/produzir), 'imediato' ou 'todos'. Ordem do Omie: recomendação, depois dias até o ponto. */
export function filtrarSugestao(linhas: LinhaSugestao[], f: FiltroSugestao): LinhaSugestao[] {
  const q = semAcento((f.q ?? '').trim())
  const ver = f.ver === 'todos' || f.ver === 'imediato' ? f.ver : 'acao'
  return linhas
    .filter((l) => (f.tipos?.length ? f.tipos.includes(l.tipoItem ?? '') : tipoPadraoIncluido(l.tipoItem)))
    .filter((l) => !f.familia || l.familia === f.familia)
    .filter((l) => !f.acao || l.acao === f.acao)
    .filter((l) => !f.fornecedor || (l.fornecedorNome ?? '') === f.fornecedor)
    .filter((l) => ver === 'todos' || (ver === 'imediato' ? l.recomendacao === 'imediato' : l.recomendacao !== 'nao'))
    .filter((l) => !q || semAcento(l.descricao).includes(q) || semAcento(l.codigo).includes(q))
    .sort((a, b) => ORDEM_REC[a.recomendacao] - ORDEM_REC[b.recomendacao] || a.diasAtePonto - b.diasAtePonto || a.descricao.localeCompare(b.descricao, 'pt-BR'))
}

export function resumoSugestao(linhas: LinhaSugestao[]): { comprarJa: number; comprarProximos: number; produzirJa: number; produzirProximos: number; valorEstimado: number; semCusto: number } {
  const r = { comprarJa: 0, comprarProximos: 0, produzirJa: 0, produzirProximos: 0, valorEstimado: 0, semCusto: 0 }
  for (const l of linhas) {
    if (l.recomendacao === 'nao') continue
    if (l.acao === 'comprar') {
      if (l.recomendacao === 'imediato') r.comprarJa++
      else r.comprarProximos++
      r.valorEstimado += l.valorEstimado
      if (l.ultimoCusto == null && l.custoMedio == null) r.semCusto++
    } else if (l.recomendacao === 'imediato') r.produzirJa++
    else r.produzirProximos++
  }
  r.valorEstimado = Math.round(r.valorEstimado * 100) / 100
  return r
}
