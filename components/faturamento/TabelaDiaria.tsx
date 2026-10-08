import type { DiaValor } from '@/lib/faturamento-dias'
import { Money } from '@/components/ui-kit/Money'

const DIAS_SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const rotuloDia = (iso: string) => {
  const dow = new Date(`${iso}T12:00:00Z`).getUTCDay()
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)} · ${DIAS_SEMANA[dow]}`
}

export function TabelaDiaria({ dias, meta, hoje }: { dias: DiaValor[]; meta?: number | null; hoje?: string }) {
  const comMeta = meta != null && meta > 0
  const th = 'px-3 py-2 text-[12px] font-semibold text-text-muted'
  return (
    <div className="overflow-x-auto rounded-[var(--r-lg)] bg-surface shadow-[var(--shadow-sm)]">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-border bg-surface">
            <th className={`text-left ${th}`}>Dia</th>
            <th className={`text-right ${th}`}>Faturamento</th>
            {comMeta && <th className={`text-right ${th}`}>Meta</th>}
            {comMeta && <th className={`text-right ${th}`}>Diferença</th>}
            {comMeta && <th className={`text-center ${th}`}>Situação</th>}
          </tr>
        </thead>
        <tbody>
          {dias.map((d) => {
            const andamento = hoje === d.dia
            const dif = comMeta ? d.valor - (meta as number) : 0
            return (
              <tr key={d.dia} className="border-t border-border/60">
                <td className="whitespace-nowrap px-3 py-2 text-text">{rotuloDia(d.dia)}</td>
                <td className="px-3 py-2 text-right text-text"><Money value={d.valor} /></td>
                {comMeta && <td className="px-3 py-2 text-right text-text-muted"><Money value={meta as number} /></td>}
                {comMeta && <td className={`px-3 py-2 text-right ${dif >= 0 ? 'text-ok' : 'text-warn'}`}><Money value={dif} /></td>}
                {comMeta && (
                  <td className="px-3 py-2 text-center text-[12px] font-semibold">
                    {andamento ? <span className="text-text-muted">em andamento</span> : dif >= 0 ? <span className="text-ok">✓ bateu</span> : <span className="text-warn">✗ não bateu</span>}
                  </td>
                )}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
