import type { SupabaseClient } from '@supabase/supabase-js'
import { logIntegrationAttempt, type LojaOmie } from '@/lib/omie/client'
import { excluirAjusteEstoque } from '@/lib/omie/ajuste'
import { excluirOrdemProducao, reverterOrdemProducao, consultarOPPorCodInt } from '@/lib/omie/ordem-producao'
import { acaoConsultaEstorno, opsParaEstornar, type VinculoOP } from '@/lib/vendas/venda-idempotente'

export type ResultadoEstornoVenda = {
  ajustesExcluidos: number
  opsExcluidas: number
  filaCancelada: number
  falhas: number
  detalhes: string[]
}

/** Vínculo venda→OP desfeito (pelo código, ou pelo nº da OP quando o alvo veio do log). */
async function marcarEstornada(supabase: SupabaseClient, lojaId: number, codInt: string | null, nCodOP: number | null) {
  let q = supabase.from('venda_op_vinculo').update({ estado: 'estornada', atualizado_em: new Date().toISOString() }).eq('loja_id', lojaId)
  if (codInt) q = q.eq('cod_int_op', codInt)
  else if (nCodOP) q = q.eq('n_cod_op', nCodOP)
  else return
  await q
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

  // 2) ordens de produção geradas por esta venda: pelo vínculo venda→OP (migration 178, não é podado) + pelo log de
  // integração (vendas de antes da 178; o sucesso é apagado depois de 2 dias pelo prune).
  const { data: vinculos } = await supabase
    .from('venda_op_vinculo')
    .select('cod_int_op, n_cod_op, estado')
    .eq('loja_id', loja.id)
    .eq('pedido_ref', pedidoRef.toLowerCase())
  const { data: logsOp } = await supabase
    .from('integration_attempts')
    .select('response')
    .eq('loja_id', loja.id)
    .eq('model', 'OrdemProducao')
    .eq('error', false)
    .like('request', marca)
    .like('response', 'nCodOP=%')
  const codigosLog = [...new Set((logsOp ?? []).map((l) => Number(String(l.response).replace('nCodOP=', ''))).filter((n) => Number.isFinite(n) && n > 0))]
  const alvos = opsParaEstornar((vinculos ?? []) as VinculoOP[], codigosLog)
  for (const alvo of alvos) {
    let nCodOP: number | null = 'nCodOP' in alvo ? alvo.nCodOP : null
    const codInt = 'codInt' in alvo ? alvo.codInt : null
    if (codInt) {
      // Vínculo sem nº da OP (a criação caiu no meio): procura no Omie pelo código antes de desistir.
      let achada: { nCodOP: number } | null = null
      let erroConsulta: unknown = null
      try { achada = await consultarOPPorCodInt(loja, codInt) } catch (e) { erroConsulta = e }
      const acao = acaoConsultaEstorno(achada, erroConsulta)
      if (acao === 'falha') {
        r.falhas++
        r.detalhes.push(`OP ${codInt}: não foi possível consultar no Omie (${erroConsulta instanceof Error ? erroConsulta.message : String(erroConsulta)})`)
        continue
      }
      if (acao === 'marcar_estornada' || !achada) { await marcarEstornada(supabase, loja.id, codInt, null); continue }
      nCodOP = achada.nCodOP
    }
    if (!nCodOP) continue
    try {
      // Concluída (é como nasce): reverte a conclusão antes de excluir. Se já estava
      // aberta, o Omie recusa a reversão — segue pra exclusão.
      await reverterOrdemProducao(loja, nCodOP).catch(() => {})
      await excluirOrdemProducao(loja, nCodOP)
      await supabase.from('ordens_producao').delete().eq('loja_id', loja.id).eq('identificacao_n_cod_op', nCodOP)
      await marcarEstornada(supabase, loja.id, codInt, nCodOP)
      r.opsExcluidas++
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (/n.o encontrad|n.o existe|inexistente|n.o localizad/i.test(msg)) {
        await supabase.from('ordens_producao').delete().eq('loja_id', loja.id).eq('identificacao_n_cod_op', nCodOP)
        await marcarEstornada(supabase, loja.id, codInt, nCodOP)
        continue
      }
      r.falhas++
      r.detalhes.push(`OP ${nCodOP}: ${msg}`)
    }
  }

  // 3) saídas de estoque (uma por item vendido)
  const { data: movs, error: eMovs } = await supabase
    .from('movimentos')
    .select('id, id_ajuste')
    .eq('loja_id', loja.id)
    .eq('tipo', 'SAI')
    // Venda com nota grava obs "Cupom N" e a marca da venda em obs_item (15/10/2026).
    .or(`obs.like.*Venda ntb-vendas #${pedidoRef}*,obs_item.like.*Venda ntb-vendas #${pedidoRef}*`)
  if (eMovs) { r.falhas++; r.detalhes.push(`saídas de estoque: ${eMovs.message}`) }
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
