'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { criarProdutoSubstituicao, type ProdutoSubstituicaoInput } from '@/lib/actions/produto-substituicao'
import { btnClass } from '@/components/ui-kit/Button'

const selectClass =
  'w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-text outline-none transition-colors focus:border-brand'
const labelClass = 'mb-1 block text-[13px] font-medium text-text-muted'

type Produto = { n_cod_prod: number; descricao: string | null }

export function ProdutoSubstituicaoForm({ produtos }: { produtos: Produto[] }) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<Partial<ProdutoSubstituicaoInput>>({})
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function salvar() {
    if (!form.n_cod_prod || !form.substitui_n_cod_prod) {
      toast.error('Selecione os dois produtos')
      return
    }
    startTransition(async () => {
      const res = await criarProdutoSubstituicao(form as ProdutoSubstituicaoInput)
      if (res?.error) {
        toast.error('Erro', { description: res.error })
        return
      }
      toast.success('Vínculo criado')
      setOpen(false)
      setForm({})
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <button type="button" className={btnClass('primary')}>
            <Plus className="size-4" /> Vincular substituto
          </button>
        }
      />
      <DialogContent className="overflow-hidden bg-surface p-0 sm:max-w-md" showCloseButton={false}>
        <div className="border-b border-border px-4 py-3 text-base font-semibold text-text">
          Vincular produto substituto
        </div>
        <div className="space-y-3 px-4 py-3">
          <div>
            <label className={labelClass}>Produto sem histórico</label>
            <select
              className={selectClass}
              value={form.n_cod_prod ?? ''}
              onChange={(e) => setForm((prev) => ({ ...prev, n_cod_prod: e.target.value ? Number(e.target.value) : undefined }))}
            >
              <option value="">Selecione...</option>
              {produtos.map((p) => (
                <option key={p.n_cod_prod} value={p.n_cod_prod}>{p.descricao ?? p.n_cod_prod}</option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Usar o histórico de</label>
            <select
              className={selectClass}
              value={form.substitui_n_cod_prod ?? ''}
              onChange={(e) => setForm((prev) => ({ ...prev, substitui_n_cod_prod: e.target.value ? Number(e.target.value) : undefined }))}
            >
              <option value="">Selecione...</option>
              {produtos.map((p) => (
                <option key={p.n_cod_prod} value={p.n_cod_prod}>{p.descricao ?? p.n_cod_prod}</option>
              ))}
            </select>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button type="button" onClick={salvar} disabled={pending} className={btnClass('primary')}>
            {pending ? 'Salvando...' : 'Vincular'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
