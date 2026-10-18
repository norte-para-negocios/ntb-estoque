'use client'

// Frete (CT-e) da nota de entrada (loja de estoque próprio, Fase B/R13): XML do CT-e ou valor digitado, só antes da entrada.
import { useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { FileUp, Truck } from 'lucide-react'
import { toast } from 'sonner'
import { btnClass } from '@/components/ui-kit/Button'
import { Spinner } from '@/components/ui-kit/Spinner'
import { campoCompra } from '@/components/compras-proprio/SeletorProduto'
import { desvincularCteNF, importarCteNF, informarFreteNF } from '@/lib/actions/nota-fiscal-proprio'

export type CteDaNota = { id: number; chave: string | null; numero: string | null; transportadora: string | null; valorCte: number; valorNesta: number; percentual: number; origem: string }
const fmtBRL = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

export function FreteCteNF({ notaId, ctes, editavel }: { notaId: number; ctes: CteDaNota[]; editavel: boolean }) {
  const router = useRouter()
  const entrada = useRef<HTMLInputElement>(null)
  const [pending, start] = useTransition()
  const [manual, setManual] = useState(false)
  const [valor, setValor] = useState('')
  const [transp, setTransp] = useState('')
  const [numero, setNumero] = useState('')
  if (!editavel && !ctes.length) return null

  function feito(r: { ok: true } | { error: string }, msg: string) {
    if ('error' in r) { toast.error('Não foi possível', { description: r.error }); return }
    toast.success(msg); router.refresh()
  }
  async function enviarXml(f: File | undefined) {
    if (!f) return
    const xml = await f.text()
    start(async () => feito(await importarCteNF(notaId, xml), 'CT-e ligado à nota'))
  }
  function salvarManual() {
    const v = Number(valor.replace(/\./g, '').replace(',', '.'))
    start(async () => { const r = await informarFreteNF(notaId, { valor: v, transportadora: transp, numero }); feito(r, 'Frete informado'); if (!('error' in r)) { setManual(false); setValor('') } })
  }
  return (
    <section className="space-y-3 rounded-[var(--r-lg)] bg-surface p-4 shadow-[var(--shadow-sm)]" aria-label="Frete (CT-e)">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-[17px] font-semibold text-text"><Truck className="size-4" />Frete (CT-e)</h3>
          <p className="text-[13px] text-text-muted">O frete entra no custo só dos itens com &quot;Frete é custo de estoque&quot; marcado.</p>
        </div>
        {editavel && (
          <div className="flex flex-wrap gap-2">
            <input ref={entrada} type="file" accept=".xml,text/xml,application/xml" className="hidden" onChange={(e) => void enviarXml(e.target.files?.[0])} />
            <button type="button" className={btnClass('outline')} disabled={pending} onClick={() => entrada.current?.click()}>{pending ? <Spinner /> : <FileUp className="size-4" />}Enviar XML do CT-e</button>
            <button type="button" className={btnClass('outline')} disabled={pending} onClick={() => setManual((v) => !v)}>Informar frete sem XML</button>
          </div>
        )}
      </div>
      {manual && editavel && (
        <div className="flex flex-wrap items-end gap-2 rounded-[var(--r-md)] bg-surface-2 p-3 text-[13px]">
          <label className="space-y-1"><span className="block text-text-muted">Valor do frete</span><input inputMode="decimal" className={`${campoCompra} num w-32`} value={valor} onChange={(e) => setValor(e.target.value)} /></label>
          <label className="space-y-1"><span className="block text-text-muted">Transportadora</span><input className={`${campoCompra} w-48`} value={transp} onChange={(e) => setTransp(e.target.value)} /></label>
          <label className="space-y-1"><span className="block text-text-muted">Número</span><input className={`${campoCompra} w-28`} value={numero} onChange={(e) => setNumero(e.target.value)} /></label>
          <button type="button" className={btnClass('primary')} disabled={pending} onClick={salvarManual}>{pending && <Spinner />}Salvar frete</button>
        </div>
      )}
      {ctes.length > 0 && (
        <ul className="divide-y divide-[var(--border)] text-[14px]">
          {ctes.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="min-w-0">{c.origem === 'xml' ? 'CT-e' : 'Frete informado'}{c.numero ? <> nº <span className="num">{c.numero}</span></> : null}{c.transportadora ? ` · ${c.transportadora}` : ''}
                <span className="text-text-muted"> · <span className="num">{fmtBRL(c.valorNesta)}</span> nesta nota{c.valorCte !== c.valorNesta ? <> (de <span className="num">{fmtBRL(c.valorCte)}</span>, <span className="num">{c.percentual.toLocaleString('pt-BR')}%</span>)</> : null}</span></span>
              {editavel && <button type="button" className="text-[13px] text-text-muted hover:text-text" disabled={pending} onClick={() => start(async () => feito(await desvincularCteNF(notaId, c.id), 'CT-e desligado'))}>Desligar</button>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
