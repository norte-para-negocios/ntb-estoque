'use server'

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { getUser } from '@/lib/auth'

export async function setCurrentLoja(lojaId: number) {
  const user = await getUser()
  const supabase = await createClient()

  // Valida que o usuario pode acessar essa loja antes de gravar.
  const { data: profile } = await supabase
    .from('profiles')
    .select('perfil')
    .eq('id', user.id)
    .single<{ perfil: string | null }>()

  const isAdmin = profile?.perfil === 'Admin'

  let permitido = false
  if (isAdmin) {
    // Admin: qualquer loja ativa.
    const { data: loja } = await supabase
      .from('lojas')
      .select('id')
      .eq('id', lojaId)
      .eq('ativo', true)
      .maybeSingle()
    permitido = !!loja
  } else {
    // Nao-admin: somente lojas em loja_user do usuario.
    const { data: vinculo } = await supabase
      .from('loja_user')
      .select('id')
      .eq('loja_id', lojaId)
      .eq('user_id', user.id)
      .maybeSingle()
    permitido = !!vinculo
  }

  if (!permitido) {
    return { error: 'Voce nao tem acesso a essa loja' }
  }

  const supabaseService = createServiceClient()
  await supabaseService.from('profiles').update({ current_loja_id: lojaId }).eq('id', user.id)
  revalidatePath('/', 'layout')
  return { ok: true }
}
