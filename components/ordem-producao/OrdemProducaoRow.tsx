'use client'

import { useState, useTransition } from 'react'
import { Printer, Check } from 'lucide-react'
import { toast } from 'sonner'
import { setValidadeOP, setQuantidadeOP, finishOP } from '@/lib/actions/ordem-producao'

interface OPData {
  id: number
  numOP: string
  produto: string
  unidade: string
  qtdOP: number | null
  validade: string | null
  quantidade: number | null
}

function fmtData(d: string | null): string {
  if (!d) return ''
  const [y, m, day] = d.split('T')[0].split('-')
  return `${day}/${m}/${y}`
}

function fmtQtd(v: number | null): string {
  if (v == null) return ''
  return v.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 })
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
    <div className="ntb-card">
      <div className="ntb-card-header flex items-center justify-between">
        <span>OP {op.numOP}</span>
        {validade && (
          <span className="text-sm font-normal text-white/90">Validade {fmtData(validade)}</span>
        )}
      </div>
      <div className="ntb-card-body">
        <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
          <div className="min-w-0 space-y-2">
            <div>
              <small className="text-[#8a8a8a]">Nome do produto</small>
              <p className="font-semibold text-[#5d5d5d]">{op.produto}</p>
            </div>
            <div className="flex gap-8">
              <div>
                <small className="text-[#8a8a8a]">Ordem de produção</small>
                <p className="font-semibold text-[#5d5d5d]">{op.numOP}</p>
              </div>
              <div>
                <small className="text-[#8a8a8a]">Quantidade</small>
                <p className="font-semibold text-[#5d5d5d]">
                  {fmtQtd(op.qtdOP)} ({op.unidade})
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-3 md:w-80 md:shrink-0">
            <div className="flex items-center gap-2">
              <span className="w-20 text-right text-sm font-semibold text-[#5d5d5d]">Validade</span>
              <button
                type="button"
                onClick={() => ajustarValidade(-1)}
                disabled={pending}
                className="ntb-btn-outline px-2 text-[#2eb5c3]"
              >
                -
              </button>
              <input
                type="date"
                value={validade}
                onChange={(e) => setValidade(e.target.value)}
                onBlur={salvarValidade}
                disabled={pending}
                className="ntb-input flex-1 text-center"
              />
              <button
                type="button"
                onClick={() => ajustarValidade(1)}
                disabled={pending}
                className="ntb-btn-outline px-2 text-[#2eb5c3]"
              >
                +
              </button>
            </div>

            <div className="flex items-center gap-2">
              <span className="w-20 text-right text-sm font-semibold text-[#5d5d5d]">Quantidade</span>
              <button
                type="button"
                onClick={() => ajustarQuantidade(-1)}
                disabled={pending}
                className="ntb-btn-outline px-2 text-[#2eb5c3]"
              >
                -
              </button>
              <input
                type="number"
                min={0}
                value={quantidade}
                onChange={(e) => setQuantidade(e.target.value)}
                onBlur={salvarQuantidade}
                disabled={pending}
                placeholder="0"
                className="ntb-input flex-1 text-center"
              />
              <button
                type="button"
                onClick={() => ajustarQuantidade(1)}
                disabled={pending}
                className="ntb-btn-outline px-2 text-[#2eb5c3]"
              >
                +
              </button>
            </div>

            <div className="flex justify-end gap-2">
              <a
                href={`/ordem-producao/${op.id}/imprimir`}
                target="_blank"
                rel="noopener noreferrer"
                className="ntb-btn-outline"
              >
                <Printer className="size-4" /> Imprimir
              </a>
              <button
                type="button"
                onClick={concluir}
                disabled={pending}
                className="ntb-btn-outline disabled:opacity-60"
              >
                <Check className="size-4" /> Concluir
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
