'use client'

import Image from 'next/image'
import { useActionState } from 'react'
import { login } from '@/lib/actions/auth'

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(login, null)

  return (
    <div className="w-full max-w-md">
      <div className="rounded-lg bg-white p-8 shadow-[0_4px_6px_rgba(0,0,0,0.1)]">
        <div className="mb-8 flex justify-center">
          <Image src="/ntb-logo.png" alt="NTB - Estoque" width={180} height={60} priority className="h-14 w-auto" />
        </div>

        <form action={formAction} className="space-y-4">
          <div>
            <label htmlFor="email" className="ntb-label">E-mail</label>
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              autoFocus
              placeholder="voce@norteparanegocios.com.br"
              className="ntb-input"
            />
          </div>
          <div>
            <label htmlFor="password" className="ntb-label">Senha</label>
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              placeholder="••••••••"
              className="ntb-input"
            />
          </div>

          {state?.error && (
            <div className="rounded border border-[#ff595e]/30 bg-[#ff595e]/10 px-3 py-2 text-sm text-[#ff595e]">
              {state.error}
            </div>
          )}

          <button
            type="submit"
            disabled={pending}
            className="ntb-btn-teal w-full justify-center py-2.5 disabled:opacity-60"
          >
            {pending ? 'Entrando...' : 'Entrar'}
          </button>
        </form>
      </div>
    </div>
  )
}
