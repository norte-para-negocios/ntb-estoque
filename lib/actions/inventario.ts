'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { carimboUsuario, getCurrentLojaId, getUser, requirePermissao } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import { getPosicaoProduto } from '@/lib/omie/posicao-estoque'
import { omieRequest, logIntegrationAttempt, type LojaOmie } from '@/lib/omie/client'
import { excluirAjusteEstoque } from '@/lib/omie/ajuste'
import { dataCriacaoBahia, dataOmieBR, hojeBahiaISO } from '@/lib/data-bahia'

export async function createInventario(codigoLocalEstoque: number, dataEscolhida?: string) {
  const hojeBahia = hojeBahiaISO()
  if (dataEscolhida && dataEscolhida > hojeBahia) {
    return { error: 'A data não pode ser futura' }
  }
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Inventarios - Criar'))) {
    return { error: 'Sem permissao para criar inventario' }
  }
  const userId = (await getUser()).id
  const supabase = createServiceClient()
  // Inventario costuma ser considerado D-1; grava data ancorada ao meio-dia
  // Bahia (a escolhida, ou hoje se vazia) em vez de cair no now() do banco.
  const dataInventario = dataCriacaoBahia(dataEscolhida) ?? dataCriacaoBahia(hojeBahia)!
  const { data: inv, error } = await supabase
    .from('inventarios')
    .insert({
      loja_id: lojaId,
      codigo_local_estoque: codigoLocalEstoque,
      status: 'Em contagem',
      user_id: userId,
      data: dataInventario,
    })
    .select('id')
    .single()
  if (error || !inv) return { error: 'Falha ao criar inventário' }
  revalidatePath('/inventario')
  return inv
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
  if (!(await requirePermissao(lojaId, 'Inventarios - Editar'))) {
    return null
  }
  const supabase = createServiceClient()
  const { data } = await supabase
    .from('inventario_items')
    .insert({
      loja_id: lojaId,
      inventario_id: inventarioId,
      ...produto,
      status: 'Iniciado',
    })
    .select('id, produto_codigo, produto_descricao, produto_familia, quan, status')
    .single()
  revalidatePath(`/inventario/${inventarioId}/contagem`)
  return data
}

/**
 * Resultado do envio item-a-item devolvido para a UI atualizar a linha na hora.
 */
export type EnvioInventarioResult = {
  status: string
  descricao_status: string | null
  valor: number | null
  id_ajuste: number | null
  error?: string
}

/**
 * Envia UM item do inventario ao Omie na hora (item-a-item): grava a quantidade, e se
 * ela for valida (>= 0) busca o CMC e lanca o ajuste de estoque. Se o item ja tinha
 * sido lancado (tem id_ajuste), exclui o ajuste antigo antes de relancar (reprocessa
 * ao mexer na quantidade). Erro num item NAO trava os outros. Retorna o status final
 * para a UI atualizar a linha sem refresh.
 *
 * Obs.: no inventario a contagem PODE ser 0 (zerar o saldo e um ajuste valido), por
 * isso aceitamos quan === 0; so quan null (campo vazio) fica pendente em 'Iniciado'.
 */
export async function enviarInventarioItem(
  itemId: number,
  quan: number | null
): Promise<EnvioInventarioResult> {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Inventarios - Editar'))) {
    return { status: 'Erro', descricao_status: 'Sem permissao para editar', valor: null, id_ajuste: null, error: 'Sem permissao para editar inventario' }
  }
  const supabase = createServiceClient()

  const { data: item } = await supabase
    .from('inventario_items')
    .select(
      'id, produto_codigo, produto_codigo_produto, id_ajuste, inventario:inventarios(id, codigo_local_estoque, tipo, origem, motivo, data, status, loja:lojas(id, omie_app_key, omie_app_secret))'
    )
    .eq('id', itemId)
    .eq('loja_id', lojaId)
    .single<{
      id: number
      produto_codigo: string
      produto_codigo_produto: number
      id_ajuste: number | null
      inventario: {
        id: number
        codigo_local_estoque: number
        tipo: string | null
        origem: string | null
        motivo: string | null
        data: string | null
        status: string | null
        loja: LojaOmie
      } | null
    }>()

  if (!item?.inventario?.loja) {
    return { status: 'Erro', descricao_status: 'Item não encontrado', valor: null, id_ajuste: null, error: 'Item não encontrado' }
  }

  // Ja lancado -> exclui o ajuste antigo antes de relancar (reprocessa ao mexer).
  if (item.id_ajuste) {
    await excluirAjusteEstoque(item.inventario.loja, item.id_ajuste)
    await supabase
      .from('inventario_items')
      .update({ id_ajuste: null, id_movest: null, codigo_status: null, descricao_status: null, response: null })
      .eq('id', item.id)
  }

  // Campo vazio (null): so grava e fica pendente em 'Iniciado'; nao apaga o item.
  if (quan === null) {
    await supabase
      .from('inventario_items')
      .update({ quan: null, status: 'Iniciado', updated_at: new Date().toISOString() })
      .eq('id', item.id)
    revalidatePath('/inventario')
    return { status: 'Iniciado', descricao_status: null, valor: null, id_ajuste: null }
  }

  await supabase
    .from('inventario_items')
    .update({ quan, updated_at: new Date().toISOString() })
    .eq('id', item.id)

  const inventario: InventarioComItens = {
    id: item.inventario.id,
    codigo_local_estoque: item.inventario.codigo_local_estoque,
    tipo: item.inventario.tipo,
    origem: item.inventario.origem,
    motivo: item.inventario.motivo,
    data: item.inventario.data,
    items: [],
    loja: item.inventario.loja,
  }
  const itemRow: InventarioItemRow = {
    id: item.id,
    produto_codigo: item.produto_codigo,
    produto_codigo_produto: item.produto_codigo_produto,
    quan,
    status: 'Iniciado',
    id_ajuste: null,
  }

  const dataAjuste = dataOmieBR(item.inventario.data)
  await processarItemInventario(inventario, itemRow, lojaId, dataAjuste)

  const { data: final } = await supabase
    .from('inventario_items')
    .select('status, descricao_status, valor, id_ajuste')
    .eq('id', item.id)
    .single<{ status: string | null; descricao_status: string | null; valor: number | null; id_ajuste: number | null }>()

  revalidatePath('/inventario')
  return {
    status: final?.status ?? 'Erro',
    descricao_status: final?.descricao_status ?? null,
    valor: final?.valor ?? null,
    id_ajuste: final?.id_ajuste ?? null,
  }
}

