'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutDashboard,
  FileText,
  Factory,
  ArrowLeftRight,
  ClipboardList,
  Package,
  Warehouse,
  ScrollText,
  Store,
  Users,
  type LucideIcon,
} from 'lucide-react'

const ICONS: Record<string, LucideIcon> = {
  LayoutDashboard,
  FileText,
  Factory,
  ArrowLeftRight,
  ClipboardList,
  Package,
  Warehouse,
  ScrollText,
  Store,
  Users,
}

type Item = { href: string; label: string; icon: string }

function NavGroup({ titulo, itens, pathname }: { titulo: string; itens: Item[]; pathname: string }) {
  if (!itens.length) return null
  return (
    <div className="px-3 mb-4">
      <div className="px-2 mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/40">
        {titulo}
      </div>
      <div className="space-y-0.5">
        {itens.map((item) => {
          const Icon = ICONS[item.icon]
          const ativo = pathname === item.href || pathname.startsWith(item.href + '/')
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`group flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors ${
                ativo
                  ? 'bg-sidebar-accent text-white'
                  : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/50 hover:text-white'
              }`}
            >
              <Icon
                className={`size-4 shrink-0 ${ativo ? 'text-brand' : 'text-sidebar-foreground/50 group-hover:text-sidebar-foreground/80'}`}
                strokeWidth={2}
              />
              {item.label}
            </Link>
          )
        })}
      </div>
    </div>
  )
}

export function SidebarNav({
  operacao,
  cadastros,
  admin,
}: {
  operacao: Item[]
  cadastros: Item[]
  admin: Item[]
}) {
  const pathname = usePathname()
  return (
    <nav className="flex-1 py-4 overflow-y-auto">
      <NavGroup titulo="Operacao" itens={operacao} pathname={pathname} />
      <NavGroup titulo="Cadastros" itens={cadastros} pathname={pathname} />
      <NavGroup titulo="Administracao" itens={admin} pathname={pathname} />
    </nav>
  )
}
