import { lerPeriodo } from '@/lib/faturamento-periodo'
import type { Classe, Medida } from '@/lib/relatorios/curva-abc-puro'
import type { BaseAbc } from '@/lib/relatorios/curva-abc-loader'

export type SpAbc = Record<string, string | undefined>
export type ParamsAbc = { ini: string; fim: string; cortado: boolean; base: BaseAbc; medida: Medida; tipos: string[]; familias: string[]; classe: Classe | ''; q: string; taxas: boolean }

const lista = (v?: string) => (v ?? '').split(',').map((x) => x.trim()).filter(Boolean)

// Período padrão = mês atual (igual ao "Mês atual" do Omie).
export function lerParamsAbc(sp: SpAbc, hoje: string): ParamsAbc {
  const per = lerPeriodo({ ini: sp.ini, fim: sp.fim, mes: sp.mes }, hoje)
  return {
    ...per,
    base: sp.base === 'compras' ? 'compras' : 'vendas',
    medida: sp.medida === 'quant' ? 'quant' : 'valor',
    tipos: lista(sp.tipo),
    familias: lista(sp.familia),
    classe: sp.classe === 'A' || sp.classe === 'B' || sp.classe === 'C' ? sp.classe : '',
    q: (sp.q ?? '').slice(0, 80),
    // taxa de serviço e outras taxas: fora da curva por padrão; taxas=1 inclui (como o Omie)
    taxas: sp.taxas === '1',
  }
}

export function paramsBaseAbc(p: ParamsAbc): Record<string, string> {
  return {
    ini: p.ini, fim: p.fim, base: p.base === 'vendas' ? '' : p.base, medida: p.medida === 'valor' ? '' : p.medida,
    tipo: p.tipos.join(','), familia: p.familias.join(','), classe: p.classe, q: p.q, taxas: p.taxas ? '1' : '',
  }
}
