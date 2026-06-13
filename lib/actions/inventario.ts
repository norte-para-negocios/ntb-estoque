'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import { getPosicaoProduto } from '@/lib/omie/posicao-estoque'
import { omieRequest, logIntegrationAttempt, type LojaOmie } from '@/lib/omie/client'
import { excluirAjusteEstoque } from '@/lib/omie/ajuste'

export async function createInventario(codigoLocalEstoque: number) {
  const lojaId = await getCurrentLojaId()
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('inventarios')
    .insert({
      loja_id: lojaId,
      codigo_local_estoque: codigoLocalEstoque,
      status: 'Em contagem',
    })
    .select('id')
    .single()
  revalidatePath('/inventario')
  return data
}

export async function addInventarioItem(
  inventarioId: number,
  produto: {
    produto_codigo_produto: number
    produto_codigo: string
    produto_descricao: string
    produto_familia: string | null
  }
) {
  const lojaId = await getCurrentLojaId()
  const supabase = createServiceClient()
  await supabase.from('inventario_items').insert({
    loja_id: lojaId,
    inventario_id: inventarioId,
    ...produto,
    status: 'Iniciado',
  })
  revalidatePath(`/inventario/${inventarioId}/contagem`)
}

export async function setQuantidadeInventarioItem(itemId: number, quan: number | null) {
  const lojaId = await getCurrentLojaId()
  const supabase = createServiceClient()
  await supabase
    .from('inventario_items')
    .update({ quan, updated_at: new Date().toISOString() })
    .eq('id', itemId)
    .eq('loja_id', lojaId)
  revalidatePath(`/inventario`)
}

export async function removeInventarioItem(itemId: number) {
  const lojaId = await getCurrentLojaId()
  const supabase = createServiceClient()
  await supabase.from('inventario_items').delete().eq('id', itemId).eq('loja_id', lojaId)
  revalidatePath('/inventario')
}

type InventarioItemRow = {
  id: number
  produto_codigo: string
  produto_codigo_produto: number
  quan: number | null
  status: string | null
  id_ajuste: number | null
}

type InventarioComItens = {
  id: number
  codigo_local_estoque: number
  tipo: string | null
  origem: string | null
  motivo: string | null
  items: InventarioItemRow[]
  loja: LojaOmie
}

/**
 * Processa um unico item do inventario contra o Omie: busca o CMC e lanca o
 * Ajuste de Estoque (IncluirAjusteEstoque). Extraido para reuso entre
 * finishInventario e forceSyncInventario.
 */
async function processarItemInventario(
  inventario: InventarioComItens,
  item: InventarioItemRow,
  lojaId: number,
  hoje: string
) {
  const supabase = createServiceClient()

  if (item.quan === null) {
    await supabase.from('inventario_items').delete().eq('id', item.id)
    return
  }

  try {
    const posicao = await getPosicaoProduto(
      inventario.loja,
      inventario.codigo_local_estoque,
      item.produto_codigo_produto,
      hoje
    )
    const valor = posicao?.n_cmc ?? 0

    if (valor <= 0) {
      await supabase
        .from('inventario_items')
        .update({ status: 'Sem CMC' })
        .eq('id', item.id)
      return
    }

    await supabase
      .from('inventario_items')
      .update({ status: 'Processando', valor })
      .eq('id', item.id)

    // Params do IncluirAjusteEstoque: nomes exatos conforme sistema Laravel original
    const param = {
      codigo_local_estoque: inventario.codigo_local_estoque,
      id_prod: item.produto_codigo_produto,
      cod_int_ajuste: `ITEM${item.id}`,
      data: hoje,
      quan: item.quan,
      valor,
      obs: 'NTB - Estoque',
      origem: inventario.origem || 'AJU',
      tipo: inventario.tipo || 'SLD',
      motivo: inventario.motivo || 'INV',
    }

    const res = await omieRequest<{
      codigo_status?: string
      descricao_status?: string
      id_movest?: number
      id_ajuste?: number
    }>({
      loja_id: lojaId,
      omie_app_key: inventario.loja.omie_app_key,
      omie_app_secret: inventario.loja.omie_app_secret,
      endpoint: 'v1/estoque/ajuste',
      call: 'IncluirAjusteEstoque',
      data: param,
    })

    await logIntegrationAttempt({
      loja_id: lojaId,
      model: 'InventarioItem',
      request: JSON.stringify(param),
      response: JSON.stringify(res),
      code: res.codigo_status ?? '200',
    })

    await supabase
      .from('inventario_items')
      .update({
        status: 'Concluido',
        codigo_status: res.codigo_status ?? null,
        descricao_status: res.descricao_status ?? null,
        id_movest: res.id_movest ?? null,
        id_ajuste: res.id_ajuste ?? null,
        response: JSON.stringify(res),
      })
      .eq('id', item.id)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await supabase
      .from('inventario_items')
      .update({ status: 'Erro', response: msg })
      .eq('id', item.id)
    await logIntegrationAttempt({
      loja_id: lojaId,
      model: 'InventarioItem',
      request: `item ${item.id}`,
      error: true,
      error_message: msg,
    })
  }
}

