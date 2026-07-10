'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog'
import { Plus, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { criarCategoriaContabil, editarCategoriaContabil, type CategoriaContabilInput } from '@/lib/actions/categoria-contabil'
import { btnClass, btnLinhaClass, RotuloAcao } from '@/components/ui-kit/Button'
import { Spinner } from '@/components/ui-kit/Spinner'

const inputClass =
  'w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-text outline-none transition-colors placeholder:text-text-muted focus:border-brand'
const labelClass = 'mb-1 block text-[13px] font-medium text-text-muted'

export type CategoriaContabilExistente = {
  id: number
  nome: string
  ativa: boolean
}

export function CategoriaContabilForm({ categoria }: { categoria?: CategoriaContabilExistente }) {
  const editando = !!categoria
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<CategoriaContabilInput>({
    nome: categoria?.nome ?? '',
    ativa: categoria?.ativa ?? true,
  })
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function set<K extends keyof CategoriaContabilInput>(campo: K, valor: CategoriaContabilInput[K]) {
    setForm((prev) => ({ ...prev, [campo]: valor }))
  }

  function salvar() {
    if (!form.nome.trim()) {
      toast.error('Informe o nome da categoria')
      return
    }
    startTransition(async () => {
      const res = editando ? await editarCategoriaContabil(categoria!.id, form) : await criarCategoriaContabil(form)
      if (res?.error) {
        toast.error('Erro', { description: res.error })
        return
      }
      toast.success(editando ? 'Categoria atualizada' : 'Categoria criada')
      setOpen(false)
      if (!editando) setForm({ nome: '', ativa: true })
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          editando ? (
            <button type="button" className={btnLinhaClass('ghost')} aria-label="Editar" title="Editar">
              <Pencil className="size-4" /> <RotuloAcao>Editar</RotuloAcao>
            </button>
          ) : (
            <button type="button" className={btnClass('primary')}>
              <Plus className="size-4" /> Nova categoria
            </button>
          )
        }
      />
      <DialogContent className="overflow-hidden bg-surface p-0 sm:max-w-md" showCloseButton={false}>
        <div className="border-b border-border px-4 py-3 text-base font-semibold text-text">
          {editando ? 'Editar categoria contábil' : 'Nova categoria contábil'}
        </div>
        <div className="space-y-3 px-4 py-3">
          <div>
            <label className={labelClass}>Nome</label>
            <input
              className={inputClass}
              value={form.nome}
              autoFocus
              onChange={(e) => set('nome', e.target.value)}
              placeholder="Ex.: Matéria-prima"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-text">
            <input
              type="checkbox"
              checked={form.ativa}
              onChange={(e) => set('ativa', e.target.checked)}
              className="accent-[var(--brand)]"
            />
            Categoria ativa
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button type="button" onClick={salvar} disabled={pending} className={btnClass('primary')}>
            {pending && <Spinner />}
            {pending ? 'Salvando...' : editando ? 'Salvar' : 'Criar categoria'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