export async function removeInventarioItem(itemId: number) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Inventarios - Editar'))) {
    return { error: 'Sem permissao para editar inventario' }
  }
  const supabase = createServiceClient()
  // Se o item ja foi lancado no Omie (id_ajuste), exclui o ajuste de estoque
  // antes de remover a linha — senao o estoque ficaria ajustado sem o item no
  // sistema. Vale para item de inventario finalizado tambem (editar pos-fato).
  const { data: item } = await supabase
    .from('inventario_items')
    .select('id, id_ajuste, loja:lojas(id, omie_app_key, omie_app_secret)')
    .eq('id', itemId)
    .eq('loja_id', lojaId)
    .single<{ id: number; id_ajuste: number | null; loja: LojaOmie }>()
  if (item?.id_ajuste && item.loja) {
    try {
      await excluirAjusteEstoque(item.loja, item.id_ajuste)
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'Falha ao excluir o ajuste no Omie' }
    }
  }
  await supabase.from('inventario_items').delete().eq('id', itemId).eq('loja_id', lojaId)
  revalidatePath('/inventario')
  return { ok: true }
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
  data: string | null
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
  dataAjuste: string // DD/MM/YYYY: data do inventario (vai no lancamento)
) {
  const supabase = createServiceClient()

  if (item.quan === null) {
    await supabase.from('inventario_items').delete().eq('id', item.id)
    return
  }

  // CMC na posicao ATUAL (hoje): custo medio vigente. Apenas a data do lancamento
  // (param.data) usa a data do inventario, que pode ser D-1/retroativa.
  const hojeCmc = dataOmieBR(null)

  try {
    const posicao = await getPosicaoProduto(
      inventario.loja,
      inventario.codigo_local_estoque,
      item.produto_codigo_produto,
      hojeCmc
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
      data: dataAjuste,
      quan: item.quan,
      valor,
      obs: await carimboUsuario(),
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
  if (!(await requirePermissao(lojaId, 'Inventarios - Editar'))) {
    return { error: 'Sem permissao para editar inventario' }
  }
  const supabase = createServiceClient()

  await supabase
    .from('inventarios')
    .update({ status: 'Processando no Omie' })
    .eq('id', inventarioId)
    .eq('loja_id', lojaId)

  const { data: inventario } = await supabase
    .from('inventarios')
    .select(
      'id, codigo_local_estoque, tipo, origem, motivo, data, items:inventario_items(*), loja:lojas(id, omie_app_key, omie_app_secret)'
    )
    .eq('id', inventarioId)
    .eq('loja_id', lojaId)
    .single<InventarioComItens>()

  if (!inventario?.loja) return { error: 'Inventário não encontrado' }

  // Data do ajuste = data do inventario (permite D-1/retroativa), nao a de hoje.
  const dataAjuste = dataOmieBR(inventario.data)

  // Os itens ja integram item-a-item ao sair do campo de quantidade; aqui so
  // processamos os pendentes (sem id_ajuste e ainda nao Concluido). Reprocessar um
  // item ja Concluido (que tem ajuste) duplicaria o lancamento no Omie.
  const pendentes = inventario.items.filter(
    (i) => i.status !== 'Concluido' && i.id_ajuste === null && i.quan !== null
  )
  for (const item of pendentes) {
    await processarItemInventario(inventario, item, lojaId, dataAjuste)
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
  if (!(await requirePermissao(lojaId, 'Inventarios - Editar'))) {
    return { error: 'Sem permissao para editar inventario' }
  }
  const supabase = createServiceClient()

  const { data: inventario } = await supabase
    .from('inventarios')
    .select(
      'id, codigo_local_estoque, tipo, origem, motivo, data, items:inventario_items(*), loja:lojas(id, omie_app_key, omie_app_secret)'
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

  // Data do ajuste = data do inventario (permite D-1/retroativa), nao a de hoje.
  const dataAjuste = dataOmieBR(inventario.data)

  // Reprocessa tudo que nao integrou (Erro/Sem CMC/Processando travado/Iniciado com
  // quantidade), sem tocar nos 'Concluido' (tem ajuste, relancar duplicaria).
  const pendentes = inventario.items.filter(
    (i) => i.status !== 'Concluido' && i.id_ajuste === null && i.quan !== null
  )

  for (const item of pendentes) {
    await processarItemInventario(inventario, item, lojaId, dataAjuste)
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
  if (!(await requirePermissao(lojaId, 'Inventarios - Criar'))) {
    return { error: 'Sem permissao para criar inventario' }
  }
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
  if (!(await requirePermissao(lojaId, 'Inventarios - Editar'))) {
    return { error: 'Sem permissao para editar inventario' }
  }
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
