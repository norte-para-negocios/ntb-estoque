'use server'

import { viaDesktop } from '@/lib/offline/via-desktop'

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export async function login(_prevState: unknown, formData: FormData) {
  const __d = viaDesktop('auth#login', login, [_prevState, formData]); if (__d) return __d as never
  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithPassword({
    email: formData.get('email') as string,
    password: formData.get('password') as string,
  })
  if (error) return { error: 'E-mail ou senha inválidos.' }
  redirect('/home')
}

export async function logout() {
  const __d = viaDesktop('auth#logout', logout, []); if (__d) return __d as never
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}
