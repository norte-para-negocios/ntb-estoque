'use server'

import { createClient } from '@/lib/supabase/server'
import { revalidatePath } from 'next/cache'
import { getUser } from '@/lib/auth'

export async function setCurrentLoja(lojaId: number) {
  const user = await getUser()
  const supabase = await createClient()
  await supabase.from('profiles').update({ current_loja_id: lojaId }).eq('id', user.id)
  revalidatePath('/', 'layout')
}
