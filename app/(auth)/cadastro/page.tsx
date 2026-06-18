'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useActionState } from 'react'
import { cadastrar } from '@/lib/actions/cadastro'
import { btnClass } from '@/components/ui-kit/Button'
import { Spinner } from '@/components/ui-kit/Spinner'
import { CheckCircle2 } from 'lucide-react'

const inputClass =
  'w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none transition-colors placeholder:text-text-muted focus:border-brand'
const labelClass = 'mb-1 block text-[13px] font-medium text-text-muted'

export default function CadastroPage() {
  const [state, formAction, pending] = useActionState(cadastrar, null)

  return (
    <div className="w-full max-w-md">
      <div
        className="rounded-lg border border-border bg-surface p-8"
        style={{ boxShadow: 'var(--shadow-md)' }}
      >
        <div className="mb-8 flex justify-center">
          <Image src="/ntb-logo.png" alt="NTB - Estoque" width={180} height={60} priority className="h-14 w-auto dark:brightness-0 dark:invert" />
        </div>

        {state?.ok ? (
          <div className="space-y-4 text-center">
            <CheckCircle2 className="mx-auto size-12 text-ok" />
            {state.entrou ? (
              <>
                <h1 className="text-lg font-semibold text-text">Conta criada</h1>
                <p className="text-sm text-text-muted">
                  Você já está vinculado à loja{' '}
                  <span className="font-medium text-text">{state.loja}</span>. Entre com seu
                  e-mail e senha. O responsável pela loja ajusta suas permissões.
                </p>
              </>
            ) : (
              <>
                <h1 className="text-lg font-semibold text-text">Acesso solicitado</h1>
                <p className="text-sm text-text-muted">
                  Seu pedido de acesso foi enviado e está aguardando a aprovação de um
                  administrador. Assim que for liberado, você poderá entrar com seu e-mail e
                  senha.
                </p>
              </>
            )}
            <Link href="/login" className={`${btnClass('primary')} w-full justify-center`}>
              Ir para o login
            </Link>
          </div>
        ) : (
          <>
            <h1 className="mb-1 text-center text-lg font-semibold text-text">Pedir acesso</h1>
            <p className="mb-6 text-center text-[13px] text-text-muted">
              Preencha seus dados e aguarde a liberação do administrador.
            </p>
            <form action={formAction} className="space-y-4">
              <div>
                <label htmlFor="name" className={labelClass}>Nome</label>
                <input id="name" name="name" type="text" required autoFocus autoComplete="name" placeholder="Seu nome" className={inputClass} />
              </div>
              <div>
                <label htmlFor="email" className={labelClass}>E-mail</label>
                <input id="email" name="email" type="email" required autoComplete="email" placeholder="voce@exemplo.com" className={inputClass} />
              </div>
              <div>
                <label htmlFor="password" className={labelClass}>Senha</label>
                <input id="password" name="password" type="password" required minLength={6} autoComplete="new-password" placeholder="Mínimo 6 caracteres" className={inputClass} />
              </div>
              <div>
                <label htmlFor="codigo" className={labelClass}>
                  Código de convite <span className="text-text-muted/70">(opcional)</span>
                </label>
                <input
                  id="codigo"
                  name="codigo"
                  type="text"
                  autoCapitalize="characters"
                  placeholder="NTB-XXXXXXXX"
                  className={`${inputClass} uppercase tracking-wider`}
                />
                <p className="mt-1 text-[12px] text-text-muted">
                  Recebeu um código do responsável? Informe para já entrar com o acesso liberado.
                  Sem código, seu pedido aguarda aprovação de um administrador.
                </p>
              </div>

              {state?.error && (
                <div className="rounded-md border border-err/30 bg-err/10 px-3 py-2 text-sm text-err">
                  {state.error}
                </div>
              )}

              <button type="submit" disabled={pending} className={`${btnClass('primary')} w-full py-2.5`}>
                {pending && <Spinner />}
                {pending ? 'Enviando...' : 'Pedir acesso'}
              </button>
            </form>

            <p className="mt-6 text-center text-[13px] text-text-muted">
              Já tem conta?{' '}
              <Link href="/login" className="font-medium text-brand hover:underline">
                Entrar
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  )
}
