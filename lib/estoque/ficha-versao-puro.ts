// T5.5 (06/11/2026): leitura das funções da migration 410 (ficha_versao_dos_movimentos, op_custo_real_teorico). PURO.

type Linha = Record<string, unknown>
const num = (v: unknown): number | null => (v == null || v === '' || !Number.isFinite(Number(v)) ? null : Number(v))

/** Linhas de ficha_versao_dos_movimentos → mapa movimento → versão da ficha. */
export function mapaVersoes(rows: Linha[] | null | undefined): Map<number, number> {
  const m = new Map<number, number>()
  for (const r of rows ?? []) {
    const id = num(r.movimento_id), v = num(r.versao)
    if (id != null && v != null) m.set(id, v)
  }
  return m
}

export const rotuloFicha = (versao: number | null | undefined): string | null => (versao == null ? null : `ficha v${versao}`)

export type ItemCustoRealTeorico = {
  codigoInsumo: number; codigo: string | null; descricao: string | null; unidade: string | null
  qtdReal: number | null; custoReal: number | null; custoUnitReal: number | null; realEstimado: boolean
  qtdTeorica: number | null; custoUnitTeorico: number | null; custoTeorico: number | null
  subReceita: boolean; versaoSub: number | null; semCusto: number; estimado: number; diferenca: number
}

export type CustoRealTeorico = {
  ref: string; versao: number | null; quantidade: number | null; status: string | null
  custoGravado: number | null; custoReal: number; custoTeorico: number; diferenca: number; diferencaPct: number | null
  teoricoSemCusto: number; teoricoEstimado: number; itens: ItemCustoRealTeorico[]
}

/** Resposta de op_custo_real_teorico (jsonb) → números. null = OP não encontrada. */
export function lerCustoRealTeorico(j: Linha | null | undefined): CustoRealTeorico | null {
  if (!j) return null
  const itens = Array.isArray(j.itens) ? (j.itens as Linha[]) : []
  return {
    ref: String(j.ref ?? ''), versao: num(j.versao), quantidade: num(j.quantidade), status: j.status == null ? null : String(j.status),
    custoGravado: num(j.custo_gravado), custoReal: num(j.custo_real) ?? 0, custoTeorico: num(j.custo_teorico) ?? 0,
    diferenca: num(j.diferenca) ?? 0, diferencaPct: num(j.diferenca_pct),
    teoricoSemCusto: num(j.teorico_sem_custo) ?? 0, teoricoEstimado: num(j.teorico_estimado) ?? 0,
    itens: itens.map((i) => ({
      codigoInsumo: Number(i.codigo_insumo), codigo: i.codigo == null ? null : String(i.codigo),
      descricao: i.descricao == null ? null : String(i.descricao), unidade: i.unidade == null ? null : String(i.unidade),
      qtdReal: num(i.qtd_real), custoReal: num(i.custo_real), custoUnitReal: num(i.custo_unit_real), realEstimado: i.real_estimado === true,
      qtdTeorica: num(i.qtd_teorica), custoUnitTeorico: num(i.custo_unit_teorico), custoTeorico: num(i.custo_teorico),
      subReceita: i.sub_receita === true, versaoSub: num(i.versao_sub), semCusto: num(i.sem_custo) ?? 0, estimado: num(i.estimado) ?? 0,
      diferenca: num(i.diferenca) ?? 0,
    })),
  }
}
