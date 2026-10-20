import { createClient } from '@/lib/supabase/server'
import { buscarTodasLinhas } from '@/lib/supabase/buscar-todas-linhas'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { lerPeriodo } from '@/lib/faturamento-periodo'
import { coberturaKardex } from '@/lib/relatorios/cmv-loader'
import { avisoCoberturaKardex } from '@/lib/estoque/espelho-frentes'
import { escolherFonteCmv } from '@/lib/relatorios/cmv-puro'
import { rotuloTipo } from '@/lib/relatorios/posicao-estoque-loader'
import { codigosDoFiltro, type DiaOp, type FiltrosOp, type LinhaOpProduto, type MetaOp } from '@/lib/relatorios/ops-periodo-puro'

export type FonteOps = 'proprio' | 'kardex' | 'ops'
export type VisaoOps = 'produzidos' | 'consumidos' | 'dias'
export type SpOps = Record<string, string | undefined>
const lista = (v?: string) => (v ?? '').split(',').map((x) => x.trim()).filter(Boolean)

export function lerParamsOps(sp: SpOps, hoje: string) {
  const per = lerPeriodo({ ini: sp.ini, fim: sp.fim, mes: sp.mes }, hoje)
  const visao: VisaoOps = sp.ver === 'consumidos' ? 'consumidos' : sp.ver === 'dias' ? 'dias' : 'produzidos'
  return { ...per, visao, tipos: lista(sp.tipo), familias: lista(sp.familia), q: (sp.q ?? '').slice(0, 80) }
}
export type ParamsOps = ReturnType<typeof lerParamsOps>
export function paramsBaseOps(p: ParamsOps): Record<string, string> {
  return { ini: p.ini, fim: p.fim, ver: p.visao === 'produzidos' ? '' : p.visao, tipo: p.tipos.join(','), familia: p.familias.join(','), q: p.q }
}

/**
 * Fonte da produção: loja própria = OPs do app com o que a produção baixou; loja Omie com o espelho do kardex cobrindo o
 * período inteiro = kardex (OPE/OPS: tem todas as produções que o Omie lançou, inclusive OPs que o espelho de OPs não
 * trouxe); senão as OPs concluídas sincronizadas, com a ficha gravada em cada OP.
 */
export async function carregarOps(lojaId: number, ini: string, fim: string, filtros: FiltrosOp) {
  const supabase = await createClient()
  const erros: string[] = []
  const [modo, cobertura] = await Promise.all([modoDaLoja(lojaId), coberturaKardex(lojaId)])
  const fonte: FonteOps = modo === 'proprio' ? 'proprio'
    : escolherFonteCmv({ modo, kardexDesde: cobertura?.desde ?? null, kardexAte: cobertura?.ate ?? null, ini, fim }) === 'kardex' ? 'kardex' : 'ops'
  type Prod = { codigo_produto: number; codigo: string | null; descricao: string | null; descricao_familia: string | null; tipo_item: string | null; unidade: string | null }
  const prods = await buscarTodasLinhas<Prod>((from, to) => supabase.from('produtos').select('codigo_produto, codigo, descricao, descricao_familia, tipo_item, unidade')
    .eq('loja_id', lojaId).order('id').range(from, to), undefined, () => erros.push('cadastro de produtos'))
  const meta = new Map<number, MetaOp>(prods.map((p) => [Number(p.codigo_produto), {
    rotulo: p.descricao?.trim() || p.codigo || `Produto ${p.codigo_produto}`, codigo: p.codigo ?? String(p.codigo_produto),
    familia: p.descricao_familia?.trim() || 'Sem família', tipo: p.tipo_item ?? '', unidade: p.unidade ?? '',
  }]))
  // filtro de tipo/família/busca vai ao banco (vale também para a série por dia); uma chamada só, já agregada
  const codigos = codigosDoFiltro(meta, filtros)
  const { data, error } = await supabase.rpc('relatorio_ops_periodo', {
    p_loja_id: lojaId, p_ini: ini, p_fim: fim, p_fonte: fonte === 'kardex' ? 'kardex' : 'ops', p_produtos: codigos,
  })
  if (error) { erros.push('ordens de produção'); console.error('relatorio-ops', error.message) }
  const j = (data && typeof data === 'object' ? data : {}) as { produtos?: LinhaOpProduto[]; dias?: DiaOp[] }
  const produtos = Array.isArray(j.produtos) ? j.produtos : []
  const dias = Array.isArray(j.dias) ? j.dias.map((d) => ({ ...d, dia: String(d.dia).slice(0, 10) })) : []
  // opções de tipo e família: as do cadastro (o resultado já vem filtrado, não serve para listar as opções)
  const doPeriodo = [...meta.values()]
  const opcoes = {
    tipos: [...new Set(doPeriodo.map((m) => m.tipo))].sort().map((c) => ({ value: c || '_', label: rotuloTipo(c) })),
    familias: [...new Set(doPeriodo.map((m) => m.familia))].sort((a, b) => a.localeCompare(b, 'pt-BR')).map((f) => ({ value: f, label: f })),
  }
  // D5: o kardex não chega ao fim do período (espelho desligado/parado) ou o fim ainda não foi relido.
  const aviso = modo === 'omie' ? avisoCoberturaKardex(cobertura, fim, ini) : null
  return { fonte, cobertura, produtos, dias, meta, erros: [...new Set(erros)], opcoes, aviso }
}
