// Norte Cozinha, Cardápios: conta de cada prato no cardápio e do cardápio inteiro (PURO, node --test).
// Delivery: o app, o cartão e o imposto saem do preço e a embalagem entra no custo, então o CMV comparado com a meta é
// (custo + embalagem) ÷ (preço × o que sobra das taxas). Assim o preço sugerido de delivery dá exatamente a meta.
// @ts-expect-error: o node --test (type stripping) exige a extensão .ts; o tsc do Next não a aceita
import { arredondarPreco, precoReal, precoSugeridoDelivery, precoSugeridoSalao, situacao, sobraPorVenda, type Situacao, type Taxas } from './preco-puro.ts'

export const CANAIS = ['salao', 'delivery', 'evento'] as const
export type CanalCardapio = (typeof CANAIS)[number]
export const NOME_CANAL: Record<CanalCardapio, string> = { salao: 'Salão', delivery: 'Delivery', evento: 'Evento' }

export type ItemCalculo = {
  custo: number
  semCusto: number
  suspeitos: number
  precoCadastro: number | null
  /** Preço só deste cardápio (null = usa o do cadastro). */
  precoProprio: number | null
}

export type ContaItem = {
  preco: number | null
  /** De onde veio o preço. */
  fontePreco: 'proprio' | 'cadastro' | 'nenhum'
  cmv: number | null
  situacao: Situacao
  /** Preço que bate a meta neste canal, arredondado para ,90 (0 sem custo). */
  sugerido: number
  /** O que sobra por venda/pedido depois do custo e das taxas do canal. */
  sobra: number | null
}

const liquidoDelivery = (t: Taxas) => 1 - t.taxaDeliveryPct - t.taxaCartaoPct - t.impostoPct

/** Custo "equivalente" para a conta de CMV: no delivery, (custo + embalagem) ÷ líquido das taxas. */
export function custoNoCanal(custo: number, canal: CanalCardapio, t: Taxas): number {
  if (canal !== 'delivery') return custo
  const l = liquidoDelivery(t)
  return l > 0 ? (custo + t.embalagem) / l : custo + t.embalagem
}

export function contaDoItem(i: ItemCalculo, canal: CanalCardapio, t: Taxas): ContaItem {
  const proprio = precoReal(i.precoProprio) ? i.precoProprio : null
  const cadastro = precoReal(i.precoCadastro) ? i.precoCadastro : null
  const preco = proprio ?? cadastro
  const fontePreco = proprio != null ? 'proprio' : cadastro != null ? 'cadastro' : 'nenhum'
  const equivalente = custoNoCanal(i.custo, canal, t)
  const sit = situacao(equivalente, preco, i.semCusto, t, i.suspeitos)
  const sugeridoBruto = canal === 'delivery' ? precoSugeridoDelivery(i.custo, t) : precoSugeridoSalao(i.custo, t)
  return {
    preco, fontePreco,
    cmv: preco != null ? equivalente / preco : null,
    situacao: sit,
    sugerido: i.custo > 0 ? arredondarPreco(sugeridoBruto) : 0,
    sobra: preco != null ? sobraPorVenda(preco, i.custo, t, canal === 'delivery' ? 'delivery' : 'salao') : null,
  }
}

const confiavel = (s: Situacao) => s === 'ok' || s === 'atencao' || s === 'acima'

export type ResumoDoCardapio = {
  pratos: number
  /** CMV ponderado: soma dos custos ÷ soma dos preços (um de cada prato, só os confiáveis). */
  cmvCardapio: number | null
  /** CMV do prato típico (mediana). */
  cmvTipico: number | null
  acima: number
  atencao: number
  semPreco: number
  /** Sem custo, incompleto ou com custo a conferir. */
  aConferir: number
  melhor: number | null
  pior: number | null
  /** Índices a repreçar (acima ou perto da meta), do pior para o menos ruim. */
  reprecar: number[]
  /** Conjunto com as porções de cada prato (só pratos com preço e custo confiável). */
  custoTotal: number
  vendaTotal: number
  /** Venda − custo do conjunto (no delivery o custo inclui a embalagem). */
  margem: number | null
  /** Margem ÷ venda. */
  margemPct: number | null
  /** Margem ÷ custo: quanto volta para cada R$ 1 de ingrediente. */
  roi: number | null
  /** O que sobra do conjunto depois do custo e das taxas do canal. */
  sobraTotal: number | null
  /** Custo de todos os pratos com ficha × porções (inclusive os sem preço): base da participação. */
  custoConjunto: number
}

/** Porções válidas (> 0); qualquer outra coisa vale 1. */
export const porcoesValidas = (p: number | null | undefined) => (p != null && Number.isFinite(p) && p > 0 ? p : 1)

