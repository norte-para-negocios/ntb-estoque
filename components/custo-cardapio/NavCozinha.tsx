'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

// Abas da Norte Cozinha. A ordem segue o caminho do dono: o que está acontecendo → o que compra → o que produz → o que vende.
export const ABAS_COZINHA = [
  { href: '/cozinha', rotulo: 'Início', exato: true },
  { href: '/cozinha/insumos', rotulo: 'Insumos' },
  { href: '/cozinha/preparacoes', rotulo: 'Preparações' },
  { href: '/cozinha/pratos', rotulo: 'Pratos' },
  { href: '/cozinha/cardapios', rotulo: 'Cardápios' },
  { href: '/cozinha/estoque', rotulo: 'Estoque' },
  { href: '/cozinha/eventos', rotulo: 'Eventos' },
  { href: '/cozinha/pacioli', rotulo: 'Pacioli' },
  { href: '/cozinha/configuracoes', rotulo: 'Configurações' },
] as const

export function NavCozinha() {
  const path = usePathname()
  return (
    <nav aria-label="Norte Cozinha" className="-mx-1 overflow-x-auto pb-1 print:hidden">
      <ul className="flex w-max gap-1 px-1">
        {ABAS_COZINHA.map((a) => {
          const ativo = 'exato' in a ? path === a.href : path === a.href || path.startsWith(a.href + '/')
          return (
            <li key={a.href}>
              <Link href={a.href} aria-current={ativo ? 'page' : undefined}
                className={`inline-flex h-8 items-center whitespace-nowrap rounded-full px-3.5 text-[13px] font-semibold u-motion u-press-sm ${ativo ? 'bg-brand-fill text-white' : 'bg-surface-2 text-text-muted hover:bg-[var(--border)] hover:text-text'}`}>
                {a.rotulo}
              </Link>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
