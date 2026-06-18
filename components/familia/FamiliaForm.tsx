'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog'
import { Plus, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { criarFamilia, editarFamilia, type FamiliaInput } from '@/lib/actions/familia'
import { btnClass } from '@/components/ui-kit/Button'

const inputClass =
  'w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-text outline-none transition-colors placeholder:text-text-muted focus:border-brand'
const labelClass = 'mb-1 block text-[13px] font-medium text-text-muted'

export type FamiliaExistente = {
  id: number
  nome: string
  codigo: string | null
  inativo: boolean
}

export function FamiliaForm({ familia }: { familia?: FamiliaExistente }) {
  const editando = !!familia
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<FamiliaInput>({
    nome: familia?.nome ?? '',
    codigo: familia?.codigo ?? '',
    inativo: familia?.inativo ?? false,
  })
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function set<K extends keyof FamiliaInput>(campo: K, valor: FamiliaInput[K]) {
    setForm((prev) => ({ ...prev, [campo]: valor }))
  }

  function salvar() {
    if (!form.nome.trim()) {
      toast.error('Informe o nome da família')
      return
    }
    startTransition(async () => {
      const res = editando ? await editarFamilia(familia!.id, form) : await criarFamilia(form)
      if (res?.error) {
        toast.error('Erro', { description: res.error })
        return
      }
      toast.success(editando ? 'Família atualizada' : 'Família criada')
      setOpen(false)
      if (!editando) setForm({ nome: '', codigo: '', inativo: false })
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          editando ? (
            <button type="button" className={btnClass('ghost')}>
              <Pencil className="size-4" /> Editar
            </button>
          ) : (
            <button type="button" className={btnClass('primary')}>
              <Plus className="size-4" /> Nova família
            </button>
          )
        }
      />
      <DialogContent className="overflow-hidden bg-surface p-0 sm:max-w-md" showCloseButton={false}>
        <div className="border-b border-border px-4 py-3 text-base font-semibold text-text">
          {editando ? 'Editar família' : 'Nova família'}
        </div>
        <div className="space-y-3 px-4 py-3">
          <div>
            <label className={labelClass}>Nome da família</label>
            <input
              className={inputClass}
              value={form.nome}
              autoFocus
              onChange={(e) => set('nome', e.target.value)}
              placeholder="Ex.: Bebidas"
            />
          </div>
          <div>
            <label className={labelClass}>Código de integração (opcional)</label>
            <input
              className={inputClass}
              value={form.codigo}
              onChange={(e) => set('codigo', e.target.value)}
              placeholder="Código interno, se usar"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-text">
            <input
              type="checkbox"
              checked={form.inativo}
              onChange={(e) => set('inativo', e.target.checked)}
              className="accent-[var(--brand)]"
            />
            Família inativa
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button type="button" onClick={salvar} disabled={pending} className={btnClass('primary')}>
            {pending ? 'Salvando...' : editando ? 'Salvar' : 'Criar família'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
