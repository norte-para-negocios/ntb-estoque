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
    <div className="px-3 mb-5">
      <div className="px-2 mb-2 text-[9px] font-bold uppercase tracking-[0.14em] text-sidebar-foreground/30">
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
              className={`group relative flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-all ${
                ativo
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-sidebar-foreground/55 hover:text-sidebar-foreground/90 hover:bg-white/[0.04]'
              }`}
            >
              {/* Barra teal à esquerda no item ativo */}
              {ativo && (
                <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-full bg-brand" />
              )}
              <Icon
                className={`size-[15px] shrink-0 transition-colors ${
                  ativo ? 'text-brand' : 'text-sidebar-foreground/35 group-hover:text-sidebar-foreground/60'
                }`}
                strokeWidth={2}
              />
              <span className={ativo ? 'font-medium' : ''}>{item.label}</span>
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
      <NavGroup titulo="Operação" itens={operacao} pathname={pathname} />
      <NavGroup titulo="Cadastros" itens={cadastros} pathname={pathname} />
      <NavGroup titulo="Administração" itens={admin} pathname={pathname} />
    </nav>
  )
}
