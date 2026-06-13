'use client'

import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { NAV_ITEMS, type NavItem } from './NavItems'

const GRUPOS = ['Operação', 'Cadastros', 'Administração'] as const

export function Sidebar({
  isAdmin,
  lojaSelector,
  userMenu,
}: {
  isAdmin: boolean
  lojaSelector: React.ReactNode
  userMenu: React.ReactNode
}) {
  const pathname = usePathname()
  const itens = NAV_ITEMS.filter((i) => !i.admin || isAdmin)
  return (
    <aside className="hidden lg:flex w-64 shrink-0 flex-col border-r border-border bg-surface">
      <div className="flex h-16 items-center px-5 border-b border-border">
        <Image src="/ntb-logo.png" alt="NTB" width={110} height={36} priority className="h-7 w-auto dark:brightness-0 dark:invert" />
      </div>
      <div className="px-3 py-3 border-b border-border">{lojaSelector}</div>
      <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-5">
        {GRUPOS.map((g) => {
          const list = itens.filter((i) => i.group === g)
          if (!list.length) return null
          return (
            <div key={g}>
              <p className="px-2 mb-1.5 text-[10px] font-bold uppercase tracking-[0.12em] text-text-muted/60">
                {g}
              </p>
              <div className="space-y-0.5">
                {list.map((item) => (
                  <SideLink
                    key={item.href}
                    item={item}
                    active={pathname === item.href || pathname.startsWith(item.href + '/')}
                  />
                ))}
              </div>
            </div>
          )
        })}
      </nav>
      <div className="border-t border-border p-3">{userMenu}</div>
    </aside>
  )
}

function SideLink({ item, active }: { item: NavItem; active: boolean }) {
  const Icon = item.icon
  return (
    <Link
      href={item.href}
      className={`group relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-all duration-200 ${
        active ? 'bg-brand-soft text-text font-medium' : 'text-text-muted hover:bg-surface-2 hover:text-text'
      }`}
      style={{ transitionTimingFunction: 'var(--ease)' }}
    >
      {active && (
        <span className="absolute left-0 top-1/2 -translate-y-1/2 h-5 w-0.5 rounded-full bg-brand" />
      )}
      <Icon
        className={`size-[17px] shrink-0 ${active ? 'text-brand' : 'text-text-muted/70 group-hover:text-text-muted'}`}
        strokeWidth={2}
      />
      {item.label}
    </Link>
  )
}
