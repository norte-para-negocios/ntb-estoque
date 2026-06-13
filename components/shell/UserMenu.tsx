'use client'

import { logout } from '@/lib/actions/auth'
import { LogOut } from 'lucide-react'

export function UserMenu({ nome, perfil }: { nome: string; perfil: string | null }) {
  const iniciais = nome
    .split(' ')
    .slice(0, 2)
    .map((p) => p[0])
    .join('')
    .toUpperCase()
  return (
    <div className="flex items-center gap-2.5">
      <div className="size-8 rounded-full bg-brand-soft text-brand flex items-center justify-center text-xs font-semibold shrink-0">
        {iniciais}
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-text">{nome}</div>
        <div className="text-[11px] text-text-muted">{perfil ?? 'Usuário'}</div>
      </div>
      <button
        onClick={() => logout()}
        aria-label="Sair"
        title="Sair"
        className="shrink-0 text-text-muted hover:text-[var(--err)] transition-colors"
      >
        <LogOut className="size-4" />
      </button>
    </div>
  )
}
