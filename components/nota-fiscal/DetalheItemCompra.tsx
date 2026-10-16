import Link from 'next/link'
import { X } from 'lucide-react'
import type { LinhaRanking } from '@/lib/faturamento-itens'
import type { NotaLeve } from '@/lib/notas-compras'
import { Money } from '@/components/ui-kit/Money'
import { BarrasDiarias } from '@/components/faturamento/BarrasDiarias'

function Info({ t, children }: { t: string; children: React.ReactNode }) {
  return <div><div className="text-[12px] text-text-muted">{t}</div><div className="num text-[18px] font-semibold text-text">{children}</div></div>
}
const fmtData = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
const fmtQtd = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 })

// Painel do produto clicado em "Produtos": numeros no periodo, compra dia a dia e as notas
// em que ele veio (cada uma abre a nota).
export function DetalheItemCompra({ item, unidade, posicao, total, serie, notas, fecharHref, produtoHref }: {
  item: LinhaRanking; unidade: string; posicao: number | null; total: number
  serie: { dia: string; valor: number }[]
  notas: { nota: NotaLeve; quant: number; valor: number }[]
  fecharHref: string; produtoHref?: string
}) {
  const precoMedio = item.quant > 0 ? item.valor / item.quant : null
  return (
    <section className="space-y-3 rounded-[var(--r-lg)] bg-surface p-4 shadow-[var(--shadow-sm)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[12px] text-text-muted">{posicao ? `#${posicao} de ${total} no ranking` : 'Fora do ranking'}</div>
          <h2 className="truncate text-[18px] font-semibold text-text">{item.rotulo}</h2>
          {produtoHref && <Link href={produtoHref} className="text-[13px] font-semibold text-brand hover:underline">Abrir produto</Link>}
        </div>
        <Link href={fecharHref} scroll={false} aria-label="Fechar detalhe" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-text-muted hover:text-text"><X className="size-4" /></Link>
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Info t="Comprado"><Money value={item.valor} /></Info>
        <Info t="Quantidade">{fmtQtd(item.quant)} {unidade || 'un'}</Info>
        <Info t={`Preço médio${unidade ? ` / ${unidade}` : ''}`}>{precoMedio == null ? '—' : <Money value={precoMedio} />}</Info>
        <Info t="Notas">{item.cupons.toLocaleString('pt-BR')}</Info>
      </div>
      <BarrasDiarias dias={serie} nome="Compra" />
      <ol className="divide-y divide-border/60 overflow-hidden rounded-[var(--r-md)] bg-surface-2/50">
        {notas.map(({ nota, quant, valor }) => (
          <li key={nota.id}>
            <Link href={`/nota-fiscal/${nota.id}`} className="grid grid-cols-[1fr_auto] items-center gap-3 px-3 py-2 u-motion hover:bg-surface-2">
              <div className="min-w-0">
                <div className="truncate text-[13px] font-medium text-text">{nota.fornecedor}</div>
                <div className="num text-[12px] text-text-muted">{fmtData(nota.dia)} · NF {nota.numero ?? '-'} · {fmtQtd(quant)} {unidade || 'un'}</div>
              </div>
              <div className="num text-[13px] font-semibold text-text"><Money value={valor} /></div>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  )
}
