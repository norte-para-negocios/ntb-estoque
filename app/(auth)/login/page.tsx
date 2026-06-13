'use client'

import Image from 'next/image'
import { useActionState } from 'react'
import { login } from '@/lib/actions/auth'
import { btnClass } from '@/components/ui-kit/Button'

const inputClass =
  'w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none transition-colors placeholder:text-text-muted focus:border-brand'
const labelClass = 'mb-1 block text-[13px] font-medium text-text-muted'

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(login, null)

  return (
    <div className="w-full max-w-md">
      <div
        className="rounded-lg border border-border bg-surface p-8"
        style={{ boxShadow: 'var(--shadow-md)' }}
      >
        <div className="mb-8 flex justify-center">
          <Image src="/ntb-logo.png" alt="NTB - Estoque" width={180} height={60} priority className="h-14 w-auto dark:brightness-0 dark:invert" />
        </div>

        <form action={formAction} className="space-y-4">
          <div>
            <label htmlFor="email" className={labelClass}>E-mail</label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              autoFocus
              placeholder="voce@norteparanegocios.com.br"
              className={inputClass}
            />
          </div>
          <div>
            <label htmlFor="password" className={labelClass}>Senha</label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              placeholder="••••••••"
              className={inputClass}
            />
          </div>

          {state?.error && (
            <div className="rounded-md border border-[var(--err)]/30 bg-[var(--err)]/10 px-3 py-2 text-sm text-[var(--err)]">
              {state.error}
            </div>
          )}

          <button
            type="submit"
            disabled={pending}
            className={`${btnClass('primary')} w-full py-2.5`}
          >
            {pending ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  )
}
