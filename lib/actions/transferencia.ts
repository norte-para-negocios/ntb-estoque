'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import { getPosicaoProduto } from '@/lib/omie/posicao-estoque'
import { omieRequest, logIntegrationAttempt, type LojaOmie } from '@/lib/omie/client'
import { excluirAjusteEstoque } from '@/lib/omie/ajuste'

export async function createTransferencia(data: {
  codigoLocalOrigem: number
  codigoLocalDestino: number
  motivo: string
}) {
  if (data.codigoLocalOrigem === data.codigoLocalDestino) {
    return { error: 'Origem e destino não podem ser o mesmo local' }
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

type MovimentoRow = {
  id: number
  id_prod: number
  codigo_local_estoque: number
  codigo_local_estoque_destino: number
  tipo: string
  quan: number | null
  status: string | null
  id_ajuste: number | null
}

type TransferenciaComMovimentos = {
  id: number
  codigo_local_origem: number
  motivo: string | null
  movimentos: MovimentoRow[]
  loja: LojaOmie
}

/**
 * Processa um unico movimento de transferencia contra o Omie: busca o CMC e lanca o
 * ajuste de estoque tipo TRF (origem -> destino). Extraido para reuso entre
 * finishTransferencia e forceSyncTransferencia.
 */
async function processarMovimento(
  trans: TransferenciaComMovimentos,
  mov: MovimentoRow,
  lojaId: number,
  hoje: string
) {
  const supabase = createServiceClient()

  if (mov.quan === null) {
    await supabase.from('movimentos').delete().eq('id', mov.id)
    return
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
      return
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
    .single<TransferenciaComMovimentos>()

  if (!trans?.loja) return { error: 'Transferência não encontrada' }

  const hoje = new Date().toLocaleDateString('pt-BR')

  for (const mov of trans.movimentos) {
    await processarMovimento(trans, mov, lojaId, hoje)
  }

  await supabase
    .from('transferencias')
    .update({ status: 'Concluido', updated_at: new Date().toISOString() })
    .eq('id', transferenciaId)

  revalidatePath('/transferencia')
  return { ok: true }
}

/**
 * Reprocessa SOMENTE os movimentos com falha (status 'Erro' ou null) de uma
 * transferencia ja concluida, sem mexer nos 'Concluido'. Espelha o forceSync do Laravel.
 */
export async function forceSyncTransferencia(transferenciaId: number) {
  const lojaId = await getCurrentLojaId()
  const supabase = createServiceClient()

  const { data: trans } = await supabase
    .from('transferencias')
    .select(
      'id, codigo_local_origem, motivo, movimentos(*), loja:lojas(id, omie_app_key, omie_app_secret)'
    )
    .eq('id', transferenciaId)
    .eq('loja_id', lojaId)
    .single<TransferenciaComMovimentos>()

  if (!trans?.loja) return { error: 'Transferência não encontrada' }

  await supabase
    .from('transferencias')
    .update({ status: 'Processando no Omie' })
    .eq('id', transferenciaId)
    .eq('loja_id', lojaId)

  const hoje = new Date().toLocaleDateString('pt-BR')

  const pendentes = trans.movimentos.filter(
    (m) => m.status === 'Erro' || m.status === null
  )

  for (const mov of pendentes) {
    await processarMovimento(trans, mov, lojaId, hoje)
  }

  await supabase
    .from('transferencias')
    .update({ status: 'Concluido', updated_at: new Date().toISOString() })
    .eq('id', transferenciaId)

  revalidatePath('/transferencia')
  return { ok: true }
}

/**
 * Duplica uma transferencia: copia origem/destino/motivo (status 'Em contagem') e
 * os movimentos com quan zerada e status 'Iniciado'. Retorna o id da nova.
 */
export async function duplicarTransferencia(transferenciaId: number) {
  const lojaId = await getCurrentLojaId()
  const supabase = createServiceClient()

  const { data: original } = await supabase
    .from('transferencias')
    .select('id, codigo_local_origem, codigo_local_destino, motivo')
    .eq('id', transferenciaId)
    .eq('loja_id', lojaId)
    .single<{
      id: number
      codigo_local_origem: number
      codigo_local_destino: number
      motivo: string | null
    }>()

  if (!original) return { error: 'Transferência não encontrada' }

  const { data: nova } = await supabase
    .from('transferencias')
    .insert({
      loja_id: lojaId,
      codigo_local_origem: original.codigo_local_origem,
      codigo_local_destino: original.codigo_local_destino,
      motivo: original.motivo,
      status: 'Em contagem',
    })
    .select('id')
    .single<{ id: number }>()

  if (!nova) return { error: 'Falha ao criar transferência' }

  const { data: movimentos } = await supabase
    .from('movimentos')
    .select('id_prod, codigo_local_estoque, codigo_local_estoque_destino')
    .eq('transferencia_id', transferenciaId)

  if (movimentos?.length) {
    await supabase.from('movimentos').insert(
      movimentos.map((m) => ({
        loja_id: lojaId,
        transferencia_id: nova.id,
        id_prod: m.id_prod,
        codigo_local_estoque: m.codigo_local_estoque,
        codigo_local_estoque_destino: m.codigo_local_estoque_destino,
        tipo: 'TRF',
        origem: 'AJU',
        motivo: 'TRF',
        data: new Date().toISOString(),
        quan: null,
        status: 'Iniciado',
      }))
    )
  }

  revalidatePath('/transferencia')
  return { id: nova.id }
}

/**
 * Exclui uma transferencia: para cada movimento ja lancado no Omie (id_ajuste),
 * exclui o ajuste de estoque; depois deleta a transferencia (cascade remove os movimentos).
 */
export async function excluirTransferencia(transferenciaId: number) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Transferencias - Excluir'))) {
    return { error: 'Sem permissão para excluir' }
  }
  const supabase = createServiceClient()

  const { data: trans } = await supabase
    .from('transferencias')
    .select('id, movimentos(id, id_ajuste), loja:lojas(id, omie_app_key, omie_app_secret)')
    .eq('id', transferenciaId)
    .eq('loja_id', lojaId)
    .single<{
      id: number
      movimentos: Array<{ id: number; id_ajuste: number | null }>
      loja: LojaOmie
    }>()

  if (!trans?.loja) return { error: 'Transferência não encontrada' }

  for (const mov of trans.movimentos) {
    if (mov.id_ajuste) {
      await excluirAjusteEstoque(trans.loja, mov.id_ajuste)
    }
  }

  await supabase.from('transferencias').delete().eq('id', transferenciaId).eq('loja_id', lojaId)

  revalidatePath('/transferencia')
  return { ok: true }
}

/**
 * Edita a quantidade de um movimento. Se ja foi lancado no Omie (tem id_ajuste),
 * exclui o ajuste primeiro, limpa os campos de integracao e volta o status para
 * 'Iniciado' antes de gravar a nova quantidade. Espelha editQuantidade do Laravel.
 */
export async function editQuantidadeMovimento(movId: number, quan: number | null) {
  const lojaId = await getCurrentLojaId()
  const supabase = createServiceClient()

  const { data: mov } = await supabase
    .from('movimentos')
    .select('id, id_ajuste, loja:lojas(id, omie_app_key, omie_app_secret)')
    .eq('id', movId)
    .eq('loja_id', lojaId)
    .single<{ id: number; id_ajuste: number | null; loja: LojaOmie }>()

  if (!mov) return { error: 'Movimento não encontrado' }

  if (mov.id_ajuste && mov.loja) {
    await excluirAjusteEstoque(mov.loja, mov.id_ajuste)
    await supabase
      .from('movimentos')
      .update({
        quan,
        status: 'Iniciado',
        id_ajuste: null,
        id_movest: null,
        codigo_status: null,
        descricao_status: null,
        response: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', movId)
      .eq('loja_id', lojaId)
  } else {
    await supabase
      .from('movimentos')
      .update({ quan, updated_at: new Date().toISOString() })
      .eq('id', movId)
      .eq('loja_id', lojaId)
  }

  revalidatePath('/transferencia')
  return { ok: true }
}
