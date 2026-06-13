'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { Menu, X, LayoutDashboard, FileText, ClipboardList, Package } from 'lucide-react'
import { NAV_ITEMS } from './NavItems'

const BOTTOM = [
  { href: '/home', label: 'Início', icon: LayoutDashboard },
  { href: '/nota-fiscal', label: 'NFs', icon: FileText },
  { href: '/inventario', label: 'Inventário', icon: ClipboardList },
  { href: '/produto', label: 'Produtos', icon: Package },
]

export function MobileNav({
  isAdmin,
  lojaSelector,
  userMenu,
}: {
  isAdmin: boolean
  lojaSelector: React.ReactNode
  userMenu: React.ReactNode
}) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()
  useEffect(() => {
    setOpen(false)
  }, [pathname])
  const itens = NAV_ITEMS.filter((i) => !i.admin || isAdmin)
  return (
    <>
      <header className="lg:hidden sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-surface/90 backdrop-blur px-3">
        <button
          onClick={() => setOpen(true)}
          aria-label="Menu"
          className="flex size-10 items-center justify-center rounded-md text-text hover:bg-surface-2"
        >
          <Menu className="size-5" />
        </button>
        <Image src="/ntb-logo.png" alt="NTB" width={100} height={32} className="h-6 w-auto" />
      </header>

      {open && (
        <div className="lg:hidden fixed inset-0 z-40 bg-black/30" onClick={() => setOpen(false)} aria-hidden />
      )}

      <aside
        className={`lg:hidden fixed inset-y-0 left-0 z-50 w-[280px] max-w-[85vw] bg-surface overflow-y-auto transition-transform duration-300 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
        style={{ transitionTimingFunction: 'var(--ease)' }}
      >
        <div className="flex h-14 items-center justify-between border-b border-border px-4">
          <Image src="/ntb-logo.png" alt="NTB" width={100} height={32} className="h-6 w-auto" />
          <button
            onClick={() => setOpen(false)}
            aria-label="Fechar"
            className="flex size-9 items-center justify-center rounded-md hover:bg-surface-2"
          >
            <X className="size-5" />
          </button>
        </div>
        <div className="px-3 py-3 border-b border-border">{lojaSelector}</div>
        <nav className="px-3 py-3 space-y-0.5">
          {itens.map((item) => {
            const Icon = item.icon
            const active = pathname === item.href || pathname.startsWith(item.href + '/')
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-2.5 rounded-md px-2.5 py-2.5 text-sm ${
                  active ? 'bg-brand-soft text-text font-medium' : 'text-text-muted'
                }`}
              >
                <Icon className={`size-[18px] ${active ? 'text-brand' : ''}`} />
                {item.label}
              </Link>
            )
          })}
        </nav>
        <div className="border-t border-border p-3">{userMenu}</div>
      </aside>

      <nav className="lg:hidden fixed bottom-0 inset-x-0 z-30 grid grid-cols-4 border-t border-border bg-surface/95 backdrop-blur">
        {BOTTOM.map((b) => {
          const Icon = b.icon
          const active = pathname.startsWith(b.href)
          return (
            <Link
              key={b.href}
              href={b.href}
              className={`flex flex-col items-center gap-0.5 py-2 text-[10px] ${
                active ? 'text-brand' : 'text-text-muted'
              }`}
            >
              <Icon className="size-5" />
              {b.label}
            </Link>
          )
        })}
      </nav>
    </>
  )
}
