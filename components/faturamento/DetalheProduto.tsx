import Link from 'next/link'
import { X } from 'lucide-react'
import type { LinhaRanking } from '@/lib/faturamento-itens'
import { Money } from '@/components/ui-kit/Money'
import { BarrasDiarias } from '@/components/faturamento/BarrasDiarias'

function Info({ t, children }: { t: string; children: React.ReactNode }) {
  return <div><div className="text-[12px] text-text-muted">{t}</div><div className="num text-[18px] font-semibold text-text">{children}</div></div>
}

// Painel do item clicado no ranking: numeros dele no periodo e o grafico dia a dia.
export function DetalheProduto({ item, posicao, total, serie, hoje, fecharHref }: {
  item: LinhaRanking; posicao: number | null; total: number; serie: { dia: string; valor: number }[]; hoje: string; fecharHref: string
}) {
  const precoMedio = item.quant > 0 ? item.valor / item.quant : null
  return (
    <section className="space-y-3 rounded-[var(--r-lg)] bg-surface p-4 shadow-[var(--shadow-sm)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[12px] text-text-muted">{posicao ? `#${posicao} de ${total} no ranking` : 'Fora do ranking'}</div>
          <h2 className="truncate text-[18px] font-semibold text-text">{item.rotulo}</h2>
        </div>
        <Link href={fecharHref} scroll={false} aria-label="Fechar detalhe" className="flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-2 text-text-muted hover:text-text"><X className="size-4" /></Link>
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Info t="Faturamento"><Money value={item.valor} /></Info>
        <Info t="Quantidade">{item.quant.toLocaleString('pt-BR', { maximumFractionDigits: 2 })} un</Info>
        <Info t="Preço médio">{precoMedio == null ? '—' : <Money value={precoMedio} />}</Info>
        <Info t="% do total">{item.pct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</Info>
      </div>
      <BarrasDiarias dias={serie} hoje={hoje} />
    </section>
  )
}
