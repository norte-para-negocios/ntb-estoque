'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Dialog,
  DialogContent,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Plus, X } from 'lucide-react'
import { toast } from 'sonner'
import { ProdutoSearch } from '@/components/produtos/ProdutoSearch'
import { criarOrdemProducao } from '@/lib/actions/ordem-producao'
import { btnClass } from '@/components/ui-kit/Button'
import type { ProdutoBusca } from '@/lib/actions/produtos-search'

const inputClass =
  'w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-text outline-none transition-colors placeholder:text-text-muted focus:border-brand'
const labelClass = 'mb-1 block text-[13px] font-medium text-text-muted'

type Local = { codigo_local_estoque: number; descricao: string | null }

function hojeISO(): string {
  // Data local (America/Bahia) no formato YYYY-MM-DD para o input date
  const agora = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Bahia' }))
  const m = String(agora.getMonth() + 1).padStart(2, '0')
  const d = String(agora.getDate()).padStart(2, '0')
  return `${agora.getFullYear()}-${m}-${d}`
}

export function CriarOrdemProducao({ locais }: { locais: Local[] }) {
  const [open, setOpen] = useState(false)
  const [produto, setProduto] = useState<ProdutoBusca | null>(null)
  const [local, setLocal] = useState('')
  const [data, setData] = useState(hojeISO())
  const [quantidade, setQuantidade] = useState('1')
  const [validade, setValidade] = useState('')
  const [obs, setObs] = useState('')
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function resetar() {
    setProduto(null)
    setLocal('')
    setData(hojeISO())
    setQuantidade('1')
    setValidade('')
    setObs('')
  }

  function criar() {
    if (!produto) {
      toast.error('Selecione o produto')
      return
    }
    const qtd = Number(quantidade)
    if (!qtd || qtd <= 0) {
      toast.error('Informe uma quantidade válida')
      return
    }
    if (!data) {
      toast.error('Informe a data de produção')
      return
    }
    startTransition(async () => {
      const res = await criarOrdemProducao({
        nCodProduto: produto.codigo_produto,
        data,
        quantidade: qtd,
        codigoLocalEstoque: local ? Number(local) : null,
        validade: validade || null,
        obs: obs.trim() || undefined,
      })
      if (res?.error) {
        toast.error('Erro ao criar OP', { description: res.error })
        return
      }
      toast.success('Ordem de produção criada no Omie')
      setOpen(false)
      resetar()
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) resetar() }}>
      <DialogTrigger
        render={
          <button type="button" className={btnClass('primary')}>
            <Plus className="size-4" /> Criar OP
          </button>
        }
      />
      <DialogContent className="overflow-hidden bg-surface p-0" showCloseButton={false}>
        <div className="border-b border-border px-4 py-3 text-base font-semibold text-text">
          Nova ordem de produção
        </div>
        <div className="space-y-4 px-4 py-3">
          <div>
            <label className={labelClass}>Produto</label>
            {produto ? (
              <div className="flex items-center justify-between gap-2 rounded-md border border-border bg-surface-2/40 px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-text">{produto.descricao}</div>
                  <div className="num truncate text-xs text-text-muted">{produto.codigo}</div>
                </div>
                <button
                  type="button"
                  onClick={() => setProduto(null)}
                  className="flex size-7 shrink-0 items-center justify-center rounded-md text-text-muted hover:bg-surface-2"
                  aria-label="Trocar produto"
                >
                  <X className="size-4" />
                </button>
              </div>
            ) : (
              <ProdutoSearch onSelect={(p) => setProduto(p)} placeholder="Buscar produto..." />
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Quantidade</label>
              <input
                type="number"
                inputMode="decimal"
                min={0}
                value={quantidade}
                onChange={(e) => setQuantidade(e.target.value)}
                className={`${inputClass} num`}
              />
            </div>
            <div>
              <label className={labelClass}>Data de produção</label>
              <input type="date" value={data} onChange={(e) => setData(e.target.value)} className={inputClass} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Local de estoque</label>
              <select value={local} onChange={(e) => setLocal(e.target.value)} className={inputClass}>
                <option value="">Padrão do produto</option>
                {locais.map((l) => (
                  <option key={l.codigo_local_estoque} value={String(l.codigo_local_estoque)}>
                    {l.descricao || l.codigo_local_estoque}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Validade (opcional)</label>
              <input type="date" value={validade} onChange={(e) => setValidade(e.target.value)} className={inputClass} />
            </div>
          </div>

          <div>
            <label className={labelClass}>Observação (opcional)</label>
            <input value={obs} onChange={(e) => setObs(e.target.value)} className={inputClass} placeholder="Ex.: lote, cupom..." />
          </div>

          <p className="text-[12px] text-text-muted">
            A data é enviada ao Omie como início, conclusão e previsão (iguais). A validade fica só no NTB Estoque.
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button type="button" onClick={criar} disabled={pending} className={btnClass('primary')}>
            {pending ? 'Criando no Omie...' : 'Criar OP'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