/** Parte de cada prato no custo do conjunto (custo × porções ÷ soma), na ordem recebida. Prato sem ficha vale 0. */
export function participacaoNoCusto(itens: { custo: number; porcoes?: number; semFicha?: boolean }[]): number[] {
  const custos = itens.map((i) => (i.semFicha ? 0 : Math.max(i.custo, 0) * porcoesValidas(i.porcoes)))
  const total = custos.reduce((a, c) => a + c, 0)
  return custos.map((c) => (total > 0 ? c / total : 0))
}

/** Lê porções digitadas ("2", "1,5"). null = inválido (precisa ser > 0 e até 1000, 3 casas). */
export function lerPorcoes(s: string): number | null {
  const v = Number(s.trim().replace(',', '.'))
  if (!Number.isFinite(v) || v <= 0 || v > 1000) return null
  return Math.round(v * 1000) / 1000
}

/**
 * Resumo de um cardápio a partir das contas dos itens (índices referem-se à lista recebida). Cada item entra com as suas
 * porções no conjunto (padrão 1): o CMV do cardápio é ponderado por elas.
 */
export function resumoDoCardapio(contas: { conta: ContaItem; custo: number; porcoes?: number; semFicha?: boolean }[], canal: CanalCardapio, t: Taxas): ResumoDoCardapio {
  const validos = contas.map((c, i) => ({ ...c, i, p: porcoesValidas(c.porcoes) })).filter((c) => confiavel(c.conta.situacao) && c.conta.preco != null && c.custo > 0)
  const somaCusto = validos.reduce((a, c) => a + custoNoCanal(c.custo, canal, t) * c.p, 0)
  const somaPreco = validos.reduce((a, c) => a + (c.conta.preco as number) * c.p, 0)
  const custoTotal = validos.reduce((a, c) => a + (canal === 'delivery' ? c.custo + t.embalagem : c.custo) * c.p, 0)
  const margem = validos.length ? somaPreco - custoTotal : null
  const sobraTotal = validos.length ? validos.reduce((a, c) => a + (c.conta.sobra ?? 0) * c.p, 0) : null
  const cmvs = validos.map((c) => c.conta.cmv as number).sort((a, b) => a - b)
  const m = Math.floor(cmvs.length / 2)
  const ordenados = [...validos].sort((a, b) => (a.conta.cmv as number) - (b.conta.cmv as number))
  return {
    pratos: contas.length,
    cmvCardapio: somaPreco > 0 ? somaCusto / somaPreco : null,
    cmvTipico: cmvs.length ? (cmvs.length % 2 ? cmvs[m] : (cmvs[m - 1] + cmvs[m]) / 2) : null,
    acima: contas.filter((c) => c.conta.situacao === 'acima').length,
    atencao: contas.filter((c) => c.conta.situacao === 'atencao').length,
    semPreco: contas.filter((c) => c.conta.situacao === 'sem_preco').length,
    aConferir: contas.filter((c) => c.conta.situacao === 'sem_custo' || c.conta.situacao === 'incompleto' || c.conta.situacao === 'suspeito').length,
    melhor: ordenados.length ? ordenados[0].i : null,
    pior: ordenados.length > 1 ? ordenados[ordenados.length - 1].i : null,
    reprecar: ordenados.filter((c) => c.conta.situacao === 'acima' || c.conta.situacao === 'atencao').reverse().map((c) => c.i),
    custoTotal, vendaTotal: somaPreco, margem,
    margemPct: margem != null && somaPreco > 0 ? margem / somaPreco : null,
    roi: margem != null && custoTotal > 0 ? margem / custoTotal : null,
    sobraTotal,
    custoConjunto: contas.reduce((a, c) => a + (c.semFicha ? 0 : Math.max(c.custo, 0) * porcoesValidas(c.porcoes)), 0),
  }
}

/** Lê preço digitado em pt-BR ("1.234,50", "12,9", "12.90"). null = vazio; NaN = inválido. */
export function lerPreco(s: string): number | null {
  const t = s.trim().replace(/^R\$\s*/i, '')
  if (!t) return null
  const normal = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t
  const v = Number(normal)
  return Number.isFinite(v) ? v : NaN
}

/** Nova ordem depois de mover o item `id` uma posição para cima ou para baixo (null = não dá para mover). */
export function moverNaLista<T>(ids: T[], id: T, direcao: 'cima' | 'baixo'): T[] | null {
  const i = ids.indexOf(id)
  const j = direcao === 'cima' ? i - 1 : i + 1
  if (i < 0 || j < 0 || j >= ids.length) return null
  const out = [...ids]
  ;[out[i], out[j]] = [out[j], out[i]]
  return out
}
