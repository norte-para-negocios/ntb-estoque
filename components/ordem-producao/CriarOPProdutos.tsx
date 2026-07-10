'use client'

import { useMemo, useState, useTransition } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { ProdutoSearch } from '@/components/produtos/ProdutoSearch'
import { Trash2, Minus, Plus, Search, CheckCircle } from 'lucide-react'
import { toast } from 'sonner'
import { btnClass } from '@/components/ui-kit/Button'
import { Spinner } from '@/components/ui-kit/Spinner'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { buscarProdutoPorCodigo, type ProdutoBusca } from '@/lib/actions/produtos-search'
import { criarOrdensProducao, saldoAtualProdutos } from '@/lib/actions/ordem-producao'
import { parseNumBR } from '@/lib/num-br'
import { gerarDatasOP, type UnidadeOP } from '@/lib/op-recorrencia'

const QrScanner = dynamic(
  () => import('@/components/contagem/QrScanner').then((m) => m.QrScanner),
  { ssr: false }
)

type ItemOP = { produto: ProdutoBusca; quantidade: string; validadeDias: string }

// Validade em DIAS -> data 'DD/MM/AAAA' para preview (base + dias). Na criacao,
// cada OP recorrente calcula a sua a partir da propria data.
function previewValidadeBR(base: string, dias: number): string {
  const [a, m, d] = base.split('-').map(Number)
  const dt = new Date(a, m - 1, d + dias)
  return dt.toLocaleDateString('pt-BR')
}

