'use client'

import { useState, useTransition } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
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

export function OrdemProducaoRow({ op }: { op: OPData }) {
  const [validade, setValidade] = useState(op.validade ?? '')
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
      toast.error('Quantidade invalida')
      return
    }
    startTransition(async () => {
      await setQuantidadeOP(op.id, num)
      toast.success('Quantidade salva')
    })
  }

  function concluir() {
    startTransition(async () => {
      const res = await finishOP(op.id)
      if (res?.error) toast.error('Erro ao concluir', { description: res.error })
      else toast.success('Ordem concluida no Omie')
    })
  }

  return (
    <tr className="border-b">
      <td className="p-3 font-medium">{op.numOP}</td>
      <td className="p-3">{op.produto}</td>
      <td className="p-3 text-right">{op.qtdOP ?? '-'}</td>
      <td className="p-3">
        <Input
          type="date"
          value={validade}
          onChange={(e) => setValidade(e.target.value)}
          onBlur={salvarValidade}
          disabled={pending}
        />
      </td>
      <td className="p-3">
        <Input
          type="number"
          min={0}
          value={quantidade}
          onChange={(e) => setQuantidade(e.target.value)}
          onBlur={salvarQuantidade}
          disabled={pending}
          className="text-right"
          placeholder="0"
        />
      </td>
      <td className="p-3">
        <div className="flex gap-2 justify-end">
          <a
            href={`/ordem-producao/${op.id}/imprimir`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-sm text-blue-600 hover:underline"
          >
            <Printer className="size-4" /> Imprimir
          </a>
          <Button size="sm" variant="outline" onClick={concluir} disabled={pending}>
            <Check className="size-4" /> Concluir
          </Button>
        </div>
      </td>
    </tr>
  )
}
