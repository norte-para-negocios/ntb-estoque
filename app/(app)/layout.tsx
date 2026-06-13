import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { AppShell } from '@/components/shell/AppShell'
import { LojaSelector } from '@/components/loja/LojaSelector'
import { UserMenu } from '@/components/shell/UserMenu'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await getProfile()
  const isAdmin = profile.perfil === 'Admin'

  const supabase = await createClient()
  const { data: lojas } = await supabase
    .from('lojas')
    .select('id, nome, nome_fantasia')
    .eq('ativo', true)
    .order('nome_fantasia')

  return (
    <AppShell
      isAdmin={isAdmin}
      lojaSelector={<LojaSelector lojas={lojas ?? []} currentLojaId={profile.current_loja_id} />}
      userMenu={<UserMenu nome={profile.name} perfil={profile.perfil} />}
    >
      {children}
    </AppShell>
  )
}
