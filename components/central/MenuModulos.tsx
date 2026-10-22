'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ChevronDown, LayoutGrid, type LucideIcon } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import { SPRING_UI } from '@/lib/motion'
import { NAV_ITEMS } from '@/components/shell/NavItems'
import { MODULOS, moduloDoPath } from '@/lib/central/modulos'
import { modulosVisiveis, type ModuloPronto } from '@/lib/central/visibilidade'
import { destinosDoMenu } from '@/lib/central/organizar'
import { iconeDoItem } from '@/lib/central/icones'
import { hrefAtivo } from '@/lib/nav-ativo'
import type { CtxVisibilidade } from '@/lib/nav-visivel'

type Destino = { href: string; label: string; Icon: LucideIcon }

/** Telas e cadastros do módulo (mesmos nomes da central), cada um a um clique. */
function destinosDoModulo(m: ModuloPronto): Destino[] {
  return destinosDoMenu(m).map((d) => ({ ...d, Icon: iconeDoItem(d.label).Icon }))
}

/** Menu novo (só desenvolvedores): 7 módulos, cada um abre a central em /central/<id>. */
export function MenuModulos({ ctx, compacto = false }: { ctx: CtxVisibilidade; compacto?: boolean }) {
  const pathname = usePathname()
  const modulos = React.useMemo(() => modulosVisiveis(MODULOS, NAV_ITEMS, ctx), [ctx])
  const ativo = moduloDoPath(pathname)
  const geralAtivo = pathname === '/central'
  // Abertos: o módulo da tela atual abre sozinho; os demais abrem pela seta.
  const [abertos, setAbertos] = React.useState<Set<string>>(() => new Set(ativo ? [ativo] : []))
  React.useEffect(() => {
    if (ativo) setAbertos((a) => (a.has(ativo) ? a : new Set(a).add(ativo)))
  }, [ativo])
  const alternar = (id: string) =>
    setAbertos((a) => {
      const n = new Set(a)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  const pilulaId = compacto ? 'nav-ativo-modulos-m' : 'nav-ativo'
  const altura = compacto ? 'min-h-11 py-2.5 text-[15px]' : 'h-9 text-[14px]'

  const cls = (on: boolean) =>
    `group relative flex ${altura} items-center gap-2.5 rounded-[10px] px-2.5 u-motion u-press-sm ${
      on ? 'text-text font-semibold' : 'text-text-muted hover:bg-white/10 hover:text-text'
    }`

  return (
    <div className="space-y-0.5" data-menu-novo>
      <Link href="/central" className={cls(geralAtivo)} aria-current={geralAtivo ? 'page' : undefined}>
        {geralAtivo && <Pilula id={pilulaId} />}
        <LayoutGrid className="relative size-[17px] shrink-0" strokeWidth={1.9} />
        <span className="relative flex-1">Visão geral</span>
      </Link>
      {modulos.map((m) => {
        const Icon = m.icone
        const on = ativo === m.id
        const destinos = destinosDoModulo(m)
        // Mais específico vence: em /estoque/ajustes só "Ajustes de estoque" acende, não "Estoque".
        const destinoAtivo = hrefAtivo(pathname, destinos.map((d) => d.href))
        const aberto = abertos.has(m.id)
        return (
          <div key={m.id}>
            <div className="relative flex items-center">
              <Link href={m.href} className={`${cls(on)} flex-1`} aria-current={pathname === m.href ? 'page' : undefined}>
                {pathname === m.href && m.href.startsWith('/central') && <Pilula id={pilulaId} />}
                <Icon className="relative size-[17px] shrink-0" strokeWidth={1.9} />
                <span className="relative flex-1">{m.nome}</span>
              </Link>
              {destinos.length > 0 && (
                <button
                  type="button"
                  onClick={() => alternar(m.id)}
                  aria-expanded={aberto}
                  aria-label={`${aberto ? 'Recolher' : 'Mostrar'} as telas de ${m.nome}`}
                  className="absolute right-1 flex size-7 items-center justify-center rounded-full text-text-muted u-motion hover:bg-white/15 hover:text-text"
                >
                  <motion.span animate={{ rotate: aberto ? 180 : 0 }} transition={SPRING_UI}>
                    <ChevronDown className="size-4" aria-hidden />
                  </motion.span>
                </button>
              )}
            </div>
            <AnimatePresence initial={false}>
              {aberto && destinos.length > 0 && (
                <motion.ul
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={SPRING_UI}
                  className="overflow-hidden"
                >
                  {destinos.map((d) => {
                    const sel = d.href === destinoAtivo
                    return (
                      <li key={d.href}>
                        <Link
                          href={d.href}
                          aria-current={sel ? 'page' : undefined}
                          className={`ml-[18px] flex ${compacto ? 'min-h-10 text-[14px]' : 'h-8 text-[13px]'} items-center gap-2 rounded-[9px] border-l border-white/15 pl-3 pr-2 u-motion ${
                            sel ? 'bg-white/[0.16] font-semibold text-text' : 'text-text-muted hover:bg-white/10 hover:text-text'
                          }`}
                        >
                          <d.Icon className="size-[15px] shrink-0" strokeWidth={1.9} aria-hidden />
                          <span className="truncate">{d.label}</span>
                        </Link>
                      </li>
                    )
                  })}
                </motion.ul>
              )}
            </AnimatePresence>
          </div>
        )
      })}
    </div>
  )
}

function Pilula({ id }: { id: string }) {
  return (
    <motion.span
      layoutId={id}
      transition={SPRING_UI}
      className="absolute inset-0 rounded-[10px] bg-white/[0.18] shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]"
    />
  )
}

/** Interruptor discreto "Menu antigo / Menu novo" (rodapé do menu, só para desenvolvedores). */
export function AlternaMenu({ novo, onChange }: { novo: boolean; onChange: (novo: boolean) => void }) {
  const opcao = (valor: boolean, rotulo: string) => (
    <button
      type="button"
      onClick={() => onChange(valor)}
      aria-pressed={novo === valor}
      className={`flex-1 rounded-[8px] px-2 py-1 text-[12px] font-medium u-motion ${
        novo === valor ? 'bg-white/[0.18] text-text' : 'text-text-muted hover:text-text'
      }`}
    >
      {rotulo}
    </button>
  )
  return (
    <div className="flex items-center gap-1 rounded-[10px] bg-surface-2/60 p-0.5" role="group" aria-label="Versão do menu">
      {opcao(false, 'Menu antigo')}
      {opcao(true, 'Menu novo')}
    </div>
  )
}
