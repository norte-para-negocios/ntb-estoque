'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog'
import { Plus, Pencil } from 'lucide-react'
import { toast } from 'sonner'
import { btnClass } from '@/components/ui-kit/Button'

const inputClass =
  'w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-text outline-none transition-colors placeholder:text-text-muted focus:border-brand'
const labelClass = 'mb-1 block text-[13px] font-medium text-text-muted'

// Form base de parceiro (fornecedor/cliente). cest opcional (so cliente usa).
export type ParceiroFormValues = {
  razao_social: string
  nome_fantasia: string
  cnpj_cpf: string
  pessoa_fisica: boolean
  inscricao_estadual: string
  email: string
  telefone: string
  cep: string
  uf: string
  cidade: string
  bairro: string
  logradouro: string
  numero: string
  inativo: boolean
  cest?: string
}

function vazio(comCest: boolean): ParceiroFormValues {
  const base: ParceiroFormValues = {
    razao_social: '',
    nome_fantasia: '',
    cnpj_cpf: '',
    pessoa_fisica: false,
    inscricao_estadual: '',
    email: '',
    telefone: '',
    cep: '',
    uf: '',
    cidade: '',
    bairro: '',
    logradouro: '',
    numero: '',
    inativo: false,
  }
  return comCest ? { ...base, cest: '' } : base
}

export function ParceiroForm({
  titulo,
  rotuloNovo,
  comCest = false,
  existente,
  onSubmit,
}: {
  titulo: string // "fornecedor" | "cliente"
  rotuloNovo: string // "Novo fornecedor"
  comCest?: boolean
  existente?: { id: number; values: ParceiroFormValues }
  onSubmit: (id: number | null, values: ParceiroFormValues) => Promise<{ error?: string; ok?: boolean }>
}) {
  const editando = !!existente
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<ParceiroFormValues>(existente?.values ?? vazio(comCest))
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function set<K extends keyof ParceiroFormValues>(campo: K, valor: ParceiroFormValues[K]) {
    setForm((prev) => ({ ...prev, [campo]: valor }))
  }

  function salvar() {
    if (!form.razao_social.trim()) {
      toast.error('Informe a razão social ou nome')
      return
    }
    startTransition(async () => {
      const res = await onSubmit(existente?.id ?? null, form)
      if (res?.error) {
        toast.error('Erro', { description: res.error })
        return
      }
      toast.success(editando ? 'Cadastro atualizado' : 'Cadastro criado')
      setOpen(false)
      if (!editando) setForm(vazio(comCest))
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
              <Plus className="size-4" /> {rotuloNovo}
            </button>
          )
        }
      />
      <DialogContent className="overflow-hidden bg-surface p-0 sm:max-w-lg" showCloseButton={false}>
        <div className="border-b border-border px-4 py-3 text-base font-semibold text-text">
          {editando ? `Editar ${titulo}` : rotuloNovo}
        </div>
        <div className="grid max-h-[60vh] grid-cols-2 gap-3 overflow-y-auto px-4 py-3">
          <div className="col-span-2">
            <label className={labelClass}>Razão social / Nome</label>
            <input
              className={inputClass}
              value={form.razao_social}
              autoFocus
              onChange={(e) => set('razao_social', e.target.value)}
            />
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
            <label className={labelClass}>CNPJ / CPF</label>
            <input className={inputClass} value={form.cnpj_cpf} onChange={(e) => set('cnpj_cpf', e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>Inscrição estadual</label>
            <input
              className={inputClass}
              value={form.inscricao_estadual}
              onChange={(e) => set('inscricao_estadual', e.target.value)}
            />
          </div>
          {comCest && (
            <div>
              <label className={labelClass}>CEST</label>
              <input
                className={inputClass}
                value={form.cest ?? ''}
                onChange={(e) => set('cest', e.target.value)}
                placeholder="0000000"
              />
            </div>
          )}
          <div className={comCest ? '' : 'col-span-2'}>
            <label className={labelClass}>E-mail</label>
            <input className={inputClass} value={form.email} onChange={(e) => set('email', e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>Telefone</label>
            <input className={inputClass} value={form.telefone} onChange={(e) => set('telefone', e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>CEP</label>
            <input className={inputClass} value={form.cep} onChange={(e) => set('cep', e.target.value)} />
          </div>
          <div className="col-span-2">
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
          <div>
            <label className={labelClass}>Bairro</label>
            <input className={inputClass} value={form.bairro} onChange={(e) => set('bairro', e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>Cidade</label>
            <input className={inputClass} value={form.cidade} onChange={(e) => set('cidade', e.target.value)} />
          </div>
          <div>
            <label className={labelClass}>UF</label>
            <input className={inputClass} value={form.uf} maxLength={2} onChange={(e) => set('uf', e.target.value)} />
          </div>
          <label className="col-span-2 flex items-center gap-2 text-sm text-text">
            <input
              type="checkbox"
              checked={form.pessoa_fisica}
              onChange={(e) => set('pessoa_fisica', e.target.checked)}
              className="accent-[var(--brand)]"
            />
            Pessoa física
          </label>
          <label className="col-span-2 flex items-center gap-2 text-sm text-text">
            <input
              type="checkbox"
              checked={form.inativo}
              onChange={(e) => set('inativo', e.target.checked)}
              className="accent-[var(--brand)]"
            />
            Inativo
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button type="button" onClick={salvar} disabled={pending} className={btnClass('primary')}>
            {pending ? 'Salvando...' : editando ? 'Salvar' : 'Criar'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
