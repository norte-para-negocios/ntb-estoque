'use client'

import { useEffect, useState } from 'react'
import { Moon, Sun } from 'lucide-react'

export function ThemeToggle() {
  const [escuro, setEscuro] = useState(false)

  useEffect(() => {
    setEscuro(document.documentElement.classList.contains('dark'))
  }, [])

  function alternar() {
    const novo = !document.documentElement.classList.contains('dark')
    document.documentElement.classList.toggle('dark', novo)
    try {
      localStorage.setItem('tema', novo ? 'dark' : 'light')
    } catch {
      // ignora indisponibilidade do localStorage
    }
    setEscuro(novo)
  }

  return (
    <button
      type="button"
      onClick={alternar}
      title={escuro ? 'Mudar para claro' : 'Mudar para escuro'}
      aria-label={escuro ? 'Mudar para claro' : 'Mudar para escuro'}
      className="flex size-8 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-2 hover:text-text"
    >
      {escuro ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </button>
  )
}
