import { formatCustoUnit } from '@/lib/num-br'
import { textoAvisoSuspeito } from '@/lib/relatorios/posicao-estoque-puro'

export type SuspeitaAviso = { chave: string; codigo: string; descricao: string; local: string; quant: number; cmcOmie: number; referencia: number | null; valorOmie: number; valor: number; motivo?: string }

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const qtd = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 })

// Aviso das linhas com CMC suspeito no Omie (regra única em posicao_valorizada, migration 282): o total já vem ajustado
// (a linha vale saldo × referência de custo); a lista mostra o dado a corrigir no Omie.
export function AvisoCustoSuspeito({ suspeitas, ajusteOmie, totalAjustado, limite = 30 }: { suspeitas: SuspeitaAviso[]; ajusteOmie: number; totalAjustado: number; limite?: number }) {
  const texto = textoAvisoSuspeito(suspeitas.length, ajusteOmie)
  if (!texto) return null
  return (
    <details className="rounded-[var(--r-md)] bg-surface px-3 py-2 text-[13px] text-warn shadow-[var(--shadow-sm)]">
      <summary className="cursor-pointer">
        {texto}. Total pelo custo do Omie: {brl(totalAjustado + ajusteOmie)}. Toque para ver a lista e corrija o custo (ou a unidade) desses produtos no Omie.
      </summary>
      <div className="mt-2 overflow-x-auto text-text">
        <table className="w-full min-w-[760px] border-collapse text-[12px]">
          <thead>
            <tr className="text-left text-text-muted">
              <th className="px-2 py-1">Produto</th><th className="px-2 py-1">Local</th><th className="px-2 py-1 text-right">Saldo</th>
              <th className="px-2 py-1 text-right">CMC no Omie</th><th className="px-2 py-1 text-right">Referência</th>
              <th className="px-2 py-1 text-right">Valor no Omie</th><th className="px-2 py-1 text-right">Valor usado</th><th className="px-2 py-1">Por quê</th>
            </tr>
          </thead>
          <tbody>
            {suspeitas.slice(0, limite).map((l) => (
              <tr key={l.chave} className="border-t border-border/60">
                <td className="px-2 py-1"><span className="num text-text-muted">{l.codigo}</span> {l.descricao}</td>
                <td className="px-2 py-1">{l.local}</td>
                <td className="num px-2 py-1 text-right">{qtd(l.quant)}</td>
                <td className="num px-2 py-1 text-right">{formatCustoUnit(l.cmcOmie)}</td>
                <td className="num px-2 py-1 text-right">{l.referencia == null ? 'sem' : formatCustoUnit(l.referencia)}</td>
                <td className="num px-2 py-1 text-right">{brl(l.valorOmie)}</td>
                <td className="num px-2 py-1 text-right">{brl(l.valor)}</td>
                <td className="px-2 py-1 text-text-muted">{l.motivo ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {suspeitas.length > limite && <p className="mt-1 text-text-muted">Mostrando {limite} de {suspeitas.length}.</p>}
      </div>
    </details>
  )
}
