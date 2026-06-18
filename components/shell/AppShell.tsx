'use client'

import * as React from 'react'
import { usePathname } from 'next/navigation'
import { Search } from 'lucide-react'

import { Sidebar } from './Sidebar'
import { MobileNav } from './MobileNav'
import { BuscaGlobal } from './BuscaGlobal'
import { SplashIntro } from './SplashIntro'

export function AppShell({
  isAdmin,
  podeGerirUsuarios = false,
  rotasVisiveis,
  lojaSelector,
  userMenu,
  children,
}: {
  isAdmin: boolean
  // AdminLoja: ve a gestao de usuarios (escopada) mesmo sem ser admin global.
  podeGerirUsuarios?: boolean
  // null = admin (ve tudo). Array = rotas que o nao-admin pode ver (4.2).
  rotasVisiveis: string[] | null
  lojaSelector: React.ReactNode
  userMenu: React.ReactNode
  children: React.ReactNode
}) {
  const [buscaAberta, setBuscaAberta] = React.useState(false)
  const pathname = usePathname()

  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Escape fecha a busca.
      if (e.key === 'Escape') {
        setBuscaAberta(false)
        return
      }

      // "/" abre a busca, desde que o foco nao esteja num campo editavel
      // e nao haja modificadores ativos.
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const alvo = e.target as HTMLElement | null
        const tag = alvo?.tagName
        const editavel =
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          tag === 'SELECT' ||
          alvo?.isContentEditable === true
        if (editavel) return

        e.preventDefault()
        setBuscaAberta(true)
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  return (
    <div className="flex min-h-screen bg-bg">
      <SplashIntro />
      <Sidebar isAdmin={isAdmin} podeGerirUsuarios={podeGerirUsuarios} rotasVisiveis={rotasVisiveis} lojaSelector={lojaSelector} userMenu={userMenu} />
      <div className="flex-1 min-w-0 flex flex-col">
        <MobileNav isAdmin={isAdmin} podeGerirUsuarios={podeGerirUsuarios} rotasVisiveis={rotasVisiveis} lojaSelector={lojaSelector} userMenu={userMenu} />
        <main className="flex-1 min-w-0 overflow-x-hidden pb-20 lg:pb-0">
          <div className="mx-auto w-full max-w-6xl px-4 lg:px-8 py-6">
            <div className="mb-4 flex justify-end">
              <button
                type="button"
                onClick={() => setBuscaAberta(true)}
                className="inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
              >
                <Search className="size-4" aria-hidden />
                <span>Buscar</span>
                <kbd className="rounded border border-border bg-surface-2 px-1.5 py-0.5 text-xs text-text-muted">
                  /
                </kbd>
              </button>
            </div>
            {/* key={pathname}: re-anima a entrada do conteúdo a cada navegação,
                dando continuidade ao skeleton de loading. */}
            <div key={pathname} className="animate-in fade-in slide-in-from-bottom-1 duration-300">
              {children}
            </div>
          </div>
        </main>
      </div>
      <BuscaGlobal open={buscaAberta} onOpenChange={setBuscaAberta} />
    </div>
  )
}
