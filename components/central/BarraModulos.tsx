'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { MoreHorizontal } from 'lucide-react'
import { motion } from 'motion/react'
import { SPRING_UI } from '@/lib/motion'
import { NAV_ITEMS } from '@/components/shell/NavItems'
import { MODULOS, moduloDoPath } from '@/lib/central/modulos'
import { modulosVisiveis } from '@/lib/central/visibilidade'
import type { CtxVisibilidade } from '@/lib/nav-visivel'

// Os módulos do dia a dia na barra do celular; o resto fica no "Mais" (abre o menu lateral).
const NA_BARRA = ['inicio', 'estoque', 'compras', 'producao']

/** Barra inferior do celular com o menu novo (só desenvolvedores). */
export function BarraModulos({ ctx, onMais }: { ctx: CtxVisibilidade; onMais: () => void }) {
  const pathname = usePathname()
  const ativo = moduloDoPath(pathname)
  const modulos = React.useMemo(
    () => modulosVisiveis(MODULOS, NAV_ITEMS, ctx).filter((m) => NA_BARRA.includes(m.id)),
    [ctx]
  )
  const cls = (on: boolean) =>
    `relative flex min-h-12 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium u-motion u-press-sm active:text-brand ${
      on ? 'text-brand' : 'text-text-muted'
    }`
  const maisAtivo = ativo != null && !NA_BARRA.includes(ativo)

  return (
    <nav
      className="lg:hidden fixed bottom-0 inset-x-0 z-30 grid border-t border-border bg-surface/85 backdrop-blur-xl backdrop-saturate-150"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)', gridTemplateColumns: `repeat(${modulos.length + 1}, minmax(0, 1fr))` }}
    >
      {modulos.map((m) => {
        const Icon = m.icone
        const on = ativo === m.id
        return (
          <Link key={m.id} href={m.href} className={cls(on)} aria-current={pathname === m.href ? 'page' : undefined}>
            {on && <Pilula />}
            <Icon className="relative size-5" />
            <span className="relative">{m.nome}</span>
          </Link>
        )
      })}
      <button type="button" onClick={onMais} className={cls(maisAtivo)} aria-label="Mais módulos">
        {maisAtivo && <Pilula />}
        <MoreHorizontal className="relative size-5" />
        <span className="relative">Mais</span>
      </button>
    </nav>
  )
}

function Pilula() {
  return <motion.span layoutId="tab-ativa" transition={SPRING_UI} className="absolute inset-x-3 inset-y-1 rounded-[12px] bg-brand-soft" />
}
