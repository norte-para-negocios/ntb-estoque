// Avisos depois de uma baixa no estoque próprio (decisões de 05/11/2026): lote vencido consumido pelo FEFO e insumo de
// produção que saiu com custo 0 ou estimado. Só leitura, depois que a baixa já foi gravada: falha aqui nunca desfaz nem
// esconde a baixa (devolve [] e loga). Regras de texto em avisos-baixa-puro.ts.
import { createServiceClient } from '@/lib/supabase/server'
import { avisosInsumosSemCusto, avisosLotesVencidos, type LoteConsumido } from './avisos-baixa-puro'

type Produto = { descricao: string; unidade: string | null }

async function produtos(lojaId: number, codigos: number[]): Promise<Map<number, Produto>> {
  const out = new Map<number, Produto>()
  const ids = [...new Set(codigos)].slice(0, 500)
  if (!ids.length) return out
  const { data, error } = await createServiceClient().from('produtos').select('codigo_produto, descricao, unidade').eq('loja_id', lojaId).in('codigo_produto', ids)
  if (error) throw new Error(error.message)
  for (const p of data ?? []) out.set(Number(p.codigo_produto), { descricao: String(p.descricao ?? p.codigo_produto), unidade: (p.unidade as string | null) ?? null })
  return out
}

/** Lotes vencidos que estas saídas consumiram (FEFO), na data efetiva de cada movimento. */
export async function avisosLotesDosMovimentos(lojaId: number, movimentoIds: number[]): Promise<string[]> {
  const ids = [...new Set(movimentoIds.filter((x) => Number.isFinite(x) && x > 0))].slice(0, 500)
  if (!ids.length) return []
  try {
    const sb = createServiceClient()
    const [{ data: movs, error: em }, { data: vinc, error: ev }] = await Promise.all([
      sb.from('estoque_movimentos_efetivo').select('id, data_ref, codigo_produto').eq('loja_id', lojaId).in('id', ids),
      sb.from('estoque_lote_movimentos').select('movimento_id, quantidade, estoque_lotes(lote, validade)').eq('loja_id', lojaId).in('movimento_id', ids).lt('quantidade', 0),
    ])
    if (em) throw new Error(em.message)
    if (ev) throw new Error(ev.message)
    const mov = new Map((movs ?? []).map((m) => [Number(m.id), { data: String(m.data_ref).slice(0, 10), produto: Number(m.codigo_produto) }]))
    const nomes = await produtos(lojaId, [...mov.values()].map((m) => m.produto))
    const linhas: LoteConsumido[] = []
    for (const v of vinc ?? []) {
      const m = mov.get(Number(v.movimento_id))
      const l = (Array.isArray(v.estoque_lotes) ? v.estoque_lotes[0] : v.estoque_lotes) as { lote: string | null; validade: string | null } | null
      if (!m || !l) continue
      const p = nomes.get(m.produto)
      linhas.push({ lote: l.lote, validade: l.validade, quantidade: Number(v.quantidade), produto: p?.descricao ?? String(m.produto), unidade: p?.unidade ?? null, dataBaixa: m.data })
    }
    return avisosLotesVencidos(linhas)
  } catch (e) {
    console.error(`avisos-baixa loja ${lojaId}: lotes vencidos`, e instanceof Error ? e.message : e)
    return []
  }
}

/** Avisos de uma produção (ordens_producao_proprio): insumos com custo 0/estimado e lotes vencidos consumidos. */
export async function avisosDaProducao(lojaId: number, ordemPropriaId: number | null | undefined): Promise<string[]> {
  if (!ordemPropriaId) return []
  try {
    const sb = createServiceClient()
    const { data: itens, error } = await sb.from('ordens_producao_proprio_itens').select('codigo_insumo, custo_unitario, movimento_id').eq('ordem_id', ordemPropriaId)
    if (error) throw new Error(error.message)
    const movIds = (itens ?? []).map((i) => Number(i.movimento_id)).filter((x) => x > 0)
    const [{ data: efet, error: ee }, nomes] = await Promise.all([
      movIds.length ? sb.from('estoque_movimentos_efetivo').select('id, custo_unitario, custo_estimado').eq('loja_id', lojaId).in('id', movIds) : Promise.resolve({ data: [], error: null }),
      produtos(lojaId, (itens ?? []).map((i) => Number(i.codigo_insumo))),
    ])
    if (ee) throw new Error(ee.message)
    const ef = new Map((efet ?? []).map((m) => [Number(m.id), { custo: m.custo_unitario == null ? null : Number(m.custo_unitario), estimado: !!m.custo_estimado }]))
    const insumos = (itens ?? []).map((i) => {
      const m = ef.get(Number(i.movimento_id))
      return { produto: nomes.get(Number(i.codigo_insumo))?.descricao ?? String(i.codigo_insumo), custoUnitario: m?.custo ?? (i.custo_unitario == null ? null : Number(i.custo_unitario)), estimado: m?.estimado ?? false }
    })
    return [...avisosInsumosSemCusto(insumos), ...(await avisosLotesDosMovimentos(lojaId, movIds))]
  } catch (e) {
    console.error(`avisos-baixa loja ${lojaId}: produção ${ordemPropriaId}`, e instanceof Error ? e.message : e)
    return []
  }
}
