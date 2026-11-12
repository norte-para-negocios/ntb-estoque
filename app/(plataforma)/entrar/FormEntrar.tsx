'use client'

import { useActionState } from 'react'
import { AlertCircle } from 'lucide-react'
import { login } from '@/lib/actions/auth'
import { LogoNegocios } from '@/components/plataforma/logo-negocios'

export function FormEntrar() {
  const [state, formAction, pending] = useActionState(login, null)
  return (
    <form action={formAction}>
      <LogoNegocios className="pn-logo-cel" />
      <h2>Entrar</h2>
      <p className="pn-d">Com o seu e-mail.</p>
      {/* Lista fechada no servidor (destinoDoLogin): só /porta é aceito. */}
      <input type="hidden" name="destino" value="/porta" />
      <label className="pn-campo">
        <span>E-mail</span>
        <input name="email" type="email" required autoComplete="email" autoFocus placeholder="voce@restaurante.com.br" />
      </label>
      <label className="pn-campo">
        <span>Senha</span>
        <input name="password" type="password" required autoComplete="current-password" placeholder="Sua senha" />
      </label>
      {state?.error && (
        <p role="alert" className="pn-erro">
          <AlertCircle size={16} strokeWidth={2} style={{ marginTop: 2, flex: 'none' }} aria-hidden="true" />
          <span>{state.error}</span>
        </p>
      )}
      <button type="submit" className="pn-entrar" disabled={pending}>
        {pending ? 'Entrando…' : 'Entrar'}
      </button>
    </form>
  )
}
