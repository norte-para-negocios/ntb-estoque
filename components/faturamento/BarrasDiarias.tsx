import type { DiaValor } from '@/lib/faturamento-dias'

// Barras de faturamento por dia, com linha horizontal opcional da meta.
// Barra cheia = bateu a meta; clara = nao bateu; cinza = dia em andamento (hoje).
export function BarrasDiarias({ dias, meta, hoje }: { dias: DiaValor[]; meta?: number | null; hoje?: string }) {
  if (!dias.length) return null
  const W = 960, H = 160, PAD = 8
  const max = Math.max(1, meta ?? 0, ...dias.map((d) => d.valor))
  const largura = (W - PAD * 2) / dias.length
  const rotulo = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
  const passo = Math.max(1, Math.ceil(dias.length / 10))
  const yMeta = meta && meta > 0 ? H - (meta / max) * H : null
  return (
    <figure className="rounded-[var(--r-lg)] bg-surface p-4 shadow-[var(--shadow-sm)]" aria-label="Faturamento por dia">
      <figcaption className="mb-2 flex flex-wrap items-center gap-4 text-[12px] text-text-muted">
        <span className="font-semibold text-text">Dia a dia</span>
        {yMeta !== null && (
          <>
            <span className="inline-flex items-center gap-1.5"><i className="inline-block size-2.5 rounded-sm bg-brand" /> Bateu a meta</span>
            <span className="inline-flex items-center gap-1.5"><i className="inline-block size-2.5 rounded-sm bg-brand/30" /> Abaixo da meta</span>
          </>
        )}
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H + 22}`} className="h-auto w-full" role="img">
        {dias.map((d, i) => {
          const x = PAD + i * largura
          const h = (d.valor / max) * H
          const andamento = hoje === d.dia
          const bateu = yMeta !== null && !andamento && d.valor >= (meta as number)
          const cls = andamento ? 'fill-text-muted/30' : yMeta === null || bateu ? 'fill-brand' : 'fill-brand/30'
          return (
            <g key={d.dia}>
              <title>{`${rotulo(d.dia)}: ${d.valor.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}${andamento ? ' (em andamento)' : ''}`}</title>
              <rect x={x + largura * 0.12} y={H - h} width={largura * 0.76} height={h} rx={3} className={cls} />
              {i % passo === 0 && <text x={x + largura / 2} y={H + 16} textAnchor="middle" className="fill-text-muted text-[11px]">{rotulo(d.dia)}</text>}
            </g>
          )
        })}
        {yMeta !== null && <line x1={PAD} x2={W - PAD} y1={yMeta} y2={yMeta} strokeDasharray="6 4" className="stroke-warn" strokeWidth={1.5} />}
      </svg>
    </figure>
  )
}
