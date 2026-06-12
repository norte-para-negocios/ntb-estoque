'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import { getPosicaoProduto } from '@/lib/omie/posicao-estoque'
import { omieRequest, logIntegrationAttempt, type LojaOmie } from '@/lib/omie/client'

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
    .single<{
      id: number
      codigo_local_estoque: number
      tipo: string | null
      origem: string | null
      motivo: string | null
      items: Array<{
        id: number
        produto_codigo: string
        produto_codigo_produto: number
        quan: number | null
      }>
      loja: LojaOmie
    }>()

  if (!inventario?.loja) return { error: 'Inventário não encontrado' }

  const hoje = new Date().toLocaleDateString('pt-BR')

  for (const item of inventario.items) {
    if (item.quan === null) {
      await supabase.from('inventario_items').delete().eq('id', item.id)
      continue
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
        continue
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

  await supabase
    .from('inventarios')
    .update({ status: 'Finalizado', finalizado: new Date().toISOString() })
    .eq('id', inventarioId)

  revalidatePath('/inventario')
  return { ok: true }
}
