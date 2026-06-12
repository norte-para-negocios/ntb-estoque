'use client'

import Image from 'next/image'
import { useActionState } from 'react'
import { login } from '@/lib/actions/auth'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'

export default function LoginPage() {
  const [state, formAction, pending] = useActionState(login, null)

  return (
    <div className="w-full max-w-sm">
      <div className="mb-8 flex justify-center">
        <Image src="/ntb-logo.png" alt="NTB Stock" width={160} height={54} priority className="h-12 w-auto" />
      </div>

      <div className="rounded-xl border bg-card p-6 shadow-[0_8px_30px_-12px_rgba(0,0,0,0.12)]">
        <h1 className="text-lg font-semibold tracking-tight">Entrar na sua conta</h1>
        <p className="text-sm text-muted-foreground mt-0.5 mb-5">
          Use as credenciais fornecidas pelo administrador.
        </p>
        <form action={formAction} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">E-mail</Label>
            <Input id="email" name="email" type="email" required autoComplete="email" placeholder="voce@norteparanegocios.com.br" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Senha</Label>
            <Input id="password" name="password" type="password" required autoComplete="current-password" placeholder="••••••••" />
          </div>
          {state?.error && (
            <div className="rounded-md bg-destructive/10 border border-destructive/20 px-3 py-2 text-sm text-destructive">
              {state.error}
            </div>
          )}
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? 'Entrando...' : 'Entrar'}
          </Button>
        </form>
      </div>
    </div>
  )
}
