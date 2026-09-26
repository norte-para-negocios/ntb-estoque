'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useActionState } from 'react'
import { cadastrar } from '@/lib/actions/cadastro'
import { btnClass } from '@/components/ui-kit/Button'
import { Spinner } from '@/components/ui-kit/Spinner'
import { AlertCircle, CheckCircle2 } from 'lucide-react'

const inputClass =
  'h-11 w-full rounded-[var(--r-md)] border-0 bg-surface-2 px-3.5 text-[15px] text-text outline-none transition-shadow placeholder:text-text-muted focus:ring-2 focus:ring-brand/40 max-sm:text-base'
const labelClass = 'mb-1.5 block text-[13px] font-semibold text-text-muted'

export default function CadastroPage() {
  const [state, formAction, pending] = useActionState(cadastrar, null)

  return (
    <div className="w-full max-w-md">
      <div className="rounded-[var(--r-xl)] bg-surface p-6 shadow-[var(--shadow-md)] sm:p-8">
        <div className="mb-8 flex justify-center">
          <Image src="/ntb-logo.png" alt="NTB - Estoque" width={180} height={60} priority className="logo-adapt h-14 w-auto" />
        </div>

        {state?.ok ? (
          <div className="space-y-4 text-center">
            <CheckCircle2 className="mx-auto size-12 text-ok" />
            {state.entrou ? (
              <>
                <h1 className="text-[22px] font-bold tracking-[-0.01em] text-text">Conta criada</h1>
                <p className="text-[15px] text-text-muted">
                  Você já está vinculado à loja{' '}
                  <span className="font-medium text-text">{state.loja}</span>. Entre com seu
                  e-mail e senha. O responsável pela loja ajusta suas permissões.
                </p>
              </>
            ) : (
              <>
                <h1 className="text-[22px] font-bold tracking-[-0.01em] text-text">Acesso solicitado</h1>
                <p className="text-[15px] text-text-muted">
                  Seu pedido de acesso foi enviado e está aguardando a aprovação de um
                  administrador. Assim que for liberado, você poderá entrar com seu e-mail e
                  senha.
                </p>
              </>
            )}
            <Link href="/login" className={`${btnClass('primary')} h-11! w-full text-[15px]!`}>
              Ir para o login
            </Link>
          </div>
        ) : (
          <>
            <h1 className="mb-1 text-center text-[22px] font-bold tracking-[-0.01em] text-text">Pedir acesso</h1>
            <p className="mb-6 text-center text-[15px] text-text-muted">
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
                  className={`${inputClass}`}
                />
                <p className="mt-1 text-[12px] text-text-muted">
                  Recebeu um código do responsável? Informe para já entrar com o acesso liberado.
                  Sem código, seu pedido aguarda aprovação de um administrador.
                </p>
              </div>

              {state?.error && (
                <p role="alert" className="flex items-start gap-2 text-[14px] text-err">
                  <AlertCircle className="mt-0.5 size-4 shrink-0" strokeWidth={2} />
                  <span>{state.error}</span>
                </p>
              )}

              <button type="submit" disabled={pending} className={`${btnClass('primary')} h-11! w-full text-[15px]!`}>
                {pending && <Spinner />}
                {pending ? 'Enviando...' : 'Pedir acesso'}
              </button>
            </form>

            <p className="mt-6 text-center text-[13px] text-text-muted">
              Já tem conta?{' '}
              <Link href="/login" className="font-semibold text-brand hover:underline">
                Entrar
              </Link>
            </p>
          </>
        )}
      </div>
    </div>
  )
}
