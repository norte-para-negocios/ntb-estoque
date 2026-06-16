'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { revalidatePath } from 'next/cache'
import { incluirProduto } from '@/lib/omie/produto'
import type { LojaOmie } from '@/lib/omie/client'

/**
 * Cria um produto no Omie e grava no banco (Bloco 9.1). ESCREVE no Omie.
 * Disparo real apenas com o Ramon (regra: nao escrever no Omie em teste sozinho).
 */
export async function criarProduto(dados: {
  codigo: string
  descricao: string
  unidade: string
  ncm: string
  valorUnitario: number
  tipoItem?: string
}) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Produtos'))) return { error: 'Sem permissão' }

  if (!dados.codigo?.trim()) return { error: 'Informe o código do produto' }
  if (!dados.descricao?.trim()) return { error: 'Informe a descrição' }
  if (!dados.unidade?.trim()) return { error: 'Informe a unidade (ex.: UN, KG)' }
  const ncm = (dados.ncm || '').replace(/\D/g, '')
  if (ncm.length !== 8) return { error: 'O NCM deve ter 8 dígitos' }

  const supabase = createServiceClient()
  const { data: loja } = await supabase
    .from('lojas')
    .select('id, omie_app_key, omie_app_secret')
    .eq('id', lojaId)
    .single<LojaOmie>()
  if (!loja) return { error: 'Loja não encontrada' }

  try {
    const res = await incluirProduto(loja, {
      codigo: dados.codigo.trim(),
      descricao: dados.descricao.trim(),
      unidade: dados.unidade.trim(),
      ncm,
      valorUnitario: Number(dados.valorUnitario) || 0,
      tipoItem: dados.tipoItem?.trim() || undefined,
    })

    // Grava o produto recem-criado direto (sem re-sync pesado de toda a base).
    const codigoProduto = res?.codigo_produto
    if (codigoProduto) {
      await supabase.from('produtos').upsert(
        {
          loja_id: lojaId,
          codigo_produto: codigoProduto,
          codigo: dados.codigo.trim(),
          descricao: dados.descricao.trim(),
          unidade: dados.unidade.trim(),
          ncm,
          valor_unitario: Number(dados.valorUnitario) || 0,
          tipo_item: dados.tipoItem?.trim() || null,
          inativo: false,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'codigo_produto,loja_id' }
      )
    }

    revalidatePath('/produto')
    return { ok: true, codigoProduto }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Falha ao criar o produto no Omie' }
  }
}
