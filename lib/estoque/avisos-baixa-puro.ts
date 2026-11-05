// Avisos da baixa no estoque próprio (decisões do dono e do Ramon, 05/11/2026). Nada aqui bloqueia: a baixa já foi feita
// pela regra de sempre (FEFO na migration 145/148; insumo sem custo médio usa o último custo conhecido, estimado, na 314)
// e a tela só mostra o que aconteceu. Puro: node --test lib/estoque/avisos-baixa-puro.test.ts.

export type LoteConsumido = {
  lote: string | null
  validade: string | null // YYYY-MM-DD
  /** quantidade do vínculo movimento × lote (saída é negativa) */
  quantidade: number
  produto: string
  unidade: string | null
  /** dia da baixa (data efetiva do movimento), YYYY-MM-DD */
  dataBaixa: string
}

const ddmm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
const qtd = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 6 })

/** "Produto: lote X vencido em dd/mm consumido (q UN)." — um por lote; lote que vence no dia da baixa ainda vale. */
export function avisosLotesVencidos(linhas: LoteConsumido[]): string[] {
  const porLote = new Map<string, { l: LoteConsumido; q: number }>()
  for (const l of linhas) {
    if (!(l.quantidade < 0) || !l.validade || !(l.validade < l.dataBaixa)) continue
    const k = JSON.stringify([l.produto, l.lote, l.validade, l.unidade])
    const a = porLote.get(k)
    if (a) a.q += -l.quantidade
    else porLote.set(k, { l, q: -l.quantidade })
  }
  return [...porLote.values()].map(({ l, q }) =>
    `${l.produto}: lote ${l.lote?.trim() || 'sem número'} vencido em ${ddmm(l.validade!)} consumido (${qtd(q)}${l.unidade ? ` ${l.unidade}` : ''}).`)
}

export type InsumoConsumido = { produto: string; custoUnitario: number | null; estimado: boolean }

/** Insumos que saíram com custo 0 ou estimado numa produção (OP ou lote). Vazio = nada a avisar. */
export function avisosInsumosSemCusto(insumos: InsumoConsumido[]): string[] {
  const zero = insumos.filter((i) => !(Number(i.custoUnitario) > 0)).map((i) => i.produto)
  const estimado = insumos.filter((i) => Number(i.custoUnitario) > 0 && i.estimado).map((i) => i.produto)
  const out: string[] = []
  if (zero.length) out.push(`Insumo saiu com custo 0 (sem nenhum custo conhecido): ${zero.join(', ')}. Lance uma entrada com custo para corrigir.`)
  if (estimado.length) out.push(`Insumo saiu com custo estimado (último custo conhecido, sem custo médio): ${estimado.join(', ')}.`)
  return out
}
