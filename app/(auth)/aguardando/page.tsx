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
      <div className="rounded-[var(--r-xl)] bg-surface p-6 text-center shadow-[var(--shadow-md)] sm:p-8">
        <div className="mb-8 flex justify-center">
          <Image src="/ntb-logo.png" alt="NTB - Estoque" width={180} height={60} priority className="logo-adapt h-14 w-auto" />
        </div>
        <Clock className="mx-auto mb-4 size-12 text-brand" />
        <h1 className="mb-2 text-[22px] font-bold tracking-[-0.01em] text-text">Conta aguardando aprovação</h1>
        <p className="mb-6 text-[15px] text-text-muted">
          Seu cadastro foi recebido e está aguardando a liberação de um administrador.
          Assim que sua conta for aprovada e vinculada a uma loja, você terá acesso ao sistema.
        </p>
        <form action={logout}>
          <button type="submit" className={`${btnClass('outline')} h-11! w-full text-[15px]!`}>
            Sair
          </button>
        </form>
      </div>
    </div>
  )
}