export function CriarOPProdutos({
  data,
  unidade,
  intervalo,
  vezes,
  localCodigo,
  obs,
}: {
  data: string
  unidade: UnidadeOP
  intervalo: number
  vezes: number
  localCodigo: number | null
  localNome: string | null
  obs: string
}) {
  const [itens, setItens] = useState<ItemOP[]>([])
  const [filtro, setFiltro] = useState('')
  const [pending, startTransition] = useTransition()
  const router = useRouter()

  const datas = useMemo(() => gerarDatasOP(data, unidade, intervalo, vezes), [data, unidade, intervalo, vezes])
  const totalOPs = itens.length * datas.length

  const visiveis = useMemo(() => {
    const q = filtro.trim().toLowerCase()
    if (!q) return itens
    return itens.filter(
      (i) => i.produto.descricao.toLowerCase().includes(q) || i.produto.codigo.toLowerCase().includes(q)
    )
  }, [itens, filtro])

  function adicionar(p: ProdutoBusca) {
    if (itens.some((i) => i.produto.codigo_produto === p.codigo_produto)) {
      toast.info('Produto já está na lista')
      return
    }
    // Mais recente no topo (igual a contagem de transferencia).
    setItens((prev) => [{ produto: p, quantidade: '1', validadeDias: '' }, ...prev])
  }

  async function onLeituraQr(codigo: string): Promise<boolean> {
    const p = await buscarProdutoPorCodigo(codigo)
    if (!p) {
      toast.warning('Produto não encontrado', { description: `Código: ${codigo}` })
      return false
    }
    adicionar(p)
    return true
  }

  function setQtd(cod: number, q: string) {
    // So aceita digitos, virgula e ponto (a virgula fica enquanto digita, ex.: "3,4");
    // parseNumBR converte na criacao. type=number/parseInt rejeitaria o decimal BR.
    const limpo = q.replace(/[^\d.,]/g, '')
    setItens((prev) => prev.map((i) => (i.produto.codigo_produto === cod ? { ...i, quantidade: limpo } : i)))
  }

  function ajustarQtd(cod: number, delta: number) {
    setItens((prev) =>
      prev.map((i) => {
        if (i.produto.codigo_produto !== cod) return i
        const parsed = parseNumBR(i.quantidade)
        const atual = parsed != null && !Number.isNaN(parsed) ? parsed : 0
        return { ...i, quantidade: String(Math.max(0, atual + delta)) }
      })
    )
  }

  function setValidadeDias(cod: number, v: string) {
    setItens((prev) => prev.map((i) => (i.produto.codigo_produto === cod ? { ...i, validadeDias: v } : i)))
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
      quantidade: parseNumBR(i.quantidade) || 0,
      validadeDias: Number(i.validadeDias) || null,
    }))
    if (itensValidos.some((i) => i.quantidade <= 0)) {
      toast.error('Quantidade inválida em algum produto')
      return
    }
    startTransition(async () => {
      // Alerta (nao bloqueia) se algum produto ja tem saldo em estoque -- pedido
      // da reuniao 09/07 (#20): evitar produzir mais sem perceber que ja tem.
      const saldos = await saldoAtualProdutos(itensValidos.map((i) => i.nCodProduto))
      const comEstoque = itens.filter((i) => (saldos[i.produto.codigo_produto] ?? 0) > 0)
      if (comEstoque.length) {
        const lista = comEstoque
          .map((i) => `${i.produto.descricao}: ${saldos[i.produto.codigo_produto].toLocaleString('pt-BR')} ${i.produto.unidade || ''}`.trim())
          .join('\n')
        if (!window.confirm(`Produto(s) já em estoque:\n\n${lista}\n\nProduzir mais mesmo assim?`)) {
          return
        }
      }
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
      <div className="sticky top-0 z-30 -mx-4 mb-4 space-y-2 border-b border-border bg-bg/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-lg sm:border sm:px-3">
        <ProdutoSearch onSelect={adicionar} codigosAdicionados={itens.map((i) => i.produto.codigo)} />
        <QrScanner onLeitura={onLeituraQr} />
      </div>

      {itens.length > 0 && (
        <div className="relative mb-4">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-text-muted" />
          <input
            type="text"
            value={filtro}
            onChange={(e) => setFiltro(e.target.value)}
            placeholder="Filtrar itens da lista"
            className="w-full rounded-md border border-border bg-surface py-2.5 pl-9 pr-3 text-sm text-text outline-none transition-colors placeholder:text-text-muted focus:border-brand"
          />
        </div>
      )}

      {visiveis.length ? (
        <ul className="space-y-2.5 lg:space-y-1.5">
          {visiveis.map((item) => {
            const q = item.quantidade
            return (
              <li key={item.produto.codigo_produto} className="rounded-lg border border-border bg-surface p-3.5 lg:flex lg:items-center lg:gap-4 lg:py-2 lg:pl-3.5 lg:pr-2">
                <div className="flex items-start justify-between gap-3 lg:min-w-0 lg:flex-1 lg:items-center">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-text">{item.produto.descricao}</div>
                    <div className="num mt-0.5 text-xs text-text-muted">{item.produto.codigo}</div>
                  </div>
                  <button
                    onClick={() => remover(item.produto.codigo_produto)}
                    className="flex size-11 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-2 hover:text-err lg:order-last lg:size-8"
                    aria-label="Remover"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>

                <div className="mt-3 flex items-center justify-between gap-3 lg:mt-0 lg:shrink-0 lg:justify-end">
                  <span className="eyebrow lg:hidden">Quantidade{item.produto.unidade ? ` (${item.produto.unidade})` : ''}</span>
                  <span className="hidden text-xs text-text-muted lg:inline">{item.produto.unidade || ''}</span>
                  <div className="flex items-center gap-2 lg:gap-1.5">
                    <button
                      onClick={() => ajustarQtd(item.produto.codigo_produto, -1)}
                      className="flex size-11 items-center justify-center rounded-md border border-border bg-surface text-text transition-colors hover:bg-surface-2 lg:size-8"
                      aria-label="Diminuir"
                    >
                      <Minus className="size-4 lg:size-3.5" />
                    </button>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={q}
                      onChange={(e) => setQtd(item.produto.codigo_produto, e.target.value)}
                      onWheel={(e) => e.currentTarget.blur()}
                      className="num h-11 w-16 rounded-md border border-border bg-surface px-2 text-center text-lg font-semibold text-text outline-none focus:border-brand lg:h-8 lg:w-14 lg:text-base"
                      placeholder="0"
                    />
                    <button
                      onClick={() => ajustarQtd(item.produto.codigo_produto, 1)}
                      className="flex size-11 items-center justify-center rounded-md border border-border bg-surface text-text transition-colors hover:bg-surface-2 lg:size-8"
                      aria-label="Aumentar"
                    >
                      <Plus className="size-4 lg:size-3.5" />
                    </button>
                  </div>
                </div>

                <div className="mt-3 flex items-center justify-between gap-3 lg:mt-0 lg:shrink-0 lg:justify-end lg:gap-2">
                  <span className="eyebrow lg:hidden">Validade (dias)</span>
                  <span className="hidden text-xs text-text-muted lg:inline">Validade</span>
                  <div className="flex items-center gap-2">
                    {item.validadeDias && Number(item.validadeDias) > 0 && datas[0] && (
                      <span className="text-xs text-text-muted">
                        vence {previewValidadeBR(datas[0], Number(item.validadeDias))}
                        {datas.length > 1 ? ' (1ª)' : ''}
                      </span>
                    )}
                    <input
                      type="number"
                      min={0}
                      inputMode="numeric"
                      value={item.validadeDias}
                      onChange={(e) => setValidadeDias(item.produto.codigo_produto, e.target.value)}
                      onWheel={(e) => e.currentTarget.blur()}
                      placeholder="dias"
                      className="num h-11 w-20 rounded-md border border-border bg-surface px-2 text-center text-sm text-text outline-none focus:border-brand lg:h-8 lg:w-16"
                    />
                  </div>
                </div>
              </li>
            )
          })}
        </ul>
      ) : (
        <EmptyState
          icon={Search}
          title={filtro ? 'Nenhum item encontrado' : 'Nenhum produto'}
          hint={filtro ? 'Ajuste o filtro de busca.' : 'Use a busca acima para adicionar produtos. O último fica no topo.'}
        />
      )}

      {itens.length > 0 && (
        <div className="sticky bottom-16 z-20 -mx-4 mt-4 border-t border-border bg-surface/95 px-4 py-3 backdrop-blur lg:bottom-0">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[13px] text-text-muted">
              {totalOPs} ordem(ns){datas.length > 1 ? ` (${itens.length} × ${datas.length})` : ''}
            </span>
            <button
              onClick={criar}
              disabled={pending}
              className={`${btnClass('primary')} w-full sm:w-auto`}
            >
              {pending ? <Spinner /> : <CheckCircle className="size-4" />}
              {pending ? 'Criando no Omie...' : `Criar ${totalOPs > 1 ? `${totalOPs} OPs` : 'OP'}`}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
