'use server'

import { createServiceClient } from '@/lib/supabase/server'
import { getCurrentLojaId } from '@/lib/auth'
import { revalidatePath } from 'next/cache'

export async function setQuantidadeNFItem(itemId: number, quantidade: number | null) {
  const lojaId = await getCurrentLojaId()
  const supabase = createServiceClient()
  await supabase
    .from('nota_fiscal_items')
    .update({ quantidade, updated_at: new Date().toISOString() })
    .eq('id', itemId)
    .eq('loja_id', lojaId)
  revalidatePath('/nota-fiscal', 'page')
}

export async function setCategoriaContabilNFItem(itemId: number, categoriaId: number | null) {
  const lojaId = await getCurrentLojaId()
  const supabase = createServiceClient()
  await supabase
    .from('nota_fiscal_items')
    .update({ categoria_contabil_id: categoriaId, updated_at: new Date().toISOString() })
    .eq('id', itemId)
    .eq('loja_id', lojaId)
  revalidatePath('/nota-fiscal', 'page')
}
