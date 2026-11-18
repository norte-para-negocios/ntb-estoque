// Gabarito do faturamento e do CMV (ticket 08): conta independente, SÓ função pura (sem banco, sem navegador, sem função, view
// nem RPC do ERP). Regras de negócio em palavras (não copiadas do ERP):
//  - Faturamento do dia = soma do valor das vendas (cupons) do dia. Venda cancelada nunca conta. Loja de estoque próprio (Norte
//    Vendas) também não conta a devolvida; loja Omie conta (a devolução entra como faturamento e o Omie a abate à parte).
//    Faturamento do mês = soma dos dias do mês.
//  - Custo de um produto, no instante da venda = custo médio vigente nesse instante (série do ledger, a última linha antes da
//    venda), quando ele não tem ficha técnica; com ficha técnica, soma de (quantidade bruta ÷ rendimento) x custo de cada insumo,
//    quantidade bruta = líquida x fator x (1 + perda%) com 6 casas; insumo que é preparação e "expande na venda" desce pela ficha
//    dele. Insumo sem custo custa zero e conta como "sem custo".
//  - CMV de uma linha vendida = quantidade x (custo do produto + custo de cada componente/opção ligado à linha), cada
//    componente na mesma quantidade da linha. Serviço (tipo 09) e taxa de serviço não têm custo.
//  - CMV do mês = soma das linhas das vendas válidas do mês.
//  - Loja Omie sem ficha local: CMV estimado = quantidade vendida x custo médio de hoje do produto (média dos locais com saldo
//    positivo ponderada pelo saldo; sem saldo, o custo do produto geral; sem ele, o maior custo válido). Custo de hoje maior que o
//    preço médio de venda no período é custo fora do normal: o produto fica com custo zero e é contado à parte.
// Decimais em BigInt com 9 casas; texto decimal entra e sai. Arredondamento meia para longe do zero.
import { parseDec, fmtDec, type Dec } from './saldo-gabarito.ts'

const E = 10n ** 9n
const abs = (n: bigint) => (n < 0n ? -n : n)
const mul = (a: Dec, b: Dec): Dec => div(a * b, E)
/** a / b arredondado meia para longe do zero (b <> 0). */
function div(a: bigint, b: bigint): bigint {
  const neg = (a < 0n) !== (b < 0n)
  const q = (abs(a) * 2n + abs(b)) / (abs(b) * 2n)
  return neg ? -q : q
}
/** 9 casas -> n casas (meia para longe do zero). */
export function arredondar(d: Dec, casas: number): Dec {
  const f = 10n ** BigInt(9 - casas)
  return div(d, f) * f
}
export const centavos = (d: Dec): bigint => div(d, E / 100n) // 9 casas -> centavos
export const dec = parseDec
export const texto = fmtDec

// ---------- Faturamento ----------
export type ModoLoja = 'omie' | 'proprio'
export type Venda = { data: string; valor: string; cancelado: boolean; devolvido: boolean }

/** A venda entra no faturamento? Cancelada nunca; devolvida só na loja Omie. */
export const contaNoFaturamento = (v: { cancelado: boolean; devolvido: boolean }, modo: ModoLoja) => !v.cancelado && (modo === 'omie' || !v.devolvido)

export function faturamentoPorDia(vendas: Venda[], modo: ModoLoja): Map<string, Dec> {
  const m = new Map<string, Dec>()
  for (const v of vendas) if (contaNoFaturamento(v, modo)) m.set(v.data, (m.get(v.data) ?? 0n) + parseDec(v.valor))
  return m
}
export function faturamentoPorMes(porDia: Map<string, Dec>): Map<string, Dec> {
  const m = new Map<string, Dec>()
  for (const [d, v] of porDia) m.set(d.slice(0, 7), (m.get(d.slice(0, 7)) ?? 0n) + v)
  return m
}
export const somar = (xs: Iterable<Dec>): Dec => { let s = 0n; for (const x of xs) s += x; return s }

// ---------- CMV: custo no instante ----------
export type Marco = { d: string; id: number } // data efetiva e id do movimento: "antes de" na ordem do ledger
export type SerieCusto = Map<string, { d: string; id: number; cmc: string }[]> // por produto, ordenada por (d, id)

const antes = (x: { d: string; id: number }, m: Marco) => x.d < m.d || (x.d === m.d && x.id < m.id)

