import Link from 'next/link'
import type { MovCusto, PontoCusto } from '@/lib/estoque/custo-produto-puro'
import { formatCustoUnit } from '@/lib/num-br'

const CORES = ['var(--brand)', 'var(--info)', 'var(--warn)']
const fmtQ = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 })
const dia = (iso: string) => { const [, m, d] = iso.split('-'); return `${d}/${m}` }
const ABSURDO = 1000

/** Gráfico (SVG, sem biblioteca) do custo médio no tempo, uma linha por local. Ponto absurdo em vermelho. */
export function GraficoCusto({ series, nomeLocal }: { series: Map<number, PontoCusto[]>; nomeLocal: Map<number, string> }) {
  const locais = [...series.entries()].filter(([, p]) => p.length).sort((a, b) => b[1].length - a[1].length).slice(0, 3)
  const pontos = locais.flatMap(([, p]) => p)
  if (!pontos.length) return <p className="py-6 text-center text-[13px] text-text-muted">Sem custo médio no período lido do kardex.</p>
  const W = 640, H = 200, ML = 72, MR = 12, MT = 12, MB = 24
  const datas = [...new Set(pontos.map((p) => p.data))].sort()
  const t0 = Date.parse(datas[0]), t1 = Date.parse(datas[datas.length - 1])
  // Pontos absurdos não esticam a escala: eixo até o maior custo normal, absurdo fica preso no topo.
  const normais = pontos.filter((p) => p.cmc < ABSURDO).map((p) => p.cmc)
  const max = Math.max(...(normais.length ? normais : pontos.map((p) => p.cmc))) * 1.1 || 1
  const x = (d: string) => ML + (t1 === t0 ? (W - ML - MR) / 2 : ((Date.parse(d) - t0) / (t1 - t0)) * (W - ML - MR))
  const y = (c: number) => MT + (1 - Math.min(c, max) / max) * (H - MT - MB)
  return (
    <figure className="space-y-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Custo médio no tempo">
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={ML} x2={W - MR} y1={y(max * f)} y2={y(max * f)} stroke="var(--border)" strokeWidth={1} />
            <text x={ML - 6} y={y(max * f) + 4} textAnchor="end" fontSize={11} fill="var(--text-muted)">{formatCustoUnit(max * f)}</text>
          </g>
        ))}
        <text x={ML} y={H - 6} fontSize={11} fill="var(--text-muted)">{dia(datas[0])}</text>
        <text x={W - MR} y={H - 6} textAnchor="end" fontSize={11} fill="var(--text-muted)">{dia(datas[datas.length - 1])}</text>
        {locais.map(([local, p], i) => (
          <g key={local}>
            <polyline fill="none" stroke={CORES[i]} strokeWidth={2} strokeLinejoin="round" points={p.map((q) => `${x(q.data)},${y(q.cmc)}`).join(' ')} />
            {p.map((q, k) => {
              const ant = k > 0 ? p[k - 1].cmc : null
              const absurdo = q.cmc >= ABSURDO || (ant != null && q.cmc >= ant * 20)
              return (
                <circle key={q.data} cx={x(q.data)} cy={y(q.cmc)} r={absurdo ? 4 : 2.5} fill={absurdo ? 'var(--err)' : CORES[i]}>
                  <title>{`${dia(q.data)} · ${nomeLocal.get(local) ?? local}: ${formatCustoUnit(q.cmc)}`}</title>
                </circle>
              )
            })}
          </g>
        ))}
      </svg>
      <figcaption className="flex flex-wrap gap-3 text-[12px] text-text-muted">
        {locais.map(([local], i) => (
          <span key={local} className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: CORES[i] }} />{nomeLocal.get(local) ?? local}</span>
        ))}
        <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-err" />custo fora do normal</span>
      </figcaption>
    </figure>
  )
}

export type LinhaPrato = { insumo: number; descricao: string; unidade: string; qtdPorUnidade: number; cmc: number | null; custo: number }

