'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Dialog,
  DialogContent,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Check, X } from 'lucide-react'
import { toast } from 'sonner'
import { aprovarUsuario, recusarUsuario } from '@/lib/actions/usuario'
import { btnClass } from '@/components/ui-kit/Button'

const inputClass =
  'w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-text outline-none transition-colors focus:border-brand'
const labelClass = 'mb-1 block text-[13px] font-medium text-text-muted'

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
  const [perfil, setPerfil] = useState<'Admin' | 'Usuario'>('Usuario')
  const [lojaIds, setLojaIds] = useState<number[]>([])
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function toggleLoja(id: number) {
    setLojaIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  function aprovar() {
    if (perfil === 'Usuario' && lojaIds.length === 0) {
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
        <DialogContent className="overflow-hidden bg-surface p-0" showCloseButton={false}>
          <div className="border-b border-border px-4 py-3 text-base font-semibold text-text">
            Aprovar {nome}
          </div>
          <div className="space-y-4 px-4 py-3">
            <div>
              <label className={labelClass}>Perfil</label>
              <select
                className={inputClass}
                value={perfil}
                onChange={(e) => setPerfil((e.target.value as 'Admin' | 'Usuario') ?? 'Usuario')}
              >
                <option value="Usuario">Usuário</option>
                <option value="Admin">Administrador</option>
              </select>
            </div>
            {perfil === 'Usuario' && (
              <div>
                <label className={labelClass}>Lojas com acesso</label>
                <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border border-border p-2">
                  {lojas.map((l) => (
                    <label key={l.id} className="flex items-center gap-2 text-sm text-text">
                      <input
                        type="checkbox"
                        checked={lojaIds.includes(l.id)}
                        onChange={() => toggleLoja(l.id)}
                        className="accent-[var(--brand)]"
                      />
                      {l.nome_fantasia || l.nome}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
            <button type="button" onClick={aprovar} disabled={pending} className={btnClass('primary')}>
              {pending ? 'Aprovando...' : 'Aprovar acesso'}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
