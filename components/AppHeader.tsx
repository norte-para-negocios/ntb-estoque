'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { Menu, X } from 'lucide-react'

export function AppHeader({ menu }: { menu: React.ReactNode }) {
  const [aberto, setAberto] = useState(false)
  const pathname = usePathname()

  // Fecha o menu ao navegar
  useEffect(() => {
    setAberto(false)
  }, [pathname])

  return (
    <>
      {/* Topbar branca */}
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-[#e2e2e2] bg-white px-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setAberto(true)}
            className="flex size-10 items-center justify-center rounded text-[#5d5d5d] transition-colors hover:bg-[#f4f4f4]"
            aria-label="Abrir menu"
          >
            <Menu className="size-6" strokeWidth={2} />
          </button>
          <Link href="/home" className="flex items-center">
            <Image src="/ntb-logo.png" alt="NTB - Estoque" width={120} height={40} priority className="h-7 w-auto" />
          </Link>
        </div>
      </header>

      {/* Backdrop */}
      {aberto && (
        <div
          className="fixed inset-0 z-40 bg-black/30 transition-opacity"
          onClick={() => setAberto(false)}
          aria-hidden
        />
      )}

      {/* Offcanvas esquerdo */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 w-[300px] max-w-[85vw] overflow-y-auto bg-[#f4f4f4] shadow-xl transition-transform duration-300 ${
          aberto ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between border-b border-[#e2e2e2] px-4 py-4">
          <Image src="/ntb-logo.png" alt="NTB - Estoque" width={120} height={40} className="h-7 w-auto" />
          <button
            type="button"
            onClick={() => setAberto(false)}
            className="flex size-9 items-center justify-center rounded text-[#5d5d5d] transition-colors hover:bg-white"
            aria-label="Fechar menu"
          >
            <X className="size-5" strokeWidth={2} />
          </button>
        </div>
        <div className="px-4 py-5">{menu}</div>
      </aside>
    </>
  )
}
