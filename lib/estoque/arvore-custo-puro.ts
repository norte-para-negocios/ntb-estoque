// T5.5 (06/11/2026): árvore de custo da ficha técnica (prato → pré-preparo → insumos) e checagem de ciclo ao salvar.
// PURO (sem banco, sem alias do Next), testado por node --test. Só MOSTRA: a baixa continua a de expandir_receita
// (sub-receita com expandir_na_venda = false sai do estoque do PI; com true é aberta nos insumos).
// O custo da árvore desce sempre pela ficha: o PI vale o que a ficha dele dá com o custo médio atual dos insumos.
// Ao lado fica o custo médio atual do PI (o que ele custou de fato nas OPs), para comparar.
import type { Ficha } from './receita'

export type FichaArvore = Ficha & { versao?: number }

export type NoArvore = {
  codigo: number
  /** Quantidade na unidade base para a quantidade pedida do produto raiz. */
  quantidade: number
  temFicha: boolean
  versao?: number
  /** A sub-receita é aberta nos insumos na baixa (expandir_na_venda). */
  abreNaBaixa: boolean
  /** Custo médio atual do produto (null = sem custo). */
  custoUnitarioCmc: number | null
  /** Custo de 1 unidade pela ficha dele (só quem tem ficha). */
  custoUnitarioFicha: number | null
  /** Custo deste nó na árvore: com ficha = soma dos filhos; sem ficha = quantidade × custo médio. */
  custo: number
  semCusto: boolean
  ciclo?: boolean
  filhos: NoArvore[]
}

export type ArvoreCusto = { codigo: number; versao?: number; quantidade: number; total: number; semCusto: number; ciclo: boolean; filhos: NoArvore[] }

const arred6 = (n: number) => Math.round(n * 1e6) / 1e6
const bruta = (i: Ficha['itens'][number]) => arred6(i.quantidadeLiquida * i.fatorCorrecao * (1 + i.perdaPct / 100))

/** Árvore de custo de `quantidade` do produto pela ficha ativa. `null` se o produto não tem ficha. */
export function arvoreCustoFicha(fichas: Map<number, FichaArvore>, cmc: Map<number, number | null>, produto: number, quantidade = 1): ArvoreCusto | null {
  const raiz = fichas.get(produto)
  if (!raiz) return null
  let semCusto = 0
  let ciclo = false
  const filhosDe = (f: FichaArvore, qtd: number, caminho: number[], nivel: number): NoArvore[] =>
    f.itens.map((i) => {
      const q = arred6(bruta(i) * (qtd / f.rendimento))
      const sub = fichas.get(i.codigoInsumo)
      const c = cmc.get(i.codigoInsumo)
      const custoUnitarioCmc = c != null && c > 0 ? c : null
      const base = { codigo: i.codigoInsumo, quantidade: q, custoUnitarioCmc }
      if (caminho.includes(i.codigoInsumo) || nivel > 10) {
        ciclo = true
        return { ...base, temFicha: !!sub, versao: sub?.versao, abreNaBaixa: !!sub?.expandirNaVenda, custoUnitarioFicha: null, custo: 0, semCusto: false, ciclo: true, filhos: [] }
      }
      if (sub) {
        const filhos = filhosDe(sub, q, [...caminho, i.codigoInsumo], nivel + 1)
        const custo = arred6(filhos.reduce((a, n) => a + n.custo, 0))
        return { ...base, temFicha: true, versao: sub.versao, abreNaBaixa: sub.expandirNaVenda, custoUnitarioFicha: q > 0 ? arred6(custo / q) : null, custo, semCusto: false, filhos }
      }
      if (custoUnitarioCmc == null) semCusto++
      return { ...base, temFicha: false, abreNaBaixa: false, custoUnitarioFicha: null, custo: arred6(q * (custoUnitarioCmc ?? 0)), semCusto: custoUnitarioCmc == null, filhos: [] }
    })
  const filhos = filhosDe(raiz, quantidade, [produto], 0)
  return { codigo: produto, versao: raiz.versao, quantidade, total: arred6(filhos.reduce((a, n) => a + n.custo, 0)), semCusto, ciclo, filhos }
}

/**
 * Ao salvar a ficha de `produto` com `insumos`: devolve o caminho do ciclo ([produto, …, produto]) ou null.
 * Usa as fichas ativas das outras receitas; a do próprio produto é a nova (os itens antigos não contam).
 */
export function cicloNaFicha(fichas: Map<number, FichaArvore>, produto: number, insumos: number[]): number[] | null {
  const itensDe = (p: number) => (p === produto ? insumos : (fichas.get(p)?.itens ?? []).map((i) => i.codigoInsumo))
  const visitados = new Set<number>()
  const busca = (p: number, caminho: number[]): number[] | null => {
    for (const filho of itensDe(p)) {
      if (filho === produto) return [...caminho, filho]
      if (visitados.has(filho)) continue
      visitados.add(filho)
      const r = busca(filho, [...caminho, filho])
      if (r) return r
    }
    return null
  }
  return busca(produto, [produto])
}
