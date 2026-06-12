'use client'

import { logout } from '@/lib/actions/auth'
import { LogOut } from 'lucide-react'

export function LogoutButton() {
  return (
    <button
      onClick={() => logout()}
      className="text-sidebar-foreground/50 hover:text-white transition-colors shrink-0"
      title="Sair"
      aria-label="Sair"
    >
      <LogOut className="size-4" />
    </button>
  )
}
