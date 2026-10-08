import Link from 'next/link'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { ATALHOS, mesVizinho, nomeMes, periodoDoAtalho } from '@/lib/faturamento-periodo'

const chipBase = 'inline-flex h-8 shrink-0 items-center whitespace-nowrap rounded-full px-3.5 text-[13px] font-semibold u-motion u-press-sm'
const chipAtivo = `${chipBase} bg-brand-fill text-white`
const chipInativo = `${chipBase} bg-surface-2 text-text-muted hover:bg-[var(--border)] hover:text-text`
const fmt = (iso: string) => iso.split('-').reverse().join('/')

// Seletor de periodo sempre visivel: mes com setas, atalhos e datas livres.
export function PeriodoBar({ basePath, params, ini, fim, hoje }: { basePath: string; params: Record<string, string>; ini: string; fim: string; hoje: string }) {
  const href = (over: Record<string, string>) => {
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries({ ...params, ...over })) if (v) q.set(k, v)
    return `${basePath}${q.size ? `?${q}` : ''}`
  }
  const mesUnico = ini.slice(0, 7) === fim.slice(0, 7)
  const mesRef = ini.slice(0, 7)
  const mesAtual = hoje.slice(0, 7)
  const irMes = (m: string) => href({ mes: m, ini: '', fim: '' })
  const outros = Object.entries(params).filter(([k, v]) => v && !['ini', 'fim', 'mes'].includes(k))
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-1 rounded-full bg-surface-2 p-0.5">
        <Link href={irMes(mesVizinho(mesRef, -1))} aria-label="Mês anterior" className="flex size-8 items-center justify-center rounded-full text-text-muted hover:bg-[var(--border)] hover:text-text"><ChevronLeft className="size-4" /></Link>
        <span className="min-w-[8.5rem] px-1 text-center text-[13px] font-semibold text-text">{mesUnico ? nomeMes(mesRef) : `${fmt(ini)} a ${fmt(fim)}`}</span>
        {mesRef < mesAtual
          ? <Link href={irMes(mesVizinho(mesRef, 1))} aria-label="Próximo mês" className="flex size-8 items-center justify-center rounded-full text-text-muted hover:bg-[var(--border)] hover:text-text"><ChevronRight className="size-4" /></Link>
          : <span className="flex size-8 items-center justify-center text-text-muted/30"><ChevronRight className="size-4" /></span>}
      </div>
      <div className="flex flex-nowrap items-center gap-1.5 overflow-x-auto [scrollbar-width:none] sm:flex-wrap [&::-webkit-scrollbar]:hidden">
        {ATALHOS.map((a) => {
          const p = periodoDoAtalho(a.value, hoje)
          return <Link key={a.value} href={href({ ini: p.ini, fim: p.fim, mes: '' })} className={p.ini === ini && p.fim === fim ? chipAtivo : chipInativo}>{a.label}</Link>
        })}
      </div>
      <form action={basePath} className="flex items-center gap-1.5 text-[13px] text-text-muted">
        {outros.map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <input type="date" name="ini" defaultValue={ini} max={hoje} aria-label="Data inicial" className="h-8 rounded-[var(--r-md)] border border-border bg-surface px-2 text-text" />
        <span>a</span>
        <input type="date" name="fim" defaultValue={fim} max={hoje} aria-label="Data final" className="h-8 rounded-[var(--r-md)] border border-border bg-surface px-2 text-text" />
        <button type="submit" className={chipInativo}>Aplicar</button>
      </form>
    </div>
  )
}
