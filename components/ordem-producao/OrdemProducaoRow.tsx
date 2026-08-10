'use client'

import Link from 'next/link'
import { useRef, useState, useTransition } from 'react'
import { Printer, Check, Minus, Plus, Undo2, Trash2, CalendarCheck, Pencil, ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import {
  setValidadeOP,
  setQuantidadeOP,
  setDataOP as setDataOPAction,
  setQtdPlanejadaOP,
  finishOP,
  reverterOP,
  excluirOP,
} from '@/lib/actions/ordem-producao'
import type { OpStatus } from '@/lib/op-status'
import { SELO_CLASSE, type CorToken } from '@/lib/status-cor'
import { parseNumBR, formatNumBR } from '@/lib/num-br'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { btnClass } from '@/components/ui-kit/Button'
import { DialogImprimirEtiqueta } from '@/components/etiqueta/DialogImprimirEtiqueta'

const stepBtnClass =
  'flex size-11 shrink-0 items-center justify-center rounded-md border border-border bg-surface text-text-muted transition-colors hover:bg-surface-2 hover:text-brand disabled:opacity-60 lg:size-5'

// Botao de acao da LINHA da OP no mobile: so icone, alvo de toque 32px.
const acaoIconeClass =
  'flex size-8 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-2 disabled:opacity-60'

// Botao de acao na tabela desktop: icone compacto size-7, sem texto.
const acaoDesktopClass =
  'flex size-7 shrink-0 items-center justify-center rounded-md transition-colors disabled:opacity-60'

// Validade -> DD/MM (compacto) para o subtitulo da linha.
function fmtValidade(v: string | null | undefined): string | null {
  if (!v) return null
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}/${m[2]}` : null
}

export interface OPData {
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
  ingredientes?: { cod: number; nome: string; unidade: string; qtd: number }[]
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
  // Quantidade = SO a contagem de etiquetas a imprimir (1, 2, 3...) -- NAO tem
  // nenhuma relacao com a producao da OP nem com o Omie. Campo 100% local, sempre
  // comeca em 1 (nunca 0/vazio): no dia a dia a OP costuma imprimir 1 etiqueta.
  const [quantidade, setQuantidade] = useState(op.quantidade != null ? formatNumBR(op.quantidade) : '1')
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

  // Hoje (ISO, local do navegador) -- usado pra travar a data de conclusao no
  // maximo hoje (o Omie rejeita ConcluirOrdemProducao com data futura).
  const hojeISO = (() => {
    const hoje = new Date()
    const mm = String(hoje.getMonth() + 1).padStart(2, '0')
    const dd = String(hoje.getDate()).padStart(2, '0')
    return `${hoje.getFullYear()}-${mm}-${dd}`
  })()

  // Conclusao guiada em dialog. op.data vem em dd/mm/aaaa -> ISO para o input.
  // Usa parsing local para evitar off-by-one de fuso UTC.
  const dataPrevistaISO = (() => {
    if (op.data && /^\d{2}\/\d{2}\/\d{4}$/.test(op.data)) {
      return op.data.split('/').reverse().join('-')
    }
    return hojeISO
  })()
  // Data da OP (previsao). AO CONTRARIO da validade (so no nosso banco), esta data e
  // a mesma do Omie: editar aqui reescreve a OP la (AlterarOrdemProducao). Otimista,
  // com revert se o Omie recusar. Bloqueada quando a OP esta concluida.
  const [dataOP, setDataOP] = useState(dataPrevistaISO)
  const dataOPSalva = useRef(dataPrevistaISO)

  function salvarDataOP(novo: string) {
    if (!novo || novo === dataOPSalva.current) return
    const anterior = dataOPSalva.current
    startTransition(async () => {
      const res = await setDataOPAction(op.id, novo)
      if (res?.error) {
        toast.error('Erro ao alterar a data', { description: res.error })
        setDataOP(anterior) // desfaz o otimismo
      } else {
        dataOPSalva.current = novo
        toast.success('Data da OP alterada no Omie')
      }
    })
  }

  // Debounce dos cliques de +/-: atualiza a tela na hora (sem travar nada), e so
  // manda pro Omie 600ms depois do ultimo clique -- clicar 5x seguido pra avancar
  // 5 dias vira UMA chamada com o valor final, em vez de 5 chamadas em fila (cada
  // uma travando o botao por 2-4s ate o Omie responder).
  const dataOPDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  function ajustarDataOP(delta: number) {
    // Parsing local (sem UTC) para evitar off-by-one em fuso UTC-3 (Bahia).
    const partes = dataOP ? dataOP.split('-').map(Number) : null
    const base = partes ? new Date(partes[0], partes[1] - 1, partes[2]) : new Date()
    base.setDate(base.getDate() + delta)
    const mm = String(base.getMonth() + 1).padStart(2, '0')
    const dd = String(base.getDate()).padStart(2, '0')
    const novo = `${base.getFullYear()}-${mm}-${dd}`
    setDataOP(novo)
    if (dataOPDebounce.current) clearTimeout(dataOPDebounce.current)
    dataOPDebounce.current = setTimeout(() => salvarDataOP(novo), 600)
  }

  // Quantidade PLANEJADA da OP (identificacao_n_qtde). AO CONTRARIO da quantidade de
  // etiqueta (so no nosso banco), esta e a mesma do Omie: editar aqui reescreve a OP
  // la (AlterarOrdemProducao), igual a data. Otimista, com revert se o Omie recusar.
  // Bloqueada quando a OP esta concluida.
  const [qtdPlanejada, setQtdPlanejada] = useState(formatNumBR(op.qtdOP) || '1')
  const qtdPlanejadaSalva = useRef(qtdPlanejada)

  function salvarQtdPlanejada(novo: string) {
    if (!novo || novo === qtdPlanejadaSalva.current) return
    const num = parseNumBR(novo)
    if (num == null || Number.isNaN(num) || num <= 0) {
      toast.error('Quantidade planejada inválida')
      setQtdPlanejada(qtdPlanejadaSalva.current) // desfaz
      return
    }
    const anterior = qtdPlanejadaSalva.current
    startTransition(async () => {
      const res = await setQtdPlanejadaOP(op.id, num)
      if (res?.error) {
        toast.error('Erro ao alterar a quantidade planejada', { description: res.error })
        setQtdPlanejada(anterior) // desfaz o otimismo
      } else {
        qtdPlanejadaSalva.current = novo
        toast.success('Quantidade planejada alterada no Omie')
      }
    })
  }

  // Mesmo debounce da data (ver ajustarDataOP) pra quantidade planejada.
  const qtdPlanejadaDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  function ajustarQtdPlanejada(delta: number) {
    let num = parseNumBR(qtdPlanejada) ?? 0
    if (Number.isNaN(num)) num = 0
    num += delta
    if (num <= 0) return // nao deixa a quantidade planejada zerar/negativar no Omie
    const novo = formatNumBR(num)
    setQtdPlanejada(novo)
    if (qtdPlanejadaDebounce.current) clearTimeout(qtdPlanejadaDebounce.current)
    qtdPlanejadaDebounce.current = setTimeout(() => salvarQtdPlanejada(novo), 600)
  }

  const [dialogConclusao, setDialogConclusao] = useState(false)
  // Editar (mobile): abre os steppers de validade/quantidade num dialog enxuto,
  // pra a linha da OP ficar compacta como as outras telas.
  const [dialogEditar, setDialogEditar] = useState(false)
  const [dataConclusao, setDataConclusao] = useState(
    dataPrevistaISO > hojeISO ? hojeISO : dataPrevistaISO
  )
  // Conclusao PARCIAL: quanto concluir (default = quantidade PLANEJADA da OP, nao a
  // etiqueta -- etiqueta e so contagem de impressao, sem relacao com producao). Ex.:
  // OP de 10 kg, concluir so 4 kg.
  const qtdConcluirDefault = op.qtdOP ?? 1
  const [qtdeConcluir, setQtdeConcluir] = useState(String(qtdConcluirDefault))

  // Recebe data/quantidade como parametros explicitos (em vez de ler estado de dialog)
  // pra servir dois pontos de chamada sem duplicar logica: o clique direto no desktop
  // (usa os campos inline dataOP/qtdPlanejada) e o dialog do mobile (usa
  // dataConclusao/qtdeConcluir).
  function concluir(dataISO: string | null, qtdStr: string) {
    const q = parseNumBR(qtdStr)
    if (q == null || Number.isNaN(q) || q <= 0) {
      toast.error('Quantidade a concluir inválida')
      return
    }
    startTransition(async () => {
      const res = await finishOP(op.id, dataISO || null, q)
      if ('error' in res) {
        // O Omie recusa concluir a OP se algum insumo da ficha técnica está com
        // CMC (custo médio) zerado. O sistema já tenta automaticamente remover
        // temporariamente o insumo sem custo da ficha técnica, concluir sem ele
        // e recolocar em seguida; se chegou erro aqui, é porque nem esse
        // fallback resolveu (ex.: não achou qual insumo é, ou falhou de novo).
        const semCmc = /\bcmc\b|custo m.dio/i.test(res.error)
        toast.error(
          semCmc ? 'Insumo sem custo médio (CMC) no Omie' : 'Erro ao concluir',
          {
            description: semCmc
              ? `${res.error} — ajuste o CMC do insumo no Omie (Estoque > Movimentação Manual > Ajustar saldo do dia, com o valor unitário) e tente concluir de novo.`
              : res.error,
            duration: semCmc ? 15000 : undefined,
          }
        )
      } else {
        if (res.insumosPulados?.length) {
          toast.warning('Concluída pulando insumo sem custo', {
            description: `Não baixou do estoque nem entrou no custo desta produção: ${res.insumosPulados.join(', ')}.`,
            duration: 15000,
          })
        } else {
          toast.success('Ordem concluída no Omie')
        }
        if (res.avisoRestaurar) {
          toast.error('Atenção: ficha técnica pode estar incompleta', {
            description: res.avisoRestaurar,
            duration: 20000,
          })
        }
        if (res.semEtiqueta) {
          toast.warning('Etiqueta ainda não impressa', {
            description: 'Esta OP foi concluída mas nenhuma etiqueta foi gerada pra ela.',
            duration: 15000,
            action: {
              label: 'Imprimir agora',
              onClick: () => window.open(`/ordem-producao/${op.id}/imprimir`, '_blank', 'noopener'),
            },
          })
        }
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
    const msg = op.concluida
      ? 'Excluir esta OP concluída? A produção será estornada (revertida) no Omie e a OP removida. Esta ação não pode ser desfeita.'
      : 'Excluir esta OP no Omie? Esta ação não pode ser desfeita.'
    if (!window.confirm(msg)) return
    startTransition(async () => {
      const res = await excluirOP(op.id)
      if (res?.error) toast.error('Erro ao excluir', { description: res.error })
      else if (res?.fantasma) toast.success('OP removida — já não existia mais no Omie')
      else toast.success('OP excluída no Omie')
    })
  }

  return {
    validade,
    setValidade,
    quantidade,
    setQuantidade,
    dataOP,
    setDataOP,
    salvarDataOP,
    ajustarDataOP,
    qtdPlanejada,
    setQtdPlanejada,
    salvarQtdPlanejada,
    ajustarQtdPlanejada,
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
    dialogEditar,
    setDialogEditar,
    dataConclusao,
    setDataConclusao,
    dataPrevistaISO,
    hojeISO,
    qtdeConcluir,
    setQtdeConcluir,
    qtdConcluirDefault,
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
    <div className="w-full flex items-center gap-1.5 lg:gap-1 lg:justify-center">
      <button
        type="button"
        onClick={() => ctrl.ajustarValidade(-1)}
        disabled={ctrl.pending || bloqueado}
        aria-label="Diminuir validade"
        className={stepBtnClass}
      >
        <Minus className="size-3.5 lg:size-3" />
      </button>
      <input
        type="date"
        value={ctrl.validade}
        onChange={(e) => ctrl.setValidade(e.target.value)}
        onBlur={ctrl.salvarValidade}
        disabled={ctrl.pending || bloqueado}
        readOnly={bloqueado}
        className="h-11 min-w-0 flex-1 rounded-md border border-border bg-surface px-2 text-center text-sm text-text num tabular-nums outline-none transition-colors focus:border-brand disabled:opacity-60 lg:h-6"
      />
      <button
        type="button"
        onClick={() => ctrl.ajustarValidade(1)}
        disabled={ctrl.pending || bloqueado}
        aria-label="Aumentar validade"
        className={stepBtnClass}
      >
        <Plus className="size-3.5 lg:size-3" />
      </button>
    </div>
  )
}

// Stepper de quantidade de ETIQUETAS a imprimir (1, 2, 3...) -- sem relacao com a
// producao/Omie, so controla quantas etiquetas saem na impressao. Sem permissao de
// Editar, fica somente-leitura. Continua editavel mesmo com a OP concluida (faz
// sentido imprimir etiqueta depois de concluir).
function StepperQuantidade({ op, ctrl }: StepperProps) {
  const bloqueado = !op.podeEditar
  return (
    <div className="w-full flex items-center gap-1.5 lg:gap-1 lg:justify-center">
      <button
        type="button"
        onClick={() => ctrl.ajustarQuantidade(-1)}
        disabled={ctrl.pending || bloqueado}
        aria-label="Diminuir quantidade"
        className={stepBtnClass}
      >
        <Minus className="size-3.5 lg:size-3" />
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
        className="h-11 min-w-0 flex-1 rounded-md border border-border bg-surface px-2 text-center text-sm text-text num tabular-nums outline-none transition-colors focus:border-brand disabled:opacity-60 lg:h-6"
      />
      <button
        type="button"
        onClick={() => ctrl.ajustarQuantidade(1)}
        disabled={ctrl.pending || bloqueado}
        aria-label="Aumentar quantidade"
        className={stepBtnClass}
      >
        <Plus className="size-3.5 lg:size-3" />
      </button>
    </div>
  )
}

// Stepper da DATA da OP (previsao). Escreve no Omie (AlterarOrdemProducao). Bloqueado
// sem permissao de Editar OU quando a OP ja esta concluida (nao da pra remarcar uma
// OP concluida sem antes reverter).
function StepperData({ op, ctrl }: StepperProps) {
  const bloqueado = !op.podeEditar || op.concluida
  return (
    <div className="w-full flex items-center gap-1.5 lg:gap-1 lg:justify-center">
      <button
        type="button"
        onClick={() => ctrl.ajustarDataOP(-1)}
        disabled={ctrl.pending || bloqueado}
        aria-label="Dia anterior"
        className={stepBtnClass}
      >
        <Minus className="size-3.5 lg:size-3" />
      </button>
      <input
        type="date"
        value={ctrl.dataOP}
        onChange={(e) => ctrl.setDataOP(e.target.value)}
        onBlur={() => ctrl.salvarDataOP(ctrl.dataOP)}
        disabled={ctrl.pending || bloqueado}
        readOnly={bloqueado}
        className="h-11 min-w-0 flex-1 rounded-md border border-border bg-surface px-2 text-center text-sm text-text num tabular-nums outline-none transition-colors focus:border-brand disabled:opacity-60 lg:h-6"
      />
      <button
        type="button"
        onClick={() => ctrl.ajustarDataOP(1)}
        disabled={ctrl.pending || bloqueado}
        aria-label="Próximo dia"
        className={stepBtnClass}
      >
        <Plus className="size-3.5 lg:size-3" />
      </button>
    </div>
  )
}

// Stepper da QUANTIDADE PLANEJADA da OP (identificacao_n_qtde, vem do Omie). Escreve
// no Omie (AlterarOrdemProducao), igual ao StepperData. Bloqueado sem permissao de
// Editar OU quando a OP ja esta concluida (Omie nao aceita alterar OP concluida).
function StepperQtdOP({ op, ctrl }: StepperProps) {
  const bloqueado = !op.podeEditar || op.concluida
  return (
    <div className="w-full flex items-center gap-1.5 lg:gap-1 lg:justify-center">
      <button
        type="button"
        onClick={() => ctrl.ajustarQtdPlanejada(-1)}
        disabled={ctrl.pending || bloqueado}
        aria-label="Diminuir quantidade planejada"
        className={stepBtnClass}
      >
        <Minus className="size-3.5 lg:size-3" />
      </button>
      <input
        type="text"
        inputMode="decimal"
        value={ctrl.qtdPlanejada}
        onChange={(e) => ctrl.setQtdPlanejada(e.target.value)}
        onBlur={() => ctrl.salvarQtdPlanejada(ctrl.qtdPlanejada)}
        onWheel={(e) => e.currentTarget.blur()}
        disabled={ctrl.pending || bloqueado}
        readOnly={bloqueado}
        placeholder="0"
        className="h-11 min-w-0 flex-1 rounded-md border border-border bg-surface px-2 text-center text-sm text-text num tabular-nums outline-none transition-colors focus:border-brand disabled:opacity-60 lg:h-6"
      />
      <button
        type="button"
        onClick={() => ctrl.ajustarQtdPlanejada(1)}
        disabled={ctrl.pending || bloqueado}
        aria-label="Aumentar quantidade planejada"
        className={stepBtnClass}
      >
        <Plus className="size-3.5 lg:size-3" />
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
              Quantidade a concluir
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                inputMode="decimal"
                value={ctrl.qtdeConcluir}
                onChange={(e) => ctrl.setQtdeConcluir(e.target.value)}
                onWheel={(e) => e.currentTarget.blur()}
                disabled={ctrl.pending}
                placeholder="0"
                className="num w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none transition-colors focus:border-brand disabled:opacity-60"
              />
              <span className="shrink-0 text-sm text-text-muted">{op.unidade}</span>
            </div>
            <p className="mt-1 text-[11px] text-text-muted">
              OP de {ctrl.qtdConcluirDefault.toLocaleString('pt-BR', { maximumFractionDigits: 12 })} {op.unidade}.
              Pode concluir com quantidade diferente da prevista, pra mais ou pra menos.
            </p>
          </div>
          <div>
            <label className="mb-1.5 block text-[13px] font-medium text-text-muted">
              Data de conclusão
            </label>
            <input
              type="date"
              value={ctrl.dataConclusao}
              max={ctrl.hojeISO}
              onChange={(e) => ctrl.setDataConclusao(e.target.value)}
              disabled={ctrl.pending}
              className="num w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none transition-colors focus:border-brand disabled:opacity-60"
            />
            <p className="mt-1 text-[11px] text-text-muted">
              Padrão: data prevista da OP (o Omie não aceita concluir com data
              futura). Altere se a produção foi em outro dia.
            </p>
          </div>
          <p className="rounded-md border border-warn/30 bg-warn/10 px-3 py-2 text-[12px] text-text-muted">
            A conclusão será gravada no Omie. O estoque produzido será incrementado
            pela quantidade informada acima.
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
            onClick={() => ctrl.concluir(ctrl.dataConclusao, ctrl.qtdeConcluir)}
            disabled={ctrl.pending}
            className={btnClass('primary')}
          >
            <Check className="size-3.5" />
            {ctrl.pending ? 'Concluindo...' : 'Confirmar conclusão'}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Dialog "Editar OP" (mobile): validade + quantidade nos mesmos steppers, num
// popup enxuto, pra a LINHA da OP ficar compacta como as outras telas. Os steppers
// salvam sozinhos (onBlur/onChange); o botao so fecha.
function DialogEditar({ op, ctrl }: StepperProps) {
  return (
    <Dialog open={ctrl.dialogEditar} onOpenChange={ctrl.setDialogEditar}>
      <DialogContent className="bg-surface" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="size-4 text-brand" />
            Editar OP {op.numOP}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div className="truncate text-[13px] text-text-muted" title={op.produto}>{op.produto}</div>
          <div>
            <label className="mb-1.5 block text-[13px] font-medium text-text-muted">Data da OP</label>
            <StepperData op={op} ctrl={ctrl} />
            {op.concluida && (
              <p className="mt-1 text-[11px] text-text-muted">
                OP concluída — reverta a conclusão para poder remarcar a data.
              </p>
            )}
          </div>
          <div>
            <label className="mb-1.5 block text-[13px] font-medium text-text-muted">Qtd OP (planejada)</label>
            <StepperQtdOP op={op} ctrl={ctrl} />
            {op.concluida && (
              <p className="mt-1 text-[11px] text-text-muted">
                OP concluída — reverta a conclusão para poder mudar a quantidade planejada.
              </p>
            )}
          </div>
          <div>
            <label className="mb-1.5 block text-[13px] font-medium text-text-muted">Validade</label>
            <StepperValidade op={op} ctrl={ctrl} />
          </div>
          <div>
            <label className="mb-1.5 block text-[13px] font-medium text-text-muted">
              QTD Etiqueta
            </label>
            <StepperQuantidade op={op} ctrl={ctrl} />
          </div>
          <p className="rounded-md border border-border bg-surface-2/40 px-3 py-2 text-[11px] text-text-muted">
            A <strong>data</strong> e a <strong>quantidade planejada</strong> da OP são gravadas
            no Omie. Já a validade e a quantidade de etiquetas ficam só no nosso sistema — a
            etiqueta é só quantas etiquetas imprimir, sem relação com a produção da OP.
          </p>
        </div>
        <DialogFooter>
          <button type="button" onClick={() => ctrl.setDialogEditar(false)} className={btnClass('primary')}>
            Pronto
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// Desktop: nada de dialog/pop-up. Data, quantidade planejada e etiqueta ja estao
// sempre visiveis/editaveis na propria linha (steppers), entao "Concluir" so usa o que
// ja esta preenchido ali -- um window.confirm com os valores atuais e a unica
// checagem antes de gravar de verdade no Omie.
function Acoes({ op, ctrl }: StepperProps) {
  function concluirDesktop() {
    // O Omie rejeita concluir com data no futuro -- se a data da linha estiver
    // agendada pra frente (OP concluida adiantada), usa hoje na conclusao em vez de
    // estourar erro. O backend (finishOP) faz o mesmo clamp por garantia; aqui e so
    // pra mensagem de confirmacao já mostrar a data real que vai pro Omie.
    const dataEfetivaISO = ctrl.dataOP && ctrl.dataOP > ctrl.hojeISO ? ctrl.hojeISO : ctrl.dataOP
    const dataBR = dataEfetivaISO ? dataEfetivaISO.split('-').reverse().join('/') : '-'
    const ok = window.confirm(
      `Concluir a OP ${op.numOP}? Será gravado no Omie: ${ctrl.qtdPlanejada} ${op.unidade}, data ${dataBR}. O estoque produzido será incrementado.`
    )
    if (!ok) return
    ctrl.concluir(dataEfetivaISO, ctrl.qtdPlanejada)
  }

  return (
    <>
      <DialogImprimirEtiqueta
        href={`/ordem-producao/${op.id}/imprimir`}
        trigger={
          <button type="button" className={`${acaoDesktopClass} text-text-muted hover:bg-surface-2 hover:text-brand`} title="Imprimir">
            <Printer className="size-3.5" />
          </button>
        }
      />
      {!op.concluida && op.podeConcluir && (
        <button
          type="button"
          onClick={concluirDesktop}
          disabled={ctrl.pending}
          className={`${acaoDesktopClass} text-text-muted hover:bg-surface-2 hover:text-brand`}
          title="Concluir OP"
        >
          <Check className="size-3.5" />
        </button>
      )}
      {/* Reverter: so na concluida (estorna sem excluir). Excluir: qualquer estado. */}
      {op.concluida && op.podeReverter && (
        <button
          type="button"
          onClick={ctrl.reverter}
          disabled={ctrl.pending}
          className={`${acaoDesktopClass} text-warn hover:bg-warn/10`}
          title="Reverter a conclusão (estorna no Omie)"
        >
          <Undo2 className="size-3.5" />
        </button>
      )}
      {op.podeExcluir && (
        <button
          type="button"
          onClick={ctrl.excluir}
          disabled={ctrl.pending}
          className={`${acaoDesktopClass} text-err hover:bg-err/10`}
          title={op.concluida ? 'Excluir a OP (reverte a produção antes)' : 'Excluir a OP no Omie'}
        >
          <Trash2 className="size-3.5" />
        </button>
      )}
    </>
  )
}

type SelecaoProps = {
  /** Selecao multipla (bulk actions): so passado por OrdemProducaoLista. */
  selecionavel?: boolean
  selecionado?: boolean
  onToggleSelecionar?: () => void
}

// Linha da tabela (desktop).
export function OrdemProducaoRow({
  op,
  selecionavel,
  selecionado,
  onToggleSelecionar,
}: { op: OPData } & SelecaoProps) {
  const ctrl = useOP(op)
  const [expandido, setExpandido] = useState(false)
  const temIng = (op.ingredientes?.length ?? 0) > 0
  const colSpanIngredientes = selecionavel ? 9 : 8

  return (
    <>
      <tr>
        {selecionavel && (
          <td className="align-middle">
            <input
              type="checkbox"
              checked={!!selecionado}
              onChange={onToggleSelecionar}
              aria-label={`Selecionar OP ${op.numOP}`}
              className="size-4 accent-[var(--brand)]"
            />
          </td>
        )}
        <td className="num font-medium text-text align-middle">
          {op.numOP}
        </td>
        <td className="align-middle !px-0 overflow-hidden">
          <StepperData op={op} ctrl={ctrl} />
        </td>
        <td className="align-middle">
          <StatusBadge status={op.status} />
        </td>
        <td className="max-w-xs align-middle">
          <Link
            href={`/ordem-producao/${op.id}`}
            className="block truncate font-medium text-text hover:text-brand hover:underline"
            title={op.produto}
          >
            {op.produto}
            <span className="ml-1.5 text-[11px] font-normal text-text-muted">{op.unidade}</span>
          </Link>
        </td>
        <td className="align-middle !px-0 overflow-hidden">
          <StepperQtdOP op={op} ctrl={ctrl} />
        </td>
        <td className="align-middle !px-0 overflow-hidden">
          <StepperValidade op={op} ctrl={ctrl} />
        </td>
        <td className="align-middle !px-0 overflow-hidden">
          <StepperQuantidade op={op} ctrl={ctrl} />
        </td>
        <td className="text-right align-middle pl-3">
          <div className="flex items-center justify-end gap-1">
            {temIng && (
              <button
                type="button"
                onClick={() => setExpandido((e) => !e)}
                className={`${acaoDesktopClass} text-text-muted hover:bg-surface-2`}
                title={expandido ? 'Ocultar ingredientes' : `${op.ingredientes!.length} ingrediente(s)`}
              >
                <ChevronDown className={`size-3.5 transition-transform duration-150 ${expandido ? 'rotate-180' : ''}`} />
              </button>
            )}
            <Acoes op={op} ctrl={ctrl} />
          </div>
        </td>
      </tr>
      {expandido && temIng && (
        <tr className="bg-surface-2/30">
          <td colSpan={colSpanIngredientes} className="px-4 py-2.5">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-muted">Ingredientes</p>
            <div className="flex flex-wrap gap-x-5 gap-y-1">
              {op.ingredientes!.map((i) => (
                <span key={i.cod} className="text-[12px] text-text">
                  {i.nome}{' '}
                  <span className="num text-text-muted">
                    {i.qtd.toLocaleString('pt-BR', { maximumFractionDigits: 4 })}
                    {i.unidade ? ` ${i.unidade}` : ''}
                  </span>
                </span>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  )
}

// Linha compacta (mobile), estilo extrato: produto + OP/data/validade/status à
// esquerda, Qtd OP à direita, ações em ícone. A edição de validade/quantidade vai
// pro dialog "Editar" (pencil), pra a lista não virar um formulário gigante.
export function OrdemProducaoCard({
  op,
  selecionavel,
  selecionado,
  onToggleSelecionar,
}: { op: OPData } & SelecaoProps) {
  const ctrl = useOP(op)
  const val = fmtValidade(op.validade)
  const [expandido, setExpandido] = useState(false)
  const temIng = (op.ingredientes?.length ?? 0) > 0

  return (
    <div className="first:rounded-t-lg last:rounded-b-lg">
      <div className="flex items-center gap-2 px-3 py-2.5">
        {selecionavel && (
          <input
            type="checkbox"
            checked={!!selecionado}
            onChange={onToggleSelecionar}
            aria-label={`Selecionar OP ${op.numOP}`}
            className="size-4 shrink-0 accent-[var(--brand)]"
          />
        )}
        <div className="min-w-0 flex-1">
          <Link
            href={`/ordem-producao/${op.id}`}
            className="block truncate text-[13px] font-medium leading-snug text-text hover:text-brand hover:underline"
            title={op.produto}
          >
            {op.produto}
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] leading-none text-text-muted">
            <StatusBadge status={op.status} />
            <span className="num">{op.numOP}</span>
            {op.data && <span className="num" title="Data prevista">{op.data}</span>}
            {val && <span className="num" title="Validade">val {val}</span>}
          </div>
        </div>

        <div className="shrink-0 whitespace-nowrap text-right text-[13px] text-text">
          <QtdOP value={op.qtdOP} /> <span className="text-[11px] text-text-muted">{op.unidade}</span>
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          {temIng && (
            <button
              type="button"
              onClick={() => setExpandido((e) => !e)}
              className={`${acaoIconeClass} hover:text-text`}
              aria-label={expandido ? 'Ocultar ingredientes' : 'Ver ingredientes'}
              title={expandido ? 'Ocultar ingredientes' : `${op.ingredientes!.length} ingrediente(s)`}
            >
              <ChevronDown className={`size-4 transition-transform duration-150 ${expandido ? 'rotate-180' : ''}`} />
            </button>
          )}
          {op.podeEditar && (
            <button
              type="button"
              onClick={() => ctrl.setDialogEditar(true)}
              className={`${acaoIconeClass} hover:text-brand`}
              aria-label="Editar"
              title="Editar validade/quantidade"
            >
              <Pencil className="size-4" />
            </button>
          )}
          {!op.concluida && op.podeConcluir && (
            <button
              type="button"
              onClick={() => ctrl.setDialogConclusao(true)}
              disabled={ctrl.pending}
              className={`${acaoIconeClass} hover:text-brand`}
              aria-label="Concluir"
              title="Concluir"
            >
              <Check className="size-4" />
            </button>
          )}
          {op.concluida && op.podeReverter && (
            <button
              type="button"
              onClick={ctrl.reverter}
              disabled={ctrl.pending}
              className={`${acaoIconeClass} text-warn`}
              aria-label="Reverter"
              title="Reverter conclusão"
            >
              <Undo2 className="size-4" />
            </button>
          )}
          {op.podeExcluir && (
            <button
              type="button"
              onClick={ctrl.excluir}
              disabled={ctrl.pending}
              className={`${acaoIconeClass} text-err`}
              aria-label="Excluir"
              title="Excluir"
            >
              <Trash2 className="size-4" />
            </button>
          )}
          <DialogImprimirEtiqueta
            href={`/ordem-producao/${op.id}/imprimir`}
            trigger={
              <button type="button" className={acaoIconeClass} aria-label="Imprimir" title="Imprimir">
                <Printer className="size-4" />
              </button>
            }
          />
        </div>
      </div>

      {expandido && temIng && (
        <div className="border-t border-border bg-surface-2/30 px-3 pb-2.5 pt-2">
          <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-text-muted">Ingredientes</p>
          <div className="flex flex-col gap-1">
            {op.ingredientes!.map((i) => (
              <div key={i.cod} className="flex items-baseline justify-between gap-2 text-[12px]">
                <span className="min-w-0 truncate text-text">{i.nome}</span>
                <span className="num shrink-0 text-text-muted">
                  {i.qtd.toLocaleString('pt-BR', { maximumFractionDigits: 4 })}
                  {i.unidade ? ` ${i.unidade}` : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {op.podeEditar && <DialogEditar op={op} ctrl={ctrl} />}
      {!op.concluida && op.podeConcluir && <DialogConclusao op={op} ctrl={ctrl} />}
    </div>
  )
}
