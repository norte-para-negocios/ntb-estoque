'use client'

import * as React from 'react'
import { usePathname } from 'next/navigation'
import { Search } from 'lucide-react'

import { Sidebar } from './Sidebar'
import { MobileNav } from './MobileNav'
import { BuscaGlobal } from './BuscaGlobal'

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
      <Sidebar isAdmin={isAdmin} podeGerirUsuarios={podeGerirUsuarios} rotasVisiveis={rotasVisiveis} lojaSelector={lojaSelector} userMenu={userMenu} />
      <div className="flex-1 min-w-0 flex flex-col">
        <MobileNav isAdmin={isAdmin} podeGerirUsuarios={podeGerirUsuarios} rotasVisiveis={rotasVisiveis} lojaSelector={lojaSelector} userMenu={userMenu} />
        {/* overflow-x-clip (NAO -hidden): clip corta overflow horizontal sem
            virar container de scroll. -hidden faria o overflow-y computar pra
            auto, tornando o <main> um scroll container SEM altura fixa -> o
            position:sticky do thead/ListaHeader grudava num elemento que nao
            rola e descia junto com o body. clip mantem o sticky preso ao body
            (cabecalho de tabela congelado tipo Excel). */}
        <main className="flex-1 min-w-0 overflow-x-clip pb-20 lg:pb-0">
          <div className="mx-auto w-full max-w-6xl px-4 lg:px-8 py-6">
            <div className="mb-4 flex justify-end">
              {/* Mobile: so icone, sem texto e sem linha extra */}
              <button
                type="button"
                onClick={() => setBuscaAberta(true)}
                aria-label="Buscar"
                className="lg:hidden flex size-9 items-center justify-center rounded-lg border border-border bg-surface text-text-muted u-motion u-press hover:bg-surface-2 hover:text-text"
              >
                <Search className="size-4" aria-hidden />
              </button>
              {/* Desktop: botao completo com texto e atalho de teclado */}
              <button
                type="button"
                onClick={() => setBuscaAberta(true)}
                className="hidden lg:inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-1.5 text-sm text-text-muted u-motion u-press hover:bg-surface-2 hover:text-text"
              >
                <Search className="size-4" aria-hidden />
                <span>Buscar</span>
                <kbd className="rounded border border-border bg-surface-2 px-1.5 py-0.5 text-xs text-text-muted">
                  /
                </kbd>
              </button>
            </div>
            {/* A3 - transicao de rota. key={pathname}: re-anima a entrada do
                conteudo a cada navegacao (crossfade discreto + 2px de subida).
                Curto e quase so opacidade: o "assentar" do conteudo fica por
                conta do stagger das linhas (A4), entao a pagina nao da um slide
                grande que brigaria com ele. Tom Linear/Vercel: a pagina troca,
                nao "voa". */}
            <div
              key={pathname}
              className="animate-in fade-in slide-in-from-bottom-[2px]"
              style={{ animationDuration: 'var(--dur)', animationTimingFunction: 'var(--ease-out)' }}
            >
              {children}
            </div>
          </div>
        </main>
      </div>
      <BuscaGlobal open={buscaAberta} onOpenChange={setBuscaAberta} />
    </div>
  )
}