/** Seção "Custo do produto": gráfico, entradas que formaram o custo e (prato) custo pela ficha. */
export function CustoProduto({ series, entradas, nomeLocal, unidade, prato, notaFicha }: {
  series: Map<number, PontoCusto[]>
  entradas: MovCusto[]
  nomeLocal: Map<number, string>
  unidade: string
  prato: { total: number; linhas: LinhaPrato[]; semCusto: number } | null
  notaFicha?: string
}) {
  return (
    <section aria-label="Custo do produto" className="space-y-3">
      <h2 className="text-[15px] font-semibold text-text">Custo do produto</h2>
      <div className="rounded-[var(--r-lg)] bg-surface p-4 u-card">
        <div className="mb-2 text-[13px] font-medium text-text">Custo médio no tempo</div>
        <GraficoCusto series={series} nomeLocal={nomeLocal} />
      </div>

      <div className="rounded-[var(--r-lg)] bg-surface p-4 u-card">
        <div className="text-[13px] font-medium text-text">Entradas que formaram o custo atual</div>
        <p className="text-[12px] text-text-muted">Entradas com custo desde a última vez que o saldo do local zerou.</p>
        {!entradas.length ? <p className="py-4 text-center text-[13px] text-text-muted">Nenhuma entrada com custo no período lido.</p> : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[560px] text-left text-[13px]">
              <thead><tr className="text-[11px] uppercase tracking-wide text-text-muted">
                <th className="py-2 pr-2 font-medium">Data</th><th className="px-2 py-2 font-medium">Local</th><th className="px-2 py-2 font-medium">Origem</th>
                <th className="px-2 py-2 text-right font-medium">Quantidade</th><th className="px-2 py-2 text-right font-medium">Custo unit.</th><th className="py-2 pl-2 text-right font-medium">Custo médio após</th>
              </tr></thead>
              <tbody>
                {entradas.map((e) => (
                  <tr key={`${e.local}-${e.ordem}`} className="border-t border-[var(--border)]">
                    <td className="num whitespace-nowrap py-2 pr-2 text-text-muted">{dia(e.data)}/{e.data.slice(2, 4)}</td>
                    <td className="whitespace-nowrap px-2 py-2 text-text-muted">{nomeLocal.get(e.local) ?? e.local}</td>
                    <td className="px-2 py-2 text-text-muted">{e.origem ?? '-'}{e.doc ? ` · ${e.doc}` : ''}</td>
                    <td className="num whitespace-nowrap px-2 py-2 text-right text-ok">+{fmtQ(e.quantidade)} {unidade}</td>
                    <td className={`num whitespace-nowrap px-2 py-2 text-right ${(e.valorUnit ?? 0) >= ABSURDO ? 'font-semibold text-err' : ''}`}>{formatCustoUnit(e.valorUnit)}</td>
                    <td className="num whitespace-nowrap py-2 pl-2 text-right">{formatCustoUnit(e.cmc)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {(prato || notaFicha) && (
        <div className="rounded-[var(--r-lg)] bg-surface p-4 u-card">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="text-[13px] font-medium text-text">Custo do prato pela ficha</div>
            {prato && <div className="num text-[18px] font-semibold text-text">{formatCustoUnit(prato.total)} <span className="text-[12px] font-normal text-text-muted">por {unidade}</span></div>}
          </div>
          {notaFicha && <p className="text-[12px] text-text-muted">{notaFicha}</p>}
          {prato && (
            <>
              <p className="text-[12px] text-text-muted">Soma dos insumos × custo médio atual de cada um.{prato.semCusto ? ` ${prato.semCusto} insumo${prato.semCusto === 1 ? '' : 's'} sem custo (conta zero).` : ''}</p>
              <div className="mt-2 overflow-x-auto">
                <table className="w-full min-w-[480px] text-left text-[13px]">
                  <thead><tr className="text-[11px] uppercase tracking-wide text-text-muted">
                    <th className="py-2 pr-2 font-medium">Insumo</th><th className="px-2 py-2 text-right font-medium">Quantidade</th><th className="px-2 py-2 text-right font-medium">Custo médio</th><th className="py-2 pl-2 text-right font-medium">Custo no prato</th>
                  </tr></thead>
                  <tbody>
                    {prato.linhas.map((l) => (
                      <tr key={l.insumo} className="border-t border-[var(--border)]">
                        <td className="py-2 pr-2"><Link href={`/estoque/produto/${l.insumo}`} className="text-text hover:underline">{l.descricao}</Link></td>
                        <td className="num whitespace-nowrap px-2 py-2 text-right text-text-muted">{fmtQ(l.qtdPorUnidade)} {l.unidade}</td>
                        <td className={`num whitespace-nowrap px-2 py-2 text-right ${l.cmc != null && l.cmc > 0 ? '' : 'text-warn'}`}>{l.cmc != null && l.cmc > 0 ? formatCustoUnit(l.cmc) : 'sem custo'}</td>
                        <td className="num whitespace-nowrap py-2 pl-2 text-right">{formatCustoUnit(l.custo)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  )
}
