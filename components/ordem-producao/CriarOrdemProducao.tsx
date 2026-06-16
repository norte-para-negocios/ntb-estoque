'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  Dialog,
  DialogContent,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { ProdutoSearch } from '@/components/produtos/ProdutoSearch'
import { criarOrdensProducao } from '@/lib/actions/ordem-producao'
import { btnClass } from '@/components/ui-kit/Button'
import type { ProdutoBusca } from '@/lib/actions/produtos-search'

const inputClass =
  'w-full rounded-md border border-border bg-surface px-3 py-1.5 text-sm text-text outline-none transition-colors placeholder:text-text-muted focus:border-brand'
const labelClass = 'mb-1 block text-[13px] font-medium text-text-muted'

type Local = { codigo_local_estoque: number; descricao: string | null }
type ItemOP = { produto: ProdutoBusca; quantidade: string; validade: string }

function hojeISO(): string {
  const agora = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Bahia' }))
  const m = String(agora.getMonth() + 1).padStart(2, '0')
  const d = String(agora.getDate()).padStart(2, '0')
  return `${agora.getFullYear()}-${m}-${d}`
}

// Gera as datas a partir de uma data base, repetindo a cada 7 dias (recorrencia semanal).
function gerarDatas(base: string, semanas: number): string[] {
  if (!base) return []
  const out: string[] = []
  const [a, m, d] = base.split('-').map(Number)
  for (let i = 0; i < Math.max(1, semanas); i++) {
    const dt = new Date(a, m - 1, d + i * 7)
    const mm = String(dt.getMonth() + 1).padStart(2, '0')
    const dd = String(dt.getDate()).padStart(2, '0')
    out.push(`${dt.getFullYear()}-${mm}-${dd}`)
  }
  return out
}

export function CriarOrdemProducao({ locais }: { locais: Local[] }) {
  const [open, setOpen] = useState(false)
  const [itens, setItens] = useState<ItemOP[]>([])
  const [local, setLocal] = useState('')
  const [data, setData] = useState(hojeISO())
  const [recorrencia, setRecorrencia] = useState('1') // numero de semanas (1 = sem repetir)
  const [obs, setObs] = useState('')
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  function resetar() {
    setItens([])
    setLocal('')
    setData(hojeISO())
    setRecorrencia('1')
    setObs('')
  }

  function adicionarProduto(p: ProdutoBusca) {
    if (itens.some((i) => i.produto.codigo_produto === p.codigo_produto)) {
      toast.info('Produto já está na lista')
      return
    }
    setItens((prev) => [...prev, { produto: p, quantidade: '1', validade: '' }])
  }

  function setQtd(codigoProduto: number, q: string) {
    setItens((prev) => prev.map((i) => (i.produto.codigo_produto === codigoProduto ? { ...i, quantidade: q } : i)))
  }

  function setValidadeItem(codigoProduto: number, v: string) {
    setItens((prev) => prev.map((i) => (i.produto.codigo_produto === codigoProduto ? { ...i, validade: v } : i)))
  }

  function remover(codigoProduto: number) {
    setItens((prev) => prev.filter((i) => i.produto.codigo_produto !== codigoProduto))
  }

  const semanas = Math.max(1, Math.min(12, Number(recorrencia) || 1))
  const datas = gerarDatas(data, semanas)
  const totalOPs = itens.length * datas.length

  function criar() {
    if (!itens.length) {
      toast.error('Adicione ao menos um produto')
      return
    }
    if (!data) {
      toast.error('Informe a data de produção')
      return
    }
    const itensValidos = itens.map((i) => ({
      nCodProduto: i.produto.codigo_produto,
      quantidade: Number(i.quantidade) || 0,
      validade: i.validade || null,
    }))
    if (itensValidos.some((i) => i.quantidade <= 0)) {
      toast.error('Quantidade inválida em algum produto')
      return
    }
    startTransition(async () => {
      const res = await criarOrdensProducao({
        itens: itensValidos,
        datas,
        codigoLocalEstoque: local ? Number(local) : null,
        obs: obs.trim() || undefined,
      })
      if (res?.error) {
        toast.error('Erro ao criar OP', { description: res.error })
        return
      }
      const criadas = res?.criadas ?? 0
      const erros = res?.erros ?? []
      if (criadas > 0) {
        toast.success(`${criadas} ordem(ns) criada(s) no Omie`, {
          description: erros.length ? `${erros.length} falharam` : undefined,
        })
        setOpen(false)
        resetar()
        router.refresh()
      } else {
        toast.error('Nenhuma OP criada', { description: erros[0] })
      }
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
      <DialogContent className="max-h-[88vh] overflow-y-auto bg-surface p-0" showCloseButton={false}>
        <div className="border-b border-border px-4 py-3 text-base font-semibold text-text">
          Nova(s) ordem(ns) de produção
        </div>
        <div className="space-y-4 px-4 py-3">
          <div>
            <label className={labelClass}>Produtos</label>
            <ProdutoSearch onSelect={adicionarProduto} placeholder="Buscar produto e adicionar..." />
            {itens.length > 0 && (
              <ul className="mt-3 space-y-2.5">
                {itens.map((i) => (
                  <li key={i.produto.codigo_produto} className="rounded-lg border border-border bg-surface p-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-text">{i.produto.descricao}</div>
                        <div className="num mt-0.5 text-xs text-text-muted">{i.produto.codigo}</div>
                      </div>
                      <button
                        type="button"
                        onClick={() => remover(i.produto.codigo_produto)}
                        className="flex size-9 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-2 hover:text-[var(--err)]"
                        aria-label="Remover"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <div>
                        <label className="eyebrow">Quantidade</label>
                        <input
                          type="number"
                          inputMode="decimal"
                          min={0}
                          value={i.quantidade}
                          onChange={(e) => setQtd(i.produto.codigo_produto, e.target.value)}
                          className="num mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-center text-sm text-text outline-none focus:border-brand"
                        />
                      </div>
                      <div>
                        <label className="eyebrow">Validade</label>
                        <input
                          type="date"
                          value={i.validade}
                          onChange={(e) => setValidadeItem(i.produto.codigo_produto, e.target.value)}
                          className="num mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-text outline-none focus:border-brand"
                        />
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelClass}>Data de produção</label>
              <input type="date" value={data} onChange={(e) => setData(e.target.value)} className={inputClass} />
            </div>
            <div>
              <label className={labelClass}>Repetir (semanas)</label>
              <select value={recorrencia} onChange={(e) => setRecorrencia(e.target.value)} className={inputClass}>
                <option value="1">Não repetir</option>
                <option value="2">2 semanas</option>
                <option value="3">3 semanas</option>
                <option value="4">4 semanas</option>
                <option value="8">8 semanas</option>
                <option value="12">12 semanas</option>
              </select>
            </div>
          </div>

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
            <label className={labelClass}>Observação (opcional)</label>
            <input value={obs} onChange={(e) => setObs(e.target.value)} className={inputClass} placeholder="Ex.: lote, cupom..." />
          </div>

          <p className="text-[12px] text-text-muted">
            {totalOPs > 0
              ? `Serão criadas ${totalOPs} ordem(ns): ${itens.length} produto(s) × ${datas.length} data(s). A validade (por produto) fica só no NTB.`
              : 'Adicione produtos e escolha a data. A data vai ao Omie como início, conclusão e previsão.'}
          </p>
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-4 py-3">
          <button type="button" onClick={criar} disabled={pending} className={btnClass('primary')}>
            {pending ? 'Criando no Omie...' : `Criar ${totalOPs > 1 ? totalOPs + ' OPs' : 'OP'}`}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
