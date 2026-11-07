'use client'

// Fase 6 (migration 450): formulário e ações de clientes e transportadoras (estoque próprio, só dev).
import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Download, Pencil, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog'
import { btnClass, btnLinhaClass, RotuloAcao } from '@/components/ui-kit/Button'
import { Spinner } from '@/components/ui-kit/Spinner'
import { criarCliente, editarCliente, excluirCliente, trazerTransportadorasDasNotas } from '@/lib/actions/clientes'
import { PAPEIS, ROTULO_PAPEL, type ClienteInput, type Papel } from '@/lib/clientes/clientes-puro'

const inputClass =
  'w-full rounded-[var(--r-md)] border-0 bg-surface-2 px-3 py-2 text-sm text-text outline-none transition-colors placeholder:text-text-muted max-sm:text-base focus:ring-2 focus:ring-brand/40'
const labelClass = 'mb-1 block text-[13px] font-medium text-text-muted'

export const clienteVazio = (papel: Papel = 'cliente'): ClienteInput => ({
  papel, razao_social: '', nome_fantasia: '', cnpj_cpf: '', inscricao_estadual: '', email: '', telefone: '', cep: '', uf: '', cidade: '',
  bairro: '', logradouro: '', numero: '', complemento: '', rntrc: '', inativo: false,
})

type Campo = { k: keyof ClienteInput; rotulo: string; largo?: boolean; max?: number }
const CAMPOS: Campo[] = [
  { k: 'razao_social', rotulo: 'Razão social / Nome', largo: true },
  { k: 'nome_fantasia', rotulo: 'Nome fantasia', largo: true },
  { k: 'cnpj_cpf', rotulo: 'CNPJ / CPF' },
  { k: 'inscricao_estadual', rotulo: 'Inscrição estadual' },
  { k: 'email', rotulo: 'E-mail' },
  { k: 'telefone', rotulo: 'Telefone' },
  { k: 'cep', rotulo: 'CEP' },
  { k: 'uf', rotulo: 'UF', max: 2 },
  { k: 'logradouro', rotulo: 'Endereço', largo: true },
  { k: 'numero', rotulo: 'Número' },
  { k: 'complemento', rotulo: 'Complemento' },
  { k: 'bairro', rotulo: 'Bairro' },
  { k: 'cidade', rotulo: 'Cidade' },
]

export function ClienteForm({ existente, papelInicial = 'cliente' }: { existente?: { id: number; values: ClienteInput }; papelInicial?: Papel }) {
  const editando = !!existente
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState<ClienteInput>(existente?.values ?? clienteVazio(papelInicial))
  const [pending, start] = useTransition()
  const router = useRouter()
  const set = <K extends keyof ClienteInput>(k: K, v: ClienteInput[K]) => setForm((f) => ({ ...f, [k]: v }))
  const transporta = form.papel !== 'cliente'

  function salvar() {
    start(async () => {
      const r = existente ? await editarCliente(existente.id, form) : await criarCliente(form)
      if ('error' in r) { toast.error('Não salvou', { description: r.error }); return }
      toast.success(editando ? 'Cadastro atualizado' : 'Cadastro criado')
      setOpen(false)
      if (!editando) setForm(clienteVazio(papelInicial))
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={editando ? (
          <button type="button" className={btnLinhaClass('ghost')} aria-label="Editar" title="Editar"><Pencil className="size-4" /> <RotuloAcao>Editar</RotuloAcao></button>
        ) : (
          <button type="button" className={btnClass('primary')}><Plus className="size-4" /> Novo cadastro</button>
        )}
      />
      <DialogContent className="overflow-hidden bg-surface p-0 sm:max-w-lg" showCloseButton={false}>
        <div className="px-5 pb-2 pt-5 text-[17px] font-semibold text-text">{editando ? 'Editar cadastro' : 'Novo cliente ou transportadora'}</div>
        <div className="grid max-h-[60vh] grid-cols-2 gap-3 overflow-y-auto px-5 py-3">
          <div className="col-span-2">
            <label className={labelClass}>É</label>
            <div className="flex flex-wrap gap-2">
              {PAPEIS.map((p) => (
                <button key={p} type="button" onClick={() => set('papel', p)} aria-pressed={form.papel === p}
                  className={`rounded-full px-3 py-1.5 text-[13px] ${form.papel === p ? 'bg-brand text-white' : 'bg-surface-2 text-text'}`}>
                  {ROTULO_PAPEL[p]}
                </button>
              ))}
            </div>
          </div>
          {CAMPOS.map((c) => (
            <div key={c.k} className={c.largo ? 'col-span-2' : ''}>
              <label className={labelClass}>{c.rotulo}</label>
              <input className={inputClass} value={form[c.k] as string} maxLength={c.max} autoFocus={c.k === 'razao_social'}
                onChange={(e) => set(c.k, e.target.value as never)} />
            </div>
          ))}
          {transporta && (
            <div className="col-span-2">
              <label className={labelClass}>RNTRC (registro da ANTT, opcional)</label>
              <input className={inputClass} value={form.rntrc} onChange={(e) => set('rntrc', e.target.value)} />
            </div>
          )}
          <label className="col-span-2 flex items-center gap-2 text-sm text-text">
            <input type="checkbox" checked={form.inativo} onChange={(e) => set('inativo', e.target.checked)} /> Inativo
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-5 py-3">
          <button type="button" className={btnClass('ghost')} onClick={() => setOpen(false)}>Cancelar</button>
          <button type="button" className={btnClass('primary')} onClick={salvar} disabled={pending || !form.razao_social.trim()}>
            {pending && <Spinner />} Salvar
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function ExcluirCliente({ id, nome }: { id: number; nome: string }) {
  const [pending, start] = useTransition()
  const router = useRouter()
  return (
    <button type="button" className={btnLinhaClass('ghost')} aria-label="Excluir" title="Excluir" disabled={pending}
      onClick={() => {
        if (!window.confirm(`Excluir "${nome}"?`)) return
        start(async () => {
          const r = await excluirCliente(id)
          if ('error' in r) { toast.error('Não excluiu', { description: r.error }); return }
          toast.success('Cadastro excluído'); router.refresh()
        })
      }}>
      <Trash2 className="size-4" /> <RotuloAcao>Excluir</RotuloAcao>
    </button>
  )
}

export function TrazerTransportadoras() {
  const [pending, start] = useTransition()
  const router = useRouter()
  return (
    <button type="button" className={btnClass('outline')} disabled={pending} title="Cadastra as transportadoras que aparecem nas notas de entrada"
      onClick={() => start(async () => {
        const r = await trazerTransportadorasDasNotas()
        if ('error' in r) { toast.error('Não trouxe', { description: r.error }); return }
        toast.success(r.novas || r.viraramAmbos
          ? `${r.novas} transportadora(s) nova(s)${r.viraramAmbos ? `; ${r.viraramAmbos} cliente(s) marcado(s) também como transportadora` : ''}`
          : 'Nenhuma transportadora nova nas notas')
        router.refresh()
      })}>
      {pending ? <Spinner /> : <Download className="size-4" />} Trazer das notas
    </button>
  )
}
