import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { MenuNTB } from '@/components/MenuNTB'

export default async function HomePage() {
  const profile = await getProfile()
  const isAdmin = profile.perfil === 'Admin'

  const supabase = await createClient()
  const { data: lojas } = await supabase
    .from('lojas')
    .select('id, nome, nome_fantasia')
    .eq('ativo', true)
    .order('nome_fantasia')

  return (
    <div className="flex justify-center pt-6">
      <div className="w-full max-w-sm px-2">
        <MenuNTB lojas={lojas ?? []} currentLojaId={profile.current_loja_id} isAdmin={isAdmin} />
      </div>
    </div>
  )
}
