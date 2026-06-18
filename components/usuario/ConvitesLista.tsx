'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Copy, Check, Trash2, Ticket, ShieldHalf, User as UserIcon } from 'lucide-react'
import { toast } from 'sonner'
import { revogarConvite } from '@/lib/actions/convite'

export type ConviteItem = {
  id: number
  codigo: string
  perfil: string
  permissoesCount: number
  lojaNome: string
  expira_em: string | null
}

// Lista de convites ativos (ainda nao usados). Copiar codigo + revogar.
export function ConvitesLista({ convites }: { convites: ConviteItem[] }) {
  if (!convites.length) {
    return (
      <p className="px-4 py-3 text-[13px] text-text-muted">
        Nenhum convite ativo. Gere um em &quot;Convidar por código&quot;.
      </p>
    )
  }
  return (
    <ul className="divide-y divide-border">
      {convites.map((c) => (
        <ConviteRow key={c.id} convite={c} />
      ))}
    </ul>
  )
}

function fmtData(d: string | null): string | null {
  if (!d) return null
  return new Date(d).toLocaleDateString('pt-BR', { timeZone: 'America/Bahia' })
}

function ConviteRow({ convite }: { convite: ConviteItem }) {
  const [copiado, setCopiado] = useState(false)
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function copiar() {
    navigator.clipboard.writeText(convite.codigo)
    setCopiado(true)
    setTimeout(() => setCopiado(false), 2000)
  }

  function revogar() {
    startTransition(async () => {
      const res = await revogarConvite(convite.id)
      if (res?.error) {
        toast.error('Erro', { description: res.error })
        return
      }
      toast.success('Convite revogado')
      router.refresh()
    })
  }

  const expira = fmtData(convite.expira_em)
  const isAdminLoja = convite.perfil === 'AdminLoja'

  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-0.5">
        <div className="flex items-center gap-2">
          <Ticket className="size-3.5 shrink-0 text-text-muted" />
          <span className="num text-sm font-medium tracking-wider text-text">{convite.codigo}</span>
        </div>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12px] text-text-muted">
          <span className="inline-flex items-center gap-1">
            {isAdminLoja ? <ShieldHalf className="size-3" /> : <UserIcon className="size-3" />}
            {isAdminLoja ? 'Admin da loja' : 'Usuário'}
          </span>
          <span>·</span>
          <span className="truncate">{convite.lojaNome}</span>
          {!isAdminLoja && (
            <>
              <span>·</span>
              <span>
                <span className="num">{convite.permissoesCount}</span> permissão(ões)
              </span>
            </>
          )}
          {expira && (
            <>
              <span>·</span>
              <span>expira em {expira}</span>
            </>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={copiar}
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[13px] font-medium text-text transition-colors hover:bg-surface-2"
        >
          {copiado ? <Check className="size-4" /> : <Copy className="size-4" />}
          {copiado ? 'Copiado' : 'Copiar'}
        </button>
        <button
          type="button"
          onClick={revogar}
          disabled={pending}
          className="inline-flex items-center gap-1.5 rounded-md border border-err/40 px-2.5 py-1.5 text-[13px] font-medium text-err transition-colors hover:bg-err/10 disabled:opacity-60"
        >
          <Trash2 className="size-4" /> Revogar
        </button>
      </div>
    </li>
  )
}
