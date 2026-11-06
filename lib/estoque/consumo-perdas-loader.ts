// Leitura das telas da Fase 5 (T5.3/T5.4), só estoque próprio, só desenvolvedor. Só LEITURA.
// Consumo e variação de preço vêm das funções da migration 400 (service_role); perdas, do ledger efetivo (311/351).
// Toda consulta checa `error`: falha vira aviso na tela, nunca "zero".
import { createServiceClient } from '@/lib/supabase/server'
import { rpcTodos } from '@/lib/supabase/rpc-todos'
import { buscarTodasLinhas } from '@/lib/supabase/buscar-todas-linhas'
import { normalizarConsumo, type LinhaConsumo, type LinhaConsumoDb } from './consumo-real-puro'
import { montarPerdas, ORIGENS_PERDA, type MovPerda, type ResultadoPerdas } from './perdas-puro'
import { lerLimitePct, LIMITE_PADRAO_PCT, type LinhaPrecoDb } from '@/lib/compras/variacao-preco-puro'

export type Cadastro = {
  produtos: Map<number, { codigo: string; descricao: string; unidade: string | null }>
  locais: { codigo: number; descricao: string }[]
}

export async function carregarCadastro(lojaId: number, avisos: string[]): Promise<Cadastro> {
  const sb = createServiceClient()
  type P = { codigo_produto: number; codigo: string; descricao: string; unidade: string | null }
  const [prods, { data: locs, error: el }] = await Promise.all([
    buscarTodasLinhas<P>((from, to) => sb.from('produtos').select('codigo_produto, codigo, descricao, unidade').eq('loja_id', lojaId).order('codigo_produto').range(from, to),
      undefined, (e) => avisos.push(`Não foi possível ler os produtos: ${e.message}`)),
    sb.from('local_estoques').select('codigo_local_estoque, descricao').eq('loja_id', lojaId).is('deleted_at', null).order('descricao'),
  ])
  if (el) avisos.push(`Não foi possível ler os locais: ${el.message}`)
  return {
    produtos: new Map(prods.map((p) => [Number(p.codigo_produto), { codigo: p.codigo, descricao: p.descricao, unidade: p.unidade }])),
    locais: (locs ?? []).map((l) => ({ codigo: Number(l.codigo_local_estoque), descricao: l.descricao as string })),
  }
}

export async function carregarConsumo(lojaId: number, ini: string, fim: string, local: number | null): Promise<{ linhas: LinhaConsumo[]; erro: string | null; ms: number }> {
  const t0 = Date.now()
  let erro: string | null = null
  const rows = await rpcTodos<LinhaConsumoDb>(createServiceClient(), 'consumo_teorico_real', { p_loja: lojaId, p_ini: ini, p_fim: fim, p_local: local },
    (e) => { erro = `Não foi possível calcular o consumo: ${e.message}` })
  return { linhas: erro ? [] : normalizarConsumo(rows), erro, ms: Date.now() - t0 }
}

export async function carregarPerdas(lojaId: number, ini: string, fim: string, avisos: string[]): Promise<ResultadoPerdas> {
  const sb = createServiceClient()
  type R = MovPerda
  const movs = await buscarTodasLinhas<R>((from, to) =>
    sb.from('estoque_movimentos_efetivo').select('id, origem, quantidade, obs, codigo_produto, codigo_local_estoque, data_ref, custo_unitario, cmc_apos, user_id')
      .eq('loja_id', lojaId).in('origem', [...ORIGENS_PERDA]).lt('quantidade', 0).gte('data_ref', ini).lte('data_ref', fim)
      .order('id').range(from, to),
    undefined, (e) => avisos.push(`Não foi possível ler as perdas: ${e.message}`))
  // Estornos: o EST tem reverses_id = movimento desfeito e é sempre posterior a ele.
  const estornos = await buscarTodasLinhas<{ reverses_id: number }>((from, to) =>
    sb.from('estoque_movimentos').select('reverses_id').eq('loja_id', lojaId).eq('tipo', 'EST').not('reverses_id', 'is', null).gte('data_ref', ini)
      .order('id').range(from, to),
    undefined, (e) => avisos.push(`Não foi possível ler os estornos: ${e.message}`))
  const num = (v: unknown) => (v == null ? null : Number(v))
  return montarPerdas(
    movs.map((m) => ({ ...m, id: Number(m.id), quantidade: Number(m.quantidade), codigo_produto: Number(m.codigo_produto), codigo_local_estoque: Number(m.codigo_local_estoque), custo_unitario: num(m.custo_unitario), cmc_apos: num(m.cmc_apos) })),
    new Set(estornos.map((e) => Number(e.reverses_id))),
  )
}

/** Limite (%) do alerta de preço da loja. Sem linha em estoque_config ou sem a coluna (400 não aplicada) = 15%. */
export async function limiteVariacaoPreco(lojaId: number): Promise<{ limite: number; configurado: boolean; aviso: string | null }> {
  const { data, error } = await createServiceClient().from('estoque_config').select('alerta_variacao_preco_pct').eq('loja_id', lojaId).maybeSingle()
  if (error) return { limite: LIMITE_PADRAO_PCT, configurado: false, aviso: `Limite da loja não lido (${error.message}); usando ${LIMITE_PADRAO_PCT}%.` }
  const v = (data as { alerta_variacao_preco_pct?: number | null } | null)?.alerta_variacao_preco_pct
  return { limite: lerLimitePct(v) ?? LIMITE_PADRAO_PCT, configurado: v != null, aviso: null }
}

export async function carregarVariacaoPreco(lojaId: number, p: { ini: string; fim: string } | { compraId: number }): Promise<{ linhas: LinhaPrecoDb[]; erro: string | null }> {
  let erro: string | null = null
  const args = 'compraId' in p ? { p_loja: lojaId, p_ini: null, p_fim: null, p_compra: p.compraId } : { p_loja: lojaId, p_ini: p.ini, p_fim: p.fim, p_compra: null }
  const linhas = await rpcTodos<LinhaPrecoDb>(createServiceClient(), 'variacao_preco_compras', args, (e) => { erro = `Não foi possível comparar os preços: ${e.message}` })
  return { linhas: erro ? [] : linhas, erro }
}
