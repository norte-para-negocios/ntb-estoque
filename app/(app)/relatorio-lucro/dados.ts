import { createServiceClient } from '@/lib/supabase/server'
import { hojeBahiaISO } from '@/lib/data-bahia'

export type DimLucro = 'produto' | 'familia' | 'tipo' | 'dia' | 'mes'
export const DIMS_LUCRO: { value: DimLucro; label: string }[] = [
  { value: 'produto', label: 'Produto' },
  { value: 'familia', label: 'Família' },
  { value: 'tipo', label: 'Tipo' },
  { value: 'dia', label: 'Dia' },
  { value: 'mes', label: 'Mês' },
]
export type OrdemLucro = 'lucro' | 'faturamento' | 'cmv' | 'margem' | 'quantidade' | 'rotulo'

export type LinhaLucro = {
  rotulo: string; quantidade: number; faturamento: number; cmv: number; lucro: number; margem: number | null
  itens_sem_baixa: number; itens_sem_custo: number
}

export type FiltroLucro = { ini: string; fim: string; dim: DimLucro; q: string; ordem: OrdemLucro; desc: boolean }

export function lerFiltro(sp: Record<string, string | string[] | undefined>): FiltroLucro {
  const um = (k: string) => (Array.isArray(sp[k]) ? sp[k]![0] : (sp[k] as string | undefined)) ?? ''
  const hoje = hojeBahiaISO()
  const iso = (s: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? s : '')
  const dims = new Set(DIMS_LUCRO.map((d) => d.value))
  const ordens = new Set<OrdemLucro>(['lucro', 'faturamento', 'cmv', 'margem', 'quantidade', 'rotulo'])
  const dim = dims.has(um('dim') as DimLucro) ? (um('dim') as DimLucro) : 'produto'
  const ordem = ordens.has(um('ordem') as OrdemLucro) ? (um('ordem') as OrdemLucro) : dim === 'dia' || dim === 'mes' ? 'rotulo' : 'lucro'
  return {
    ini: iso(um('data_inicio')) || `${hoje.slice(0, 8)}01`, fim: iso(um('data_final')) || hoje, dim,
    q: um('q').trim().slice(0, 80), ordem, desc: um('sentido') ? um('sentido') === 'desc' : ordem !== 'rotulo',
  }
}

const n = (v: unknown) => Number(v) || 0

export async function carregarLucro(lojaId: number, f: FiltroLucro) {
  const supabase = createServiceClient()
  const [{ data, error }, { data: dias }, { data: vendas }] = await Promise.all([
    supabase.rpc('lucro_proprio', { p_loja: lojaId, p_ini: f.ini, p_fim: f.fim, p_dim: f.dim }),
    supabase.rpc('lucro_proprio', { p_loja: lojaId, p_ini: f.ini, p_fim: f.fim, p_dim: 'dia' }),
    supabase.from('vendas_proprio').select('valor').eq('loja_id', lojaId).eq('cancelado', false).eq('devolvido', false).gte('data', f.ini).lte('data', f.fim).limit(50000),
  ])
  const norm = (r: Record<string, unknown>): LinhaLucro => ({
    rotulo: String(r.rotulo ?? ''), quantidade: n(r.quantidade), faturamento: n(r.faturamento), cmv: n(r.cmv), lucro: n(r.lucro),
    margem: r.margem == null ? null : n(r.margem), itens_sem_baixa: n(r.itens_sem_baixa), itens_sem_custo: n(r.itens_sem_custo),
  })
  let linhas = ((data ?? []) as Record<string, unknown>[]).map(norm)
  if (f.q) { const t = f.q.toLowerCase(); linhas = linhas.filter((l) => l.rotulo.toLowerCase().includes(t)) }
  const chave = f.ordem
  linhas.sort((a, b) => {
    const va = chave === 'rotulo' ? a.rotulo : (a[chave] ?? -Infinity)
    const vb = chave === 'rotulo' ? b.rotulo : (b[chave] ?? -Infinity)
    const c = typeof va === 'string' ? va.localeCompare(vb as string, 'pt-BR') : (va as number) - (vb as number)
    return f.desc ? -c : c
  })
  const evolucao = ((dias ?? []) as Record<string, unknown>[]).map(norm).sort((a, b) => a.rotulo.localeCompare(b.rotulo))
  const todos = ((data ?? []) as Record<string, unknown>[]).map(norm)
  const faturamento = todos.reduce((s, l) => s + l.faturamento, 0)
  const cmv = todos.reduce((s, l) => s + l.cmv, 0)
  const qtdVendas = (vendas ?? []).length
  return {
    erro: error?.message ?? null, linhas, evolucao,
    totais: {
      faturamento, cmv, lucro: faturamento - cmv, margem: faturamento > 0 ? ((faturamento - cmv) / faturamento) * 100 : null,
      vendas: qtdVendas, ticket: qtdVendas > 0 ? (vendas ?? []).reduce((s, v) => s + n(v.valor), 0) / qtdVendas : null,
      semBaixa: todos.reduce((s, l) => s + l.itens_sem_baixa, 0), semCusto: todos.reduce((s, l) => s + l.itens_sem_custo, 0),
    },
  }
}
