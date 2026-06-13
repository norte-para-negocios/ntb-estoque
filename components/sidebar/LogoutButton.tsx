'use client'

import { logout } from '@/lib/actions/auth'
import { LogOut } from 'lucide-react'

export function LogoutButton({ variant = 'icon' }: { variant?: 'icon' | 'menu' }) {
  if (variant === 'menu') {
    return (
      <button
        onClick={() => logout()}
        className="flex w-full items-center gap-3 py-3 font-semibold text-[#ff595e] transition-colors hover:text-[#e04449]"
      >
        <LogOut className="size-5" strokeWidth={2} />
        Sair
      </button>
    )
  }

  return (
    <button
      onClick={() => logout()}
      className="shrink-0 text-[#8a8a8a] transition-colors hover:text-[#5d5d5d]"
      title="Sair"
      aria-label="Sair"
    >
      <LogOut className="size-4" />
    </button>
  )
}
