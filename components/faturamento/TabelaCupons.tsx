import type { CupomLinha } from '@/lib/faturamento-extras-loader'
import { Money } from '@/components/ui-kit/Money'

const fmtDia = (iso: string) => iso.split('-').reverse().join('/')

export function TabelaCupons({ cupons }: { cupons: CupomLinha[] }) {
  const th = 'px-3 py-2 text-[12px] font-semibold text-text-muted'
  return (
    <div className="max-h-[70vh] overflow-auto rounded-[var(--r-lg)] bg-surface shadow-[var(--shadow-sm)]">
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-surface">
          <tr className="border-b border-border">
            <th className={`text-left ${th}`}>Data</th>
            <th className={`text-left ${th}`}>Hora</th>
            <th className={`text-left ${th}`}>Número</th>
            <th className={`text-right ${th}`}>Valor</th>
            <th className={`text-left ${th}`}>Situação</th>
          </tr>
        </thead>
        <tbody>
          {cupons.map((c) => (
            <tr key={c.id} className="border-t border-border/60">
              <td className="whitespace-nowrap px-3 py-2 text-text">{fmtDia(c.dia)}</td>
              <td className="px-3 py-2 text-text-muted">{c.hora ?? '-'}</td>
              <td className="px-3 py-2 text-text-muted">{c.num ?? '-'}</td>
              <td className="px-3 py-2 text-right font-medium text-text"><Money value={c.valor} /></td>
              <td className={`px-3 py-2 ${c.situacao === 'Autorizada' ? 'text-text-muted' : 'text-warn'}`}>{c.situacao}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