/** Custo médio vigente do produto logo antes do marco, ou null se nunca teve custo. */
export function cmcNoMarco(serie: SerieCusto, produto: string, marco: Marco): Dec | null {
  const s = serie.get(produto)
  if (!s) return null
  // pesquisa binária: última linha antes do marco
  let lo = 0, hi = s.length - 1, r = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (antes(s[mid], marco)) { r = mid; lo = mid + 1 } else hi = mid - 1
  }
  if (r < 0) return null
  const c = parseDec(s[r].cmc)
  return c > 0n ? c : null
}

export type ItemFicha = { insumo: string; liquida: string; fator: string; perda: string }
export type Ficha = { rendimento: string; expandir: boolean; itens: ItemFicha[] }
export type Fichas = Map<string, Ficha>

/** Quantidade bruta (6 casas) = líquida x fator x (1 + perda/100). */
export function quantidadeBruta(i: ItemFicha): Dec {
  return arredondar(mul(mul(parseDec(i.liquida), parseDec(i.fator)), E + div(parseDec(i.perda), 100n)), 6)
}

export type CustoCalculado = { custo: Dec; semCusto: number }

/** Custo de UMA unidade do produto no marco. `servicos`: códigos que não mexem no estoque (custo zero, sem alerta). */
export function custoUnitario(cod: string, fichas: Fichas, serie: SerieCusto, marco: Marco, servicos: Set<string> = new Set()): CustoCalculado {
  if (servicos.has(cod)) return { custo: 0n, semCusto: 0 }
  const folha = (c: string): CustoCalculado => {
    const x = cmcNoMarco(serie, c, marco)
    return x == null ? { custo: 0n, semCusto: 1 } : { custo: x, semCusto: 0 }
  }
  const descer = (c: string, nivel: number): CustoCalculado => {
    const f = fichas.get(c)
    if (!f || nivel > 8) return folha(c)
    const rend = parseDec(f.rendimento)
    let soma = 0n, sem = 0
    for (const i of f.itens) {
      const filho = fichas.get(i.insumo)
      const x = filho?.expandir && nivel < 8 ? descer(i.insumo, nivel + 1) : folha(i.insumo)
      soma += mul(div(quantidadeBruta(i) * E, rend), x.custo)
      sem += x.semCusto
    }
    return { custo: soma, semCusto: sem }
  }
  return descer(cod, 0)
}

export type LinhaVenda = {
  vendaId: number; data: string; marco: Marco
  codigo: string | null; nome: string; quantidade: string; valor: string
  componentes: string[]
  taxa: boolean // taxa de serviço: nunca tem custo
  semBaixa: boolean // o ERP não gravou nenhuma saída de estoque para esta linha (informado pelo robô a partir do ledger)
}

/** CMV de uma linha vendida: quantidade x (custo do produto + custo de cada componente). */
export function cmvDaLinha(l: LinhaVenda, fichas: Fichas, serie: SerieCusto, servicos: Set<string>): CustoCalculado {
  if (l.taxa) return { custo: 0n, semCusto: 0 }
  const q = parseDec(l.quantidade)
  let custo = 0n, sem = 0
  for (const c of [...(l.codigo ? [l.codigo] : []), ...l.componentes]) {
    const x = custoUnitario(c, fichas, serie, l.marco, servicos)
    custo += mul(q, x.custo)
    sem += x.semCusto
  }
  return { custo, semCusto: sem }
}

export type LinhaResultado = { rotulo: string; quantidade: Dec; faturamento: Dec; cmv: Dec; cmvSemBaixa: Dec; linhasSemBaixa: number; semCusto: number }

/** CMV por rótulo (produto) no período. `rotulo(l)` diz em que linha da tela a venda cai. */
export function cmvPorRotulo(linhas: LinhaVenda[], fichas: Fichas, serie: SerieCusto, servicos: Set<string>, rotulo: (l: LinhaVenda) => string): Map<string, LinhaResultado> {
  const m = new Map<string, LinhaResultado>()
  for (const l of linhas) {
    const k = rotulo(l)
    const r = m.get(k) ?? { rotulo: k, quantidade: 0n, faturamento: 0n, cmv: 0n, cmvSemBaixa: 0n, linhasSemBaixa: 0, semCusto: 0 }
    const c = cmvDaLinha(l, fichas, serie, servicos)
    r.quantidade += parseDec(l.quantidade)
    r.faturamento += parseDec(l.valor)
    r.cmv += c.custo
    r.semCusto += c.semCusto
    if (l.semBaixa && c.custo > 0n) { r.cmvSemBaixa += c.custo; r.linhasSemBaixa++ }
    m.set(k, r)
  }
  return m
}

