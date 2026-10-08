import type { MatrizMensal } from '@/lib/faturamento-itens'

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const rotuloMes = (ym: string) => `${MESES[Number(ym.slice(5, 7)) - 1]}/${ym.slice(2, 4)}`
const fmt = (n: number) => (n ? n.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-')
const moeda = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

// Evolucao mensal: linhas (produto/familia/tipo) x meses do periodo, com total e %.
export function MatrizMensalTabela({ matriz, titulo }: { matriz: MatrizMensal; titulo: string }) {
  const th = 'px-3 py-2 text-[12px] font-semibold text-text-muted'
  return (
    <div className="max-h-[70vh] overflow-auto rounded-[var(--r-lg)] bg-surface shadow-[var(--shadow-sm)]">
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 z-20 bg-surface">
          <tr className="border-b border-border">
            <th className={`sticky left-0 z-30 bg-surface text-left ${th}`}>{titulo}</th>
            {matriz.meses.map((m) => <th key={m} className={`text-right ${th}`}>{rotuloMes(m)}</th>)}
            <th className={`text-right ${th}`}>Total</th>
            <th className={`text-right ${th}`}>%</th>
          </tr>
        </thead>
        <tbody>
          {matriz.linhas.map((l) => (
            <tr key={l.chave} className="border-t border-border/60">
              <td className="sticky left-0 z-10 max-w-[18rem] truncate bg-surface px-3 py-2 text-text">{l.rotulo}</td>
              {matriz.meses.map((m) => <td key={m} className="num whitespace-nowrap px-3 py-2 text-right text-text">{fmt(l.porMes[m] ?? 0)}</td>)}
              <td className="num whitespace-nowrap px-3 py-2 text-right font-semibold text-text">{moeda(l.total)}</td>
              <td className="num whitespace-nowrap px-3 py-2 text-right text-text-muted">{l.pct.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%</td>
            </tr>
          ))}
        </tbody>
        <tfoot className="sticky bottom-0 z-20">
          <tr className="border-t border-border bg-surface-2 font-semibold">
            <td className="sticky left-0 z-30 bg-surface-2 px-3 py-2 text-text">Total</td>
            {matriz.meses.map((m) => <td key={m} className="num whitespace-nowrap px-3 py-2 text-right text-text">{fmt(matriz.totalPorMes[m] ?? 0)}</td>)}
            <td className="num whitespace-nowrap px-3 py-2 text-right text-text">{moeda(matriz.total)}</td>
            <td className="bg-surface-2" />
          </tr>
        </tfoot>
      </table>
    </div>
  )
}
