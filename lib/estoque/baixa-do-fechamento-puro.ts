// F-04 (ODARA): o fechamento da venda (vendas_proprio) chegou, mas a baixa do estoque nunca chegou (nenhum registro em
// venda_integracao_pedidos e nenhuma saída VENDA no ledger). Puro: monta os itens da baixa a partir do que o fechamento guardou.
export type ItemFechado = {
  codigo: string | null
  codigo_produto: number | string | null
  componentes: (number | string)[] | null
  quantidade: number | string
}

export type ItemBaixaFechamento = { codigo: string; quantidade: number; localEstoque?: number }

/**
 * Item com código = o próprio produto. Item de cardápio sem código (guarda só `componentes`) = cada componente, como o Vendas faz
 * ao mandar a baixa. `codigoDoProduto` traduz codigo_produto → código (SKU) do cadastro; `localDoProduto` é o local onde o produto
 * costuma sair (a baixa original não é conhecida). Item que não dá para traduzir vai para `semCodigo` (a tela avisa, nunca some calado).
 */
export function itensDaBaixaDoFechamento(
  itens: ItemFechado[],
  codigoDoProduto: Map<number, string>,
  localDoProduto: Map<number, number>,
): { itens: ItemBaixaFechamento[]; semCodigo: number } {
  const out: ItemBaixaFechamento[] = []
  let semCodigo = 0
  const empurra = (codigo: string | null | undefined, produto: number | null, quantidade: number) => {
    if (!codigo || !(quantidade > 0)) { semCodigo++; return }
    const local = produto != null ? localDoProduto.get(produto) : undefined
    out.push(local ? { codigo, quantidade, localEstoque: local } : { codigo, quantidade })
  }
  for (const i of itens) {
    const q = Number(i.quantidade)
    const prod = i.codigo_produto != null ? Number(i.codigo_produto) : null
    if (i.codigo && i.codigo.trim()) { empurra(i.codigo.trim(), prod, q); continue }
    const comps = (i.componentes ?? []).map(Number).filter(Number.isFinite)
    if (!comps.length) { semCodigo++; continue }
    for (const c of comps) empurra(codigoDoProduto.get(c), c, q)
  }
  return { itens: out, semCodigo }
}

/** Local mais usado nas saídas de venda de cada produto (as mais recentes primeiro; empate: o mais recente). */
export function localMaisUsado(movs: { codigo_produto: number | string; codigo_local_estoque: number | string }[]): Map<number, number> {
  const cont = new Map<number, Map<number, number>>()
  for (const m of movs) {
    const p = Number(m.codigo_produto), l = Number(m.codigo_local_estoque)
    const c = cont.get(p) ?? new Map<number, number>()
    c.set(l, (c.get(l) ?? 0) + 1)
    cont.set(p, c)
  }
  const res = new Map<number, number>()
  const primeiraVez = new Map<string, number>()
  movs.forEach((m, idx) => { const k = `${m.codigo_produto}|${m.codigo_local_estoque}`; if (!primeiraVez.has(k)) primeiraVez.set(k, idx) })
  for (const [p, c] of cont) {
    let melhor = -1, n = 0, idxMelhor = Infinity
    for (const [l, q] of c) {
      const idx = primeiraVez.get(`${p}|${l}`) ?? Infinity
      if (q > n || (q === n && idx < idxMelhor)) { melhor = l; n = q; idxMelhor = idx }
    }
    if (melhor >= 0) res.set(p, melhor)
  }
  return res
}
