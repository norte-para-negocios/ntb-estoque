'use client'

import { useState, useTransition } from 'react'
import { Printer, Check, Minus, Plus, Undo2, Trash2, CalendarCheck } from 'lucide-react'
import { toast } from 'sonner'
import { setValidadeOP, setQuantidadeOP, finishOP, reverterOP, excluirOP } from '@/lib/actions/ordem-producao'
import type { OpStatus } from '@/lib/op-status'
import { SELO_CLASSE, type CorToken } from '@/lib/status-cor'
import { parseNumBR } from '@/lib/num-br'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { btnClass } from '@/components/ui-kit/Button'

const stepBtnClass =
  'flex size-11 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-text-muted transition-colors hover:bg-surface-2 hover:text-brand disabled:opacity-60 lg:size-7'

interface OPData {
  id: number
  numOP: string
  produto: string
  unidade: string
  qtdOP: number | null
  validade: string | null
  quantidade: number | null
  data?: string | null // data prevista/real da OP (dd/mm/aaaa)
  concluida: boolean
  status: OpStatus
  /** Permissoes de acao por botao (calculadas no servidor). */
  podeEditar?: boolean // steppers de validade/quantidade
  podeExcluir?: boolean // excluir OP aberta
  podeConcluir?: boolean // concluir OP aberta
  podeReverter?: boolean // reverter OP concluida
}

// Selo de status na listagem (4 estados). O botao "Concluir" some quando concluida.
const STATUS_INFO: Record<OpStatus, { label: string; token: CorToken }> = {
  concluida: { label: 'Concluída', token: 'ok' },
  prevista: { label: 'Prevista', token: 'info' },
  atrasada: { label: 'Atrasada', token: 'err' },
  pendente: { label: 'Pendente', token: 'warn' },
}

