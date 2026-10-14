// Saúde do estoque ("nosso Omie" Fase 2): regras puras de classificação.
// Sem imports de valor: node --test lib/estoque/saude-puro.test.ts.
// Limiares (ver plano 2026-10-13-nosso-omie-fase2-3): custo absurdo = CMC >= R$ 1.000/un ou >= 20x o anterior;
// salto recente = CMC >= 10x o anterior no mesmo local (mesma regra do marcador "salto" do kardex);
// contagem que oscila = duas contagens seguidas do mesmo produto/local com razão >= 3 ou indo a zero.

export const CUSTO_ABSURDO_MIN = 1000
export const CUSTO_ABSURDO_VEZES = 20
export const SALTO_VEZES = 10
export const OSCILACAO_VEZES = 3
const TIPOS_PRODUCAO = new Set(['03', '04'])

/** Um movimento com o saldo/custo médio logo depois dele (kardex do Omie ou ledger próprio). */
export type MovSaldo = { data: string; ordem: number; local: number; saldo: number | null; cmc: number | null }

const ordenar = <T extends { data: string; ordem: number }>(l: T[]) =>
  [...l].sort((a, b) => a.data.localeCompare(b.data) || a.ordem - b.ordem)

function porLocal(movs: MovSaldo[]): Map<number, MovSaldo[]> {
  const m = new Map<number, MovSaldo[]>()
  for (const x of ordenar(movs)) {
    const arr = m.get(x.local) ?? []
    arr.push(x)
    m.set(x.local, arr)
  }
  return m
}

export function custoAbsurdo(cmc: number | null, anterior: number | null): 'alto' | 'salto20' | null {
  if (cmc == null || !(cmc > 0)) return null
  if (cmc >= CUSTO_ABSURDO_MIN) return 'alto'
  if (anterior != null && anterior > 0 && cmc >= anterior * CUSTO_ABSURDO_VEZES) return 'salto20'
  return null
}

/** Por local negativo no último movimento: a data do 1º movimento do trecho negativo atual. */
export function negativoDesde(movs: MovSaldo[]): Map<number, string> {
  const r = new Map<number, string>()
  for (const [local, lista] of porLocal(movs)) {
    let inicio: string | null = null
    for (const x of lista) {
      if (x.saldo == null) continue
      if (x.saldo < 0) inicio ??= x.data
      else inicio = null
    }
    if (inicio != null) r.set(local, inicio)
  }
  return r
}

/** Movimentos desde `desde` cujo CMC é >= 10x o último CMC > 0 do mesmo local. */
export function saltosRecentes(movs: MovSaldo[], desde: string): { local: number; data: string; de: number; para: number }[] {
  const r: { local: number; data: string; de: number; para: number }[] = []
  for (const [local, lista] of porLocal(movs)) {
    let ant: number | null = null
    for (const x of lista) {
      const c = x.cmc ?? 0
      if (!(c > 0)) continue
      if (ant != null && c >= ant * SALTO_VEZES && x.data >= desde) r.push({ local, data: x.data, de: ant, para: c })
      ant = c
    }
  }
  return r
}

/** Por local: o último CMC > 0 e o CMC > 0 do movimento anterior a ele. */
export function ultimoCmcAnterior(movs: MovSaldo[]): Map<number, { atual: number; anterior: number | null }> {
  const r = new Map<number, { atual: number; anterior: number | null }>()
  for (const [local, lista] of porLocal(movs)) {
    const cmcs = lista.map((x) => x.cmc ?? 0).filter((c) => c > 0)
    if (cmcs.length) r.set(local, { atual: cmcs[cmcs.length - 1], anterior: cmcs.length > 1 ? cmcs[cmcs.length - 2] : null })
  }
  return r
}

export type Contagem = { produto: number; local: number; data: string; ordem: number; qtd: number }

export function oscilacoesContagem(c: Contagem[]): { produto: number; local: number; data: string; de: number; para: number }[] {
  const grupos = new Map<string, Contagem[]>()
  for (const x of ordenar(c)) {
    const k = `${x.produto}:${x.local}`
    const arr = grupos.get(k) ?? []
    arr.push(x)
    grupos.set(k, arr)
  }
  const r: { produto: number; local: number; data: string; de: number; para: number }[] = []
  for (const lista of grupos.values()) {
    for (let i = 1; i < lista.length; i++) {
      const a = lista[i - 1].qtd, b = lista[i].qtd
      const oscila = a > 0 && b > 0 ? Math.max(a, b) / Math.min(a, b) >= OSCILACAO_VEZES : (a > 0) !== (b > 0) && (a > 0 || b > 0)
      if (oscila) r.push({ produto: lista[i].produto, local: lista[i].local, data: lista[i].data, de: a, para: b })
    }
  }
  return r.sort((x, y) => x.produto - y.produto || x.data.localeCompare(y.data))
}

