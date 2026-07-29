'use client'

import { useState } from 'react'

type BucketProducao = {
  chave: string
  rotulo: string
  total: number
  porFuncionario: { nome: string; qtd: number }[]
}

const CORES = [
  'var(--series-1)',
  'var(--series-2)',
  'var(--series-3)',
  'var(--series-4)',
  'var(--series-5)',
  'var(--series-6)',
  'var(--series-7)',
]
const COR_OUTROS = 'var(--text-muted)'

function corDoFuncionario(nome: string, funcionariosOrdenados: string[]): string {
  const idx = funcionariosOrdenados.indexOf(nome)
  if (idx === -1 || idx >= CORES.length) return COR_OUTROS
  return CORES[idx]
}

export function ProducaoChart({
  buckets,
  funcionariosOrdenados,
}: {
  buckets: BucketProducao[]
  funcionariosOrdenados: string[]
}) {
  const [hover, setHover] = useState<number | null>(null)
  const maxTotal = Math.max(...buckets.map((b) => b.total), 1)

  const larguraBarra = 28
  const gap = 10
  const alturaPlot = 220
  const alturaEixoX = 28
  const larguraEixoY = 40
  const largura = larguraEixoY + buckets.length * (larguraBarra + gap)
  const altura = alturaPlot + alturaEixoX

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(maxTotal * f))

  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      {/* Legenda -- sempre visivel com 2+ series */}
      {funcionariosOrdenados.length > 1 && (
        <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1.5">
          {funcionariosOrdenados.map((nome) => (
            <div key={nome} className="flex items-center gap-1.5 text-[12px] text-text-muted">
              <span
                className="inline-block size-2.5 rounded-sm"
                style={{ background: corDoFuncionario(nome, funcionariosOrdenados) }}
              />
              {nome}
            </div>
          ))}
        </div>
      )}

      <div className="overflow-x-auto">
        <svg width={largura} height={altura} role="img" aria-label="OPs concluídas por período">
          {/* Gridlines horizontais */}
          {yTicks.map((v, i) => {
            const y = alturaPlot - (v / maxTotal) * alturaPlot
            return (
              <g key={i}>
                <line x1={larguraEixoY} y1={y} x2={largura} y2={y} stroke="var(--border)" strokeWidth={1} />
                <text x={larguraEixoY - 6} y={y + 3} textAnchor="end" fontSize={10} fill="var(--text-muted)">
                  {v}
                </text>
              </g>
            )
          })}

          {/* Barras empilhadas */}
          {buckets.map((b, i) => {
            const x = larguraEixoY + i * (larguraBarra + gap)
            let yAtual = alturaPlot
            const segmentos = b.porFuncionario.map((f) => {
              const h = maxTotal > 0 ? (f.qtd / maxTotal) * alturaPlot : 0
              const y = yAtual - h
              yAtual = y - 2 // gap de 2px entre segmentos
              return { ...f, y, h }
            })
            return (
              <g
                key={b.chave}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                tabIndex={0}
                style={{ cursor: b.total > 0 ? 'pointer' : 'default', outline: 'none' }}
              >
                {segmentos.map((s, si) => (
                  <rect
                    key={si}
                    x={x}
                    y={s.y}
                    width={larguraBarra}
                    height={Math.max(s.h, 0)}
                    fill={corDoFuncionario(s.nome, funcionariosOrdenados)}
                    opacity={hover === null || hover === i ? 1 : 0.35}
                    rx={si === segmentos.length - 1 ? 4 : 0}
                  />
                ))}
                {/* Hit area maior que a barra, cobre a coluna inteira */}
                <rect x={x} y={0} width={larguraBarra} height={alturaPlot} fill="transparent" />
                {/* Total no topo (label direto -- so o total, nao cada segmento) */}
                {b.total > 0 && (
                  <text
                    x={x + larguraBarra / 2}
                    y={(segmentos[segmentos.length - 1]?.y ?? alturaPlot) - 6}
                    textAnchor="middle"
                    fontSize={10}
                    fontWeight={600}
                    fill="var(--text)"
                  >
                    {b.total}
                  </text>
                )}
                <text
                  x={x + larguraBarra / 2}
                  y={alturaPlot + 18}
                  textAnchor="middle"
                  fontSize={10}
                  fill="var(--text-muted)"
                >
                  {b.rotulo}
                </text>
              </g>
            )
          })}
        </svg>
      </div>

      {/* Tooltip do bucket em hover/focus */}
      {hover !== null && buckets[hover] && buckets[hover].total > 0 && (
        <div className="mt-3 rounded-md border border-border bg-surface-2 px-3 py-2 text-[12px]">
          <div className="font-semibold text-text">
            {buckets[hover].rotulo} — {buckets[hover].total} OP(s)
          </div>
          <div className="mt-1 space-y-0.5">
            {buckets[hover].porFuncionario.map((f) => (
              <div key={f.nome} className="flex items-center gap-1.5 text-text-muted">
                <span
                  className="inline-block h-0.5 w-3 rounded-full"
                  style={{ background: corDoFuncionario(f.nome, funcionariosOrdenados) }}
                />
                <span>{f.nome}:</span>
                <span className="num font-medium text-text">{f.qtd}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
