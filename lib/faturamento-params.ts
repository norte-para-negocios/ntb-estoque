import { lerPeriodo } from '@/lib/faturamento-periodo'

export type Situacao = 'validas' | 'devolvidas' | 'canceladas'
export type Aba = 'produtos' | 'familias' | 'tipos' | 'pagamentos' | 'mensal' | 'dias' | 'cupons' | 'descontos'
export type SpFat = Record<string, string | undefined>

export type ParamsFat = {
  ini: string; fim: string; cortado: boolean
  aba: Aba; tipos: string[]; familias: string[]; situacao: Situacao
  por: 'produto' | 'familia' | 'tipo'; q: string; ordem: 'valor' | 'quant'; sentido: 'mais' | 'menos'; produto: string
}

const lista = (v?: string) => (v ?? '').split(',').map((x) => x.trim()).filter(Boolean)

export function lerParamsFaturamento(sp: SpFat, hoje: string): ParamsFat {
  const per = lerPeriodo({ ini: sp.ini, fim: sp.fim, mes: sp.mes }, hoje)
  return {
    ...per,
    aba: (['produtos', 'familias', 'tipos', 'pagamentos', 'mensal', 'dias', 'cupons', 'descontos'] as const).find((a) => a === sp.aba) ?? 'produtos',
    tipos: lista(sp.tipo),
    familias: lista(sp.familia),
    situacao: (['devolvidas', 'canceladas'] as const).find((s) => s === sp.situacao) ?? 'validas',
    por: (['produto', 'familia'] as const).find((d) => d === sp.por) ?? 'tipo',
    q: (sp.q ?? '').slice(0, 80),
    ordem: sp.ordem === 'quant' ? 'quant' : 'valor',
    sentido: sp.sentido === 'menos' ? 'menos' : 'mais',
    produto: sp.produto ?? '',
  }
}
