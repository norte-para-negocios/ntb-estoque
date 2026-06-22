'use client'

import * as React from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronDown, PanelLeftClose, PanelLeftOpen, Lock } from 'lucide-react'
import { NAV_ITEMS, type NavItem } from './NavItems'

const GRUPOS = ['Operação', 'Cadastros', 'Administração'] as const
type Grupo = (typeof GRUPOS)[number]

const LS_RECOLHIDA = 'ntb.sidebar.recolhida'
const LS_GRUPO_ABERTO = 'ntb.sidebar.grupoAberto'

/** Lê localStorage com segurança (SSR + JSON quebrado não derrubam a UI). */
function lerLS<T>(chave: string, fallback: T): T {
  if (typeof window === 'undefined') return fallback
  try {
    const v = window.localStorage.getItem(chave)
    return v === null ? fallback : (JSON.parse(v) as T)
  } catch {
    return fallback
  }
}

function gravarLS(chave: string, valor: unknown) {
  try {
    window.localStorage.setItem(chave, JSON.stringify(valor))
  } catch {
    /* localStorage indisponível (modo privado): degrada sem quebrar. */
  }
}

export function Sidebar({
  isAdmin,
  podeGerirUsuarios = false,
  rotasVisiveis,
  lojaSelector,
  userMenu,
}: {
  isAdmin: boolean
  podeGerirUsuarios?: boolean
  rotasVisiveis: string[] | null
  lojaSelector: React.ReactNode
  userMenu: React.ReactNode
}) {
  const pathname = usePathname()

  // Filtro de permissão (4.2) intacto: mesma regra de antes.
  // - admin: so admin global. - gestaoUsuarios: admin global OU AdminLoja.
  const permitidas = rotasVisiveis ? new Set(rotasVisiveis) : null
  const itens = React.useMemo(
    () =>
      NAV_ITEMS.filter(
        (i) =>
          (!i.admin || isAdmin) &&
          (!i.gestaoUsuarios || isAdmin || podeGerirUsuarios) &&
          (permitidas === null || permitidas.has(i.href))
      ),
    [isAdmin, podeGerirUsuarios, rotasVisiveis] // eslint-disable-line react-hooks/exhaustive-deps
  )

  // Só os grupos que sobraram itens depois do filtro.
  const gruposVisiveis = React.useMemo(
    () => GRUPOS.filter((g) => itens.some((i) => i.group === g)),
    [itens]
  )

  // Qual grupo contém a rota atual? Ele começa aberto.
  const grupoDaRota = React.useMemo<Grupo | null>(() => {
    const atual = itens.find(
      (i) => pathname === i.href || pathname.startsWith(i.href + '/')
    )
    return atual?.group ?? null
  }, [itens, pathname])

  // Estado: sanfona com um grupo aberto por vez + sidebar recolhida.
  // Inicializa de forma estável no SSR; reidrata do localStorage após montar.
  const [montado, setMontado] = React.useState(false)
  const [recolhida, setRecolhida] = React.useState(false)
  const [grupoAberto, setGrupoAberto] = React.useState<Grupo | null>(null)

  React.useEffect(() => {
    const r = lerLS<boolean>(LS_RECOLHIDA, false)
    const salvoAberto = lerLS<Grupo | null>(LS_GRUPO_ABERTO, null)
    setRecolhida(r)
    // Prioriza o grupo da rota atual; cai pro salvo; por fim o primeiro grupo.
    const inicial =
      (grupoDaRota && gruposVisiveis.includes(grupoDaRota) && grupoDaRota) ||
      (salvoAberto && gruposVisiveis.includes(salvoAberto) ? salvoAberto : null) ||
      gruposVisiveis[0] ||
      null
    setGrupoAberto(inicial)
    setMontado(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Ao navegar, garante que o grupo da rota atual esteja aberto.
  React.useEffect(() => {
    if (!montado || !grupoDaRota) return
    setGrupoAberto((atual) => (atual === grupoDaRota ? atual : grupoDaRota))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grupoDaRota])

  function alternarGrupo(g: Grupo) {
    setGrupoAberto((atual) => {
      const proximo = atual === g ? null : g
      gravarLS(LS_GRUPO_ABERTO, proximo)
      return proximo
    })
  }

  function recolher() {
    setRecolhida(true)
    gravarLS(LS_RECOLHIDA, true)
  }

  function expandir() {
    setRecolhida(false)
    gravarLS(LS_RECOLHIDA, false)
  }

  // Botão flutuante: aparece quando recolhida. Retângulo de cantos bem
  // arredondados, solto sobre o conteúdo (não preso à borda).
  return (
    <>
      <FloatingToggle visivel={montado && recolhida} onClick={expandir} />

      <aside
        data-recolhida={recolhida}
        className={`hidden lg:flex shrink-0 flex-col border-r border-border bg-surface sticky top-0 h-screen self-start overflow-hidden will-change-[width,opacity] ${
          recolhida ? 'w-0 -translate-x-2 opacity-0 pointer-events-none border-r-0' : 'w-64 translate-x-0 opacity-100'
        }`}
        style={{
          transition:
            'width var(--dur-slow) var(--ease-in-out), opacity var(--dur) var(--ease-out), transform var(--dur-slow) var(--ease-in-out)',
        }}
        aria-hidden={recolhida}
      >
        {/* min-w-64 trava a largura do conteúdo durante a animação de width,
            evitando reflow/“amassado” do texto enquanto a aside encolhe. */}
        <div className="flex w-64 min-w-64 flex-col h-full">
          <div className="flex h-16 items-center justify-between gap-2 px-5 border-b border-border">
            <Image
              src="/ntb-logo.png"
              alt="NTB"
              width={110}
              height={36}
              priority
              className="h-7 w-auto dark:brightness-0 dark:invert"
            />
            <button
              type="button"
              onClick={recolher}
              aria-label="Recolher menu"
              title="Recolher menu"
              className="flex size-8 items-center justify-center rounded-md text-text-muted u-motion u-press-sm hover:bg-surface-2 hover:text-text"
            >
              <PanelLeftClose className="size-[18px]" strokeWidth={2} />
            </button>
          </div>

          <div className="px-3 py-3 border-b border-border">{lojaSelector}</div>

          <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
            {gruposVisiveis.map((g) => {
              const list = itens.filter((i) => i.group === g)
              const aberto = montado ? grupoAberto === g : g === gruposVisiveis[0]
              const temAtivoFechado =
                !aberto &&
                list.some(
                  (i) => pathname === i.href || pathname.startsWith(i.href + '/')
                )
              return (
                <GrupoSanfona
                  key={g}
                  grupo={g}
                  aberto={aberto}
                  temAtivoFechado={temAtivoFechado}
                  onToggle={() => alternarGrupo(g)}
                >
                  {list.map((item) => (
                    <SideLink
                      key={item.href}
                      item={item}
                      isAdmin={isAdmin}
                      active={
                        pathname === item.href || pathname.startsWith(item.href + '/')
                      }
                    />
                  ))}
                </GrupoSanfona>
              )
            })}
          </nav>

          <div className="border-t border-border p-3">{userMenu}</div>
        </div>
      </aside>
    </>
  )
}

function FloatingToggle({ visivel, onClick }: { visivel: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Abrir menu"
      title="Abrir menu"
      className={`hidden lg:flex fixed left-4 top-4 z-40 items-center gap-2 rounded-2xl border border-border bg-surface/90 px-3 py-2.5 text-sm font-medium text-text shadow-[var(--shadow-md)] backdrop-blur will-change-transform hover:-translate-y-px hover:bg-surface hover:shadow-[var(--shadow-md)] active:scale-[var(--press)] ${
        visivel
          ? 'translate-x-0 scale-100 opacity-100 pointer-events-auto'
          : '-translate-x-3 scale-95 opacity-0 pointer-events-none'
      }`}
      style={{
        transition:
          'transform var(--dur-slow) var(--ease-in-out), opacity var(--dur) var(--ease-out)',
      }}
    >
      <PanelLeftOpen className="size-[18px] text-brand" strokeWidth={2} />
      <Image
        src="/ntb-logo.png"
        alt="NTB"
        width={64}
        height={22}
        className="h-4 w-auto dark:brightness-0 dark:invert"
      />
    </button>
  )
}

function GrupoSanfona({
  grupo,
  aberto,
  temAtivoFechado,
  onToggle,
  children,
}: {
  grupo: string
  aberto: boolean
  temAtivoFechado: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={aberto}
        className="group flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-2 text-[11px] font-bold uppercase tracking-[0.1em] text-text-muted/70 u-motion hover:bg-surface-2 hover:text-text-muted"
      >
        <span className="flex items-center gap-1.5">
          {grupo}
          {temAtivoFechado && (
            <span className="size-1.5 rounded-full bg-brand" aria-hidden />
          )}
        </span>
        <ChevronDown
          className={`size-3.5 shrink-0 text-text-muted/60 transition-transform ${
            aberto ? 'rotate-0' : '-rotate-90'
          }`}
          strokeWidth={2.5}
          style={{ transitionDuration: 'var(--dur-slow)', transitionTimingFunction: 'var(--ease-in-out)' }}
        />
      </button>
      {/* grid-template-rows 0fr->1fr: anima a altura sem medir o DOM e sem
          animar `height` (mais barato; só transform/opacity no conteúdo). */}
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
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}

function SideLink({ item, active, isAdmin }: { item: NavItem; active: boolean; isAdmin: boolean }) {
  const Icon = item.icon
  // Bloqueada para quem nao e admin global: cadeado e cinza, mas ainda navega
  // (a propria pagina mostra o "em breve").
  const bloqueada = !!item.cadeadoSemAdmin && !isAdmin
  return (
    <Link
      href={item.href}
      className={`group relative flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm u-motion u-press-sm ${
        active
          ? 'bg-brand-soft text-text font-medium'
          : `text-text-muted hover:bg-surface-2 hover:text-text ${bloqueada ? 'opacity-70' : ''}`
      }`}
      title={bloqueada ? 'Em breve' : undefined}
    >
      {active && (
        <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-brand" />
      )}
      <Icon
        className={`size-[17px] shrink-0 u-motion ${
          active ? 'text-brand' : 'text-text-muted/70 group-hover:translate-x-px group-hover:text-text-muted'
        }`}
        strokeWidth={2}
      />
      <span className="flex-1">{item.label}</span>
      {bloqueada && <Lock className="size-3.5 shrink-0 text-text-muted/60" strokeWidth={2} />}
    </Link>
  )
}
