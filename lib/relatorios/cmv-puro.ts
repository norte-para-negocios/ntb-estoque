// CMV/CPV para todas as lojas (matriz N9). Três fontes, escolhidas por loja e período:
//  - proprio: custo de cada baixa do ledger (lucro_proprio, migrations 142/150/183);
//  - kardex: loja Omie com o espelho do kardex cobrindo o período inteiro: valor de cada movimento (RPC 187);
//  - estimado: loja Omie sem kardex no período: quantidade vendida (cupons) × custo médio de hoje (foto mais recente).
//    O Omie não guarda custo histórico em nenhuma outra tabela espelhada (movimentos.valor das saídas do PDV é o preço
//    de venda; margem_snapshot_diario não tem CMC de saldo negativo), por isso a tela avisa que é estimativa.
// Puro, sem imports: node --test lib/relatorios/cmv-puro.test.ts

export type FonteCmv = 'proprio' | 'kardex' | 'estimado'
export type DimCmv = 'produto' | 'familia' | 'tipo'
export type LinhaCmv = {
  chave: string; rotulo: string; familia: string; tipoCod: string; tipo: string
  quant: number; faturamento: number; cmv: number; consumo: number
  ei: number; compras: number; producao: number; ef: number; outrasEntradas: number; outrasSaidas: number; semCusto: number; custoSuspeito: number
  quebra: number // quantidade que o saldo do kardex 'pulou' sem movimento no espelho (0 = cadeia íntegra)
}
export type VendaItem = { idProduto: number | null; produto: string; familia: string; tipoCod: string; tipo: string; quant: number; valor: number }
export type LinhaRpcCmv = {
  n_cod_prod: number; ei: number; compras: number; producao: number; outras_entradas: number; vendas: number
  qtd_vendida: number; consumo_op: number; outras_saidas: number; ef: number; sem_custo: number; quebra?: number
}
export type MetaCmv = { rotulo: string; familia: string; tipoCod: string; tipo: string }

const r2 = (n: number) => Math.round(n * 100) / 100
const r6 = (n: number) => Math.round(n * 1e6) / 1e6
const custoValido = (c: number) => Number.isFinite(c) && c > 0 && c < 1e7

export function escolherFonteCmv(a: { modo: 'omie' | 'proprio' | 'nenhum'; kardexDesde: string | null; kardexAte: string | null; ini: string; fim: string }): FonteCmv {
  if (a.modo === 'proprio') return 'proprio'
  if (a.modo === 'omie' && a.kardexDesde && a.kardexAte && a.kardexDesde <= a.ini && a.fim <= a.kardexAte) return 'kardex'
  return 'estimado'
}

/** Período que a "Movimentação pelo valor do movimento" consegue mostrar: loja própria = o pedido; loja Omie = a parte
 *  do pedido coberta pelo histórico completo do kardex (null se nada). `cortado` = o pedido foi reduzido. */
export function periodoValorMovimento(a: { modo: 'omie' | 'proprio' | 'nenhum'; kardexDesde: string | null; kardexAte: string | null; ini: string; fim: string }): { ini: string; fim: string; cortado: boolean } | null {
  if (a.modo === 'proprio') return { ini: a.ini, fim: a.fim, cortado: false }
  if (a.modo !== 'omie' || !a.kardexDesde || !a.kardexAte) return null
  const ini = a.ini > a.kardexDesde ? a.ini : a.kardexDesde
  const fim = a.fim < a.kardexAte ? a.fim : a.kardexAte
  return ini <= fim ? { ini, fim, cortado: ini !== a.ini || fim !== a.fim } : null
}

