'use client'

import { useMemo, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { ProdutoSearch } from '@/components/produtos/ProdutoSearch'
import { Trash2, Minus, Plus, Search, CheckCircle } from 'lucide-react'
import { toast } from 'sonner'
import { btnClass } from '@/components/ui-kit/Button'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { criarOrdensProducao } from '@/lib/actions/ordem-producao'
import type { ProdutoBusca } from '@/lib/actions/produtos-search'

type ItemOP = { produto: ProdutoBusca; quantidade: string; validade: string }

// Datas a partir da base, repetindo a cada 7 dias (recorrencia semanal). Mesma
// regra do passo 1; recalculada aqui para nao depender de passar o array na URL.
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

function fmtBR(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso
}

export function CriarOPProdutos({
  data,
  semanas,
  localCodigo,
  localNome,
  obs,
}: {
  data: string
  semanas: number
  localCodigo: number | null
  localNome: string | null
  obs: string
}) {
  const [itens, setItens] = useState<ItemOP[]>([])
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  const datas = useMemo(() => gerarDatas(data, semanas), [data, semanas])
  const totalOPs = itens.length * datas.length

  function adicionar(p: ProdutoBusca) {
    if (itens.some((i) => i.produto.codigo_produto === p.codigo_produto)) {
      toast.info('Produto já está na lista')
      return
    }
    // Mais recente no topo (igual a contagem de transferencia).
    setItens((prev) => [{ produto: p, quantidade: '1', validade: '' }, ...prev])
  }

  function setQtd(cod: number, q: string) {
    setItens((prev) => prev.map((i) => (i.produto.codigo_produto === cod ? { ...i, quantidade: q } : i)))
  }

  function ajustarQtd(cod: number, delta: number) {
    setItens((prev) =>
      prev.map((i) => {
        if (i.produto.codigo_produto !== cod) return i
        const atual = Number(i.quantidade) || 0
        return { ...i, quantidade: String(Math.max(0, atual + delta)) }
      })
    )
  }

  function setValidade(cod: number, v: string) {
    setItens((prev) => prev.map((i) => (i.produto.codigo_produto === cod ? { ...i, validade: v } : i)))
  }

  function remover(cod: number) {
    setItens((prev) => prev.filter((i) => i.produto.codigo_produto !== cod))
  }

  function criar() {
    if (!itens.length) {
      toast.error('Adicione ao menos um produto')
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
        codigoLocalEstoque: localCodigo,
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
        router.push('/ordem-producao')
      } else {
        toast.error('Nenhuma OP criada', { description: erros[0] })
      }
    })
  }

  return (
    <div className="pb-28 lg:pb-20">
      {/* Resumo do cabecalho escolhido no passo 1 */}
      <div className="mb-4 rounded-lg border border-border bg-surface p-4">
        <h1 className="text-lg font-semibold text-text">Nova ordem de produção</h1>
        <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-text-muted">
          <span>
            Data: <span className="num text-text">{fmtBR(data)}</span>
          </span>
          {semanas > 1 && (
            <span>
              Repete por <span className="text-text">{semanas} semanas</span> ({datas.length} datas)
            </span>
          )}
          <span>
            Local: <span className="text-text">{localNome ?? 'Padrão do produto'}</span>
          </span>
        </div>
      </div>

      {/* Busca fixa no topo */}
      <div className="sticky top-0 z-10 -mx-4 mb-4 border-b border-border bg-bg/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-lg sm:border sm:px-3">
        <ProdutoSearch
          onSelect={adicionar}
          codigosAdicionados={itens.map((i) => i.produto.codigo)}
          placeholder="Buscar produto e adicionar..."
        />
      </div>

      {itens.length ? (
        <ul className="space-y-2.5">
          {itens.map((i) => {
            const base = Number(i.quantidade) || 0
            return (
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

                <div className="mt-3 flex items-center justify-between gap-3">
                  <span className="eyebrow">Quantidade{i.produto.unidade ? ` (${i.produto.unidade})` : ''}</span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => ajustarQtd(i.produto.codigo_produto, -1)}
                      className="flex size-9 items-center justify-center rounded-md border border-border bg-surface text-text transition-colors hover:bg-surface-2 active:scale-95"
                      aria-label="Diminuir"
                    >
                      <Minus className="size-4" />
                    </button>
                    <input
                      type="number"
                      min={0}
                      inputMode="numeric"
                      value={i.quantidade}
                      onChange={(e) => setQtd(i.produto.codigo_produto, e.target.value)}
                      className="num w-16 rounded-md border border-border bg-surface px-2 py-1.5 text-center text-lg font-semibold text-text outline-none focus:border-brand"
                      placeholder="0"
                    />
                    <button
                      type="button"
                      onClick={() => ajustarQtd(i.produto.codigo_produto, 1)}
                      className="flex size-9 items-center justify-center rounded-md border border-border bg-surface text-text transition-colors hover:bg-surface-2 active:scale-95"
                      aria-label="Aumentar"
                    >
                      <Plus className="size-4" />
                    </button>
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between gap-3">
                  <span className="eyebrow">Validade</span>
                  <input
                    type="date"
                    value={i.validade}
                    onChange={(e) => setValidade(i.produto.codigo_produto, e.target.value)}
                    className="num rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-text outline-none focus:border-brand"
                  />
                </div>
              </li>
            )
          })}
        </ul>
      ) : (
        <EmptyState
          icon={Search}
          title="Nenhum produto"
          hint="Use a busca acima para adicionar produtos. O último adicionado fica no topo."
        />
      )}

      {itens.length > 0 && (
        <div className="sticky bottom-16 z-20 -mx-4 mt-4 border-t border-border bg-surface/95 px-4 py-3 backdrop-blur lg:bottom-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-[13px] text-text-muted">
              {totalOPs} ordem(ns): {itens.length} produto(s) × {datas.length} data(s). Validade fica só no NTB.
            </span>
            <button
              onClick={criar}
              disabled={pending}
              className={`${btnClass('primary')} w-full sm:w-auto`}
            >
              <CheckCircle className="size-4" />
              {pending ? 'Criando no Omie...' : `Criar ${totalOPs > 1 ? `${totalOPs} OPs` : 'OP'}`}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
