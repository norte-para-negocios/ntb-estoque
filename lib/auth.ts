import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export async function getUser() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')
  return user
}

export type Profile = {
  id: string
  name: string
  current_loja_id: number | null
  perfil: string | null
  status: string | null
  loja: { id: number; nome: string; nome_fantasia: string | null } | null
}

export async function getProfile(): Promise<Profile> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('id, name, current_loja_id, perfil, status, loja:lojas(id, nome, nome_fantasia)')
    .eq('id', user.id)
    .single<Profile>()

  if (!profile) redirect('/login')
  // Conta recem-criada pelo cadastro publico: sem acesso ate o admin aprovar.
  if (profile.status === 'pendente') redirect('/aguardando')
  return profile
}

export async function isAdmin(): Promise<boolean> {
  const profile = await getProfile()
  return profile.perfil === 'Admin'
}

export async function requirePermissao(lojaId: number, permissaoNome: string): Promise<boolean> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: profile } = await supabase
    .from('profiles')
    .select('perfil')
    .eq('id', user.id)
    .single<{ perfil: string | null }>()

  // Admin tem acesso a tudo
  if (profile?.perfil === 'Admin') return true

  const { data: permissao } = await supabase
    .from('permissoes')
    .select('id')
    .eq('nome', permissaoNome)
    .single<{ id: number }>()

  if (!permissao) return false

  const { data } = await supabase
    .from('permissao_user')
    .select('id')
    .eq('loja_id', lojaId)
    .eq('user_id', user.id)
    .eq('permissao_id', permissao.id)
    .maybeSingle()

  return !!data
}

export async function getCurrentLojaId(): Promise<number> {
  const profile = await getProfile()
  if (!profile.current_loja_id) redirect('/home')
  return profile.current_loja_id
}
