'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { btnClass } from '@/components/ui-kit/Button'
import { criarEvento } from '@/lib/actions/cozinha-eventos'

const campo = 'h-10 w-full rounded-[var(--r-md)] bg-surface-2 px-3 text-[15px] outline-none focus:ring-2 focus:ring-brand/40'

export function FormEvento() {
  const router = useRouter()
  const [aberto, setAberto] = useState(false)
  const [nome, setNome] = useState('')
  const [data, setData] = useState('')
  const [convidados, setConvidados] = useState('50')
  const [pendente, start] = useTransition()

  const enviar = (e: React.FormEvent) => {
    e.preventDefault()
    start(async () => {
      const r = await criarEvento(nome, data || null, Number(convidados))
      if ('error' in r) { toast.error(r.error); return }
      setAberto(false)
      router.push(`/cozinha/eventos/${r.id}`)
    })
  }

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger render={<button type="button" className={btnClass('primary')}><Plus className="size-4" /> Novo evento</button>} />
      <DialogContent className="bg-surface sm:max-w-md">
        <DialogTitle>Novo evento</DialogTitle>
        <DialogDescription>Depois você escolhe os pratos e vê o custo por pessoa, a produção e as compras.</DialogDescription>
        <form onSubmit={enviar} className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-[13px] font-medium">Nome do evento</span>
            <input autoFocus required maxLength={120} value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Casamento Andrade" className={campo} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-[13px] font-medium">Data</span>
              <input type="date" value={data} onChange={(e) => setData(e.target.value)} className={campo} />
            </label>
            <label className="block">
              <span className="mb-1 block text-[13px] font-medium">Convidados</span>
              <input required inputMode="numeric" value={convidados} onChange={(e) => setConvidados(e.target.value.replace(/\D/g, ''))} className={`${campo} num text-right`} />
            </label>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className={btnClass('outline')} onClick={() => setAberto(false)}>Cancelar</button>
            <button type="submit" disabled={pendente || !nome.trim() || !(Number(convidados) > 0)} className={btnClass('primary')}>{pendente ? 'Criando…' : 'Criar'}</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
