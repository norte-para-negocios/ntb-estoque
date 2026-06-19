'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { carimboUsuario, getCurrentLojaId, getUser, requirePermissao } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import { getPosicaoProduto } from '@/lib/omie/posicao-estoque'
import { omieRequest, logIntegrationAttempt, type LojaOmie } from '@/lib/omie/client'
import { excluirAjusteEstoque } from '@/lib/omie/ajuste'
import { dataCriacaoBahia, dataOmieBR, hojeBahiaISO } from '@/lib/data-bahia'
import type { TipoTransferencia } from '@/lib/transferencia-tipos'

export async function createTransferencia(data: {
  codigoLocalOrigem: number
  codigoLocalDestino: number
  tipo: TipoTransferencia
  data?: string // YYYY-MM-DD; vazio = hoje. Pode ser retroativa, nao futura.
}) {
  if (data.codigoLocalOrigem === data.codigoLocalDestino) {
    return { error: 'Origem e destino não podem ser o mesmo local' }
  }
  if (data.tipo !== 'TRF' && data.tipo !== 'TPQ') {
    return { error: 'Tipo de transferência inválido' }
  }
  const hojeBahia = hojeBahiaISO()
  if (data.data && data.data > hojeBahia) {
    return { error: 'A data não pode ser futura' }
  }
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Transferencias - Criar'))) {
    return { error: 'Sem permissao para criar transferencia' }
  }
  const userId = (await getUser()).id
  const supabase = createServiceClient()
  // Sempre grava data ancorada ao meio-dia Bahia: a escolhida, ou hoje se vier
  // vazia (evita cair no now() do banco, que perde a ancoragem de fuso).
  const dataCriacao = dataCriacaoBahia(data.data) ?? dataCriacaoBahia(hojeBahia)!
  const { data: trans } = await supabase
    .from('transferencias')
    .insert({
      loja_id: lojaId,
      codigo_local_origem: data.codigoLocalOrigem,
      codigo_local_destino: data.codigoLocalDestino,
      motivo: data.tipo, // guarda o tipo (TRF/TPQ); vira o `tipo` do ajuste no Omie
      status: 'Em contagem',
      user_id: userId,
      data: dataCriacao,
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
  if (!(await requirePermissao(lojaId, 'Transferencias - Editar'))) {
    return null
  }
  const supabase = createServiceClient()

  const { data: trans } = await supabase
    .from('transferencias')
    .select('codigo_local_origem, codigo_local_destino, motivo')
    .eq('id', transferenciaId)
    .eq('loja_id', lojaId)
    .single()

  if (!trans) return null

  // motivo da transferencia guarda o tipo escolhido (TRF/TPQ); fallback TRF.
  const tipo = trans.motivo === 'TPQ' ? 'TPQ' : 'TRF'

  const { data } = await supabase
    .from('movimentos')
    .insert({
      loja_id: lojaId,
      transferencia_id: transferenciaId,
      tipo,
      origem: 'AJU',
      motivo: tipo,
      data: new Date().toISOString(),
      id_prod: produto.id_prod,
      codigo_local_estoque: trans.codigo_local_origem,
      codigo_local_estoque_destino: trans.codigo_local_destino,
      status: 'Iniciado',
    })
    .select('id')
    .single()
  revalidatePath(`/transferencia/${transferenciaId}/contagem`)
  return data
}

/**
 * Resultado do envio item-a-item devolvido para a UI atualizar a linha na hora.
 */
export type EnvioMovimentoResult = {
  status: string
  descricao_status: string | null
  valor: number | null
  id_ajuste: number | null
  error?: string
}

/**
 * Envia UM movimento ao Omie na hora (item-a-item): grava a quantidade, e se ela
 * for valida (> 0) busca o CMC e lanca o ajuste de estoque. Se o item ja tinha sido
 * lancado (tem id_ajuste), exclui o ajuste antigo antes de relancar (reprocessa ao
 * mexer na quantidade). Erro num item NAO afeta os outros. Retorna o status final
 * para a UI atualizar a linha sem refresh.
 */
export async function enviarMovimento(
  movimentoId: number,
  quan: number | null
): Promise<EnvioMovimentoResult> {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Transferencias - Editar'))) {
    return { status: 'Erro', descricao_status: 'Sem permissao para editar', valor: null, id_ajuste: null, error: 'Sem permissao para editar transferencia' }
  }
  const supabase = createServiceClient()

  // Carrega o movimento + transferencia + loja num so passo.
  const { data: mov } = await supabase
    .from('movimentos')
    .select(
      'id, id_prod, codigo_local_estoque, codigo_local_estoque_destino, tipo, id_ajuste, transferencia:transferencias(id, codigo_local_origem, motivo, data, status, loja:lojas(id, omie_app_key, omie_app_secret))'
    )
    .eq('id', movimentoId)
    .eq('loja_id', lojaId)
    .single<{
      id: number
      id_prod: number
      codigo_local_estoque: number
      codigo_local_estoque_destino: number
      tipo: string
      id_ajuste: number | null
      transferencia: {
        id: number
        codigo_local_origem: number
        motivo: string | null
        data: string | null
        status: string | null
        loja: LojaOmie
      } | null
    }>()

  if (!mov?.transferencia?.loja) {
    return { status: 'Erro', descricao_status: 'Movimento não encontrado', valor: null, id_ajuste: null, error: 'Movimento não encontrado' }
  }

  // Se ja foi lancado, exclui o ajuste antigo antes de relancar (mexeu na quantidade
  // -> reprocessa). Limpa os campos de integracao pra nao deixar estado velho.
  if (mov.id_ajuste) {
    await excluirAjusteEstoque(mov.transferencia.loja, mov.id_ajuste)
    await supabase
      .from('movimentos')
      .update({ id_ajuste: null, id_movest: null, codigo_status: null, descricao_status: null, response: null })
      .eq('id', mov.id)
  }

  // Quantidade vazia/zerada: so grava e marca 'Iniciado' (sem mandar pro Omie). Nao
  // apaga o item (evita o bug do produto que "some"); o usuario segue contando.
  if (quan === null || !(quan > 0)) {
    await supabase
      .from('movimentos')
      .update({ quan, status: 'Iniciado', updated_at: new Date().toISOString() })
      .eq('id', mov.id)
    revalidatePath('/transferencia')
    return { status: 'Iniciado', descricao_status: null, valor: null, id_ajuste: null }
  }

  await supabase
    .from('movimentos')
    .update({ quan, updated_at: new Date().toISOString() })
    .eq('id', mov.id)

  const trans: TransferenciaComMovimentos = {
    id: mov.transferencia.id,
    codigo_local_origem: mov.transferencia.codigo_local_origem,
    motivo: mov.transferencia.motivo,
    data: mov.transferencia.data,
    movimentos: [],
    loja: mov.transferencia.loja,
  }
  const movRow: MovimentoRow = {
    id: mov.id,
    id_prod: mov.id_prod,
    codigo_local_estoque: mov.codigo_local_estoque,
    codigo_local_estoque_destino: mov.codigo_local_estoque_destino,
    tipo: mov.tipo,
    quan,
    status: 'Iniciado',
    id_ajuste: null,
  }

  const dataMov = dataOmieBR(mov.transferencia.data)
  await processarMovimento(trans, movRow, lojaId, dataMov, await carimboUsuario())

  // Le o resultado final que processarMovimento gravou.
  const { data: final } = await supabase
    .from('movimentos')
    .select('status, descricao_status, valor, id_ajuste')
    .eq('id', mov.id)
    .single<{ status: string | null; descricao_status: string | null; valor: number | null; id_ajuste: number | null }>()

  revalidatePath('/transferencia')
  return {
    status: final?.status ?? 'Erro',
    descricao_status: final?.descricao_status ?? null,
    valor: final?.valor ?? null,
    id_ajuste: final?.id_ajuste ?? null,
  }
}

