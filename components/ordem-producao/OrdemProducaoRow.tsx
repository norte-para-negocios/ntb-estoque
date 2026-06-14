'use client'

import { useState, useTransition } from 'react'
import { Printer, Check, Minus, Plus } from 'lucide-react'
import { toast } from 'sonner'
import { setValidadeOP, setQuantidadeOP, finishOP } from '@/lib/actions/ordem-producao'
import { Num } from '@/components/ui-kit/Num'

const stepBtnClass =
  'flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-text-muted transition-colors hover:bg-surface-2 hover:text-brand disabled:opacity-60'

interface OPData {
  id: number
  numOP: string
  produto: string
  unidade: string
  qtdOP: number | null
  validade: string | null
  quantidade: number | null
  inclusao?: string | null // data de inclusao da OP no Omie (dd/mm/aaaa)
}

// Hook com toda a logica de estado/acoes, compartilhada entre tabela (desktop) e card (mobile).
function useOP(op: OPData) {
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

  return {
    validade,
    setValidade,
    quantidade,
    setQuantidade,
    pending,
    salvarValidade,
    salvarQuantidade,
    ajustarValidade,
    ajustarQuantidade,
    concluir,
  }
}

type StepperProps = {
  op: OPData
  ctrl: ReturnType<typeof useOP>
}

// Stepper de validade (data).
function StepperValidade({ ctrl }: StepperProps) {
  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => ctrl.ajustarValidade(-1)}
        disabled={ctrl.pending}
        aria-label="Diminuir validade"
        className={stepBtnClass}
      >
        <Minus className="size-3.5" />
      </button>
      <input
        type="date"
        value={ctrl.validade}
        onChange={(e) => ctrl.setValidade(e.target.value)}
        onBlur={ctrl.salvarValidade}
        disabled={ctrl.pending}
        className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1.5 text-center text-sm text-text num tabular-nums outline-none transition-colors focus:border-brand disabled:opacity-60 lg:w-28 lg:flex-none"
      />
      <button
        type="button"
        onClick={() => ctrl.ajustarValidade(1)}
        disabled={ctrl.pending}
        aria-label="Aumentar validade"
        className={stepBtnClass}
      >
        <Plus className="size-3.5" />
      </button>
    </div>
  )
}

// Stepper de quantidade (numero).
function StepperQuantidade({ ctrl }: StepperProps) {
  return (
    <div className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={() => ctrl.ajustarQuantidade(-1)}
        disabled={ctrl.pending}
        aria-label="Diminuir quantidade"
        className={stepBtnClass}
      >
        <Minus className="size-3.5" />
      </button>
      <input
        type="number"
        inputMode="decimal"
        min={0}
        value={ctrl.quantidade}
        onChange={(e) => ctrl.setQuantidade(e.target.value)}
        onBlur={ctrl.salvarQuantidade}
        disabled={ctrl.pending}
        placeholder="0"
        className="min-w-0 flex-1 rounded-md border border-border bg-surface px-2 py-1.5 text-center text-sm text-text num tabular-nums outline-none transition-colors focus:border-brand disabled:opacity-60 lg:w-20 lg:flex-none"
      />
      <button
        type="button"
        onClick={() => ctrl.ajustarQuantidade(1)}
        disabled={ctrl.pending}
        aria-label="Aumentar quantidade"
        className={stepBtnClass}
      >
        <Plus className="size-3.5" />
      </button>
    </div>
  )
}

function Acoes({ op, ctrl }: StepperProps) {
  return (
    <>
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
        onClick={ctrl.concluir}
        disabled={ctrl.pending}
        className="inline-flex items-center gap-1 text-brand hover:underline disabled:opacity-60"
      >
        <Check className="size-3.5" /> Concluir
      </button>
    </>
  )
}

// Linha da tabela (desktop).
export function OrdemProducaoRow({ op }: { op: OPData }) {
  const ctrl = useOP(op)

  return (
    <tr>
      <td className="num font-medium text-text align-top">
        {op.numOP}
        {op.inclusao && (
          <div className="text-[11px] font-normal text-text-muted">Incl. {op.inclusao}</div>
        )}
      </td>
      <td className="max-w-xs align-top">
        <div className="truncate font-medium text-text">{op.produto}</div>
        <div className="text-[11px] text-text-muted">{op.unidade}</div>
      </td>
      <td className="text-right align-top">
        <Num value={op.qtdOP} frac={3} /> <span className="text-text-muted">{op.unidade}</span>
      </td>
      <td className="align-top">
        <StepperValidade op={op} ctrl={ctrl} />
      </td>
      <td className="align-top">
        <StepperQuantidade op={op} ctrl={ctrl} />
      </td>
      <td className="text-right align-top">
        <div className="flex items-center justify-end gap-3 whitespace-nowrap">
          <Acoes op={op} ctrl={ctrl} />
        </div>
      </td>
    </tr>
  )
}

// Card empilhado (mobile).
export function OrdemProducaoCard({ op }: { op: OPData }) {
  const ctrl = useOP(op)

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium text-text">{op.produto}</div>
          <div className="text-[11px] text-text-muted">{op.unidade}</div>
        </div>
        <div className="shrink-0 text-right">
          <div className="num text-[11px] font-semibold text-text-muted">OP</div>
          <div className="num font-medium text-text">{op.numOP}</div>
          {op.inclusao && <div className="text-[11px] text-text-muted">Incl. {op.inclusao}</div>}
        </div>
      </div>

      <div className="mt-3 text-sm">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
          Qtd OP{' '}
        </span>
        <Num value={op.qtdOP} frac={3} /> <span className="text-text-muted">{op.unidade}</span>
      </div>

      <div className="mt-3">
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
          Validade
        </div>
        <StepperValidade op={op} ctrl={ctrl} />
      </div>

      <div className="mt-3">
        <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-text-muted">
          Quantidade
        </div>
        <StepperQuantidade op={op} ctrl={ctrl} />
      </div>

      <div className="mt-4 flex items-center gap-4 border-t border-border/60 pt-3">
        <Acoes op={op} ctrl={ctrl} />
      </div>
    </div>
  )
}
