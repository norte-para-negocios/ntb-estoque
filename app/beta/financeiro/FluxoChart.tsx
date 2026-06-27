// Grafico de fluxo de caixa: barras divergentes (entradas pra cima, saidas pra baixo)
// por mes, com linha do saldo acumulado. SVG puro, server-safe, sem libs.
import { Money } from '@/components/ui-kit/Money'

type Ponto = { mes: string; entradas: number; saidas: number; saldoMes: number; acumulado: number }

function mesCurto(mes: string): string {
  const [y, m] = mes.split('-')
  const nomes = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
  return `${nomes[Number(m) - 1]}/${y.slice(2)}`
}

export function FluxoChart({ dados }: { dados: Ponto[] }) {
  if (dados.length === 0) return null

  // Geometria (coordenadas do viewBox; o SVG escala via width:100%)
  const W = 760, H = 240
  const padX = 16, padTop = 24, padBottom = 34
  const zeroY = padTop + (H - padTop - padBottom) / 2
  const semiAltura = (H - padTop - padBottom) / 2

  const maxBarra = Math.max(1, ...dados.map(d => Math.max(d.entradas, d.saidas)))
  const passo = (W - padX * 2) / dados.length
  const barW = Math.min(28, passo * 0.5)

  // Escala do acumulado (linha): usa min/max proprios
  const accs = dados.map(d => d.acumulado)
  const accMax = Math.max(...accs, 0)
  const accMin = Math.min(...accs, 0)
  const accRange = accMax - accMin || 1
  const accY = (v: number) => padTop + (1 - (v - accMin) / accRange) * (H - padTop - padBottom)

  const pontosLinha = dados.map((d, i) => `${padX + passo * i + passo / 2},${accY(d.acumulado).toFixed(1)}`).join(' ')

  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-[13px] font-semibold text-text">Entradas x saidas por mes</h3>
        <div className="flex items-center gap-3 text-[11px] text-text-muted">
          <span className="inline-flex items-center gap-1"><i className="size-2 rounded-sm" style={{ background: 'var(--ok)' }} /> Entradas</span>
          <span className="inline-flex items-center gap-1"><i className="size-2 rounded-sm" style={{ background: 'var(--err)' }} /> Saidas</span>
          <span className="inline-flex items-center gap-1"><i className="size-2 rounded-full" style={{ background: 'var(--brand)' }} /> Acumulado</span>
        </div>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 'auto' }} role="img" aria-label="Grafico de fluxo de caixa">
        {/* linha zero */}
        <line x1={padX} y1={zeroY} x2={W - padX} y2={zeroY} stroke="var(--border)" strokeWidth={1} />

        {dados.map((d, i) => {
          const cx = padX + passo * i + passo / 2
          const hE = (d.entradas / maxBarra) * semiAltura
          const hS = (d.saidas / maxBarra) * semiAltura
          return (
            <g key={d.mes}>
              {/* entrada (cima) */}
              <rect x={cx - barW / 2} y={zeroY - hE} width={barW} height={hE} rx={2} fill="var(--ok)" opacity={0.9}>
                <title>{`${mesCurto(d.mes)} entradas: R$ ${d.entradas.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`}</title>
              </rect>
              {/* saida (baixo) */}
              <rect x={cx - barW / 2} y={zeroY} width={barW} height={hS} rx={2} fill="var(--err)" opacity={0.85}>
                <title>{`${mesCurto(d.mes)} saidas: R$ ${d.saidas.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`}</title>
              </rect>
              {/* label mes */}
              <text x={cx} y={H - 14} textAnchor="middle" className="fill-[var(--text-muted)]" style={{ fontSize: 11 }}>{mesCurto(d.mes)}</text>
            </g>
          )
        })}

        {/* linha do acumulado */}
        <polyline points={pontosLinha} fill="none" stroke="var(--brand)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {dados.map((d, i) => (
          <circle key={d.mes} cx={padX + passo * i + passo / 2} cy={accY(d.acumulado)} r={3} fill="var(--surface)" stroke="var(--brand)" strokeWidth={2}>
            <title>{`${mesCurto(d.mes)} acumulado: R$ ${d.acumulado.toLocaleString('pt-BR', { minimumFractionDigits: 2 })}`}</title>
          </circle>
        ))}
      </svg>
    </div>
  )
}
