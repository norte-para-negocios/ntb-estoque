'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useState, useEffect, useMemo } from 'react'
import { usePathname } from 'next/navigation'
import {
  Menu,
  X,
  ChevronDown,
  Lock,
  LayoutDashboard,
  FileText,
  ClipboardList,
  Package,
  Search,
} from 'lucide-react'
import { motion } from 'motion/react'
import { SPRING_UI } from '@/lib/motion'
import { NAV_ITEMS } from './NavItems'

const GRUPOS = ['Operação', 'Cadastros', 'Administração'] as const
type Grupo = (typeof GRUPOS)[number]

const BOTTOM = [
  { href: '/home', label: 'Início', icon: LayoutDashboard },
  { href: '/nota-fiscal', label: 'NFs', icon: FileText },
  { href: '/inventario', label: 'Inventário', icon: ClipboardList },
  { href: '/produto', label: 'Produtos', icon: Package },
]

export function MobileNav({
  isAdmin,
  isSuperAdmin = false,
  podeGerirUsuarios = false,
  rotasVisiveis,
  lojaSelector,
  userMenu,
  onBuscar,
}: {
  isAdmin: boolean
  isSuperAdmin?: boolean
  podeGerirUsuarios?: boolean
  rotasVisiveis: string[] | null
  lojaSelector: React.ReactNode
  userMenu: React.ReactNode
  /** Abre a busca global (o ícone fica na barra superior, não numa linha própria). */
  onBuscar?: () => void
}) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()

  useEffect(() => {
    setOpen(false)
  }, [pathname])

  // Trava o scroll do body enquanto o drawer está aberto (sem mexer em html).
  useEffect(() => {
    if (!open) return
    const anterior = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = anterior
    }
  }, [open])

  // Filtro de permissão (4.2) intacto.
  const permitidas = rotasVisiveis ? new Set(rotasVisiveis) : null
  const itens = useMemo(
    () =>
      NAV_ITEMS.filter(
        (i) =>
          (!i.admin || isAdmin) &&
          (!i.gestaoUsuarios || isAdmin || podeGerirUsuarios) &&
          (!i.superAdmin || isSuperAdmin) &&
          (permitidas === null || permitidas.has(i.href))
      ),
    [isAdmin, isSuperAdmin, podeGerirUsuarios, rotasVisiveis] // eslint-disable-line react-hooks/exhaustive-deps
  )

  const gruposVisiveis = useMemo(
    () => GRUPOS.filter((g) => itens.some((i) => i.group === g)),
    [itens]
  )

  const grupoDaRota = useMemo<Grupo | null>(() => {
    const atual = itens.find(
      (i) => pathname === i.href || pathname.startsWith(i.href + '/')
    )
    return atual?.group ?? null
  }, [itens, pathname])

  const [grupoAberto, setGrupoAberto] = useState<Grupo | null>(null)

  // Ao abrir o drawer, expande o grupo da rota atual (ou o primeiro).
  useEffect(() => {
    if (open) {
      setGrupoAberto(grupoDaRota ?? gruposVisiveis[0] ?? null)
    }
  }, [open, grupoDaRota, gruposVisiveis])

  // Barra inferior fixa: filtra pelas mesmas permissoes. /home nao tem permissao
  // mapeada (sempre visivel), entao a barra nunca fica vazia.
  const bottomVisivel = BOTTOM.filter((b) => permitidas === null || permitidas.has(b.href))

  return (
    <>
      <header
        className="lg:hidden sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-surface/85 backdrop-blur-xl backdrop-saturate-150 px-3"
        style={{
          paddingTop: 'env(safe-area-inset-top)',
          height: 'calc(3.5rem + env(safe-area-inset-top))',
        }}
      >
        <button
          onClick={() => setOpen(true)}
          aria-label="Abrir menu"
          className="flex size-10 items-center justify-center rounded-full text-text u-motion u-press-sm hover:bg-surface-2"
        >
          <Menu className="size-5" />
        </button>
        <Image
          src="/ntb-logo.png"
          alt="NTB"
          width={100}
          height={32}
          className="logo-adapt h-6 w-auto"
        />
        {onBuscar && (
          <button
            type="button"
            onClick={onBuscar}
            aria-label="Buscar"
            className="ml-auto flex size-10 items-center justify-center rounded-full text-text-muted u-motion u-press-sm hover:bg-surface-2 hover:text-text"
          >
            <Search className="size-5" />
          </button>
        )}
      </header>

      {/* Backdrop com fade. */}
      <div
        className={`lg:hidden fixed inset-0 z-40 bg-black/40 transition-opacity ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        style={{ transitionDuration: 'var(--dur-slow)', transitionTimingFunction: 'var(--ease-out)' }}
        onClick={() => setOpen(false)}
        aria-hidden
      />

      <aside
        className={`sidebar-blue lg:hidden fixed inset-y-0 left-0 z-50 w-[300px] max-w-[86vw] flex flex-col will-change-transform ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
        style={{
          transition: 'transform var(--dur-slow) var(--ease-in-out)',
        }}
        aria-hidden={!open}
      >
        <div
          className="flex h-14 items-center justify-between px-4 shrink-0"
          style={{ paddingTop: 'env(safe-area-inset-top)', height: 'calc(3.5rem + env(safe-area-inset-top))' }}
        >
          <Image
            src="/ntb-logo.png"
            alt="NTB"
            width={100}
            height={32}
            className="logo-adapt h-6 w-auto"
          />
          <button
            onClick={() => setOpen(false)}
            aria-label="Fechar menu"
            className="flex size-10 items-center justify-center rounded-full u-motion u-press-sm hover:bg-surface-2"
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="px-3 pb-3 shrink-0">{lojaSelector}</div>

        <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
          {gruposVisiveis.map((g) => {
            const list = itens.filter((i) => i.group === g)
            const aberto = grupoAberto === g
            const temAtivoFechado =
              !aberto &&
              list.some(
                (i) => pathname === i.href || pathname.startsWith(i.href + '/')
              )
            return (
              <div key={g}>
                <button
                  type="button"
                  onClick={() => setGrupoAberto((atual) => (atual === g ? null : g))}
                  aria-expanded={aberto}
                  className="flex w-full items-center justify-between gap-2 rounded-[10px] px-2.5 py-2.5 text-[13px] font-semibold text-text-muted u-motion active:bg-surface-2"
                >
                  <span className="flex items-center gap-1.5">
                    {g}
                    {temAtivoFechado && (
                      <span className="size-1.5 rounded-full bg-brand-fill" aria-hidden />
                    )}
                  </span>
                  <ChevronDown
                    className={`size-4 shrink-0 text-text-muted/60 transition-transform ${
                      aberto ? 'rotate-0' : '-rotate-90'
                    }`}
                    strokeWidth={2.5}
                    style={{ transitionDuration: 'var(--dur-slow)', transitionTimingFunction: 'var(--ease-in-out)' }}
                  />
                </button>
                <div
                  className="grid transition-[grid-template-rows]"
                  style={{
                    gridTemplateRows: aberto ? '1fr' : '0fr',
                    transitionDuration: 'var(--dur-slow)',
                    transitionTimingFunction: 'var(--ease-in-out)',
                  }}
                >
                  <div className="overflow-hidden">
                    <div
                      className={`space-y-0.5 pt-0.5 pb-1 transition-opacity ${
                        aberto ? 'opacity-100' : 'opacity-0'
                      }`}
                      style={{ transitionDuration: 'var(--dur)', transitionTimingFunction: 'var(--ease-out)' }}
                    >
                      {list.map((item) => {
                        const Icon = item.icon
                        const active =
                          pathname === item.href || pathname.startsWith(item.href + '/')
                        const bloqueada = !!item.cadeadoSemAdmin && !isAdmin
                        return (
                          <Link
                            key={item.href}
                            href={item.href}
                            title={bloqueada ? 'Em breve' : undefined}
                            className={`flex min-h-11 items-center gap-2.5 rounded-[10px] px-2.5 py-2.5 text-[15px] u-motion active:bg-surface-2 ${
                              active ? 'bg-white/[0.18] text-text font-semibold' : `text-text-muted ${bloqueada ? 'opacity-70' : ''}`
                            }`}
                          >
                            <Icon className="size-[18px] shrink-0" />
                            <span className="flex-1">{item.label}</span>
                            {bloqueada && <Lock className="size-3.5 shrink-0 text-text-muted/60" strokeWidth={2} />}
                          </Link>
                        )
                      })}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </nav>

        <div
          className="border-t border-border p-3 shrink-0"
          style={{ paddingBottom: 'calc(0.75rem + env(safe-area-inset-bottom))' }}
        >
          {userMenu}
        </div>
      </aside>

      <nav
        className="lg:hidden fixed bottom-0 inset-x-0 z-30 grid border-t border-border bg-surface/85 backdrop-blur-xl backdrop-saturate-150"
        style={{
          paddingBottom: 'env(safe-area-inset-bottom)',
          gridTemplateColumns: `repeat(${bottomVisivel.length}, minmax(0, 1fr))`,
        }}
      >
        {bottomVisivel.map((b) => {
          const Icon = b.icon
          const active = pathname.startsWith(b.href)
          return (
            <Link
              key={b.href}
              href={b.href}
              className={`relative flex min-h-12 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium u-motion u-press-sm active:text-brand ${
                active ? 'text-brand' : 'text-text-muted'
              }`}
            >
              {/* Pílula suave que desliza entre as abas (estilo iOS). */}
              {active && (
                <motion.span
                  layoutId="tab-ativa"
                  transition={SPRING_UI}
                  className="absolute inset-x-3 inset-y-1 rounded-[12px] bg-brand-soft"
                />
              )}
              <Icon className="relative size-5" />
              <span className="relative">{b.label}</span>
            </Link>
          )
        })}
      </nav>
    </>
  )
}
