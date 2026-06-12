'use client'

import { logout } from '@/lib/actions/auth'
import { LogOut } from 'lucide-react'

export function LogoutButton() {
  return (
    <button
      onClick={() => logout()}
      className="text-gray-400 hover:text-gray-700"
      title="Sair"
      aria-label="Sair"
    >
      <LogOut className="size-4" />
    </button>
  )
}
