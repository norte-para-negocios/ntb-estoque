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

// Admin GLOBAL: vê todas as lojas, todos os módulos, administração global
// (Lojas, Logs, Saúde da integração, Usuários). NÃO inclui o Admin de loja.
export async function isAdmin(): Promise<boolean> {
  const profile = await getProfile()
  return profile.perfil === 'Admin'
}

// Admin de loja: acesso TOTAL aos módulos das lojas vinculadas (loja_user), mas
// NÃO é admin global. Retorna true se o perfil é 'AdminLoja' e a loja informada
// (ou a loja atual) está entre as lojas do usuário.
export async function isAdminDaLoja(lojaId?: number): Promise<boolean> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return false

  const { data: profile } = await supabase
    .from('profiles')
    .select('perfil, current_loja_id')
    .eq('id', user.id)
    .single<{ perfil: string | null; current_loja_id: number | null }>()

  if (profile?.perfil !== 'AdminLoja') return false
  const alvo = lojaId ?? profile.current_loja_id
  if (!alvo) return false

  const { data: vinculo } = await supabase
    .from('loja_user')
    .select('id')
    .eq('user_id', user.id)
    .eq('loja_id', alvo)
    .maybeSingle()
  return !!vinculo
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

  // Admin global tem acesso a tudo.
  if (profile?.perfil === 'Admin') return true

  // Admin de loja: acesso total aos modulos da(s) loja(s) vinculada(s).
  if (profile?.perfil === 'AdminLoja') {
    const { data: vinculo } = await supabase
      .from('loja_user')
      .select('id')
      .eq('user_id', user.id)
      .eq('loja_id', lojaId)
      .maybeSingle()
    if (vinculo) return true
  }

  const { data: permissao } = await supabase
    .from('permissoes')
    .select('id')
    .eq('nome', permissaoNome)
    .single<{ id: number }>()

  if (!permissao) return false

  // Permissão DIRETA do usuário (override avulso por loja).
  const { data: direta } = await supabase
    .from('permissao_user')
    .select('id')
    .eq('loja_id', lojaId)
    .eq('user_id', user.id)
    .eq('permissao_id', permissao.id)
    .maybeSingle()
  if (direta) return true

  // Permissão herdada do CARGO do usuário NESTA loja (loja_user.cargo_id).
  const { data: vinc } = await supabase
    .from('loja_user')
    .select('cargo_id')
    .eq('user_id', user.id)
    .eq('loja_id', lojaId)
    .maybeSingle<{ cargo_id: number | null }>()
  if (vinc?.cargo_id) {
    const { data: doCargo } = await supabase
      .from('cargo_permissao')
      .select('cargo_id')
      .eq('cargo_id', vinc.cargo_id)
      .eq('permissao_id', permissao.id)
      .maybeSingle()
    if (doCargo) return true
  }

  return false
}

export async function getCurrentLojaId(): Promise<number> {
  const profile = await getProfile()
  if (!profile.current_loja_id) redirect('/home')
  return profile.current_loja_id
}

// Ator da GESTAO DE USUARIOS (frente C). Resume quem esta agindo nas telas/acoes
// de usuario, para escopar Admin global x AdminLoja:
//  - Admin global ('Admin'): gere tudo, todas as lojas, qualquer perfil.
//  - AdminLoja: gere SO as lojas dele (loja_user), so cria/convida/aprova perfil
//    'Usuario', e so concede permissoes que ele mesmo tem (todas, ja que AdminLoja
//    tem acesso total as lojas dele -> '*').
//  - Outros perfis: nao podem gerir (podeGerir = false).
// Esta funcao e a fonte de verdade no SERVIDOR; a UI so reflete o que ela diz.
export type AtorGestao = {
  id: string
  perfil: string | null
  isAdminGlobal: boolean
  isAdminLoja: boolean
  podeGerir: boolean
  // Lojas que o ator pode gerir. Admin global: todas as ativas. AdminLoja: as dele.
  lojaIds: number[]
}

export async function getAtorGestao(): Promise<AtorGestao> {
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

  const perfil = profile?.perfil ?? null
  const isAdminGlobal = perfil === 'Admin'
  const isAdminLoja = perfil === 'AdminLoja'

  let lojaIds: number[] = []
  if (isAdminGlobal) {
    const { data } = await supabase.from('lojas').select('id').eq('ativo', true)
    lojaIds = (data ?? []).map((l) => l.id as number)
  } else if (isAdminLoja) {
    const { data } = await supabase
      .from('loja_user')
      .select('loja_id')
      .eq('user_id', user.id)
    lojaIds = [...new Set((data ?? []).map((r) => r.loja_id as number).filter((v) => v != null))]
  }

  return {
    id: user.id,
    perfil,
    isAdminGlobal,
    isAdminLoja,
    podeGerir: isAdminGlobal || (isAdminLoja && lojaIds.length > 0),
    lojaIds,
  }
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

  // Admin de loja: acesso total aos modulos da loja atual (se vinculado a ela).
  if (profile?.perfil === 'AdminLoja') {
    const { data: vinculo } = await supabase
      .from('loja_user')
      .select('id')
      .eq('user_id', user.id)
      .eq('loja_id', lojaId)
      .maybeSingle()
    if (vinculo) return new Set(['*'])
  }

  // Junta permissao_user (da loja) com o nome da permissao.
  const { data } = await supabase
    .from('permissao_user')
    .select('permissoes(nome)')
    .eq('user_id', user.id)
    .eq('loja_id', lojaId)
    .returns<{ permissoes: { nome: string } | { nome: string }[] | null }[]>()

  const nomes = new Set<string>()
  const addNomes = (rows: { permissoes: { nome: string } | { nome: string }[] | null }[] | null) => {
    for (const row of rows ?? []) {
      const p = row.permissoes
      if (!p) continue
      if (Array.isArray(p)) for (const x of p) { if (x?.nome) nomes.add(x.nome) }
      else if (p.nome) nomes.add(p.nome)
    }
  }
  addNomes(data)

  // + permissões herdadas do CARGO do usuário nesta loja.
  const { data: vinc } = await supabase
    .from('loja_user')
    .select('cargo_id')
    .eq('user_id', user.id)
    .eq('loja_id', lojaId)
    .maybeSingle<{ cargo_id: number | null }>()
  if (vinc?.cargo_id) {
    const { data: doCargo } = await supabase
      .from('cargo_permissao')
      .select('permissoes(nome)')
      .eq('cargo_id', vinc.cargo_id)
      .returns<{ permissoes: { nome: string } | { nome: string }[] | null }[]>()
    addNomes(doCargo)
  }
  return nomes
}
