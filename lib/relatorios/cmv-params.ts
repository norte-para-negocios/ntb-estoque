import { lerPeriodo } from '@/lib/faturamento-periodo'
import type { DimCmv } from '@/lib/relatorios/cmv-puro'

export type SpCmv = Record<string, string | undefined>
export type AbaCmv = 'produtos' | 'familias' | 'tipos' | 'estoque'
export type ParamsCmv = { ini: string; fim: string; cortado: boolean; aba: AbaCmv; tipos: string[]; familias: string[]; q: string }
export const DIM_DA_ABA: Record<AbaCmv, DimCmv> = { produtos: 'produto', familias: 'familia', tipos: 'tipo', estoque: 'produto' }

const lista = (v?: string) => (v ?? '').split(',').map((x) => x.trim()).filter(Boolean)

export function lerParamsCmv(sp: SpCmv, hoje: string): ParamsCmv {
  return {
    ...lerPeriodo({ ini: sp.ini, fim: sp.fim, mes: sp.mes }, hoje),
    aba: (['produtos', 'familias', 'tipos', 'estoque'] as const).find((a) => a === sp.aba) ?? 'produtos',
    tipos: lista(sp.tipo), familias: lista(sp.familia), q: (sp.q ?? '').slice(0, 80),
  }
}
export const paramsBaseCmv = (p: ParamsCmv): Record<string, string> =>
  ({ ini: p.ini, fim: p.fim, aba: p.aba === 'produtos' ? '' : p.aba, tipo: p.tipos.join(','), familia: p.familias.join(','), q: p.q })

const fmt = (iso: string) => iso.split('-').reverse().join('/')
export function textoFonte(fonte: 'proprio' | 'kardex' | 'estimado', cobertura: { desde: string; ate: string } | null, dataFoto: string | null): string {
  if (fonte === 'proprio') return 'Custo real de cada baixa do estoque (saída de cada venda pelo custo médio da hora).'
  if (fonte === 'kardex') return `Kardex do Omie: cada saída pelo valor do próprio movimento (histórico completo de ${fmt(cobertura!.desde)} a ${fmt(cobertura!.ate)}).`
  return `Estimado: quantidade vendida × custo médio de hoje${dataFoto ? ` (foto de ${fmt(dataFoto)})` : ''}. ${cobertura ? `O kardex do Omie desta loja só cobre de ${fmt(cobertura.desde)} a ${fmt(cobertura.ate)}; escolha um período dentro dele para ver o custo de cada movimento.` : 'O espelho do kardex do Omie não está ligado nesta loja, então o custo da hora de cada venda não está disponível.'}`
}
