// Fichas técnicas (receitas) do Estoque próprio — regras PURAS (sem banco, sem alias do Next), usadas pela tela
// (custo ao vivo) e testadas por node --test. Espelham as funções SQL da migration 133 (expandir_receita, custo_unitario_ficha).
// Quantidades SEMPRE na unidade base do produto (g, ml, un).

export type ItemFicha = {
  codigoInsumo: number
  quantidadeLiquida: number
  fatorCorrecao: number
  perdaPct: number
}

export type Ficha = {
  codigoProduto: number
  rendimento: number
  expandirNaVenda: boolean
  itens: ItemFicha[]
}

export type InsumoExpandido = { codigoInsumo: number; quantidade: number }

const arred6 = (n: number) => Math.round(n * 1e6) / 1e6

/** Quantidade que sai do estoque: líquida × fator de correção × (1 + perda%). */
export function brutaDoItem(i: Pick<ItemFicha, 'quantidadeLiquida' | 'fatorCorrecao' | 'perdaPct'>): number {
  return arred6(i.quantidadeLiquida * i.fatorCorrecao * (1 + i.perdaPct / 100))
}

export type ErroFicha = { campo: string; mensagem: string }

/** Valida o que o usuário digitou ANTES de ir ao banco (o banco valida de novo). */
export function validarFicha(codigoProduto: number, rendimento: number, itens: Partial<ItemFicha>[]): ErroFicha[] {
  const erros: ErroFicha[] = []
  if (!(rendimento > 0)) erros.push({ campo: 'rendimento', mensagem: 'O rendimento deve ser maior que zero.' })
  if (!itens.length) erros.push({ campo: 'itens', mensagem: 'Adicione pelo menos um insumo.' })
  const vistos = new Set<number>()
  itens.forEach((i, n) => {
    const linha = `Insumo ${n + 1}`
    if (!i.codigoInsumo) erros.push({ campo: `item${n}`, mensagem: `${linha}: escolha o insumo.` })
    else if (i.codigoInsumo === codigoProduto) erros.push({ campo: `item${n}`, mensagem: `${linha}: um produto não pode ser insumo de si mesmo.` })
    else if (vistos.has(i.codigoInsumo)) erros.push({ campo: `item${n}`, mensagem: `${linha}: insumo repetido.` })
    if (i.codigoInsumo) vistos.add(i.codigoInsumo)
    if (!((i.quantidadeLiquida ?? 0) > 0)) erros.push({ campo: `item${n}`, mensagem: `${linha}: quantidade deve ser maior que zero.` })
    if (!((i.fatorCorrecao ?? 1) > 0)) erros.push({ campo: `item${n}`, mensagem: `${linha}: fator de correção deve ser maior que zero.` })
    const p = i.perdaPct ?? 0
    if (p < 0 || p > 100) erros.push({ campo: `item${n}`, mensagem: `${linha}: perda deve ficar entre 0 e 100%.` })
  })
  return erros
}

/**
 * Insumos finais para `quantidade` do produto (somados por insumo, ordenados). Sub-receita só é aberta quando a ficha dela
 * tem `expandirNaVenda`; senão o insumo é consumido do estoque como produto pronto. Ciclo/profundidade > 10 lança erro.
 */
export function expandirReceita(fichas: Map<number, Ficha>, codigoProduto: number, quantidade: number): InsumoExpandido[] {
  const soma = new Map<number, number>()
  const rec = (produto: number, qtd: number, nivel: number, caminho: number[]) => {
    if (nivel > 10) throw new Error('Receita com profundidade excessiva (ciclo?)')
    const f = fichas.get(produto)
    if (!f) return
    const fator = qtd / f.rendimento
    for (const i of f.itens) {
      if (caminho.includes(i.codigoInsumo)) throw new Error(`Receita circular em ${i.codigoInsumo}`)
      const bruta = brutaDoItem(i) * fator
      const filha = fichas.get(i.codigoInsumo)
      if (filha?.expandirNaVenda) rec(i.codigoInsumo, bruta, nivel + 1, [...caminho, i.codigoInsumo])
      else soma.set(i.codigoInsumo, (soma.get(i.codigoInsumo) ?? 0) + bruta)
    }
  }
  rec(codigoProduto, quantidade, 0, [codigoProduto])
  return [...soma.entries()].map(([codigoInsumo, q]) => ({ codigoInsumo, quantidade: arred6(q) })).sort((a, b) => a.codigoInsumo - b.codigoInsumo)
}

/** Custo de UMA unidade do produto: soma dos insumos finais × CMC atual. `null` se o produto não tem ficha. */
export function custoUnitarioFicha(fichas: Map<number, Ficha>, cmcPorProduto: Map<number, number>, codigoProduto: number): number | null {
  if (!fichas.has(codigoProduto)) return null
  const total = expandirReceita(fichas, codigoProduto, 1).reduce((a, i) => a + i.quantidade * (cmcPorProduto.get(i.codigoInsumo) ?? 0), 0)
  return arred6(total)
}

/** Linha de custo por insumo para a tela do editor (custo ao vivo). */
export function custoDoItem(item: ItemFicha, rendimento: number, cmc: number | undefined): { bruta: number; custoPorUnidade: number; custoLote: number } {
  const bruta = brutaDoItem(item)
  const custoLote = arred6(bruta * (cmc ?? 0))
  return { bruta, custoLote, custoPorUnidade: rendimento > 0 ? arred6(custoLote / rendimento) : 0 }
}

/** Quanto um lote de `quantidade` consome e custa (prévia da tela "Produzir lote"). */
export function previaProducao(fichas: Map<number, Ficha>, cmcPorProduto: Map<number, number>, codigoProduto: number, quantidade: number) {
  const insumos = expandirReceita(fichas, codigoProduto, quantidade)
  const custoTotal = arred6(insumos.reduce((a, i) => a + i.quantidade * (cmcPorProduto.get(i.codigoInsumo) ?? 0), 0))
  return { insumos, custoTotal, custoUnitario: quantidade > 0 ? arred6(custoTotal / quantidade) : 0 }
}
