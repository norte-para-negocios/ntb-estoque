'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Dialog,
  DialogContent,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { criarUsuario } from '@/lib/actions/usuario'
import { btnClass } from '@/components/ui-kit/Button'

const inputClass =
  'w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-text outline-none transition-colors placeholder:text-text-muted focus:border-brand'
const labelClass = 'mb-1 block text-[13px] font-medium text-text-muted'

type Loja = { id: number; nome: string; nome_fantasia: string | null }

export function NovoUsuario({ lojas }: { lojas: Loja[] }) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [perfil, setPerfil] = useState<'Admin' | 'Usuario'>('Usuario')
  const [lojaIds, setLojaIds] = useState<number[]>([])
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function toggleLoja(id: number) {
    setLojaIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  function criar() {
    if (!name || !email) {
      toast.error('Preencha nome e e-mail')
      return
    }
    if (perfil === 'Usuario' && lojaIds.length === 0) {
      toast.error('Selecione ao menos uma loja')
      return
    }
    startTransition(async () => {
      const res = await criarUsuario({
        name,
        email,
        perfil,
        lojaIds: perfil === 'Admin' ? lojas.map((l) => l.id) : lojaIds,
      })
      if (res?.error) {
        toast.error('Erro', { description: res.error })
        return
      }
      toast.success('Usuário criado', {
        description: `Senha provisória: ${res.senha}`,
        duration: 15000,
      })
      setOpen(false)
      setName('')
      setEmail('')
      setLojaIds([])
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <button type="button" className={btnClass('primary')}>
            <Plus className="size-4" /> Novo usuário
          </button>
        }
      />
      <DialogContent className="overflow-hidden bg-surface p-0" showCloseButton={false}>
        <div className="border-b border-border px-4 py-3 text-base font-semibold text-text">
          Novo usuário
        </div>
        <div className="space-y-4 px-4 py-3">
          <div>
            <label className={labelClass}>Nome</label>
            <input className={inputClass} value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>E-mail</label>
            <input
              className={inputClass}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
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
          <button type="button" onClick={criar} disabled={pending} className={btnClass('primary')}>
            {pending ? 'Criando...' : 'Criar usuário'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
