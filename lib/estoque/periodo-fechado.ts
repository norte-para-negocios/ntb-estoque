import { createServiceClient } from '@/lib/supabase/server'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { bloqueioPorPeriodo, situacaoDaData, type MesFechado, type SituacaoPeriodo } from '@/lib/estoque/periodo-fechado-puro'

// Fase F: leitura do fechamento de período (migration 230) para o servidor recusar ANTES de escrever ou de mandar
// ao Omie. A trava de verdade do estoque próprio é do banco (PF001); aqui é a mesma regra para as lojas Omie, onde o
// banco não tem como travar (o Omie é quem grava). Sem a migration aplicada, nada está fechado (comportamento antigo).

export async function mesesFechados(lojaId: number): Promise<MesFechado[]> {
  const { data, error } = await createServiceClient()
    .from('estoque_periodo_fechado').select('mes, fechado_em, fechado_por_nome').eq('loja_id', lojaId).order('mes')
  if (error) {
    if (!/estoque_periodo_fechado/.test(error.message)) console.error('fechamento: leitura', error.message)
    return []
  }
  return (data ?? []).map((r) => ({ mes: String(r.mes).slice(0, 7), fechadoEm: r.fechado_em ?? null, fechadoPorNome: r.fechado_por_nome ?? null }))
}

export async function mesesFechadosSet(lojaId: number): Promise<Set<string>> {
  return new Set((await mesesFechados(lojaId)).map((m) => m.mes))
}

/** Mensagem de recusa quando alguma das datas cai num mês fechado da loja; null quando pode escrever. */
export async function exigirPeriodoAberto(lojaId: number, datas: (string | null | undefined)[], oQue: string): Promise<string | null> {
  if (!datas.some(Boolean)) return null
  return bloqueioPorPeriodo(datas, await mesesFechados(lojaId), oQue)
}

export async function situacaoPeriodoLoja(lojaId: number, dataISO: string): Promise<SituacaoPeriodo> {
  const fechados = (await mesesFechados(lojaId)).map((m) => m.mes)
  return situacaoDaData(dataISO, hojeBahiaISO(), fechados, process.env.ESTOQUE_MES_FECHADO_ATE ?? null)
}

/**
 * Nota de entrada do estoque próprio já lançada num mês fechado: desfazer a entrada ou excluir a nota mudaria o mês
 * entregue ao contador. A data é a do movimento de entrada de cada item lançado (o banco recusa do mesmo jeito).
 */
export async function travaDaCompraLancada(lojaId: number, compraId: number): Promise<string | null> {
  const fechados = await mesesFechados(lojaId)
  if (!fechados.length) return null // sem mês fechado, nenhuma consulta a mais
  const sb = createServiceClient()
  const { data: itens } = await sb.from('compras_proprio_itens').select('movimento_id').eq('compra_id', compraId).eq('loja_id', lojaId)
    .eq('lancado', true).not('movimento_id', 'is', null).order('id')
  const ids = (itens ?? []).map((i) => Number(i.movimento_id))
  if (!ids.length) return null
  const { data: movs } = await sb.from('estoque_movimentos').select('data_ref').eq('loja_id', lojaId).in('id', ids.slice(0, 500))
  return bloqueioPorPeriodo((movs ?? []).map((m) => String(m.data_ref)), fechados, 'nota de entrada lançada no estoque')
}

/** Aplica os filtros de `filtrosForaDosFechados` na consulta (um `.or()` por mês; com `tabela`, na tabela embutida `!inner`). */
type ComOr = { or: (filtro: string, opcoes?: { referencedTable?: string }) => unknown }
export function semMesFechado<Q>(q: Q, filtros: string[], tabela?: string): Q {
  let r = q as unknown as ComOr
  for (const f of filtros) r = (tabela ? r.or(f, { referencedTable: tabela }) : r.or(f)) as ComOr
  return r as unknown as Q
}