const osc = (a: number, b: number) => (a > 0 && b > 0 ? Math.max(a, b) / Math.min(a, b) >= OSCILACAO_VEZES : (a > 0) !== (b > 0) && (a > 0 || b > 0))
/** A anterior parece a vírgula no lugar errado (5,5 digitado 5.500) e a última é a certa. */
const anteriorEraVirgula = (de: number, para: number) => de >= 1000 && para > 0 && de / para >= 500

/**
 * Contagem estranha que ainda vale: só a ÚLTIMA contagem de cada produto/local, e só quando ela é o erro. Não entra
 * a contagem que desfez um erro anterior (voltou ao nível de antes, ou a anterior tinha cara de vírgula errada).
 */
export function contagemSuspeitaAtual(c: Contagem[]): { produto: number; local: number; data: string; de: number; para: number }[] {
  const grupos = new Map<string, Contagem[]>()
  for (const x of ordenar(c)) {
    const k = `${x.produto}:${x.local}`
    const arr = grupos.get(k) ?? []
    arr.push(x)
    grupos.set(k, arr)
  }
  const r: { produto: number; local: number; data: string; de: number; para: number }[] = []
  for (const lista of grupos.values()) {
    const n = lista.length
    if (n < 2) continue
    const L = lista[n - 1].qtd, P = lista[n - 2].qtd
    if (!osc(P, L)) continue
    if (n >= 3) {
      const Q = lista[n - 3].qtd
      if (osc(Q, P) && !osc(Q, L)) continue
    }
    if (anteriorEraVirgula(P, L)) continue
    r.push({ produto: lista[n - 1].produto, local: lista[n - 1].local, data: lista[n - 1].data, de: P, para: L })
  }
  return r.sort((x, y) => x.produto - y.produto)
}

export type OPAbertaMin = { id: number; produto: number | null; origem: string | null; local?: number | null }

/**
 * Sobrando: OP aberta do PDV (cupom) de produto com saldo >= 0. Faltando: PA/PI com saldo < 0 sem nenhuma OP aberta.
 * Com `saldosLocal` (chave `produto:local`), vale o saldo do LOCAL da OP (OP sem local = total) e faltando passa a ser
 * "prato negativo num local sem OP aberta naquele local" (OP sem local cobre todos).
 */
export function opsSobrandoFaltando(
  saldos: Map<number, number>, tipos: Map<number, string | null>, abertas: OPAbertaMin[], listaOk = true,
  saldosLocal?: Map<string, number>,
): { sobrando: OPAbertaMin[]; faltando: number[]; indisponivel: boolean } {
  // Sem a lista de OPs (erro de leitura), "sem OP" acusaria todo prato negativo: não classifica.
  if (!listaOk) return { sobrando: [], faltando: [], indisponivel: true }
  const saldoDaOP = (o: OPAbertaMin) => (saldosLocal && o.local ? (saldosLocal.get(`${o.produto}:${o.local}`) ?? 0) : (saldos.get(o.produto!) ?? 0))
  const sobrando = abertas.filter((o) => o.origem === 'cupom' && o.produto != null && saldos.has(o.produto) && saldoDaOP(o) >= 0)
  let faltando: number[]
  if (saldosLocal) {
    const cobreTudo = new Set(abertas.filter((o) => o.produto != null && !o.local).map((o) => o.produto as number))
    const comOPLocal = new Set(abertas.filter((o) => o.produto != null && o.local).map((o) => `${o.produto}:${o.local}`))
    const f = new Set<number>()
    for (const [chave, s] of saldosLocal) {
      const p = Number(chave.split(':')[0])
      if (s < 0 && TIPOS_PRODUCAO.has(tipos.get(p) ?? '') && !cobreTudo.has(p) && !comOPLocal.has(chave)) f.add(p)
    }
    faltando = [...f]
  } else {
    const comOP = new Set(abertas.map((o) => o.produto).filter((p): p is number => p != null))
    faltando = [...saldos.entries()].filter(([p, s]) => s < 0 && TIPOS_PRODUCAO.has(tipos.get(p) ?? '') && !comOP.has(p)).map(([p]) => p)
  }
  return { sobrando, faltando: faltando.sort((a, b) => a - b), indisponivel: false }
}

