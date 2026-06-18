import { getProfile, getPermissoesNomes } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { AppShell } from '@/components/shell/AppShell'
import { LojaSelector } from '@/components/loja/LojaSelector'
import { UserMenu } from '@/components/shell/UserMenu'
import { rotasPermitidas } from '@/lib/permissoes-menu'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await getProfile()
  const isAdmin = profile.perfil === 'Admin'
  // AdminLoja tambem gerencia usuarios (escopado a loja dele) -> ve a rota /usuario.
  const podeGerirUsuarios = isAdmin || profile.perfil === 'AdminLoja'

  const supabase = await createClient()

  // Quais rotas do menu o usuario pode ver (4.2). Admin recebe null = todas.
  const permissoes = await getPermissoesNomes(profile.current_loja_id)
  const rotasVisiveis = isAdmin ? null : Array.from(rotasPermitidas(permissoes))

  let lojasQuery = supabase
    .from('lojas')
    .select('id, nome, nome_fantasia')
    .eq('ativo', true)
    .order('nome_fantasia')

  // Nao-admin so enxerga as lojas que tem em loja_user.
  if (!isAdmin) {
    const { data: vinculos } = await supabase
      .from('loja_user')
      .select('loja_id')
      .eq('user_id', profile.id)
    const lojaIds = [
      ...new Set((vinculos ?? []).map((v) => v.loja_id).filter((v): v is number => v != null)),
    ]
    lojasQuery = lojasQuery.in('id', lojaIds.length ? lojaIds : [-1])
  }

  const { data: lojas } = await lojasQuery

  return (
    <AppShell
      isAdmin={isAdmin}
      podeGerirUsuarios={podeGerirUsuarios}
      rotasVisiveis={rotasVisiveis}
      lojaSelector={<LojaSelector lojas={lojas ?? []} currentLojaId={profile.current_loja_id} />}
      userMenu={<UserMenu nome={profile.name} perfil={profile.perfil} />}
    >
      {children}
    </AppShell>
  )
}
