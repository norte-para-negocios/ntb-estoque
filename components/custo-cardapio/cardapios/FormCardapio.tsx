'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { Plus } from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { SegmentedControl } from '@/components/ui-kit/SegmentedControl'
import { btnClass } from '@/components/ui-kit/Button'
import { criarCardapio, editarCardapio } from '@/lib/actions/cozinha-cardapios'
import { CANAIS, NOME_CANAL, type CanalCardapio } from '@/lib/custo-cardapio/cardapios-puro'

const DICA_CANAL: Record<CanalCardapio, string> = {
  salao: 'CMV = custo ÷ preço, contra a meta.',
  delivery: 'Conta a comissão do app, o cartão, o imposto e a embalagem.',
  evento: 'Mesma conta do salão, para cardápios de festa.',
}

/** Criar cardápio (sem `cardapio`) ou mudar nome e canal de um que existe. */
export function FormCardapio({ cardapio, gatilho }: { cardapio?: { id: number; nome: string; canal: CanalCardapio }; gatilho?: React.ReactElement }) {
  const router = useRouter()
  const [aberto, setAberto] = useState(false)
  const [nome, setNome] = useState(cardapio?.nome ?? '')
  const [canal, setCanal] = useState<CanalCardapio>(cardapio?.canal ?? 'salao')
  const [pendente, start] = useTransition()

  const enviar = (e: React.FormEvent) => {
    e.preventDefault()
    start(async () => {
      if (cardapio) {
        const r = await editarCardapio(cardapio.id, nome, canal)
        if ('error' in r) { toast.error(r.error); return }
        toast.success('Cardápio salvo')
        setAberto(false)
      } else {
        const r = await criarCardapio(nome, canal)
        if ('error' in r) { toast.error(r.error); return }
        setAberto(false)
        router.push(`/cozinha/cardapios/${r.id}`)
      }
    })
  }

  return (
    <Dialog open={aberto} onOpenChange={(v) => { setAberto(v); if (v) { setNome(cardapio?.nome ?? ''); setCanal(cardapio?.canal ?? 'salao') } }}>
      <DialogTrigger render={gatilho ?? <button type="button" className={btnClass('primary')}><Plus className="size-4" /> Novo cardápio</button>} />
      <DialogContent className="bg-surface sm:max-w-md">
        <DialogTitle>{cardapio ? 'Editar cardápio' : 'Novo cardápio'}</DialogTitle>
        <DialogDescription>Escolha onde ele é vendido: a conta do CMV muda com o canal.</DialogDescription>
        <form onSubmit={enviar} className="space-y-4">
          <label className="block">
            <span className="mb-1 block text-[13px] font-medium">Nome</span>
            <input autoFocus required maxLength={80} value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Ex.: Almoço executivo"
              className="h-10 w-full rounded-[var(--r-md)] bg-surface-2 px-3 text-[15px] outline-none focus:ring-2 focus:ring-brand/40" />
          </label>
          <div>
            <span className="mb-1 block text-[13px] font-medium">Onde é vendido</span>
            <SegmentedControl aria-label="Canal" value={canal} onChange={(v) => setCanal(v as CanalCardapio)} opcoes={CANAIS.map((c) => ({ value: c, label: NOME_CANAL[c] }))} />
            <p className="mt-1.5 text-[12px] text-text-muted">{DICA_CANAL[canal]}</p>
          </div>
          <div className="flex justify-end gap-2">
            <button type="button" className={btnClass('outline')} onClick={() => setAberto(false)}>Cancelar</button>
            <button type="submit" disabled={pendente || !nome.trim()} className={btnClass('primary')}>{pendente ? 'Salvando…' : cardapio ? 'Salvar' : 'Criar'}</button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