export async function removeMovimento(movimentoId: number) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Transferencias - Editar'))) {
    return { error: 'Sem permissao para editar transferencia' }
  }
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
  data: string | null
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
  dataMov: string, // DD/MM/YYYY: data da transferencia (vai no lancamento)
  obsCarimbo: string // "NTB Estoque · <usuario>" — quem fez a transferencia
) {
  const supabase = createServiceClient()

  if (mov.quan === null) {
    await supabase.from('movimentos').delete().eq('id', mov.id)
    return
  }

  // O CMC e buscado na posicao ATUAL (hoje): e o custo medio vigente. Buscar na
  // data retroativa marcaria "Sem CMC" produtos que so ganharam custo depois.
  // Apenas a DATA DO LANCAMENTO (param.data) usa a data da transferencia.
  const hojeCmc = dataOmieBR(null)

  try {
    const posicao = await getPosicaoProduto(
      trans.loja,
      mov.codigo_local_estoque,
      mov.id_prod,
      hojeCmc
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
      data: dataMov,
      quan: mov.quan,
      valor,
      obs: obsCarimbo,
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
  if (!(await requirePermissao(lojaId, 'Transferencias - Editar'))) {
    return { error: 'Sem permissao para editar transferencia' }
  }
  const supabase = createServiceClient()

  await supabase
    .from('transferencias')
    .update({ status: 'Processando no Omie' })
    .eq('id', transferenciaId)
    .eq('loja_id', lojaId)

  const { data: trans } = await supabase
    .from('transferencias')
    .select(
      'id, codigo_local_origem, motivo, data, movimentos(*), loja:lojas(id, omie_app_key, omie_app_secret)'
    )
    .eq('id', transferenciaId)
    .eq('loja_id', lojaId)
    .single<TransferenciaComMovimentos>()

  if (!trans?.loja) return { error: 'Transferência não encontrada' }

  // Data do ajuste = data da transferencia (permite retroativa), nao a de hoje.
  const dataMov = dataOmieBR(trans.data)

  // Como os itens ja integram item-a-item ao sair do campo de quantidade, aqui so
  // processamos os que ficaram pendentes (sem id_ajuste e ainda nao Concluido).
  // Reprocessar um 'Concluido' (que ja tem ajuste) duplicaria o lancamento no Omie.
  const pendentes = trans.movimentos.filter(
    (m) => m.status !== 'Concluido' && m.id_ajuste === null && m.quan !== null && m.quan > 0
  )
  for (const mov of pendentes) {
    await processarMovimento(trans, mov, lojaId, dataMov, await carimboUsuario())
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
  if (!(await requirePermissao(lojaId, 'Transferencias - Editar'))) {
    return { error: 'Sem permissao para editar transferencia' }
  }
  const supabase = createServiceClient()

  const { data: trans } = await supabase
    .from('transferencias')
    .select(
      'id, codigo_local_origem, motivo, data, movimentos(*), loja:lojas(id, omie_app_key, omie_app_secret)'
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

  // Data do ajuste = data da transferencia (permite retroativa), nao a de hoje.
  const dataMov = dataOmieBR(trans.data)

  // Reprocessa tudo que nao integrou ainda (Erro/Processando travado/Iniciado com
  // quantidade), sem tocar nos 'Concluido' (tem ajuste, relancar duplicaria).
  const pendentes = trans.movimentos.filter(
    (m) =>
      m.status !== 'Concluido' &&
      m.id_ajuste === null &&
      m.quan !== null &&
      m.quan > 0
  )

  for (const mov of pendentes) {
    await processarMovimento(trans, mov, lojaId, dataMov, await carimboUsuario())
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
  if (!(await requirePermissao(lojaId, 'Transferencias - Criar'))) {
    return { error: 'Sem permissao para criar transferencia' }
  }
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
    const tipo = original.motivo === 'TPQ' ? 'TPQ' : 'TRF'
    await supabase.from('movimentos').insert(
      movimentos.map((m) => ({
        loja_id: lojaId,
        transferencia_id: nova.id,
        id_prod: m.id_prod,
        codigo_local_estoque: m.codigo_local_estoque,
        codigo_local_estoque_destino: m.codigo_local_estoque_destino,
        tipo,
        origem: 'AJU',
        motivo: tipo,
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
  if (!(await requirePermissao(lojaId, 'Transferencias - Editar'))) {
    return { error: 'Sem permissao para editar transferencia' }
  }
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
