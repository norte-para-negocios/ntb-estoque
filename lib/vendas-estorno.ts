import type { SupabaseClient } from '@supabase/supabase-js'
import { logIntegrationAttempt, type LojaOmie } from '@/lib/omie/client'
import { excluirAjusteEstoque } from '@/lib/omie/ajuste'
import { excluirOrdemProducao, reverterOrdemProducao } from '@/lib/omie/ordem-producao'

export type ResultadoEstornoVenda = {
  ajustesExcluidos: number
  opsExcluidas: number
  filaCancelada: number
  falhas: number
  detalhes: string[]
}

const REF = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Desfaz no Omie o que UMA venda do ntb-vendas gerou (nota fiscal cancelada = venda
 * estornada, 2026-09-29): exclui as saídas de estoque (`movimentos` com a obs da venda),
 * as ordens de produção (achadas pelo log de integração, que guarda o pedido na
 * requisição) e cancela o que ainda estava pendente na fila. Idempotente: uma segunda
 * chamada não acha mais nada.
 */
export async function estornarVenda(supabase: SupabaseClient, loja: LojaOmie, pedidoRef: string): Promise<ResultadoEstornoVenda> {
  const r: ResultadoEstornoVenda = { ajustesExcluidos: 0, opsExcluidas: 0, filaCancelada: 0, falhas: 0, detalhes: [] }
  if (!REF.test(pedidoRef)) throw new Error('pedidoRef inválido')
  const marca = `%Venda ntb-vendas #${pedidoRef}%`

  // 1) fila: OP/NFC-e desta venda que ainda não foi (nem deve mais ser) enviada
  const { data: fila } = await supabase
    .from('vendas_integracao_fila')
    .update({ status: 'Erro', ultimo_erro: 'Venda estornada (nota fiscal cancelada)', updated_at: new Date().toISOString() })
    .eq('loja_id', loja.id)
    .eq('status', 'Pendente')
    .eq('ref', pedidoRef)
    .select('id')
  r.filaCancelada = fila?.length ?? 0

  // 2) ordens de produção geradas por esta venda
  const { data: logsOp } = await supabase
    .from('integration_attempts')
    .select('response')
    .eq('loja_id', loja.id)
    .eq('model', 'OrdemProducao')
    .eq('error', false)
    .like('request', marca)
    .like('response', 'nCodOP=%')
  const codigosOp = [...new Set((logsOp ?? []).map((l) => Number(String(l.response).replace('nCodOP=', ''))).filter((n) => Number.isFinite(n) && n > 0))]
  for (const nCodOP of codigosOp) {
    try {
      // Concluída (é como nasce): reverte a conclusão antes de excluir. Se já estava
      // aberta, o Omie recusa a reversão — segue pra exclusão.
      await reverterOrdemProducao(loja, nCodOP).catch(() => {})
      await excluirOrdemProducao(loja, nCodOP)
      await supabase.from('ordens_producao').delete().eq('loja_id', loja.id).eq('identificacao_n_cod_op', nCodOP)
      r.opsExcluidas++
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (/n.o encontrad|n.o existe|inexistente|n.o localizad/i.test(msg)) {
        await supabase.from('ordens_producao').delete().eq('loja_id', loja.id).eq('identificacao_n_cod_op', nCodOP)
        continue
      }
      r.falhas++
      r.detalhes.push(`OP ${nCodOP}: ${msg}`)
    }
  }

  // 3) saídas de estoque (uma por item vendido)
  const { data: movs } = await supabase
    .from('movimentos')
    .select('id, id_ajuste')
    .eq('loja_id', loja.id)
    .eq('tipo', 'SAI')
    .like('obs', marca)
  for (const m of (movs ?? []) as { id: number; id_ajuste: number | null }[]) {
    if (m.id_ajuste) {
      const ok = await excluirAjusteEstoque(loja, Number(m.id_ajuste))
      if (!ok) { r.falhas++; r.detalhes.push(`ajuste ${m.id_ajuste}: falha ao excluir no Omie`); continue }
    }
    await supabase.from('movimentos').delete().eq('id', m.id)
    r.ajustesExcluidos++
  }

  await logIntegrationAttempt({
    loja_id: loja.id,
    model: 'EstornarVenda',
    request: `pedidoRef=${pedidoRef}`,
    response: JSON.stringify(r),
    code: r.falhas ? undefined : '0',
    error: r.falhas > 0,
    error_message: r.falhas ? r.detalhes.join('; ').slice(0, 500) : undefined,
  })
  return r
}