/**
 * Finaliza o inventario: para cada item, busca o CMC (custo medio) da posicao de
 * estoque no Omie e lanca um Ajuste de Estoque (IncluirAjusteEstoque). Processamento
 * sequencial, sem retry manual item a item (corrige o bug do sistema antigo).
 */
export async function finishInventario(inventarioId: number) {
  const lojaId = await getCurrentLojaId()
  const supabase = createServiceClient()

  await supabase
    .from('inventarios')
    .update({ status: 'Processando no Omie' })
    .eq('id', inventarioId)
    .eq('loja_id', lojaId)

  const { data: inventario } = await supabase
    .from('inventarios')
    .select(
      'id, codigo_local_estoque, tipo, origem, motivo, items:inventario_items(*), loja:lojas(id, omie_app_key, omie_app_secret)'
    )
    .eq('id', inventarioId)
    .eq('loja_id', lojaId)
    .single<InventarioComItens>()

  if (!inventario?.loja) return { error: 'Inventário não encontrado' }

  const hoje = new Date().toLocaleDateString('pt-BR')

  for (const item of inventario.items) {
    await processarItemInventario(inventario, item, lojaId, hoje)
  }

  await supabase
    .from('inventarios')
    .update({ status: 'Finalizado', finalizado: new Date().toISOString() })
    .eq('id', inventarioId)

  revalidatePath('/inventario')
  return { ok: true }
}

/**
 * Reprocessa SOMENTE os itens com falha (status 'Erro' ou null) de um inventario
 * ja finalizado, sem mexer nos itens 'Concluido'. Espelha o forceSync do Laravel.
 */
export async function forceSyncInventario(inventarioId: number) {
  const lojaId = await getCurrentLojaId()
  const supabase = createServiceClient()

  const { data: inventario } = await supabase
    .from('inventarios')
    .select(
      'id, codigo_local_estoque, tipo, origem, motivo, items:inventario_items(*), loja:lojas(id, omie_app_key, omie_app_secret)'
    )
    .eq('id', inventarioId)
    .eq('loja_id', lojaId)
    .single<InventarioComItens>()

  if (!inventario?.loja) return { error: 'Inventário não encontrado' }

  await supabase
    .from('inventarios')
    .update({ status: 'Processando no Omie' })
    .eq('id', inventarioId)
    .eq('loja_id', lojaId)

  const hoje = new Date().toLocaleDateString('pt-BR')

  const pendentes = inventario.items.filter(
    (i) => i.status === 'Erro' || i.status === null || i.status === 'Sem CMC'
  )

  for (const item of pendentes) {
    await processarItemInventario(inventario, item, lojaId, hoje)
  }

  await supabase
    .from('inventarios')
    .update({ status: 'Finalizado', finalizado: new Date().toISOString() })
    .eq('id', inventarioId)

  revalidatePath('/inventario')
  return { ok: true }
}

