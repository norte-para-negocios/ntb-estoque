import 'server-only'
import { createClient } from '@/lib/supabase/server'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { cardapiosQueUsam, eventosQueUsam, type CardapioQueUsa, type EventoQueUsa } from './relacoes-puro'

// Norte Cozinha: cardápios e próximos eventos (orçamento ou confirmado, não finalizados, de hoje em diante ou sem data)
// que usam um insumo. Só leitura (RLS). `usos` = raiz → quantidade do insumo em 1 unidade da raiz (dadosInsumos).

export async function relacoesDoInsumo(lojaId: number, usos: Map<number, number>): Promise<{ cardapios: CardapioQueUsa[]; eventos: EventoQueUsa[] }> {
  const raizes = [...usos.keys()]
  if (!raizes.length) return { cardapios: [], eventos: [] }
  const supabase = await createClient()
  const lote = raizes.slice(0, 300)
  const [ci, ei] = await Promise.all([
    supabase.from('custo_cardapio_itens').select('cardapio_id, codigo_produto, porcoes').eq('loja_id', lojaId).in('codigo_produto', lote).limit(2000),
    supabase.from('custo_evento_itens').select('evento_id, codigo_produto, porcoes_por_convidado').eq('loja_id', lojaId).in('codigo_produto', lote).limit(2000),
  ])
  // Sem a coluna porcoes (migration 474 pendente): relê sem ela.
  let itensCard = (ci.data ?? []) as { cardapio_id: number; codigo_produto: number; porcoes?: number | string | null }[]
  if (ci.error && /porcoes/.test(ci.error.message)) {
    const { data } = await supabase.from('custo_cardapio_itens').select('cardapio_id, codigo_produto').eq('loja_id', lojaId).in('codigo_produto', lote).limit(2000)
    itensCard = (data ?? []) as typeof itensCard
  }
  const idsCard = [...new Set(itensCard.map((i) => Number(i.cardapio_id)))]
  const idsEv = [...new Set((ei.data ?? []).map((i) => Number(i.evento_id)))]
  const hoje = hojeBahiaISO()
  const [cs, es] = await Promise.all([
    idsCard.length ? supabase.from('custo_cardapios').select('id, nome, ativo').eq('loja_id', lojaId).in('id', idsCard) : Promise.resolve({ data: [] }),
    idsEv.length ? supabase.from('custo_eventos').select('id, nome, data_evento, status, convidados, folga_pct').eq('loja_id', lojaId).in('id', idsEv)
      .in('status', ['orcamento', 'confirmado']).is('finalizado_em', null).or(`data_evento.gte.${hoje},data_evento.is.null`) : Promise.resolve({ data: [] }),
  ])
  return {
    cardapios: cardapiosQueUsam(usos,
      ((cs.data ?? []) as { id: number; nome: string; ativo: boolean }[]).map((c) => ({ id: Number(c.id), nome: c.nome, ativo: !!c.ativo })),
      itensCard.map((i) => ({ cardapioId: Number(i.cardapio_id), codigo: Number(i.codigo_produto), porcoes: i.porcoes == null ? 1 : Number(i.porcoes) }))),
    eventos: eventosQueUsam(usos,
      ((es.data ?? []) as { id: number; nome: string; data_evento: string | null; status: string; convidados: number; folga_pct: number | string | null }[]).map((e) => ({
        id: Number(e.id), nome: e.nome, data: e.data_evento ? String(e.data_evento).slice(0, 10) : null, status: e.status,
        convidados: Number(e.convidados), folgaPct: Number(e.folga_pct ?? 0),
      })),
      (ei.data ?? []).map((i) => ({ eventoId: Number(i.evento_id), codigo: Number(i.codigo_produto), porcoesPorConvidado: Number(i.porcoes_por_convidado) }))),
  }
}