// ---------- CMV estimado (loja Omie sem ficha local) ----------
export type FotoCusto = { produto: string; local: number; saldo: string; cmc: string }

/** Custo médio de hoje por produto: locais com saldo positivo ponderados pelo saldo; senão o do local 0 (geral); senão o maior. */
export function custoMedioDeHoje(foto: FotoCusto[]): Map<string, Dec> {
  const g = new Map<string, { valor: Dec; saldo: Dec; geral: Dec | null; maior: Dec | null }>()
  for (const f of foto) {
    const cmc = parseDec(f.cmc), saldo = parseDec(f.saldo)
    const x = g.get(f.produto) ?? { valor: 0n, saldo: 0n, geral: null, maior: null }
    if (cmc > 0n && cmc < 10_000_000n * E) {
      if (f.local === 0) x.geral = cmc
      else {
        if (saldo > 0n) { x.valor += mul(saldo, cmc); x.saldo += saldo }
        if (x.maior == null || cmc > x.maior) x.maior = cmc
      }
    }
    g.set(f.produto, x)
  }
  const out = new Map<string, Dec>()
  for (const [p, x] of g) {
    const c = x.saldo > 0n ? div(x.valor * E, x.saldo) : (x.geral ?? x.maior)
    if (c != null) out.set(p, arredondar(c, 6))
  }
  return out
}

export type ItemCupom = { produto: string | null; rotulo: string; quantidade: string; valor: string }
export type LinhaEstimada = LinhaResultado & { foraDoNormal: boolean; semCustoMedio: boolean }

export function cmvEstimado(itens: ItemCupom[], custo: Map<string, Dec>): Map<string, LinhaEstimada> {
  const m = new Map<string, LinhaEstimada>()
  for (const i of itens) {
    const k = i.produto != null ? i.produto : `nome:${i.rotulo}`
    const r = m.get(k) ?? { rotulo: i.rotulo, quantidade: 0n, faturamento: 0n, cmv: 0n, cmvSemBaixa: 0n, linhasSemBaixa: 0, semCusto: 0, foraDoNormal: false, semCustoMedio: false }
    r.quantidade += parseDec(i.quantidade)
    r.faturamento += parseDec(i.valor)
    m.set(k, r)
  }
  for (const [k, r] of m) {
    let c: Dec | undefined = k.startsWith('nome:') ? undefined : custo.get(k)
    const preco = r.quantidade > 0n ? div(r.faturamento * E, r.quantidade) : 0n
    if (c != null && preco > 0n && c > preco) { r.foraDoNormal = true; c = undefined }
    else if (c == null) r.semCustoMedio = true
    r.cmv = mul(c ?? 0n, r.quantidade)
  }
  return m
}

// ---------- Comparação e decomposição ----------
export type Contribuinte = { rotulo: string; tela: Dec; gabarito: Dec; diferenca: Dec; causa: string }

/** Linhas cuja diferença (tela − gabarito) passa da tolerância, a maior diferença primeiro. */
export function decompor(tela: Map<string, Dec>, gab: Map<string, Dec>, tolerancia: Dec, causaDe: (rotulo: string, dif: Dec) => string = () => ''): Contribuinte[] {
  const out: Contribuinte[] = []
  for (const k of new Set([...tela.keys(), ...gab.keys()])) {
    const t = tela.get(k) ?? 0n, g = gab.get(k) ?? 0n
    const d = t - g
    if (abs(d) > tolerancia) out.push({ rotulo: k, tela: t, gabarito: g, diferenca: d, causa: causaDe(k, d) })
  }
  return out.sort((a, b) => (abs(b.diferenca) > abs(a.diferenca) ? 1 : abs(b.diferenca) < abs(a.diferenca) ? -1 : a.rotulo < b.rotulo ? -1 : 1))
}

export const iguaisAte = (a: Dec, b: Dec, tolerancia: Dec) => abs(a - b) <= tolerancia
export const modulo = abs
