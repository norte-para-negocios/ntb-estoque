import Image from 'next/image'
import { getProfile } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { LojaSelector } from '@/components/loja/LojaSelector'
import { LogoutButton } from '@/components/sidebar/LogoutButton'
import { SidebarNav } from '@/components/sidebar/SidebarNav'

export async function AppSidebar() {
  const profile = await getProfile()
  const isAdmin = profile.perfil === 'Admin'

  const supabase = await createClient()
  const { data: lojas } = await supabase
    .from('lojas')
    .select('id, nome, nome_fantasia')
    .eq('ativo', true)
    .order('nome_fantasia')

  const operacao = [
    { href: '/home', label: 'Início', icon: 'LayoutDashboard' },
    { href: '/nota-fiscal', label: 'Notas Fiscais', icon: 'FileText' },
    { href: '/ordem-producao', label: 'Ordens de Produção', icon: 'Factory' },
    { href: '/transferencia', label: 'Transferências', icon: 'ArrowLeftRight' },
    { href: '/inventario', label: 'Inventários', icon: 'ClipboardList' },
  ]
  const cadastros = [
    { href: '/produto', label: 'Produtos', icon: 'Package' },
    { href: '/local-estoque', label: 'Locais de Estoque', icon: 'Warehouse' },
    { href: '/log', label: 'Logs de Integração', icon: 'ScrollText' },
  ]
  const admin = isAdmin
    ? [
        { href: '/loja', label: 'Lojas', icon: 'Store' },
        { href: '/usuario', label: 'Usuários', icon: 'Users' },
      ]
    : []

  const iniciais = profile.name
    .split(' ')
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase()

  return (
    <aside className="w-64 shrink-0 bg-sidebar text-sidebar-foreground min-h-screen flex flex-col">
      <div className="px-5 h-16 flex items-center border-b border-sidebar-border">
        <Image
          src="/ntb-logo.png"
          alt="NTB Stock"
          width={120}
          height={40}
          priority
          className="h-7 w-auto brightness-0 invert"
        />
      </div>

      <div className="px-3 py-3 border-b border-sidebar-border">
        <LojaSelector lojas={lojas ?? []} currentLojaId={profile.current_loja_id} />
      </div>

      <SidebarNav operacao={operacao} cadastros={cadastros} admin={admin} />

      <div className="px-3 py-3 border-t border-sidebar-border flex items-center gap-2.5">
        <div className="size-8 rounded-full bg-sidebar-accent flex items-center justify-center text-xs font-medium text-white shrink-0">
          {iniciais}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-white truncate">{profile.name}</div>
          <div className="text-[11px] text-sidebar-foreground/50">{profile.perfil}</div>
        </div>
        <LogoutButton />
      </div>
    </aside>
  )
}
