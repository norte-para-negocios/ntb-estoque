// Estrutura dos produtos em todos os níveis (matriz N2, relatório ERP_ESTRUTURA_TODOS do Omie). Regra lida na captura da
// loja 5 (17/10/2026): o item que tem ficha (produto intermediário) aparece e logo abaixo vêm os itens da ficha dele, com
// a quantidade no prato = quantidade do intermediário no prato × quantidade do item por unidade do intermediário; a perda
// do item só é informada (não multiplica); a ordem é sequencial na descida.
// Puro, sem imports: node --test lib/relatorios/estrutura-puro.test.ts

export type ItemFicha = { insumo: number; quantidade: number; perda: number; unidade: string | null }
export type LinhaEstrutura = {
  produto: number; nivel: number; caminho: string; ordem: number; insumo: number; quantidade: number; quantidadePai: number
  perda: number; unidade: string | null; temFicha: boolean; ciclo: boolean
}

const r6 = (n: number) => Math.round(n * 1e6) / 1e6

/** Desce a ficha de `produto` até `maxNivel` níveis. Item que já está no caminho (ciclo) aparece marcado e não desce. */
export function explodirEstrutura(fichas: Map<number, ItemFicha[]>, produto: number, maxNivel = 10): LinhaEstrutura[] {
  const out: LinhaEstrutura[] = []
  const descer = (cod: number, fator: number, nivel: number, prefixo: string, caminho: Set<number>) => {
    const itens = fichas.get(cod) ?? []
    itens.forEach((i, idx) => {
      const ciclo = caminho.has(i.insumo)
      const temFicha = (fichas.get(i.insumo)?.length ?? 0) > 0
      const pos = prefixo ? `${prefixo}.${idx + 1}` : String(idx + 1)
      const quantidade = r6(fator * i.quantidade)
      out.push({ produto, nivel, caminho: pos, ordem: out.length + 1, insumo: i.insumo, quantidade, quantidadePai: r6(fator), perda: i.perda, unidade: i.unidade, temFicha, ciclo })
      if (temFicha && !ciclo && nivel < maxNivel) descer(i.insumo, quantidade, nivel + 1, pos, new Set([...caminho, i.insumo]))
    })
  }
  descer(produto, 1, 1, '', new Set([produto]))
  return out
}
