'use client'

import * as React from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutGrid } from 'lucide-react'
import { motion } from 'motion/react'
import { SPRING_UI } from '@/lib/motion'
import { NAV_ITEMS } from '@/components/shell/NavItems'
import { MODULOS, moduloDoPath } from '@/lib/central/modulos'
import { modulosVisiveis, type CtxVisibilidade } from '@/lib/central/visibilidade'

/** Menu novo (só desenvolvedores): 7 módulos, cada um abre a central em /central/<id>. */
export function MenuModulos({ ctx, compacto = false }: { ctx: CtxVisibilidade; compacto?: boolean }) {
  const pathname = usePathname()
  const modulos = React.useMemo(() => modulosVisiveis(MODULOS, NAV_ITEMS, ctx), [ctx])
  const ativo = moduloDoPath(pathname)
  const geralAtivo = pathname === '/central'
  const pilulaId = compacto ? 'nav-ativo-modulos-m' : 'nav-ativo'
  const altura = compacto ? 'min-h-11 py-2.5 text-[15px]' : 'h-9 text-[14px]'

  const cls = (on: boolean) =>
    `group relative flex ${altura} items-center gap-2.5 rounded-[10px] px-2.5 u-motion u-press-sm ${
      on ? 'text-text font-semibold' : 'text-text-muted hover:bg-white/10 hover:text-text'
    }`

  return (
    <div className="space-y-0.5" data-menu-novo>
      <Link href="/central" className={cls(geralAtivo)}>
        {geralAtivo && <Pilula id={pilulaId} />}
        <LayoutGrid className="relative size-[17px] shrink-0" strokeWidth={1.9} />
        <span className="relative flex-1">Visão geral</span>
      </Link>
      {modulos.map((m) => {
        const Icon = m.icone
        const on = ativo === m.id
        const soBreve = m.id === 'financas'
        return (
          <Link key={m.id} href={`/central/${m.id}`} className={cls(on)} aria-current={on ? 'page' : undefined}>
            {on && <Pilula id={pilulaId} />}
            <Icon className="relative size-[17px] shrink-0" strokeWidth={1.9} />
            <span className="relative flex-1">{m.nome}</span>
            {soBreve && (
              <span className="relative rounded-full bg-surface-2 px-1.5 py-px text-[10px] font-semibold text-warn">novo</span>
            )}
          </Link>
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
