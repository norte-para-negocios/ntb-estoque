import Link from 'next/link'
import { ChevronRight } from 'lucide-react'
import type { NotaLeve } from '@/lib/notas-compras'
import { statusNF } from '@/lib/nf-status'
import { FUNDO_CLASSE } from '@/lib/status-cor'
import { Money } from '@/components/ui-kit/Money'

const fmtData = (iso: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '-')

// Notas no mesmo desenho do ranking do Faturamento: barra proporcional ao maior valor da
// lista; a linha inteira abre a nota (itens, vinculos de produto, acoes).
export function ListaNotasCompra({ notas, maxValor }: { notas: NotaLeve[]; maxValor: number }) {
  const max = Math.max(1, maxValor)
  return (
    <ol className="divide-y divide-border/60 overflow-hidden rounded-[var(--r-lg)] bg-surface shadow-[var(--shadow-sm)]">
      {notas.map((n) => {
        const st = statusNF(n.etapa, { infoCadastro: { cCancelada: n.cancelada ? 'S' : 'N' }, sefaz: n.sefazSituacao ? { situacao: n.sefazSituacao } : undefined })
        return (
          <li key={n.id}>
            <Link href={`/nota-fiscal/${n.id}`} className="grid grid-cols-[1fr_auto] items-center gap-3 px-3 py-2.5 u-motion hover:bg-surface-2 sm:grid-cols-[7.5rem_1fr_auto_1rem]">
              <div className="hidden min-w-0 sm:block">
                <div className="num text-[13px] text-text">{fmtData(n.dia)}</div>
                <div className="num truncate whitespace-nowrap text-[12px] text-text-muted">NF {n.numero ?? '-'}{n.serie ? `/${n.serie}` : ''}</div>
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-text">{n.fornecedor}</div>
                <div className="truncate text-[12px] text-text-muted">
                  <span className="num sm:hidden">{fmtData(n.dia)} · NF {n.numero ?? '-'}{n.natureza ? ' · ' : ''}</span>
                  {n.natureza}
                </div>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-surface-2">
                  <div className={`h-1.5 rounded-full ${n.cancelada ? 'bg-text-muted/40' : 'bg-brand'}`} style={{ width: `${Math.max(1, (n.valor / max) * 100)}%` }} />
                </div>
              </div>
              <div className="text-right">
                <div className={`num text-sm font-semibold ${n.cancelada ? 'text-text-muted line-through' : 'text-text'}`}><Money value={n.valor} /></div>
                <div className="inline-flex items-center gap-1.5 whitespace-nowrap text-[12px] text-text-muted" title={st.label}>
                  <span className={`size-2 shrink-0 rounded-full ${FUNDO_CLASSE[st.tom]}`} aria-hidden />
                  {st.label.replace(/ \(etapa [^)]*\)$/, '')}
                </div>
              </div>
              <ChevronRight className="hidden size-4 text-text-muted sm:block" aria-hidden />
            </Link>
          </li>
        )
      })}
    </ol>
  )
}
