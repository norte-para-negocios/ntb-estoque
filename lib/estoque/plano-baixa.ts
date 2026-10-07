// Planejamento PURO da baixa de venda em loja de estoque proprio (sem banco, sem imports): testado por node --test.
// `resolverLocal` e injetado (localDaVenda de lib/vendas/local-venda.ts) para este arquivo nao depender de alias do Next.
export type ItemVendaProprio = {
  codigo: string
  quantidade: number
  destination?: 'kitchen' | 'bar' | null
  setor?: string | null
  localEstoque?: number | null
}

export type PlanoItem = {
  indice: number
  codigo: string
  quantidade: number
  produto?: number
  local?: number
  /** n-esima ocorrencia do mesmo (produto, local) no pedido: parte da chave de idempotencia. */
  linha: number
  pulo?: { op: 'pulada' | 'sem_estrutura'; baixa: string; erro: string }
}

export type ResultadoItemProprio = {
  codigo: string
  ok: boolean
  op: 'sem_estrutura' | 'pulada' | 'erro'
  baixa: string
  erro?: string
  saldo?: number
  negativo?: boolean
  duplicado?: boolean
}

/** Decide, sem tocar no banco, o que cada item vira. Pura: testada em scripts/testes/vendaProprio.test.ts. */
export function planejarBaixa(
  itens: Partial<ItemVendaProprio>[],
  loja: unknown,
  resolverLocal: (loja: any, item: any) => number | null,
  produtoPorCodigo: Map<string, number>,
  localPadrao: number | null,
  locaisDaLoja: Set<number>
): PlanoItem[] {
  const ocorrencias = new Map<string, number>()
  return itens.map((item, indice) => {
    const codigo = item?.codigo ?? '?'
    const base = { indice, codigo, quantidade: Number(item?.quantidade) || 0, linha: 0 }
    if (!item?.codigo || !item.quantidade || item.quantidade <= 0) {
      return { ...base, pulo: { op: 'pulada', baixa: 'pulada', erro: 'Item inválido' } }
    }
    const produto = produtoPorCodigo.get(item.codigo)
    if (!produto) {
      return { ...base, pulo: { op: 'pulada', baixa: 'pulada', erro: 'Produto sem cadastro correspondente no ntb-estoque' } }
    }
    const local = resolverLocal(loja, item) ?? localPadrao
    if (!local) {
      return { ...base, produto, pulo: { op: 'sem_estrutura', baixa: 'sem local de estoque', erro: 'Sem local de estoque para a saída' } }
    }
    if (!locaisDaLoja.has(Number(local))) {
      return { ...base, produto, pulo: { op: 'pulada', baixa: 'pulada', erro: `O local de estoque ${local} não existe nesta loja` } }
    }
    const chave = `${produto}|${local}`
    const n = ocorrencias.get(chave) ?? 0
    ocorrencias.set(chave, n + 1)
    return { ...base, produto, local: Number(local), linha: n }
  })
}

