import { cache } from 'react'
import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { temPermissao } from '@/lib/permissao-puro'

// Velocidade (13/10/2026): cada tela chamava auth.getUser() (ida ao servidor de login) e lia o perfil de novo em cada
// requirePermissao/isAdmin/getCurrentLojaId — 5 a 15 idas em série por página. cache() do React guarda o resultado
// só durante a mesma requisição (fora da renderização, ex. rota de API, não guarda nada: comportamento de antes).
const usuarioDaRequisicao = cache(async () => {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  return user
})

const perfilDaRequisicao = cache(async (userId: string) => {
  const supabase = await createClient()
  const { data } = await supabase
    .from('profiles')
    .select('id, name, current_loja_id, perfil, status, is_super_admin, loja:lojas(id, nome, nome_fantasia)')
    .eq('id', userId)
    .single<Profile>()
  return data
})

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
  is_super_admin: boolean
  loja: { id: number; nome: string; nome_fantasia: string | null } | null
}

export async function getProfile(): Promise<Profile> {
  const user = await usuarioDaRequisicao()
  if (!user) redirect('/login')

  const profile = await perfilDaRequisicao(user.id)

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

// Super admin total: único flag que libera acesso à área VTBstock Beta.
// Ortogonal ao Admin global (Admin pode não ser super admin e vice-versa).
export async function isSuperAdmin(): Promise<boolean> {
  const profile = await getProfile()
  return profile.is_super_admin === true
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
  const user = await usuarioDaRequisicao()
  if (!user) redirect('/login')
  // Mesma regra de sempre (Admin global; AdminLoja vinculado; permissão direta na loja; permissão do cargo na loja),
  // calculada uma vez por requisição e loja em getPermissoesNomes.
  return temPermissao(await getPermissoesNomes(lojaId), permissaoNome)
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

  // is_test NAO filtrado aqui de proposito: ator.lojaIds e usado por muito
  // mais que a tela de usuario (minha-loja, resumo, cargo, convite,
  // relatorios) -- filtrar aqui vazava pra esses consumidores e quebrava
  // "loja de teste faz tudo que a loja real faz" (achado real: Admin
  // dentro de uma loja [TESTE] recebia 404 em "Minha loja", e "Resumo"
  // mostrava dado de outra loja REAL sem aviso). Quem precisa esconder
  // lojas de teste (ex: formulario de vinculo de usuario) filtra na
  // propria query, nao aqui.
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
export const getPermissoesNomes = cache(async (lojaId: number | null): Promise<Set<string>> => {
  const supabase = await createClient()
  const user = await usuarioDaRequisicao()
  if (!user) return new Set()

  const profile = await perfilDaRequisicao(user.id)

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
})
