import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { AppHeader } from '@/components/AppHeader'
import { MenuNTB } from '@/components/MenuNTB'

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const profile = await getProfile()
  const isAdmin = profile.perfil === 'Admin'

  const supabase = await createClient()
  const { data: lojas } = await supabase
    .from('lojas')
    .select('id, nome, nome_fantasia')
    .eq('ativo', true)
    .order('nome_fantasia')

  const menu = (
    <MenuNTB lojas={lojas ?? []} currentLojaId={profile.current_loja_id} isAdmin={isAdmin} />
  )

  return (
    <div className="flex min-h-screen flex-col bg-[#f4f4f4]">
      <AppHeader menu={menu} />
      <main className="flex-1 py-6">
        <div className="mx-auto w-full max-w-5xl px-4">{children}</div>
      </main>
    </div>
  )
}
