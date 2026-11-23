import type { LinhaCartao } from '@/lib/faturamento-itens'
import { Money } from '@/components/ui-kit/Money'

export function TabelaCartoes({ linhas }: { linhas: LinhaCartao[] }) {
  const th = 'px-3 py-2 text-[12px] font-semibold text-text-muted'
  const total = linhas.reduce((s, l) => s + l.valor, 0)
  return (
    <div className="space-y-2">
      <h3 className="text-[14px] font-semibold text-text">Cartões por maquininha e bandeira</h3>
      <div className="overflow-auto rounded-[var(--r-lg)] bg-surface shadow-[var(--shadow-sm)]">
        <table className="w-full border-collapse text-sm">
          <thead className="bg-surface">
            <tr className="border-b border-border">
              <th className={`text-left ${th}`}>Método</th>
              <th className={`text-left ${th}`}>Maquininha</th>
              <th className={`text-left ${th}`}>Bandeira</th>
              <th className={`text-right ${th}`}>Qtd</th>
              <th className={`text-right ${th}`}>Total</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.chave} className="border-t border-border/60">
                <td className="px-3 py-2 text-text">{l.metodo}</td>
                <td className="px-3 py-2 text-text-muted">{l.maquininha || 'Não informada'}</td>
                <td className="px-3 py-2 text-text-muted">{l.bandeira || '-'}</td>
                <td className="px-3 py-2 text-right text-text-muted">{l.qtd}</td>
                <td className="px-3 py-2 text-right font-medium text-text"><Money value={l.valor} /></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="border-t border-border">
              <td colSpan={4} className="px-3 py-2 text-right text-[12px] font-semibold text-text-muted">Total em cartão</td>
              <td className="px-3 py-2 text-right font-semibold text-text"><Money value={total} /></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  )
}
