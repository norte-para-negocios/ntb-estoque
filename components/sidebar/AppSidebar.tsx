import Link from 'next/link'
import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { LojaSelector } from '@/components/loja/LojaSelector'
import { LogoutButton } from '@/components/sidebar/LogoutButton'

export async function AppSidebar() {
  const profile = await getProfile()
  const isAdmin = profile.perfil === 'Admin'

  const supabase = await createClient()
  const { data: lojas } = await supabase
    .from('lojas')
    .select('id, nome, nome_fantasia')
    .eq('ativo', true)
    .order('nome_fantasia')

  const links = [
    { href: '/home', label: 'Inicio' },
    { href: '/nota-fiscal', label: 'Notas Fiscais' },
    { href: '/ordem-producao', label: 'Ordens de Producao' },
    { href: '/transferencia', label: 'Transferencias' },
    { href: '/inventario', label: 'Inventarios' },
    { href: '/produto', label: 'Produtos' },
    { href: '/local-estoque', label: 'Locais de Estoque' },
    { href: '/log', label: 'Logs de Integracao' },
    ...(isAdmin
      ? [
          { href: '/loja', label: 'Lojas' },
          { href: '/usuario', label: 'Usuarios' },
        ]
      : []),
  ]

  return (
    <aside className="w-64 shrink-0 bg-white border-r min-h-screen flex flex-col">
      <div className="p-4 border-b font-bold text-lg">NTB - Estoque</div>
      <div className="p-4 border-b">
        <LojaSelector lojas={lojas ?? []} currentLojaId={profile.current_loja_id} />
      </div>
      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="block px-3 py-2 rounded-md hover:bg-gray-100 text-sm text-gray-700"
          >
            {link.label}
          </Link>
        ))}
      </nav>
      <div className="p-4 border-t text-sm text-gray-600 flex items-center justify-between">
        <span className="truncate">{profile.name}</span>
        <LogoutButton />
      </div>
    </aside>
  )
}
