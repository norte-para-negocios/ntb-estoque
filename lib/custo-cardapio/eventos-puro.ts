// Norte Cozinha, Eventos: conta do evento e explosão da produção e das compras (PURO, sem banco, sem alias do Next; node --test).
// O prato desce pela ficha (arvoreCustoFicha) para a quantidade do evento inteiro: nó com ficha = preparação a produzir,
// folha = insumo a comprar. Nada aqui grava nada.
// @ts-expect-error: o node --test (type stripping) exige a extensão .ts; o tsc do Next não a aceita
import { arvoreCustoFicha, type FichaArvore, type NoArvore } from '../estoque/arvore-custo-puro.ts'
// @ts-expect-error: o node --test (type stripping) exige a extensão .ts; o tsc do Next não a aceita
import { arredondarPreco } from './preco-puro.ts'

export const STATUS_EVENTO = ['orcamento', 'confirmado', 'realizado', 'cancelado'] as const
export type StatusEvento = (typeof STATUS_EVENTO)[number]
export const NOME_STATUS: Record<StatusEvento, string> = { orcamento: 'Orçamento', confirmado: 'Confirmado', realizado: 'Realizado', cancelado: 'Cancelado' }

/** Porções de um prato no evento: convidados × porções por convidado. */
export const porcoesNoEvento = (convidados: number, porcoesPorConvidado: number) =>
  Math.round(Math.max(convidados, 0) * Math.max(porcoesPorConvidado, 0) * 1000) / 1000

export type ResumoEvento = {
  custoTotal: number
  custoPorPessoa: number
  /** Preço por pessoa que bate a meta de CMV, arredondado para ,90 (0 sem custo). */
  precoSugeridoPorPessoa: number
  receita: number | null
  /** Fração do preço que sobra depois da comida: (preço − custo por pessoa) ÷ preço. */
  margem: number | null
  cmv: number | null
  /** Receita − custo total (antes de mão de obra, impostos e custo fixo). */
  sobra: number | null
}

/** Conta do evento a partir do custo de 1 porção de cada prato. */
export function resumoEvento(
  convidados: number,
  itens: { porcoesPorConvidado: number; custoPorPorcao: number }[],
  metaCmv: number,
  precoPorPessoa: number | null,
): ResumoEvento {
  const conv = Math.max(convidados, 0)
  const custoTotal = itens.reduce((a, i) => a + porcoesNoEvento(conv, i.porcoesPorConvidado) * Math.max(i.custoPorPorcao, 0), 0)
  const custoPorPessoa = conv > 0 ? custoTotal / conv : 0
  const preco = precoPorPessoa != null && precoPorPessoa > 0 ? precoPorPessoa : null
  const receita = preco != null && conv > 0 ? preco * conv : null
  return {
    custoTotal,
    custoPorPessoa,
    precoSugeridoPorPessoa: metaCmv > 0 && custoPorPessoa > 0 ? arredondarPreco(custoPorPessoa / metaCmv) : 0,
    receita,
    margem: preco != null ? (preco - custoPorPessoa) / preco : null,
    cmv: preco != null ? custoPorPessoa / preco : null,
    sobra: receita != null ? receita - custoTotal : null,
  }
}

export type Necessidade = { codigo: number; quantidade: number; custo: number; semCusto: boolean; custoUnitario: number | null }
export type Explosao = {
  /** Preparações (nós com ficha), somadas entre os pratos, na unidade do produto. */
  preparacoes: Map<number, Necessidade>
  /** Insumos (folhas), quantidade bruta (com perda), somados entre os pratos. */
  insumos: Map<number, Necessidade>
  /** Pratos sem ficha (não entram na conta). */
  semFicha: number[]
  ciclo: boolean
}

const arred6 = (n: number) => Math.round(n * 1e6) / 1e6

function somar(m: Map<number, Necessidade>, n: NoArvore) {
  const a = m.get(n.codigo) ?? { codigo: n.codigo, quantidade: 0, custo: 0, semCusto: false, custoUnitario: n.custoUnitarioCmc }
  a.quantidade = arred6(a.quantidade + n.quantidade)
  a.custo = arred6(a.custo + n.custo)
  a.semCusto = a.semCusto || n.semCusto
  m.set(n.codigo, a)
}

/** Explode os pedidos do evento (prato × porções) até os insumos, somando o que se repete entre pratos. */
export function explodirEvento(fichas: Map<number, FichaArvore>, cmc: Map<number, number | null>, pedidos: { codigo: number; porcoes: number }[]): Explosao {
  const preparacoes = new Map<number, Necessidade>()
  const insumos = new Map<number, Necessidade>()
  const semFicha: number[] = []
  let ciclo = false
  const descer = (nos: NoArvore[]) => {
    for (const n of nos) {
      if (n.ciclo) { ciclo = true; continue }
      if (n.temFicha) { somar(preparacoes, n); descer(n.filhos) } else somar(insumos, n)
    }
  }
  for (const p of pedidos) {
    if (!(p.porcoes > 0)) continue
    const a = arvoreCustoFicha(fichas, cmc, p.codigo, p.porcoes)
    if (!a) { semFicha.push(p.codigo); continue }
    if (a.ciclo) ciclo = true
    descer(a.filhos)
  }
  return { preparacoes, insumos, semFicha, ciclo }
}

export type InfoProduto = { descricao: string; unidade: string | null; familia: string | null }

export type LinhaCompra = {
  codigo: number
  descricao: string
  unidade: string | null
  familia: string
  /** Quantidade bruta que o evento consome. */
  bruta: number
  /** Saldo em estoque (null = não dá para comparar, ex.: unidade da ficha diferente da do estoque). */
  emEstoque: number | null
  faltaComprar: number
  custoUnitario: number | null
  /** Custo estimado do que falta comprar (custo médio × falta). */
  custoCompra: number
  semCusto: boolean
}

