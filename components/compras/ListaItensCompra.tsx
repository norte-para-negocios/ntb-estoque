import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import type { LinhaDetalheCompra } from '@/lib/relatorio-frio-nf'
import { formatarNomeProduto } from '@/lib/formatar-nome'
import { Money } from '@/components/ui-kit/Money'

const fmtData = (iso: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '-')
const fmtQtd = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 })
const fmtUnit = (n: number) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Itens comprados (ultimo nivel do detalhamento do relatorio de Compras), no mesmo desenho da
// lista de notas: data e NF a esquerda, produto com barra proporcional, valor a direita.
// A linha abre as movimentacoes do produto (mesmo destino do link da tabela antiga).
export function ListaItensCompra({ itens }: { itens: LinhaDetalheCompra[] }) {
  const max = Math.max(1, ...itens.map((it) => Number(it.total) || 0))
  return (
    <ol className="divide-y divide-border/60 overflow-hidden rounded-[var(--r-lg)] bg-surface shadow-[var(--shadow-sm)]">
      {itens.map((it, i) => {
        const dia = String(it.data).slice(0, 10)
        const total = Number(it.total) || 0
        const nome = formatarNomeProduto(it.produto ?? '') || it.produto
        return (
          <li key={`${it.nota}-${i}`}>
            <Link href={`/movimentacoes?produto=${encodeURIComponent(it.produto ?? '')}`} className="grid grid-cols-[1fr_auto] items-center gap-3 px-3 py-2.5 u-motion hover:bg-surface-2 sm:grid-cols-[7.5rem_1fr_auto_1rem]">
              <div className="hidden min-w-0 sm:block">
                <div className="num text-[13px] text-text">{fmtData(dia)}</div>
                <div className="num truncate whitespace-nowrap text-[12px] text-text-muted">NF {it.nota || '-'}</div>
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-text" title={it.produto ?? ''}>{nome}</div>
                <div className="truncate text-[12px] text-text-muted">
                  <span className="num sm:hidden">{fmtData(dia)} · NF {it.nota || '-'} · </span>
                  {it.fornecedor}{it.cfop ? <span className="num"> · CFOP {it.cfop}</span> : null}
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                  <div className="h-1.5 rounded-full bg-brand" style={{ width: `${Math.max(1, (total / max) * 100)}%` }} />
                </div>
              </div>
              <div className="text-right">
                <div className="num text-sm font-semibold text-text"><Money value={total} /></div>
                <div className="num whitespace-nowrap text-[12px] text-text-muted">{fmtQtd(Number(it.qtde) || 0)}{it.unidade ? ` ${it.unidade}` : ''} × {fmtUnit(Number(it.preco_unit) || 0)}</div>
              </div>
              <ChevronRight className="hidden size-4 text-text-muted sm:block" aria-hidden />
            </Link>
          </li>
        )
      })}
    </ol>
  )
}
