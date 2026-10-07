'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { BellRing, PackageX, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { btnClass, btnLinhaClass, RotuloAcao } from '@/components/ui-kit/Button'
import { Spinner } from '@/components/ui-kit/Spinner'
import { baixarLoteVencido, reconciliarLotes, salvarAlertaValidade } from '@/lib/actions/validade-proprio'

const campo =
  'w-full rounded-[var(--r-md)] border-0 bg-surface-2 px-3 py-2 text-sm text-text outline-none max-sm:text-base focus:ring-2 focus:ring-brand/40'

const MOTIVOS = ['Vencido', 'Estragou antes do vencimento', 'Avaria / embalagem danificada', 'Descarte por qualidade']

export type LoteAcao = {
  id: number; produto: string; codigo: string | null; unidade: string | null; lote: string | null; validade: string | null; saldo: number; local: string
}

const fmt = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 })
const data = (iso: string | null) => (iso ? iso.split('-').reverse().join('/') : 'sem validade')

/** 'Dar baixa por vencimento' de um lote: quantidade (padrão = saldo do lote) e motivo. Entra no estoque como PERDA. */
export function BaixaLote({ lote }: { lote: LoteAcao }) {
  const [open, setOpen] = useState(false)
  const [qtd, setQtd] = useState(String(lote.saldo).replace('.', ','))
  const [motivo, setMotivo] = useState(MOTIVOS[0])
  const [detalhe, setDetalhe] = useState('')
  const [pending, start] = useTransition()
  const router = useRouter()
  const un = lote.unidade ?? ''

  function salvar() {
    const m = [motivo, detalhe.trim()].filter(Boolean).join(' · ')
    start(async () => {
      const r = await baixarLoteVencido({ loteId: lote.id, quantidade: qtd, motivo: m })
      if ('error' in r) { toast.error('Não foi possível dar baixa', { description: r.error }); return }
      toast.success('Baixa registrada', { description: r.aviso ?? `${fmt(Number(qtd.replace(',', '.')))} ${un} saíram do estoque como perda.` })
      setOpen(false)
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger
        render={
          <button type="button" aria-label={`Dar baixa no lote ${lote.lote ?? ''}`} title="Dar baixa por vencimento" className={btnLinhaClass('dangerSoft')}>
            <PackageX className="size-4" /><RotuloAcao>Dar baixa</RotuloAcao>
          </button>
        }
      />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Dar baixa por vencimento</DialogTitle>
          <p className="text-[13px] text-text-muted">
            {lote.produto}{lote.codigo && <span className="num"> · {lote.codigo}</span>}
          </p>
        </DialogHeader>
        <div className="space-y-4">
          <dl className="grid grid-cols-3 gap-2 rounded-[var(--r-md)] bg-surface-2 p-3 text-[13px]">
            <div><dt className="text-text-muted">Lote</dt><dd className="num font-medium text-text">{lote.lote ?? '—'}</dd></div>
            <div><dt className="text-text-muted">Validade</dt><dd className="num font-medium text-text">{data(lote.validade)}</dd></div>
            <div><dt className="text-text-muted">No lote</dt><dd className="num font-medium text-text">{fmt(lote.saldo)} {un}</dd></div>
          </dl>
          <div className="space-y-2">
            <Label htmlFor="baixa-qtd">Quantidade</Label>
            <div className="relative">
              <input id="baixa-qtd" inputMode="decimal" className={`${campo} pr-12`} value={qtd} onChange={(e) => setQtd(e.target.value)} />
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] font-medium text-text-muted">{un}</span>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="baixa-motivo">Motivo</Label>
            <select id="baixa-motivo" className={campo} value={motivo} onChange={(e) => setMotivo(e.target.value)}>
              {MOTIVOS.map((m) => <option key={m}>{m}</option>)}
            </select>
            <input aria-label="Detalhe do motivo (opcional)" className={campo} value={detalhe} onChange={(e) => setDetalhe(e.target.value)} placeholder="Detalhe (opcional): onde estava, quem conferiu" />
          </div>
          <p className="text-[12px] text-text-muted">Sai do local {lote.local} como perda, fica no histórico de movimentações e não altera o custo médio.</p>
        </div>
        <DialogFooter>
          <button type="button" className={btnClass('danger')} onClick={salvar} disabled={pending}>{pending && <Spinner />}Dar baixa</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Quantos dias antes do vencimento o lote entra no alerta. */
export function ConfigAlertaValidade({ dias }: { dias: number }) {
  const [open, setOpen] = useState(false)
  const [valor, setValor] = useState(String(dias))
  const [pending, start] = useTransition()
  const router = useRouter()
  function salvar() {
    start(async () => {
      const r = await salvarAlertaValidade(valor)
      if ('error' in r) { toast.error('Não foi possível salvar', { description: r.error }); return }
      toast.success('Alerta atualizado', { description: `Lotes que vencem em até ${valor} dias aparecem no alerta.` })
      setOpen(false)
      router.refresh()
    })
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<button type="button" className={btnClass('outline')}><BellRing className="size-4" />Alerta: {dias} dias</button>} />
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Alerta de vencimento</DialogTitle>
          <p className="text-[13px] text-text-muted">Lotes que vencem dentro deste prazo aparecem no Início, na Reposição e no filtro padrão desta tela.</p>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="alerta-dias">Avisar com quantos dias de antecedência</Label>
          <div className="relative">
            <input id="alerta-dias" inputMode="numeric" className={`${campo} pr-14`} value={valor} onChange={(e) => setValor(e.target.value.replace(/\D/g, ''))} />
            <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] font-medium text-text-muted">dias</span>
          </div>
        </div>
        <DialogFooter>
          <button type="button" className={btnClass('primary')} onClick={salvar} disabled={pending}>{pending && <Spinner />}Salvar</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

/** Corrige diferença entre os lotes e o saldo do produto (só no saldo sem lote). */
export function BotaoReconciliar() {
  const [pending, start] = useTransition()
  const router = useRouter()
  return (
    <button
      type="button"
      className={btnClass('outline')}
      disabled={pending}
      onClick={() => start(async () => {
        const r = await reconciliarLotes()
        if ('error' in r) { toast.error('Não foi possível conferir', { description: r.error }); return }
        toast.success('Lotes conferidos', { description: r.corrigidos ? `${r.corrigidos} produto(s) acertado(s) no saldo sem lote.` : 'Nada a acertar.' })
        router.refresh()
      })}
    >
      {pending ? <Spinner /> : <RefreshCw className="size-4" />}Acertar lotes
    </button>
  )
}
