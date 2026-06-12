'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import { getPosicaoProduto } from '@/lib/omie/posicao-estoque'
import { omieRequest, logIntegrationAttempt, type LojaOmie } from '@/lib/omie/client'

export async function createTransferencia(data: {
  codigoLocalOrigem: number
  codigoLocalDestino: number
  motivo: string
}) {
  if (data.codigoLocalOrigem === data.codigoLocalDestino) {
    return { error: 'Origem e destino nao podem ser o mesmo local' }
  }
  const lojaId = await getCurrentLojaId()
  const supabase = createServiceClient()
  const { data: trans } = await supabase
    .from('transferencias')
    .insert({
      loja_id: lojaId,
      codigo_local_origem: data.codigoLocalOrigem,
      codigo_local_destino: data.codigoLocalDestino,
      motivo: data.motivo,
      status: 'Em contagem',
    })
    .select('id')
    .single()
  revalidatePath('/transferencia')
  return { id: trans?.id }
}

export async function addMovimento(
  transferenciaId: number,
  produto: { id_prod: number }
) {
  const lojaId = await getCurrentLojaId()
  const supabase = createServiceClient()

  const { data: trans } = await supabase
    .from('transferencias')
    .select('codigo_local_origem, codigo_local_destino')
    .eq('id', transferenciaId)
    .eq('loja_id', lojaId)
    .single()

  if (!trans) return

  await supabase.from('movimentos').insert({
    loja_id: lojaId,
    transferencia_id: transferenciaId,
    tipo: 'TRF',
    origem: 'AJU',
    motivo: 'TRF',
    data: new Date().toISOString(),
    id_prod: produto.id_prod,
    codigo_local_estoque: trans.codigo_local_origem,
    codigo_local_estoque_destino: trans.codigo_local_destino,
    status: 'Iniciado',
  })
  revalidatePath(`/transferencia/${transferenciaId}/contagem`)
}

export async function setQuantidadeMovimento(movimentoId: number, quan: number | null) {
  const lojaId = await getCurrentLojaId()
  const supabase = createServiceClient()
  await supabase
    .from('movimentos')
    .update({ quan, updated_at: new Date().toISOString() })
    .eq('id', movimentoId)
    .eq('loja_id', lojaId)
  revalidatePath('/transferencia')
}

export async function removeMovimento(movimentoId: number) {
  const lojaId = await getCurrentLojaId()
  const supabase = createServiceClient()
  await supabase.from('movimentos').delete().eq('id', movimentoId).eq('loja_id', lojaId)
  revalidatePath('/transferencia')
}

/**
 * Finaliza a transferencia: para cada movimento, busca o CMC e lanca o ajuste de
 * estoque tipo TRF (origem -> destino) no Omie. Sequencial, sem retry manual.
 */
export async function finishTransferencia(transferenciaId: number) {
  const lojaId = await getCurrentLojaId()
  const supabase = createServiceClient()

  await supabase
    .from('transferencias')
    .update({ status: 'Processando no Omie' })
    .eq('id', transferenciaId)
    .eq('loja_id', lojaId)

  const { data: trans } = await supabase
    .from('transferencias')
    .select(
      'id, codigo_local_origem, motivo, movimentos(*), loja:lojas(id, omie_app_key, omie_app_secret)'
    )
    .eq('id', transferenciaId)
    .eq('loja_id', lojaId)
    .single<{
      id: number
      codigo_local_origem: number
      motivo: string | null
      movimentos: Array<{
        id: number
        id_prod: number
        codigo_local_estoque: number
        codigo_local_estoque_destino: number
        tipo: string
        quan: number | null
      }>
      loja: LojaOmie
    }>()

  if (!trans?.loja) return { error: 'Transferencia nao encontrada' }

  const hoje = new Date().toLocaleDateString('pt-BR')

  for (const mov of trans.movimentos) {
    if (mov.quan === null) {
      await supabase.from('movimentos').delete().eq('id', mov.id)
      continue
    }

    try {
      const posicao = await getPosicaoProduto(
        trans.loja,
        mov.codigo_local_estoque,
        mov.id_prod,
        hoje
      )
      const valor = posicao?.n_cmc ?? 0

      if (valor <= 0) {
        await supabase
          .from('movimentos')
          .update({ status: 'Erro', descricao_status: 'Sem CMC' })
          .eq('id', mov.id)
        continue
      }

      await supabase
        .from('movimentos')
        .update({ status: 'Processando', valor })
        .eq('id', mov.id)

      const param = {
        codigo_local_estoque: mov.codigo_local_estoque,
        id_prod: mov.id_prod,
        cod_int_ajuste: `MOV-${mov.id}`,
        data: hoje,
        quan: mov.quan,
        valor,
        obs: 'NTB - Estoque',
        origem: 'AJU',
        tipo: mov.tipo,
        motivo: trans.motivo || 'TRF',
        codigo_local_estoque_destino: mov.codigo_local_estoque_destino,
      }

      const res = await omieRequest<{
        codigo_status?: string
        descricao_status?: string
        id_movest?: number
        id_ajuste?: number
      }>({
        loja_id: lojaId,
        omie_app_key: trans.loja.omie_app_key,
        omie_app_secret: trans.loja.omie_app_secret,
        endpoint: 'v1/estoque/ajuste',
        call: 'IncluirAjusteEstoque',
        data: param,
      })

      await logIntegrationAttempt({
        loja_id: lojaId,
        model: 'Movimento',
        request: JSON.stringify(param),
        response: JSON.stringify(res),
        code: res.codigo_status ?? '200',
      })

      await supabase
        .from('movimentos')
        .update({
          status: 'Concluido',
          codigo_status: res.codigo_status ?? null,
          descricao_status: res.descricao_status ?? null,
          id_movest: res.id_movest ?? null,
          id_ajuste: res.id_ajuste ?? null,
          response: JSON.stringify(res),
        })
        .eq('id', mov.id)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      await supabase
        .from('movimentos')
        .update({ status: 'Erro', response: msg })
        .eq('id', mov.id)
      await logIntegrationAttempt({
        loja_id: lojaId,
        model: 'Movimento',
        request: `movimento ${mov.id}`,
        error: true,
        error_message: msg,
      })
    }
  }

  await supabase
    .from('transferencias')
    .update({ status: 'Concluido', updated_at: new Date().toISOString() })
    .eq('id', transferenciaId)

  revalidatePath('/transferencia')
  return { ok: true }
}
