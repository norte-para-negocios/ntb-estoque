'use client'

import * as React from 'react'
import { usePathname } from 'next/navigation'
import { Search } from 'lucide-react'

import { Sidebar } from './Sidebar'
import { MobileNav } from './MobileNav'
import { BuscaGlobal } from './BuscaGlobal'
import { Sininho } from './Sininho'
import { BannerSync } from '@/components/desktop/BannerSync'
import { CentralProvider } from '@/components/central/central-estado'

export function AppShell({
  isAdmin,
  isSuperAdmin = false,
  podeGerirUsuarios = false,
  rotasVisiveis,
  estoqueProprio = false,
  temEstoque = false,
  pedidosOmie = false,
  centralUserId,
  lojaSelector,
  userMenu,
  children,
}: {
  isAdmin: boolean
  isSuperAdmin?: boolean
  // AdminLoja: ve a gestao de usuarios (escopada) mesmo sem ser admin global.
  podeGerirUsuarios?: boolean
  // null = admin (ve tudo). Array = rotas que o nao-admin pode ver (4.2).
  rotasVisiveis: string[] | null
  estoqueProprio?: boolean
  temEstoque?: boolean
  pedidosOmie?: boolean
  /** Só desenvolvedores: id do usuário (favoritos da central). */
  centralUserId?: string
  lojaSelector: React.ReactNode
  userMenu: React.ReactNode
  children: React.ReactNode
}) {
  const [buscaAberta, setBuscaAberta] = React.useState(false)
  const pathname = usePathname()
  // Menu por módulos + Central (só desenvolvedores): mesmas regras de visibilidade que o menu atual.
  const centralCtx = React.useMemo(
    () =>
      isSuperAdmin
        ? { ctx: { isAdmin, isSuperAdmin, podeGerirUsuarios, rotasVisiveis, estoqueProprio, temEstoque, pedidosOmie, desktop: process.env.NEXT_PUBLIC_DESKTOP === '1' }, userId: centralUserId ?? '' }
        : null,
    [isAdmin, isSuperAdmin, podeGerirUsuarios, rotasVisiveis, estoqueProprio, temEstoque, pedidosOmie, centralUserId]
  )

  React.useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      // Escape fecha a busca.
      if (e.key === 'Escape') {
        setBuscaAberta(false)
        return
      }

      // Cmd+K / Ctrl+K abre a busca em qualquer lugar (inclusive dentro de um campo).
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setBuscaAberta(true)
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
      <Sidebar isAdmin={isAdmin} isSuperAdmin={isSuperAdmin} podeGerirUsuarios={podeGerirUsuarios} rotasVisiveis={rotasVisiveis} estoqueProprio={estoqueProprio} temEstoque={temEstoque} pedidosOmie={pedidosOmie} lojaSelector={lojaSelector} userMenu={userMenu} />
      <div className="flex-1 min-w-0 flex flex-col">
        <MobileNav isAdmin={isAdmin} isSuperAdmin={isSuperAdmin} podeGerirUsuarios={podeGerirUsuarios} rotasVisiveis={rotasVisiveis} estoqueProprio={estoqueProprio} temEstoque={temEstoque} pedidosOmie={pedidosOmie} lojaSelector={lojaSelector} userMenu={userMenu} onBuscar={() => setBuscaAberta(true)} />
        {/* overflow-x-clip (NAO -hidden): clip corta overflow horizontal sem
            virar container de scroll. -hidden faria o overflow-y computar pra
            auto, tornando o <main> um scroll container SEM altura fixa -> o
            position:sticky do thead/ListaHeader grudava num elemento que nao
            rola e descia junto com o body. clip mantem o sticky preso ao body
            (cabecalho de tabela congelado tipo Excel). */}
        <main className="flex-1 min-w-0 overflow-x-clip pb-20 lg:pb-0">
          <div className="mx-auto w-full max-w-6xl px-4 lg:px-8 py-6">
            <div className="mb-2 hidden items-center justify-end gap-2 lg:flex">
              <Sininho tela="desktop" />
              {/* Celular: a busca fica na barra superior (MobileNav). Desktop: botao completo com texto e atalho de teclado */}
              <button
                type="button"
                onClick={() => setBuscaAberta(true)}
                className="inline-flex h-9 items-center gap-2 rounded-full bg-surface px-3.5 text-[14px] text-text-muted shadow-[var(--shadow-sm)] u-motion u-press hover:text-text"
              >
                <Search className="size-4" aria-hidden />
                <span>Buscar</span>
                <kbd className="rounded-md bg-surface-2 px-1.5 py-0.5 text-xs text-text-muted">
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
            <BannerSync />
            <div
              key={pathname}
              className="animate-in fade-in slide-in-from-bottom-[8px]"
              style={{ animationDuration: '220ms', animationTimingFunction: 'cubic-bezier(0.32, 0.72, 0, 1)' }}
            >
              {isSuperAdmin && centralCtx ? <CentralProvider value={centralCtx}>{children}</CentralProvider> : children}
            </div>
          </div>
        </main>
      </div>
      <BuscaGlobal open={buscaAberta} onOpenChange={setBuscaAberta} />
    </div>
  )
}