function StatusBadge({ status }: { status: OpStatus }) {
  const { label, token } = STATUS_INFO[status]
  return (
    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${SELO_CLASSE[token]}`}>
      {label}
    </span>
  )
}

// Quantidade da OP: inteiro sem casas decimais, decimal com ate 3 casas sem zeros
// a direita. Ex.: 20.000 -> "20"; 1.500 -> "1,5"; 1.234 -> "1,234".
function QtdOP({ value }: { value: number | null | undefined }) {
  const v = value ?? 0
  const frac = Number.isInteger(v) ? 0 : 3
  return (
    <span className="num">
      {v.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: frac })}
    </span>
  )
}

// Hook com toda a logica de estado/acoes, compartilhada entre tabela (desktop) e card (mobile).
function useOP(op: OPData) {
  const [validade, setValidade] = useState(op.validade ? op.validade.split('T')[0] : '')
  // Quantidade sempre comeca em 1 (nunca 0/vazio): no dia a dia a OP costuma ser de 1.
  const [quantidade, setQuantidade] = useState(op.quantidade != null ? String(op.quantidade) : '1')
  const [pending, startTransition] = useTransition()

  function salvarValidade() {
    startTransition(async () => {
      await setValidadeOP(op.id, validade || null)
      toast.success('Validade salva')
    })
  }

  function salvarQuantidade() {
    const num = parseNumBR(quantidade)
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
    // Parsing local (sem UTC): "2025-01-15" -> new Date(2025,0,15) para evitar
    // off-by-one quando o TZ local e UTC-3 (Bahia) e o ISO converte para dia anterior.
    const partes = validade ? validade.split('-').map(Number) : null
    const base = partes ? new Date(partes[0], partes[1] - 1, partes[2]) : new Date()
    base.setDate(base.getDate() + delta)
    const mm = String(base.getMonth() + 1).padStart(2, '0')
    const dd = String(base.getDate()).padStart(2, '0')
    const novo = `${base.getFullYear()}-${mm}-${dd}`
    setValidade(novo)
    startTransition(async () => {
      await setValidadeOP(op.id, novo)
      toast.success('Validade salva')
    })
  }

  function ajustarQuantidade(delta: number) {
    let num = parseNumBR(quantidade) ?? 0
    if (Number.isNaN(num)) num = 0
    num += delta
    if (num < 0) num = 0
    setQuantidade(String(num))
    startTransition(async () => {
      await setQuantidadeOP(op.id, num)
      toast.success('Quantidade salva')
    })
  }

  // Conclusao guiada em dialog. op.data vem em dd/mm/aaaa -> ISO para o input.
  // Usa parsing local para evitar off-by-one de fuso UTC.
  const dataPrevistaISO = (() => {
    if (op.data && /^\d{2}\/\d{2}\/\d{4}$/.test(op.data)) {
      return op.data.split('/').reverse().join('-')
    }
    const hoje = new Date()
    const mm = String(hoje.getMonth() + 1).padStart(2, '0')
    const dd = String(hoje.getDate()).padStart(2, '0')
    return `${hoje.getFullYear()}-${mm}-${dd}`
  })()
  const [dialogConclusao, setDialogConclusao] = useState(false)
  const [dataConclusao, setDataConclusao] = useState(dataPrevistaISO)

  function concluir() {
    startTransition(async () => {
      const res = await finishOP(op.id, dataConclusao || null)
      if (res?.error) toast.error('Erro ao concluir', { description: res.error })
      else {
        toast.success('Ordem concluída no Omie')
        setDialogConclusao(false)
      }
    })
  }

  // Reverter a conclusao (OP concluida) e excluir (OP aberta). Escrevem no Omie.
  function reverter() {
    if (!window.confirm('Reverter a conclusão desta OP no Omie? O estoque produzido será estornado.')) return
    startTransition(async () => {
      const res = await reverterOP(op.id)
      if (res?.error) toast.error('Erro ao reverter', { description: res.error })
      else toast.success('Conclusão revertida no Omie')
    })
  }

  function excluir() {
    if (!window.confirm('Excluir esta OP no Omie? Esta ação não pode ser desfeita.')) return
    startTransition(async () => {
      const res = await excluirOP(op.id)
      if (res?.error) toast.error('Erro ao excluir', { description: res.error })
      else toast.success('OP excluída no Omie')
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
    reverter,
    excluir,
    dialogConclusao,
    setDialogConclusao,
    dataConclusao,
    setDataConclusao,
    dataPrevistaISO,
  }
}

type StepperProps = {
  op: OPData
  ctrl: ReturnType<typeof useOP>
}

// Stepper de validade (data). Sem permissao de Editar, fica somente-leitura.
function StepperValidade({ op, ctrl }: StepperProps) {
  const bloqueado = !op.podeEditar
  return (
    <div className="flex items-center gap-1.5 lg:justify-center">
      <button
        type="button"
        onClick={() => ctrl.ajustarValidade(-1)}
        disabled={ctrl.pending || bloqueado}
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
        disabled={ctrl.pending || bloqueado}
        readOnly={bloqueado}
        className="h-11 min-w-0 flex-1 rounded-md border border-border bg-surface px-2 text-center text-sm text-text num tabular-nums outline-none transition-colors focus:border-brand disabled:opacity-60 lg:h-8 lg:w-28 lg:flex-none"
      />
      <button
        type="button"
        onClick={() => ctrl.ajustarValidade(1)}
        disabled={ctrl.pending || bloqueado}
        aria-label="Aumentar validade"
        className={stepBtnClass}
      >
        <Plus className="size-3.5" />
      </button>
    </div>
  )
}

// Stepper de quantidade (numero). Sem permissao de Editar, fica somente-leitura.
function StepperQuantidade({ op, ctrl }: StepperProps) {
  const bloqueado = !op.podeEditar
  return (
    <div className="flex items-center gap-1.5 lg:justify-center">
      <button
        type="button"
        onClick={() => ctrl.ajustarQuantidade(-1)}
        disabled={ctrl.pending || bloqueado}
        aria-label="Diminuir quantidade"
        className={stepBtnClass}
      >
        <Minus className="size-3.5" />
      </button>
      <input
        type="text"
        inputMode="decimal"
        value={ctrl.quantidade}
        onChange={(e) => ctrl.setQuantidade(e.target.value)}
        onBlur={ctrl.salvarQuantidade}
        onWheel={(e) => e.currentTarget.blur()}
        disabled={ctrl.pending || bloqueado}
        readOnly={bloqueado}
        placeholder="0"
        className="h-11 min-w-0 flex-1 rounded-md border border-border bg-surface px-2 text-center text-sm text-text num tabular-nums outline-none transition-colors focus:border-brand disabled:opacity-60 lg:h-8 lg:w-20 lg:flex-none"
      />
      <button
        type="button"
        onClick={() => ctrl.ajustarQuantidade(1)}
        disabled={ctrl.pending || bloqueado}
        aria-label="Aumentar quantidade"
        className={stepBtnClass}
      >
        <Plus className="size-3.5" />
      </button>
    </div>
  )
}

// Dialog de conclusao guiada: escolher data (default = data prevista) + confirmar.
// Desacopla o seletor de data dos botoes Imprimir/Excluir, evitando o espremimento
// reportado no video.
function DialogConclusao({ op, ctrl }: StepperProps) {
  return (
    <Dialog open={ctrl.dialogConclusao} onOpenChange={ctrl.setDialogConclusao}>
      <DialogContent className="bg-surface" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarCheck className="size-4 text-brand" />
            Concluir OP {op.numOP}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div>
            <label className="mb-1.5 block text-[13px] font-medium text-text-muted">
              Data de conclusao
            </label>
            <input
              type="date"
              value={ctrl.dataConclusao}
              onChange={(e) => ctrl.setDataConclusao(e.target.value)}
              disabled={ctrl.pending}
              className="num w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none transition-colors focus:border-brand disabled:opacity-60"
            />
            <p className="mt-1 text-[11px] text-text-muted">
              Padrao: data prevista da OP. Altere se a producao foi em outro dia.
            </p>
          </div>
          <p className="rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-[12px] text-text-muted">
            A conclusao sera gravada no Omie. O estoque produzido sera incrementado.
          </p>
        </div>

        <DialogFooter>
          <button
            type="button"
            onClick={() => ctrl.setDialogConclusao(false)}
            disabled={ctrl.pending}
            className={btnClass('ghost')}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={ctrl.concluir}
            disabled={ctrl.pending}
            className={btnClass('primary')}
          >
            <Check className="size-3.5" />
            {ctrl.pending ? 'Concluindo...' : 'Confirmar conclusao'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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
      {!op.concluida && op.podeConcluir && (
        <>
          <button
            type="button"
            onClick={() => ctrl.setDialogConclusao(true)}
            disabled={ctrl.pending}
            className="inline-flex items-center gap-1 text-brand hover:underline disabled:opacity-60"
          >
            <Check className="size-3.5" /> Concluir
          </button>
          <DialogConclusao op={op} ctrl={ctrl} />
        </>
      )}
      {/* Regra do fundador: concluida -> reverter; aberta -> excluir. Cada acao
          atras da sua permissao (Reverter / Excluir). */}
      {op.concluida
        ? op.podeReverter && (
            <button
              type="button"
              onClick={ctrl.reverter}
              disabled={ctrl.pending}
              className="inline-flex items-center gap-1 text-text-muted hover:text-warn hover:underline disabled:opacity-60"
              title="Reverter a conclusao (estorna no Omie)"
            >
              <Undo2 className="size-3.5" /> Reverter
            </button>
          )
        : op.podeExcluir && (
            <button
              type="button"
              onClick={ctrl.excluir}
              disabled={ctrl.pending}
              className="inline-flex items-center gap-1 text-text-muted hover:text-err hover:underline disabled:opacity-60"
              title="Excluir a OP no Omie"
            >
              <Trash2 className="size-3.5" /> Excluir
            </button>
          )}
    </>
  )
}

// Linha da tabela (desktop).
export function OrdemProducaoRow({ op }: { op: OPData }) {
  const ctrl = useOP(op)

  return (
    <tr>
      <td className="num font-medium text-text align-top">
        <span>{op.numOP}</span>
        {op.data && (
          <div className="text-[11px] font-normal text-text-muted" title="Data prevista da OP">
            Prev. {op.data}
          </div>
        )}
      </td>
      <td className="align-top">
        <StatusBadge status={op.status} />
      </td>
      <td className="max-w-xs align-top">
        <div className="truncate font-medium text-text">{op.produto}</div>
        <div className="text-[11px] text-text-muted">{op.unidade}</div>
      </td>
      <td className="text-right align-top">
        <QtdOP value={op.qtdOP} /> <span className="text-text-muted">{op.unidade}</span>
      </td>
      <td className="align-top">
        <StepperValidade op={op} ctrl={ctrl} />
      </td>
      <td className="align-top">
        <StepperQuantidade op={op} ctrl={ctrl} />
      </td>
      <td className="text-right align-top">
        <div className="flex flex-wrap items-center justify-end gap-x-2.5 gap-y-1.5">
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
          {op.data && (
            <div className="text-[11px] text-text-muted" title="Data prevista da OP">
              Prev. {op.data}
            </div>
          )}
          <div className="mt-1 flex justify-end">
            <StatusBadge status={op.status} />
          </div>
        </div>
      </div>

      <div className="mt-3 text-sm">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-text-muted">
          Qtd OP{' '}
        </span>
        <QtdOP value={op.qtdOP} /> <span className="text-text-muted">{op.unidade}</span>
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
