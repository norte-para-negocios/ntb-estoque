'use client'

import { Sidebar } from './Sidebar'
import { MobileNav } from './MobileNav'

export function AppShell({
  isAdmin,
  lojaSelector,
  userMenu,
  children,
}: {
  isAdmin: boolean
  lojaSelector: React.ReactNode
  userMenu: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="flex min-h-screen bg-bg">
      <Sidebar isAdmin={isAdmin} lojaSelector={lojaSelector} userMenu={userMenu} />
      <div className="flex-1 min-w-0 flex flex-col">
        <MobileNav isAdmin={isAdmin} lojaSelector={lojaSelector} userMenu={userMenu} />
        <main className="flex-1 min-w-0 pb-20 lg:pb-0">
          <div className="mx-auto w-full max-w-6xl px-4 lg:px-8 py-6">{children}</div>
        </main>
      </div>
    </div>
  )
}
