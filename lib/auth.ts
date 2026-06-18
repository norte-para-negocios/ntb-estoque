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

// Carimbo da observacao das escritas no Omie: "NTB Estoque · <usuario do login>".
// Sem usuario (ex.: sync automatico), cai no rotulo do sistema; nunca inventa nome.
export async function carimboUsuario(): Promise<string> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return 'NTB Estoque'
    const { data } = await supabase
      .from('profiles')
      .select('name')
      .eq('id', user.id)
      .single<{ name: string | null }>()
    return data?.name ? `NTB Estoque · ${data.name}` : 'NTB Estoque'
  } catch {
    return 'NTB Estoque'
  }
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

// Conjunto de NOMES de permissao que o usuario tem na loja informada.
// Admin recebe '*' (tudo) para o chamador tratar como acesso total.
// Usado pelo shell para esconder do menu o que o usuario nao pode ver (4.2).
export async function getPermissoesNomes(lojaId: number | null): Promise<Set<string>> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return new Set()

  const { data: profile } = await supabase
    .from('profiles')
    .select('perfil')
    .eq('id', user.id)
    .single<{ perfil: string | null }>()

  if (profile?.perfil === 'Admin') return new Set(['*'])
  if (!lojaId) return new Set()

  // Junta permissao_user (da loja) com o nome da permissao.
  const { data } = await supabase
    .from('permissao_user')
    .select('permissoes(nome)')
    .eq('user_id', user.id)
    .eq('loja_id', lojaId)
    .returns<{ permissoes: { nome: string } | { nome: string }[] | null }[]>()

  const nomes = new Set<string>()
  for (const row of data ?? []) {
    const p = row.permissoes
    if (!p) continue
    if (Array.isArray(p)) {
      for (const x of p) if (x?.nome) nomes.add(x.nome)
    } else if (p.nome) {
      nomes.add(p.nome)
    }
  }
  return nomes
}
