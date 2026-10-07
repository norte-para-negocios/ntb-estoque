// Evolução diária: barras de faturamento com o lucro em cima. SVG puro (sem biblioteca), cores do kit.
export function EvolucaoDiaria({ dias }: { dias: { dia: string; faturamento: number; lucro: number }[] }) {
  const W = 960, H = 160, PAD = 8
  const max = Math.max(1, ...dias.map((d) => d.faturamento))
  const largura = (W - PAD * 2) / dias.length
  const rotulo = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
  const passo = Math.max(1, Math.ceil(dias.length / 10))
  return (
    <figure className="rounded-[var(--r-lg)] bg-surface p-4 shadow-[var(--shadow-sm)]" aria-label="Evolução diária do faturamento e do lucro">
      <figcaption className="mb-2 flex flex-wrap items-center gap-4 text-[12px] text-text-muted">
        <span className="font-semibold text-text">Dia a dia</span>
        <span className="inline-flex items-center gap-1.5"><i className="inline-block size-2.5 rounded-sm bg-brand/30" /> Faturamento</span>
        <span className="inline-flex items-center gap-1.5"><i className="inline-block size-2.5 rounded-sm bg-brand" /> Lucro</span>
      </figcaption>
      <svg viewBox={`0 0 ${W} ${H + 22}`} className="h-auto w-full" role="img">
        {dias.map((d, i) => {
          const x = PAD + i * largura
          const hf = (d.faturamento / max) * H
          const hl = (Math.max(0, d.lucro) / max) * H
          return (
            <g key={d.dia}>
              <title>{`${rotulo(d.dia)}: faturamento ${d.faturamento.toFixed(2)} · lucro ${d.lucro.toFixed(2)}`}</title>
              <rect x={x + largura * 0.12} y={H - hf} width={largura * 0.76} height={hf} rx={3} className="fill-brand/30" />
              <rect x={x + largura * 0.12} y={H - hl} width={largura * 0.76} height={hl} rx={3} className="fill-brand" />
              {i % passo === 0 && <text x={x + largura / 2} y={H + 16} textAnchor="middle" className="fill-text-muted text-[11px]">{rotulo(d.dia)}</text>}
            </g>
          )
        })}
      </svg>
    </figure>
  )
}