/**
 * Duplica um inventario: cria um novo (mesmo local, status 'Em contagem') e copia
 * os itens com quan zerada e status 'Iniciado'. Retorna o id do novo inventario.
 */
export async function duplicarInventario(inventarioId: number) {
  const lojaId = await getCurrentLojaId()
  const supabase = createServiceClient()

  const { data: original } = await supabase
    .from('inventarios')
    .select('id, codigo_local_estoque')
    .eq('id', inventarioId)
    .eq('loja_id', lojaId)
    .single<{ id: number; codigo_local_estoque: number }>()

  if (!original) return { error: 'Inventário não encontrado' }

  const { data: novo } = await supabase
    .from('inventarios')
    .insert({
      loja_id: lojaId,
      codigo_local_estoque: original.codigo_local_estoque,
      status: 'Em contagem',
    })
    .select('id')
    .single<{ id: number }>()

  if (!novo) return { error: 'Falha ao criar inventário' }

  const { data: itens } = await supabase
    .from('inventario_items')
    .select('produto_codigo_produto, produto_codigo, produto_descricao, produto_familia')
    .eq('inventario_id', inventarioId)

  if (itens?.length) {
    await supabase.from('inventario_items').insert(
      itens.map((i) => ({
        loja_id: lojaId,
        inventario_id: novo.id,
        produto_codigo_produto: i.produto_codigo_produto,
        produto_codigo: i.produto_codigo,
        produto_descricao: i.produto_descricao,
        produto_familia: i.produto_familia,
        quan: null,
        status: 'Iniciado',
      }))
    )
  }

  revalidatePath('/inventario')
  return { id: novo.id }
}

/**
 * Exclui um inventario: para cada item ja lancado no Omie (id_ajuste), exclui o
 * ajuste de estoque; depois deleta o inventario (cascade remove os itens).
 */
export async function excluirInventario(inventarioId: number) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Inventarios - Excluir'))) {
    return { error: 'Sem permissão para excluir' }
  }
  const supabase = createServiceClient()

  const { data: inventario } = await supabase
    .from('inventarios')
    .select('id, items:inventario_items(id, id_ajuste), loja:lojas(id, omie_app_key, omie_app_secret)')
    .eq('id', inventarioId)
    .eq('loja_id', lojaId)
    .single<{
      id: number
      items: Array<{ id: number; id_ajuste: number | null }>
      loja: LojaOmie
    }>()

  if (!inventario?.loja) return { error: 'Inventário não encontrado' }

  for (const item of inventario.items) {
    if (item.id_ajuste) {
      await excluirAjusteEstoque(inventario.loja, item.id_ajuste)
    }
  }

  await supabase.from('inventarios').delete().eq('id', inventarioId).eq('loja_id', lojaId)

  revalidatePath('/inventario')
  return { ok: true }
}

/**
 * Edita a quantidade de um item. Se o item ja foi lancado no Omie (tem id_ajuste),
 * exclui o ajuste primeiro, limpa os campos de integracao e volta o status para
 * 'Iniciado' antes de gravar a nova quantidade. Espelha editQuantidade do Laravel.
 */
export async function editQuantidadeInventarioItem(itemId: number, quan: number | null) {
  const lojaId = await getCurrentLojaId()
  const supabase = createServiceClient()

  const { data: item } = await supabase
    .from('inventario_items')
    .select('id, id_ajuste, loja:lojas(id, omie_app_key, omie_app_secret)')
    .eq('id', itemId)
    .eq('loja_id', lojaId)
    .single<{ id: number; id_ajuste: number | null; loja: LojaOmie }>()

  if (!item) return { error: 'Item não encontrado' }

  if (item.id_ajuste && item.loja) {
    await excluirAjusteEstoque(item.loja, item.id_ajuste)
    await supabase
      .from('inventario_items')
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
      .eq('id', itemId)
      .eq('loja_id', lojaId)
  } else {
    await supabase
      .from('inventario_items')
      .update({ quan, updated_at: new Date().toISOString() })
      .eq('id', itemId)
      .eq('loja_id', lojaId)
  }

  revalidatePath('/inventario')
  return { ok: true }
}
