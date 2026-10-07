'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ClipboardCheck } from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { btnClass } from '@/components/ui-kit/Button'
import { Spinner } from '@/components/ui-kit/Spinner'
import { abrirInventario } from '@/lib/actions/inventario-proprio'
import { ROTULO_CLASSE, type ClasseAbc } from '@/lib/estoque/inventario-regras'

const campo =
  'w-full rounded-[var(--r-md)] border-0 bg-surface-2 px-3 py-2 text-sm text-text outline-none max-sm:text-base focus:ring-2 focus:ring-brand/40'

export function NovaContagem({ locais, porClasse }: { locais: { codigoLocal: number; descricao: string }[]; porClasse: Record<ClasseAbc, number> }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [local, setLocal] = useState<number | ''>(locais.length === 1 ? locais[0].codigoLocal : '')
  const [tipo, setTipo] = useState<'geral' | 'ciclica'>('geral')
  const [classe, setClasse] = useState<ClasseAbc>('A')
  const [descricao, setDescricao] = useState('')
  const [pending, start] = useTransition()

  function abrir() {
    if (local === '') return toast.error('Escolha o local que será contado')
    start(async () => {
      const r = await abrirInventario({ codigoLocal: local, tipo, classe: tipo === 'ciclica' ? classe : null, descricao })
      if ('error' in r) { toast.error('Não foi possível abrir a contagem', { description: r.error }); return }
      toast.success('Contagem aberta', { description: `${r.itens} item(ns) para conferir. O saldo do sistema fica escondido.` })
      setOpen(false)
      router.push(`/inventario-proprio/${r.id}/contar`)
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<button type="button" className={btnClass('primary')}><ClipboardCheck className="size-4" />Nova contagem</button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nova contagem de estoque</DialogTitle>
          <p className="text-[13px] text-text-muted">Quem conta não vê quanto o sistema acha que tem. A diferença só aparece na revisão.</p>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="ctg-local">Local</Label>
            <select id="ctg-local" className={campo} value={local} onChange={(e) => setLocal(Number(e.target.value))}>
              <option value="" disabled>Escolha o local</option>
              {locais.map((l) => <option key={l.codigoLocal} value={l.codigoLocal}>{l.descricao}</option>)}
            </select>
          </div>
          <div className="space-y-2">
            <Label>Tipo</Label>
            <div className="inline-flex rounded-[10px] bg-surface-2 p-0.5 text-[13px] font-medium">
              {(['geral', 'ciclica'] as const).map((t) => (
                <button key={t} type="button" onClick={() => setTipo(t)}
                  className={`rounded-[8px] px-3 py-1.5 u-motion ${tipo === t ? 'bg-surface text-text shadow-sm' : 'text-text-muted hover:text-text'}`}>
                  {t === 'geral' ? 'Geral (tudo do local)' : 'Cíclica (por curva)'}
                </button>
              ))}
            </div>
          </div>
          {tipo === 'ciclica' && (
            <div className="space-y-2">
              <Label>Curva</Label>
              <div className="grid gap-2">
                {(['A', 'B', 'C'] as const).map((c) => (
                  <button key={c} type="button" onClick={() => setClasse(c)}
                    className={`flex items-start gap-3 rounded-[var(--r-md)] p-3 text-left u-motion ${classe === c ? 'bg-brand/10 ring-2 ring-brand/40' : 'bg-surface-2 hover:bg-[var(--border)]'}`}>
                    <span className="num flex size-7 shrink-0 items-center justify-center rounded-full bg-surface text-[14px] font-bold text-text">{c}</span>
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium text-text">{ROTULO_CLASSE[c]}</span>
                      <span className="text-[12px] text-text-muted">{porClasse[c]} produto{porClasse[c] === 1 ? '' : 's'} na loja</span>
                    </span>
                  </button>
                ))}
              </div>
              <p className="text-[12px] text-text-muted">A curva usa o valor saído nos últimos 90 dias. Só entram os itens que o sistema acredita haver neste local.</p>
            </div>
          )}
          <div className="space-y-2">
            <Label htmlFor="ctg-desc">Descrição (opcional)</Label>
            <input id="ctg-desc" className={campo} value={descricao} onChange={(e) => setDescricao(e.target.value)} placeholder="Ex.: Contagem do bar, domingo à noite" />
          </div>
        </div>
        <DialogFooter>
          <button type="button" className={btnClass('primary')} onClick={abrir} disabled={pending}>{pending && <Spinner />}Abrir contagem</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
