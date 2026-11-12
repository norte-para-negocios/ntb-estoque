'use client'

import { useMemo, useState, useTransition } from 'react'
import { Check, Plus, Search } from 'lucide-react'
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { SegmentedControl } from '@/components/ui-kit/SegmentedControl'
import { btnClass } from '@/components/ui-kit/Button'
import { brl, pct } from '@/lib/custo-cardapio/formato'

// Busca de pratos com ficha para pôr num cardápio ou evento. Fica aberta para adicionar vários seguidos.

export type OpcaoPrato = {
  codigo: number
  codigoTexto: string
  descricao: string
  familia: string | null
  tipo: 'prato' | 'preparacao'
  custo: number
  preco: number | null
  /** Texto curto à direita (ex.: CMV ou custo por porção). */
  detalhe?: string
}

const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()

export function SeletorPratos({ opcoes, usados, onEscolher, rotulo = 'Adicionar prato', comPreparacoes = false, metaCmv }: {
  opcoes: OpcaoPrato[]
  usados: number[]
  onEscolher: (codigo: number) => Promise<boolean>
  rotulo?: string
  comPreparacoes?: boolean
  metaCmv?: number
}) {
  const [aberto, setAberto] = useState(false)
  const [q, setQ] = useState('')
  const [tipo, setTipo] = useState<'prato' | 'preparacao'>('prato')
  const [familia, setFamilia] = useState('')
  const [pendente, start] = useTransition()
  const [enviando, setEnviando] = useState<number | null>(null)
  const jaTem = useMemo(() => new Set(usados), [usados])

  const doTipo = useMemo(() => opcoes.filter((o) => !comPreparacoes || o.tipo === tipo), [opcoes, comPreparacoes, tipo])
  const familias = useMemo(() => [...new Set(doTipo.map((o) => o.familia).filter((f): f is string => !!f))].sort((a, b) => a.localeCompare(b, 'pt-BR')), [doTipo])
  const lista = useMemo(() => {
    const termos = norm(q).split(/\s+/).filter(Boolean)
    return doTipo.filter((o) => (!familia || o.familia === familia) && termos.every((t) => norm(`${o.descricao} ${o.codigoTexto} ${o.familia ?? ''}`).includes(t)))
  }, [doTipo, q, familia])

  const escolher = (codigo: number) => {
    setEnviando(codigo)
    start(async () => {
      await onEscolher(codigo)
      setEnviando(null)
    })
  }

  return (
    <Dialog open={aberto} onOpenChange={setAberto}>
      <DialogTrigger render={<button type="button" className={btnClass('primary')}><Plus className="size-4" /> {rotulo}</button>} />
      <DialogContent className="flex max-h-[85dvh] flex-col gap-3 overflow-hidden bg-surface sm:max-w-xl">
        <DialogTitle>{rotulo}</DialogTitle>
        {comPreparacoes && (
          <SegmentedControl aria-label="Tipo" value={tipo} onChange={(v) => { setTipo(v as 'prato' | 'preparacao'); setFamilia('') }}
            opcoes={[{ value: 'prato', label: 'Pratos' }, { value: 'preparacao', label: 'Preparações' }]} />
        )}
        <label className="relative block">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
          <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar pelo nome ou código"
            className="h-10 w-full rounded-full bg-surface-2 pl-9 pr-4 text-[14px] outline-none focus:ring-2 focus:ring-brand/40" />
        </label>
        {familias.length > 1 && (
          <select value={familia} onChange={(e) => setFamilia(e.target.value)} aria-label="Família"
            className="h-9 w-full rounded-full bg-surface-2 px-3 text-[13px] text-text-muted outline-none focus:ring-2 focus:ring-brand/40 sm:w-60">
            <option value="">Todas as famílias</option>
            {familias.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        )}
        <ul className="-mx-2 min-h-0 flex-1 overflow-y-auto">
          {lista.length === 0 && <li className="px-2 py-8 text-center text-[13px] text-text-muted">{opcoes.length ? 'Nada com essa busca.' : 'Nenhum prato com ficha técnica nesta loja.'}</li>}
          {lista.slice(0, 200).map((o) => {
            const tem = jaTem.has(o.codigo)
            const cmv = o.preco && o.custo > 0 ? o.custo / o.preco : null
            return (
              <li key={o.codigo}>
                <button type="button" disabled={tem || pendente} onClick={() => escolher(o.codigo)}
                  className="flex w-full items-center gap-3 rounded-[var(--r-md)] px-2 py-2 text-left u-motion enabled:hover:bg-surface-2 disabled:opacity-60">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] font-medium">{o.descricao}</span>
                    <span className="block truncate text-[12px] text-text-muted">{o.codigoTexto}{o.familia ? ` · ${o.familia}` : ''}</span>
                  </span>
                  <span className="num shrink-0 text-right text-[12px] text-text-muted">
                    <span className="block">custo {brl(o.custo)}</span>
                    <span className={`block ${metaCmv != null && cmv != null && cmv > metaCmv ? 'text-err' : ''}`}>{o.detalhe ?? (o.preco ? `${brl(o.preco)} · ${pct(cmv)}` : 'sem preço')}</span>
                  </span>
                  <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-surface-2 text-text-muted">
                    {tem ? <Check className="size-4 text-ok" /> : enviando === o.codigo ? <span className="size-3 animate-pulse rounded-full bg-brand" /> : <Plus className="size-4" />}
                  </span>
                </button>
              </li>
            )
          })}
          {lista.length > 200 && <li className="px-2 py-2 text-center text-[12px] text-text-muted">Mais {lista.length - 200}. Refine a busca.</li>}
        </ul>
        <div className="flex justify-end">
          <button type="button" className={btnClass('outline')} onClick={() => setAberto(false)}>Pronto</button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
