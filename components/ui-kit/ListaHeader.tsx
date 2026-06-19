'use client'

import * as React from 'react'

/**
 * ListaHeader — wrapper sticky para o cabeçalho das telas de lista.
 *
 * Envolve <PageHeader> (+ chips opcionais) e mantém o bloco fixo
 * enquanto a tabela rola, com fundo e borda inferior sutil.
 *
 * Mobile  : sticky top-14 z-20 (abaixo do MobileNav h-14 z-30).
 * Desktop : sticky top-0 z-20 (MobileNav é lg:hidden; sidebar é fixo).
 *
 * z-index 20 — igual ao DetailHeader: acima da tabela, abaixo de
 * modais/gaveta (z-40/z-50).
 *
 * -mx + px: estica o fundo até as bordas do container (px-4/lg:px-8
 * do AppShell), sem afetar o layout interno dos filhos.
 *
 * O <PageHeader> filho mantém seu mb-5 original; o pb-3 do wrapper
 * garante respiro entre os chips e a tabela quando o bloco está colado.
 *
 * Coordenação do thead sticky (bug I2):
 * Um ResizeObserver mede a altura deste bloco e grava --lista-header-h
 * em document.documentElement. Lista.tsx e DataTable.tsx usam essa
 * variável no top do <thead> para que o cabeçalho da tabela fique
 * colado ABAIXO deste bloco, sem colidir.
 */
export function ListaHeader({ children }: { children: React.ReactNode }) {
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    const el = ref.current
    if (!el) return

    // MobileNav tem h-14 (56px) e só aparece abaixo de lg (1024px).
    // No desktop o ListaHeader começa em top-0; no mobile em top-14.
    // O thead sticky precisa de top = (offset do MobileNav) + (altura do ListaHeader)
    // para não colidir com nenhum dos dois cabeçalhos fixos.
    const MOBILE_NAV_H = 56 // px — equivale a h-14 do MobileNav
    const isDesktop = () => window.matchMedia('(min-width: 1024px)').matches

    const update = () => {
      const h = el.getBoundingClientRect().height
      const offset = isDesktop() ? 0 : MOBILE_NAV_H
      document.documentElement.style.setProperty('--lista-header-h', `${offset + h}px`)
    }

    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)

    // Recalcula ao redimensionar a janela (mudança desktop ↔ mobile)
    window.addEventListener('resize', update)

    return () => {
      ro.disconnect()
      window.removeEventListener('resize', update)
      // Limpa ao desmontar (tela sem ListaHeader não herdaria offset antigo)
      document.documentElement.style.removeProperty('--lista-header-h')
    }
  }, [])

  return (
    <div
      ref={ref}
      className={[
        'sticky top-14 lg:top-0 z-20',
        'bg-bg/95 backdrop-blur-sm',
        'border-b border-border',
        '-mx-4 px-4 lg:-mx-8 lg:px-8',
        'pt-3 pb-3',
        // Remove a margem inferior do último filho (ex: mb-5 do PageHeader quando
        // não há chips) para o bloco sticky não ficar com padding excessivo.
        '[&>*:last-child]:mb-0',
        'min-w-0',
      ].join(' ')}
    >
      {children}
    </div>
  )
}
