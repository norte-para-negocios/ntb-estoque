import Link from 'next/link'
import {
  Home,
  FileText,
  Factory,
  ArrowLeftRight,
  ClipboardList,
  Package,
  Warehouse,
  Store,
  Users,
  ScrollText,
  LogOut,
  type LucideIcon,
} from 'lucide-react'
import { LojaSelector } from '@/components/loja/LojaSelector'
import { LogoutButton } from '@/components/sidebar/LogoutButton'

type Loja = { id: number; nome: string; nome_fantasia: string | null }

type ItemMenu = { href: string; label: string; icon: LucideIcon }

export function MenuNTB({
  lojas,
  currentLojaId,
  isAdmin,
}: {
  lojas: Loja[]
  currentLojaId: number | null
  isAdmin: boolean
}) {
  const itens: ItemMenu[] = [
    { href: '/home', label: 'Página Inicial', icon: Home },
    { href: '/nota-fiscal', label: 'Notas Fiscais', icon: FileText },
    { href: '/ordem-producao', label: 'Ordens de Produção', icon: Factory },
    { href: '/transferencia', label: 'Transferências', icon: ArrowLeftRight },
    { href: '/inventario', label: 'Inventário', icon: ClipboardList },
    { href: '/produto', label: 'Produtos', icon: Package },
    { href: '/local-estoque', label: 'Locais de Estoque', icon: Warehouse },
  ]

  const itensAdmin: ItemMenu[] = isAdmin
    ? [
        { href: '/loja', label: 'Lojas', icon: Store },
        { href: '/usuario', label: 'Usuários', icon: Users },
        { href: '/log', label: 'Logs de Integração', icon: ScrollText },
      ]
    : []

  return (
    <div className="flex flex-col">
      {/* Seletor de loja */}
      <div className="mb-5">
        <h6 className="mb-2 text-sm font-semibold text-[#5d5d5d]">Acessando:</h6>
        <LojaSelector lojas={lojas} currentLojaId={currentLojaId} />
      </div>

      {/* Links principais */}
      <nav className="flex flex-col">
        {[...itens, ...itensAdmin].map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="flex items-center gap-3 py-3 font-semibold text-[#5d5d5d] transition-colors hover:text-[#2eb5c3]"
          >
            <item.icon className="size-5 text-[#2eb5c3]" strokeWidth={2} />
            {item.label}
          </Link>
        ))}

        {/* Sair */}
        <div className="mt-2 border-t border-[#e2e2e2] pt-2">
          <LogoutButton variant="menu" />
        </div>
      </nav>
    </div>
  )
}