export type ItemFichaLocal = { produto: number; insumo: number; local: number | null }

/** Insumo de ficha sem custo médio > 0 no local de consumo (o Omie recusa concluir a OP: Client-193). */
export function insumosSemCustoNoLocal(itens: ItemFichaLocal[], cmcLocal: Map<string, number>): { insumo: number; local: number; pratos: number[] }[] {
  const m = new Map<string, { insumo: number; local: number; pratos: Set<number> }>()
  for (const it of itens) {
    if (it.local == null) continue
    const k = `${it.insumo}:${it.local}`
    if ((cmcLocal.get(k) ?? 0) > 0) continue
    const g = m.get(k) ?? { insumo: it.insumo, local: it.local, pratos: new Set<number>() }
    g.pratos.add(it.produto)
    m.set(k, g)
  }
  return [...m.values()]
    .map((g) => ({ insumo: g.insumo, local: g.local, pratos: [...g.pratos].sort((a, b) => a - b) }))
    .sort((a, b) => a.insumo - b.insumo || a.local - b.local)
}

/** PA/PI que vendeu e cuja ficha foi lida do Omie com 0 itens (produto ainda não lido não entra). */
export function produtosSemFichaQueVendem(vendidos: Set<number>, fichaLida: Map<number, number>, tipos: Map<number, string | null>): number[] {
  return [...vendidos].filter((p) => fichaLida.get(p) === 0 && TIPOS_PRODUCAO.has(tipos.get(p) ?? '')).sort((a, b) => a - b)
}

/** CMC por `produto:local` na foto mais recente de posicao_estoques que tem local real (local 0 é sentinela). */
export function cmcPorLocalAtual(posicoes: { data_posicao: string; codigo_local_estoque: number; n_cod_prod: number; n_cmc: number | null }[]): Map<string, number> {
  const datas = posicoes.filter((p) => Number(p.codigo_local_estoque) !== 0).map((p) => p.data_posicao).sort()
  const ultima = datas[datas.length - 1]
  const r = new Map<string, number>()
  if (!ultima) return r
  for (const p of posicoes) {
    if (p.data_posicao !== ultima || Number(p.codigo_local_estoque) === 0) continue
    r.set(`${Number(p.n_cod_prod)}:${Number(p.codigo_local_estoque)}`, Number(p.n_cmc ?? 0))
  }
  return r
}

/**
 * Texto do "negativo desde" honesto com a cobertura do histórico: sem histórico completo do kardex não há data;
 * se o trecho negativo começa no 1º movimento lido e o saldo antes dele já era negativo (ou não há movimento na
 * janela), ele começou antes do início da janela (`coberturaIni`).
 */
export function rotuloNegativoDesde(p: { desde: string | undefined; primeiraData: string | undefined; saldoAntesDaPrimeira: number | null; coberturaIni: string | null }):
  { tipo: 'sem_historico' | 'antes' | 'desde'; data: string | null } {
  if (!p.coberturaIni) return { tipo: 'sem_historico', data: null }
  if (!p.desde) return { tipo: 'antes', data: p.coberturaIni }
  if (p.desde === p.primeiraData && (p.saldoAntesDaPrimeira == null || p.saldoAntesDaPrimeira < 0)) return { tipo: 'antes', data: p.coberturaIni }
  return { tipo: 'desde', data: p.desde }
}

/**
 * Produtos que tiveram pelo menos 1 venda: uma consulta (com `limit(1)`) por produto, 10 por vez. Uma consulta por
 * lote com limite de linhas perdia produtos quando um deles vendia muito e ocupava o limite.
 */
export async function quaisVenderam(cods: number[], consulta: (cod: number) => PromiseLike<{ data: unknown[] | null }>): Promise<Set<number>> {
  const r = new Set<number>()
  for (let i = 0; i < cods.length; i += 10) {
    const res = await Promise.all(cods.slice(i, i + 10).map(async (c) => ({ c, vendeu: !!(await consulta(c)).data?.length })))
    for (const x of res) if (x.vendeu) r.add(x.c)
  }
  return r
}
