import Link from 'next/link'
import type { LinhaRanking } from '@/lib/faturamento-itens'
import { Money } from '@/components/ui-kit/Money'

const fmtQtd = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
const fmtPct = (n: number) => `${n.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`

// Lista ordenada com barra proporcional ao maior valor. `hrefDe` (opcional) torna a linha clicavel.
export function RankingBarras({ linhas, ordem, selecionado, hrefDe, mostrarQuant = true }: { linhas: LinhaRanking[]; ordem: 'valor' | 'quant'; selecionado?: string; hrefDe?: (chave: string) => string; mostrarQuant?: boolean }) {
  const max = Math.max(1, ...linhas.map((l) => l[ordem]))
  return (
    <ol className="divide-y divide-border/60 overflow-hidden rounded-[var(--r-lg)] bg-surface shadow-[var(--shadow-sm)]">
      {linhas.map((l, i) => {
        const corpo = (
          <div className={`grid grid-cols-[2rem_1fr_auto] items-center gap-3 px-3 py-2.5 ${selecionado === l.chave ? 'bg-brand-soft' : ''} ${hrefDe ? 'u-motion hover:bg-surface-2' : ''}`}>
            <span className="num text-right text-[12px] text-text-muted">{i + 1}</span>
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-text">{l.rotulo}</div>
              <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                <div className="h-1.5 rounded-full bg-brand" style={{ width: `${Math.max(1, (l[ordem] / max) * 100)}%` }} />
              </div>
            </div>
            <div className="text-right">
              <div className="num text-sm font-semibold text-text"><Money value={l.valor} /></div>
              <div className="num text-[12px] text-text-muted">{mostrarQuant ? `${fmtQtd(l.quant)} un · ` : `${l.cupons} cupons · `}{fmtPct(l.pct)}</div>
            </div>
          </div>
        )
        return <li key={l.chave}>{hrefDe ? <Link href={hrefDe(l.chave)} scroll={false}>{corpo}</Link> : corpo}</li>
      })}
    </ol>
  )
}
