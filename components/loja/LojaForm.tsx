'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Dialog,
  DialogContent,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Plus, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { criarLoja, editarLoja, type LojaInput } from '@/lib/actions/loja'
import { btnClass } from '@/components/ui-kit/Button'

const inputClass =
  'w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-text outline-none transition-colors placeholder:text-text-muted focus:border-brand'
const labelClass = 'mb-1 block text-[13px] font-medium text-text-muted'

export type LojaExistente = {
  id: number
  cnpj: string | null
  nome: string | null
  nome_fantasia: string | null
  cep: string | null
  uf: string | null
  cidade: string | null
  bairro: string | null
  logradouro: string | null
  numero: string | null
  omie_app_key: string | null
  omie_app_secret: string | null
  ativo: boolean | null
}

function vazio(): LojaInput {
  return {
    cnpj: '',
    nome: '',
    nome_fantasia: '',
    cep: '',
    uf: '',
    cidade: '',
    bairro: '',
    logradouro: '',
    numero: '',
    omie_app_key: '',
    omie_app_secret: '',
    ativo: true,
  }
}

function fromLoja(l: LojaExistente): LojaInput {
  return {
    cnpj: l.cnpj ?? '',
    nome: l.nome ?? '',
    nome_fantasia: l.nome_fantasia ?? '',
    cep: l.cep ?? '',
    uf: l.uf ?? '',
    cidade: l.cidade ?? '',
    bairro: l.bairro ?? '',
    logradouro: l.logradouro ?? '',
    numero: l.numero ?? '',
    omie_app_key: l.omie_app_key ?? '',
    omie_app_secret: l.omie_app_secret ?? '',
    ativo: l.ativo ?? true,
  }
}

export function LojaForm({ loja }: { loja?: LojaExistente }) {
  const editando = !!loja
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<LojaInput>(loja ? fromLoja(loja) : vazio())
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function set<K extends keyof LojaInput>(campo: K, valor: LojaInput[K]) {
    setForm((prev) => ({ ...prev, [campo]: valor }))
  }

  function salvar() {
    if (!form.cnpj.trim() || !form.nome.trim()) {
      toast.error('Preencha CNPJ e nome')
      return
    }
    startTransition(async () => {
      const res = editando ? await editarLoja(loja!.id, form) : await criarLoja(form)
      if (res?.error) {
        toast.error('Erro', { description: res.error })
        return
      }
      toast.success(editando ? 'Loja atualizada' : 'Loja criada')
      setOpen(false)
      if (!editando) setForm(vazio())
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          editando ? (
            <button type="button" className={btnClass('outline')}>
              <Pencil className="size-4" /> Editar
            </button>
          ) : (
            <button type="button" className={btnClass('primary')}>
              <Plus className="size-4" /> Nova loja
            </button>
          )
        }
      />
      <DialogContent className="overflow-hidden bg-surface p-0 sm:max-w-lg" showCloseButton={false}>
        <div className="border-b border-border px-4 py-3 text-base font-semibold text-text">
          {editando ? 'Editar loja' : 'Nova loja'}
        </div>
        <div className="grid max-h-[60vh] grid-cols-2 gap-3 overflow-y-auto px-4 py-3">
          <div>
            <label className={labelClass}>CNPJ</label>
            <input className={inputClass} value={form.cnpj} onChange={(e) => set('cnpj', e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>Nome</label>
            <input className={inputClass} value={form.nome} onChange={(e) => set('nome', e.target.value)} />
          </div>
          <div className="col-span-2">
            <label className={labelClass}>Nome fantasia</label>
            <input
              className={inputClass}
              value={form.nome_fantasia}
              onChange={(e) => set('nome_fantasia', e.target.value)}
            />
          </div>
          <div>
            <label className={labelClass}>CEP</label>
            <input className={inputClass} value={form.cep} onChange={(e) => set('cep', e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>UF</label>
            <input
              className={inputClass}
              value={form.uf}
              maxLength={2}
              onChange={(e) => set('uf', e.target.value)}
            />
          </div>
          <div>
            <label className={labelClass}>Cidade</label>
            <input className={inputClass} value={form.cidade} onChange={(e) => set('cidade', e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>Bairro</label>
            <input className={inputClass} value={form.bairro} onChange={(e) => set('bairro', e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>Logradouro</label>
            <input
              className={inputClass}
              value={form.logradouro}
              onChange={(e) => set('logradouro', e.target.value)}
            />
          </div>
          <div>
            <label className={labelClass}>Número</label>
            <input className={inputClass} value={form.numero} onChange={(e) => set('numero', e.target.value)} />
          </div>
          <div className="col-span-2">
            <label className={labelClass}>Omie App Key</label>
            <input
              className={inputClass}
              value={form.omie_app_key}
              onChange={(e) => set('omie_app_key', e.target.value)}
              placeholder="Deixe vazio para loja fora do Omie"
            />
          </div>
          <div className="col-span-2">
            <label className={labelClass}>Omie App Secret</label>
            <input
              className={inputClass}
              value={form.omie_app_secret}
              onChange={(e) => set('omie_app_secret', e.target.value)}
              placeholder="Deixe vazio para loja fora do Omie"
            />
          </div>
          <label className="col-span-2 flex items-center gap-2 text-sm text-text">
            <input
              type="checkbox"
              checked={form.ativo}
              onChange={(e) => set('ativo', e.target.checked)}
              className="accent-[var(--brand)]"
            />
            Loja ativa
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button type="button" onClick={salvar} disabled={pending} className={btnClass('primary')}>
            {pending ? 'Salvando...' : editando ? 'Salvar' : 'Criar loja'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
