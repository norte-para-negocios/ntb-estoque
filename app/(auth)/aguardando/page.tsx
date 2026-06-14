import Image from 'next/image'
import { Clock } from 'lucide-react'
import { getUser } from '@/lib/auth'
import { logout } from '@/lib/actions/auth'
import { btnClass } from '@/components/ui-kit/Button'

// Tela para usuario logado mas com status 'pendente' (aguardando aprovacao do admin).
// Nao usa getProfile (evita loop com o redirect do gate); so confirma que ha sessao.
export default async function AguardandoPage() {
  await getUser()

  return (
    <div className="w-full max-w-md">
      <div className="rounded-lg border border-border bg-surface p-8 text-center" style={{ boxShadow: 'var(--shadow-md)' }}>
        <div className="mb-8 flex justify-center">
          <Image src="/ntb-logo.png" alt="NTB - Estoque" width={180} height={60} priority className="h-14 w-auto dark:brightness-0 dark:invert" />
        </div>
        <Clock className="mx-auto mb-4 size-12 text-brand" />
        <h1 className="mb-2 text-lg font-semibold text-text">Conta aguardando aprovação</h1>
        <p className="mb-6 text-sm text-text-muted">
          Seu cadastro foi recebido e está aguardando a liberação de um administrador.
          Assim que sua conta for aprovada e vinculada a uma loja, você terá acesso ao sistema.
        </p>
        <form action={logout}>
          <button type="submit" className={`${btnClass('outline')} w-full justify-center`}>
            Sair
          </button>
        </form>
      </div>
    </div>
  )
}
