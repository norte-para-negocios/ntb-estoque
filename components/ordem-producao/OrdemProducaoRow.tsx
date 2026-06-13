'use client'

import { useState, useTransition } from 'react'
import { Printer, Check, Minus, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { setValidadeOP, setQuantidadeOP, finishOP } from '@/lib/actions/ordem-producao'
import { Num } from '@/components/ui-kit/Num'

const stepBtnClass =
  'flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-text-muted transition-colors hover:bg-surface-2 hover:text-brand disabled:opacity-60'
const fieldClass =
  'w-28 rounded-md border border-border bg-surface px-2 py-1.5 text-center text-sm text-text num tabular-nums outline-none transition-colors focus:border-brand disabled:opacity-60'

interface OPData {
  id: number
  numOP: string
  produto: string
  unidade: string
  qtdOP: number | null
  validade: string | null
  quantidade: number | null
}

export function OrdemProducaoRow({ op }: { op: OPData }) {
  const [validade, setValidade] = useState(op.validade ? op.validade.split('T')[0] : '')
  const [quantidade, setQuantidade] = useState(op.quantidade != null ? String(op.quantidade) : '')
  const [pending, startTransition] = useTransition()

  function salvarValidade() {
    startTransition(async () => {
      await setValidadeOP(op.id, validade || null)
      toast.success('Validade salva')
    })
  }

  function salvarQuantidade() {
    const num = quantidade === '' ? null : Number(quantidade)
    if (num != null && (Number.isNaN(num) || num < 0)) {
      toast.error('Quantidade inválida')
      return
    }
    startTransition(async () => {
      await setQuantidadeOP(op.id, num)
      toast.success('Quantidade salva')
    })
  }

  function ajustarValidade(delta: number) {
    const base = validade ? new Date(validade) : new Date()
    base.setDate(base.getDate() + delta)
    const novo = base.toISOString().split('T')[0]
    setValidade(novo)
    startTransition(async () => {
      await setValidadeOP(op.id, novo)
      toast.success('Validade salva')
    })
  }

  function ajustarQuantidade(delta: number) {
    let num = quantidade === '' ? 0 : Number(quantidade)
    if (Number.isNaN(num)) num = 0
    num += delta
    if (num < 0) num = 0
    setQuantidade(String(num))
    startTransition(async () => {
      await setQuantidadeOP(op.id, num)
      toast.success('Quantidade salva')
    })
  }

  function concluir() {
    startTransition(async () => {
      const res = await finishOP(op.id)
      if (res?.error) toast.error('Erro ao concluir', { description: res.error })
      else toast.success('Ordem concluída no Omie')
    })
  }

  return (
    <tr>
      <td className="num font-medium text-text align-top">{op.numOP}</td>
      <td className="max-w-xs align-top">
        <div className="truncate font-medium text-text">{op.produto}</div>
        <div className="text-[11px] text-text-muted">{op.unidade}</div>
      </td>
      <td className="text-right align-top">
        <Num value={op.qtdOP} frac={3} />{' '}
        <span className="text-text-muted">{op.unidade}</span>
      </td>
      <td className="align-top">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => ajustarValidade(-1)}
            disabled={pending}
            aria-label="Diminuir validade"
            className={stepBtnClass}
          >
            <Minus className="size-3.5" />
          </button>
          <input
            type="date"
            value={validade}
            onChange={(e) => setValidade(e.target.value)}
            onBlur={salvarValidade}
            disabled={pending}
            className={fieldClass}
          />
          <button
            type="button"
            onClick={() => ajustarValidade(1)}
            disabled={pending}
            aria-label="Aumentar validade"
            className={stepBtnClass}
          >
            <Plus className="size-3.5" />
          </button>
        </div>
      </td>
      <td className="align-top">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => ajustarQuantidade(-1)}
            disabled={pending}
            aria-label="Diminuir quantidade"
            className={stepBtnClass}
          >
            <Minus className="size-3.5" />
          </button>
          <input
            type="number"
            min={0}
            value={quantidade}
            onChange={(e) => setQuantidade(e.target.value)}
            onBlur={salvarQuantidade}
            disabled={pending}
            placeholder="0"
            className="w-20 rounded-md border border-border bg-surface px-2 py-1.5 text-center text-sm text-text num tabular-nums outline-none transition-colors focus:border-brand disabled:opacity-60"
          />
          <button
            type="button"
            onClick={() => ajustarQuantidade(1)}
            disabled={pending}
            aria-label="Aumentar quantidade"
            className={stepBtnClass}
          >
            <Plus className="size-3.5" />
          </button>
        </div>
      </td>
      <td className="text-right align-top">
        <div className="flex items-center justify-end gap-3 whitespace-nowrap">
          <a
            href={`/ordem-producao/${op.id}/imprimir`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-brand hover:underline"
          >
            <Printer className="size-3.5" /> Imprimir
          </a>
          <button
            type="button"
            onClick={concluir}
            disabled={pending}
            className="inline-flex items-center gap-1 text-brand hover:underline disabled:opacity-60"
          >
            <Check className="size-3.5" /> Concluir
          </button>
        </div>
      </td>
    </tr>
  )
}
