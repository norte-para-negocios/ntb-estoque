// Kardex do Omie (ListarMovimentoEstoque): normalização pura, sem imports (testada com node --test).
// A chamada ao Omie fica em lib/omie/kardex.ts.

export type MovOmie = {
  idMov: number; idProd: number; codigo_local_estoque: number; dtMov: string
  codOrigem?: string; desOrigem?: string; tipo?: string; qtde: number; valor?: number; cmc?: number; saldo?: number
  numDoc?: string; numPedido?: string; idAjuste?: number; idCupom?: number; cancelamento?: string
}
export type LinhaKardexOmie = {
  loja_id: number; id_mov: number; n_cod_prod: number; codigo_local_estoque: number; data_mov: string
  cod_origem: string; des_origem: string | null; tipo: string | null; quantidade: number
  valor_unit: number | null; cmc_apos: number | null; saldo_apos: number | null
  num_doc: string | null; num_pedido: string | null; id_ajuste: number | null; id_cupom: number | null; cancelado: boolean
}

const iso = (br: string) => { const [d, m, a] = br.split('/'); return `${a}-${m}-${d}` }
const numOuNull = (v: unknown) => (v == null || v === '' ? null : Number(v))

export function normalizarMovOmie(m: MovOmie, lojaId: number): LinhaKardexOmie {
  return {
    loja_id: lojaId, id_mov: Number(m.idMov), n_cod_prod: Number(m.idProd), codigo_local_estoque: Number(m.codigo_local_estoque),
    data_mov: iso(m.dtMov), cod_origem: m.codOrigem ?? '', des_origem: m.desOrigem ?? null, tipo: m.tipo ?? null,
    quantidade: Number(m.qtde ?? 0), valor_unit: numOuNull(m.valor), cmc_apos: numOuNull(m.cmc), saldo_apos: numOuNull(m.saldo),
    num_doc: m.numDoc ?? null, num_pedido: m.numPedido ?? null, id_ajuste: numOuNull(m.idAjuste), id_cupom: numOuNull(m.idCupom),
    cancelado: m.cancelamento === 'S',
  }
}

/** Ordena por data e id_mov e marca o movimento cujo CMC é >= 10x o do anterior (mesmo local). */
export function marcarSaltosCmc(linhas: LinhaKardexOmie[]): (LinhaKardexOmie & { saltoCmc: boolean })[] {
  const ord = [...linhas].sort((a, b) => a.data_mov.localeCompare(b.data_mov) || a.id_mov - b.id_mov)
  const ultimo = new Map<number, number>()
  return ord.map((l) => {
    const ant = ultimo.get(l.codigo_local_estoque)
    const atual = Math.abs(l.cmc_apos ?? 0)
    const saltoCmc = ant != null && ant > 0 && atual >= ant * 10
    if (atual > 0) ultimo.set(l.codigo_local_estoque, atual)
    return { ...l, saltoCmc }
  })
}

/** Um upsert não pode tocar a mesma linha duas vezes: mantém a última ocorrência de (id_mov, local). */
export function deduplicarMovs<T extends { id_mov: number; codigo_local_estoque: number }>(linhas: T[]): T[] {
  const m = new Map<string, T>()
  for (const l of linhas) m.set(`${l.id_mov}:${l.codigo_local_estoque}`, l)
  return [...m.values()]
}
