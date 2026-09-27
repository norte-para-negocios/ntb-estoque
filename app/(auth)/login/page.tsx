'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useActionState } from 'react'
import { login } from '@/lib/actions/auth'
import { AlertCircle } from 'lucide-react'
import { btnClass } from '@/components/ui-kit/Button'

const inputClass =
  'h-11 w-full rounded-[var(--r-md)] border-0 bg-surface-2 px-3.5 text-[15px] text-text outline-none transition-shadow placeholder:text-text-muted focus:ring-2 focus:ring-brand/40 max-sm:text-base'
const labelClass = 'mb-1.5 block text-[13px] font-semibold text-text-muted'

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(login, null)

  return (
    <div className="w-full max-w-md">
      <div className="rounded-[var(--r-xl)] bg-surface p-6 shadow-[var(--shadow-md)] sm:p-8">
        <div className="mb-8 flex justify-center">
          <Image src="/norte-estoque-logo.png" alt="Norte Estoque" width={569} height={240} priority className="logo-adapt h-14 w-auto" />
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
            <p role="alert" className="flex items-start gap-2 text-[14px] text-err">
              <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} />
              <span>{state.error}</span>
            </p>
          )}

          <button
            type="submit"
            disabled={pending}
            className={`${btnClass('primary')} h-11! w-full text-[15px]!`}
          >
            {pending ? 'Entrando...' : 'Entrar'}
          </button>
        </form>

        <p className="mt-6 text-center text-[13px] text-text-muted">
          Não tem acesso?{' '}
          <Link href="/cadastro" className="font-semibold text-brand hover:underline">
            Pedir acesso
          </Link>
        </p>
      </div>
    </div>
  )
}