export const SEM_FAMILIA = 'Sem família'

/**
 * Lista de compras: o que o evento consome, menos o saldo (negativo conta como zero).
 * `saldo` devolve undefined quando o saldo não é comparável; aí compra tudo e marca emEstoque = null.
 */
export function listaDeCompras(insumos: Map<number, Necessidade>, info: (codigo: number) => InfoProduto, saldo: (codigo: number) => number | undefined): LinhaCompra[] {
  const out: LinhaCompra[] = []
  for (const n of insumos.values()) {
    const p = info(n.codigo)
    const s = saldo(n.codigo)
    const emEstoque = s == null ? null : Math.max(s, 0)
    const faltaComprar = arred6(Math.max(n.quantidade - (emEstoque ?? 0), 0))
    out.push({
      codigo: n.codigo, descricao: p.descricao, unidade: p.unidade, familia: p.familia?.trim() || SEM_FAMILIA,
      bruta: n.quantidade, emEstoque, faltaComprar, custoUnitario: n.custoUnitario,
      custoCompra: arred6(faltaComprar * (n.custoUnitario ?? 0)), semCusto: n.semCusto,
    })
  }
  return out.sort((a, b) => a.descricao.localeCompare(b.descricao, 'pt-BR'))
}

/** Agrupa por família (famílias em ordem alfabética, "Sem família" no fim). */
export function porFamilia<T extends { familia: string }>(linhas: T[]): { familia: string; linhas: T[] }[] {
  const m = new Map<string, T[]>()
  for (const l of linhas) m.set(l.familia, [...(m.get(l.familia) ?? []), l])
  return [...m.entries()]
    .sort(([a], [b]) => (a === SEM_FAMILIA ? 1 : b === SEM_FAMILIA ? -1 : a.localeCompare(b, 'pt-BR')))
    .map(([familia, linhas]) => ({ familia, linhas }))
}

export type LinhaProducao = { codigo: number; descricao: string; unidade: string | null; quantidade: number; emEstoque: number | null; custo: number }

export function listaDeProducao(preparacoes: Map<number, Necessidade>, info: (codigo: number) => InfoProduto, saldo: (codigo: number) => number | undefined): LinhaProducao[] {
  return [...preparacoes.values()].map((n) => {
    const p = info(n.codigo)
    const s = saldo(n.codigo)
    return { codigo: n.codigo, descricao: p.descricao, unidade: p.unidade, quantidade: n.quantidade, emEstoque: s == null ? null : Math.max(s, 0), custo: n.custo }
  }).sort((a, b) => a.descricao.localeCompare(b.descricao, 'pt-BR'))
}

/** 'YYYY-MM-DD' → '12/11/2026' (sem fuso). */
export function formatarData(d: string | null | undefined): string {
  if (!d) return 'Sem data'
  const [a, m, dia] = d.slice(0, 10).split('-')
  return a && m && dia ? `${dia}/${m}/${a}` : 'Sem data'
}

/** Dias até a data (negativo = já passou). */
export function diasAte(d: string | null, hoje = new Date()): number | null {
  if (!d) return null
  const [a, m, dia] = d.slice(0, 10).split('-').map(Number)
  if (!a || !m || !dia) return null
  return Math.round((Date.UTC(a, m - 1, dia) - Date.UTC(hoje.getFullYear(), hoje.getMonth(), hoje.getDate())) / 864e5)
}

const num = (v: number, casas = 3) => v.toLocaleString('pt-BR', { maximumFractionDigits: casas })
/** Quantidade legível: kg/l abaixo de 1 vira g/ml. */
export function quantidadeTexto(v: number, unidade: string | null): string {
  const u = (unidade ?? '').toUpperCase()
  if (u === 'KG' && v < 1) return `${num(v * 1000, 0)} g`
  if ((u === 'L' || u === 'LT') && v < 1) return `${num(v * 1000, 0)} ml`
  return `${num(v)}${u ? ` ${u.toLowerCase()}` : ''}`
}

/** Texto de produção e compras pronto para colar no WhatsApp (*negrito* do WhatsApp). */
export function textoWhatsApp(
  e: { nome: string; data: string | null; convidados: number },
  pratos: { descricao: string; porcoes: number }[],
  producao: LinhaProducao[],
  compras: LinhaCompra[],
): string {
  const t = [`*${e.nome}*`, `${formatarData(e.data)} · ${e.convidados} convidado${e.convidados === 1 ? '' : 's'}`]
  if (pratos.length) {
    t.push('', '*Pratos*')
    for (const p of pratos) t.push(`- ${p.descricao}: ${num(p.porcoes, 1)} porç${p.porcoes === 1 ? 'ão' : 'ões'}`)
  }
  if (producao.length) {
    t.push('', '*Produzir*')
    for (const p of producao) t.push(`- ${p.descricao}: ${quantidadeTexto(p.quantidade, p.unidade)}`)
  }
  const comprar = compras.filter((c) => c.faltaComprar > 0)
  if (comprar.length) {
    t.push('', '*Comprar*')
    for (const g of porFamilia(comprar)) {
      t.push(`_${g.familia}_`)
      for (const c of g.linhas) t.push(`- ${c.descricao}: ${quantidadeTexto(c.faltaComprar, c.unidade)}`)
    }
    const total = comprar.reduce((a, c) => a + c.custoCompra, 0)
    if (total > 0) t.push('', `Estimativa da compra: ${total.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`)
  } else if (compras.length) {
    t.push('', 'Todos os insumos já estão em estoque.')
  }
  return t.join('\n')
}