/** CMC de hoje por produto: média dos locais com saldo positivo; senão o da sentinela (local 0); senão o maior válido. */
export function custoMedioAtual(foto: { n_cod_prod: number; codigo_local_estoque: number; n_saldo: number; n_cmc: number }[]): Map<number, number> {
  const g = new Map<number, { valor: number; saldo: number; sentinela: number | null; maior: number | null }>()
  for (const f of foto) {
    const cod = Number(f.n_cod_prod), cmc = Number(f.n_cmc) || 0, saldo = Number(f.n_saldo) || 0
    const x = g.get(cod) ?? { valor: 0, saldo: 0, sentinela: null, maior: null }
    if (custoValido(cmc)) {
      if (Number(f.codigo_local_estoque) === 0) x.sentinela = cmc
      else {
        if (saldo > 0) { x.valor += saldo * cmc; x.saldo += saldo }
        x.maior = Math.max(x.maior ?? 0, cmc)
      }
    }
    g.set(cod, x)
  }
  const out = new Map<number, number>()
  for (const [cod, x] of g) {
    const c = x.saldo > 0 ? x.valor / x.saldo : (x.sentinela ?? x.maior)
    if (c != null && custoValido(c)) out.set(cod, r6(c))
  }
  return out
}

export function linhaVazia(chave: string, rotulo: string, m?: Partial<MetaCmv>): LinhaCmv {
  return {
    chave, rotulo, familia: m?.familia ?? 'Sem família', tipoCod: m?.tipoCod ?? '', tipo: m?.tipo ?? 'Não classificado',
    quant: 0, faturamento: 0, cmv: 0, consumo: 0, ei: 0, compras: 0, producao: 0, ef: 0, outrasEntradas: 0, outrasSaidas: 0, semCusto: 0, custoSuspeito: 0, quebra: 0,
  }
}

const chaveVenda = (v: VendaItem) => (v.idProduto != null ? String(v.idProduto) : `nome:${v.produto}`)

function faturamentoPorProduto(vendas: VendaItem[]): Map<string, LinhaCmv> {
  const m = new Map<string, LinhaCmv>()
  for (const v of vendas) {
    const k = chaveVenda(v)
    const l = m.get(k) ?? linhaVazia(k, v.produto, { familia: v.familia, tipoCod: v.tipoCod, tipo: v.tipo })
    l.faturamento += v.valor
    l.quant += v.quant
    m.set(k, l)
  }
  return m
}

export function montarLinhasEstimado(vendas: VendaItem[], custo: Map<number, number>): LinhaCmv[] {
  const m = faturamentoPorProduto(vendas)
  for (const l of m.values()) {
    let c = l.chave.startsWith('nome:') ? undefined : custo.get(Number(l.chave))
    // custo de hoje acima do preço médio de venda = custo fora do normal (o CMC de prato do Omie salta, E14;
    // loja 5, 12/09–13/10: 18 produtos, ex. 774,32 hoje contra 33,58 no kardex): fica de fora e é contado
    const preco = l.quant > 0 ? l.faturamento / l.quant : 0
    if (c != null && preco > 0 && c > preco) { l.custoSuspeito = 1; c = undefined }
    else if (c == null) l.semCusto = 1
    l.cmv = r2((c ?? 0) * l.quant)
    l.faturamento = r2(l.faturamento)
    l.quant = r6(l.quant)
  }
  return [...m.values()]
}

export function montarLinhasKardex(rpc: LinhaRpcCmv[], vendas: VendaItem[], meta: Map<number, MetaCmv>): LinhaCmv[] {
  const m = faturamentoPorProduto(vendas)
  for (const l of m.values()) l.quant = 0 // a quantidade vendida vem do kardex (saídas de venda)
  for (const r of rpc) {
    const k = String(r.n_cod_prod)
    const md = meta.get(Number(r.n_cod_prod))
    const l = m.get(k) ?? linhaVazia(k, md?.rotulo ?? `Produto ${k}`, md)
    l.cmv = Number(r.vendas) || 0
    l.quant = Number(r.qtd_vendida) || 0
    l.consumo = Number(r.consumo_op) || 0
    l.ei = Number(r.ei) || 0
    l.compras = Number(r.compras) || 0
    l.producao = Number(r.producao) || 0
    l.ef = Number(r.ef) || 0
    l.outrasEntradas = Number(r.outras_entradas) || 0
    l.outrasSaidas = Number(r.outras_saidas) || 0
    l.semCusto = Number(r.sem_custo) || 0
    l.quebra = Number(r.quebra) || 0
    m.set(k, l)
  }
  // venda sem nenhuma saída no kardex (ex.: taxa de serviço, produto que não baixa estoque): custo zero, contado
  const noKardex = new Set(rpc.map((r) => String(r.n_cod_prod)))
  for (const l of m.values()) {
    l.faturamento = r2(l.faturamento)
    if (l.faturamento > 0 && !noKardex.has(l.chave)) l.semCusto = 1
  }
  return [...m.values()]
}

