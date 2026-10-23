import { formatCustoUnit } from '@/lib/num-br'
import { textoCustoForaDoNormal, type CustoForaDoNormal } from '@/lib/relatorios/cmv-puro'

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
const qtd = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 })

// Aviso do CMV/CPV pelo kardex quando o custo de algum movimento do Omie estava fora do normal (migration 290): os
// totais já vêm com o custo normal do produto; a lista mostra o que corrigir no Omie (custo ou unidade).
export function AvisoCustoForaDoNormal({ dados, limite = 30 }: { dados: CustoForaDoNormal; limite?: number }) {
  const texto = textoCustoForaDoNormal(dados, brl)
  if (!texto) return null
  return (
    <details className="rounded-[var(--r-md)] bg-surface px-3 py-2 text-[13px] text-warn shadow-[var(--shadow-sm)]">
      <summary className="cursor-pointer">
        {texto} Toque para ver a lista. O custo normal é o custo do dia a dia do produto (o valor do meio dos movimentos dos últimos 120 dias); corrija no Omie o custo ou a unidade desses produtos.
      </summary>
      <div className="mt-2 overflow-x-auto text-text">
        <table className="w-full min-w-[980px] border-collapse text-[12px]">
          <thead>
            <tr className="text-left text-text-muted">
              <th className="px-2 py-1">Produto</th><th className="px-2 py-1 text-right">Qtd. vendida</th>
              <th className="px-2 py-1 text-right">CMV pelo Omie</th><th className="px-2 py-1 text-right">CMV usado</th>
              <th className="px-2 py-1 text-right">Consumo OP pelo Omie</th><th className="px-2 py-1 text-right">Consumo usado</th>
              <th className="px-2 py-1 text-right">Estoque inicial Omie / usado</th><th className="px-2 py-1 text-right">Estoque final Omie / usado</th>
              <th className="px-2 py-1 text-right">Custo normal (un.)</th>
            </tr>
          </thead>
          <tbody>
            {dados.produtos.slice(0, limite).map((p) => (
              <tr key={p.rotulo} className="border-t border-border/60">
                <td className="px-2 py-1">{p.rotulo}</td>
                <td className="num px-2 py-1 text-right">{qtd(p.quant)}</td>
                <td className="num px-2 py-1 text-right">{brl(p.cmvOmie)}</td>
                <td className="num px-2 py-1 text-right">{brl(p.cmv)}</td>
                <td className="num px-2 py-1 text-right">{brl(p.consumoOmie)}</td>
                <td className="num px-2 py-1 text-right">{brl(p.consumo)}</td>
                <td className="num px-2 py-1 text-right">{Math.abs(p.eiOmie - p.ei) > 0.005 ? `${brl(p.eiOmie)} / ${brl(p.ei)}` : '—'}</td>
                <td className="num px-2 py-1 text-right">{Math.abs(p.efOmie - p.ef) > 0.005 ? `${brl(p.efOmie)} / ${brl(p.ef)}` : '—'}</td>
                <td className="num px-2 py-1 text-right">{p.semReferencia ? 'sem custo confiável' : p.referencia == null ? '—' : formatCustoUnit(p.referencia)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {dados.produtos.length > limite && <p className="mt-1 text-text-muted">Mostrando {limite} de {dados.produtos.length}. O arquivo do botão Baixar traz todos.</p>}
      </div>
    </details>
  )
}
