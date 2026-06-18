'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Dialog,
  DialogContent,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Check, X, ShieldCheck, ShieldHalf, User as UserIcon, Store } from 'lucide-react'
import { toast } from 'sonner'
import { aprovarUsuario, recusarUsuario, type PerfilUsuario } from '@/lib/actions/usuario'
import { btnClass } from '@/components/ui-kit/Button'

type Loja = { id: number; nome: string; nome_fantasia: string | null }

export function AprovarUsuario({
  userId,
  nome,
  lojas,
}: {
  userId: string
  nome: string
  lojas: Loja[]
}) {
  const [open, setOpen] = useState(false)
  const [perfil, setPerfil] = useState<PerfilUsuario>('Usuario')
  const [lojaIds, setLojaIds] = useState<number[]>([])
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function toggleLoja(id: number) {
    setLojaIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  function aprovar() {
    if (perfil !== 'Admin' && lojaIds.length === 0) {
      toast.error('Selecione ao menos uma loja')
      return
    }
    startTransition(async () => {
      const res = await aprovarUsuario(userId, { perfil, lojaIds })
      if (res?.error) {
        toast.error('Erro', { description: res.error })
        return
      }
      toast.success('Cadastro aprovado')
      setOpen(false)
      router.refresh()
    })
  }

  function recusar() {
    startTransition(async () => {
      const res = await recusarUsuario(userId)
      if (res?.error) {
        toast.error('Erro', { description: res.error })
        return
      }
      toast.success('Cadastro recusado')
      router.refresh()
    })
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      <button
        type="button"
        onClick={recusar}
        disabled={pending}
        className={btnClass('outline')}
      >
        <X className="size-4" /> Recusar
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogTrigger
          render={
            <button type="button" className={btnClass('primary')}>
              <Check className="size-4" /> Aprovar
            </button>
          }
        />
        <DialogContent className="overflow-hidden bg-surface p-0 sm:max-w-md" showCloseButton={false}>
          <div className="flex items-center gap-2.5 border-b border-border px-5 py-4">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand">
              <Check className="size-4" strokeWidth={2} />
            </span>
            <div className="min-w-0">
              <div className="truncate text-[15px] font-semibold text-text">Aprovar acesso</div>
              <div className="truncate text-[12px] text-text-muted">{nome}</div>
            </div>
          </div>
          <div className="space-y-5 px-5 py-4">
            <div>
              <label className="mb-1.5 block text-[13px] font-medium text-text">Perfil</label>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                <button
                  type="button"
                  onClick={() => setPerfil('Usuario')}
                  className={`flex flex-col gap-1 rounded-md border p-2.5 text-left transition-colors ${
                    perfil === 'Usuario' ? 'border-brand bg-brand-soft' : 'border-border bg-surface hover:bg-surface-2'
                  }`}
                >
                  <span className={`flex items-center gap-1.5 text-[13px] font-medium ${perfil === 'Usuario' ? 'text-brand' : 'text-text'}`}>
                    <UserIcon className="size-4" /> Usuário
                  </span>
                  <span className="text-[11px] text-text-muted">Conforme permissões</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPerfil('AdminLoja')}
                  className={`flex flex-col gap-1 rounded-md border p-2.5 text-left transition-colors ${
                    perfil === 'AdminLoja' ? 'border-brand bg-brand-soft' : 'border-border bg-surface hover:bg-surface-2'
                  }`}
                >
                  <span className={`flex items-center gap-1.5 text-[13px] font-medium ${perfil === 'AdminLoja' ? 'text-brand' : 'text-text'}`}>
                    <ShieldHalf className="size-4" /> Admin da loja
                  </span>
                  <span className="text-[11px] text-text-muted">Total nas lojas dele</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPerfil('Admin')}
                  className={`flex flex-col gap-1 rounded-md border p-2.5 text-left transition-colors ${
                    perfil === 'Admin' ? 'border-brand bg-brand-soft' : 'border-border bg-surface hover:bg-surface-2'
                  }`}
                >
                  <span className={`flex items-center gap-1.5 text-[13px] font-medium ${perfil === 'Admin' ? 'text-brand' : 'text-text'}`}>
                    <ShieldCheck className="size-4" /> Administrador
                  </span>
                  <span className="text-[11px] text-text-muted">Total no sistema</span>
                </button>
              </div>
            </div>
            {perfil !== 'Admin' && (
              <div>
                <label className="mb-1.5 block text-[13px] font-medium text-text">
                  <span className="inline-flex items-center gap-1.5">
                    <Store className="size-3.5 text-text-muted" /> Lojas com acesso
                  </span>
                </label>
                <div className="grid grid-cols-1 gap-1.5 rounded-md border border-border bg-surface-2/30 p-2 sm:grid-cols-2">
                  {lojas.map((l) => {
                    const on = lojaIds.includes(l.id)
                    return (
                      <button
                        key={l.id}
                        type="button"
                        onClick={() => toggleLoja(l.id)}
                        className={`flex items-center gap-2 rounded-md border px-2.5 py-1.5 text-left text-[13px] transition-colors ${
                          on ? 'border-brand bg-brand-soft text-text' : 'border-border bg-surface text-text-muted hover:text-text'
                        }`}
                      >
                        <span
                          className={`flex size-4 shrink-0 items-center justify-center rounded border ${
                            on ? 'border-brand bg-brand text-white' : 'border-border'
                          }`}
                        >
                          {on && <span className="text-[10px] leading-none">✓</span>}
                        </span>
                        <span className="truncate">{l.nome_fantasia || l.nome}</span>
                      </button>
                    )
                  })}
                </div>
                <p className="mt-1.5 text-[12px] text-text-muted">
                  As permissões iniciais ficam liberadas; ajuste depois em Editar.
                </p>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
            <button type="button" onClick={() => setOpen(false)} disabled={pending} className={btnClass('outline')}>
              Cancelar
            </button>
            <button type="button" onClick={aprovar} disabled={pending} className={btnClass('primary')}>
              {pending ? 'Aprovando...' : 'Aprovar acesso'}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