/** EI + C + P − EF (fórmula do relatório CMV/CPV do Omie). */
export const cmvFormulaOmie = (l: Pick<LinhaCmv, 'ei' | 'compras' | 'producao' | 'ef'>) => r2(l.ei + l.compras + l.producao - l.ef)

/** Totais da fórmula EI + C + P − EF sem os produtos com quebra na cadeia do kardex (o EF deles carrega um saldo que
 *  "pulou" sem movimento no espelho, ex. azeitona da loja 5: R$ 449,7 mil de EF falso). Vendas/consumo não mudam. */
export function totaisFormula(linhas: LinhaCmv[], incluiTipo: (tipoCod: string) => boolean): { semQuebra: number; foraDoTotal: number; quebrados: { rotulo: string; quebra: number; formula: number }[] } {
  let semQuebra = 0, foraDoTotal = 0
  const quebrados: { rotulo: string; quebra: number; formula: number }[] = []
  for (const l of linhas) {
    if (!incluiTipo(l.tipoCod)) continue
    const f = cmvFormulaOmie(l)
    if (l.quebra > 0.01) { foraDoTotal += f; quebrados.push({ rotulo: l.rotulo, quebra: l.quebra, formula: f }) }
    else semQuebra += f
  }
  quebrados.sort((a, b) => Math.abs(b.formula) - Math.abs(a.formula) || a.rotulo.localeCompare(b.rotulo, 'pt-BR'))
  return { semQuebra: r2(semQuebra), foraDoTotal: r2(foraDoTotal), quebrados }
}

const CAMPOS = ['quant', 'faturamento', 'cmv', 'consumo', 'ei', 'compras', 'producao', 'ef', 'outrasEntradas', 'outrasSaidas', 'semCusto', 'custoSuspeito', 'quebra'] as const

export function agruparCmv(linhas: LinhaCmv[], por: DimCmv): LinhaCmv[] {
  let out: LinhaCmv[]
  if (por === 'produto') out = linhas.map((l) => ({ ...l }))
  else {
    const g = new Map<string, LinhaCmv>()
    for (const l of linhas) {
      const k = por === 'familia' ? l.familia : (l.tipoCod || '_')
      const x = g.get(k) ?? linhaVazia(k, por === 'familia' ? l.familia : l.tipo, { familia: l.familia, tipoCod: l.tipoCod, tipo: l.tipo })
      for (const c of CAMPOS) x[c] += l[c]
      g.set(k, x)
    }
    out = [...g.values()]
  }
  for (const l of out) for (const c of CAMPOS) l[c] = c === 'quant' || c === 'quebra' ? r6(l[c]) : c === 'semCusto' || c === 'custoSuspeito' ? l[c] : r2(l[c])
  return out.sort((a, b) => b.cmv - a.cmv || b.faturamento - a.faturamento || a.rotulo.localeCompare(b.rotulo, 'pt-BR'))
}

export function resumoCmv(linhas: LinhaCmv[]): { faturamento: number; cmv: number; margem: number; margemPct: number | null; consumo: number; semCusto: number; custoSuspeito: number; faturamentoSuspeito: number } {
  let faturamento = 0, cmv = 0, consumo = 0, semCusto = 0, custoSuspeito = 0, faturamentoSuspeito = 0
  for (const l of linhas) {
    faturamento += l.faturamento; cmv += l.cmv; consumo += l.consumo; semCusto += l.semCusto; custoSuspeito += l.custoSuspeito
    if (l.custoSuspeito) faturamentoSuspeito += l.faturamento
  }
  return {
    faturamento: r2(faturamento), cmv: r2(cmv), margem: r2(faturamento - cmv), consumo: r2(consumo), semCusto, custoSuspeito, faturamentoSuspeito: r2(faturamentoSuspeito),
    margemPct: faturamento > 0 ? Math.round(((faturamento - cmv) / faturamento) * 1000) / 10 : null,
  }
}
