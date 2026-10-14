import Link from 'next/link'
import { Info } from 'lucide-react'
import { TabelaMovimentos } from '@/components/movimentacoes/TabelaMovimentos'
import { movimentosDaOP } from '@/lib/movimentacoes/dados'
import type { ItemFichaOP, OPMin } from '@/lib/movimentacoes/movimentacoes-puro'

const fmtQtd = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 4 })

/**
 * Página da OP: a ficha usada (gravada na OP: insumo, quantidade, local de consumo) e os movimentos de estoque que a OP
 * gerou — entrada do produto e consumo dos insumos — pelo kardex do Omie (loja com espelho) ou pela própria ficha.
 */
export async function MovimentosDaOP({ lojaId, op, itens }: { lojaId: number; op: OPMin; itens: ItemFichaOP[] }) {
  const r = await movimentosDaOP(lojaId, op, itens)
  const nomes = new Map(r.linhas.map((l) => [l.n_cod_prod, l]))
  const numero = op.identificacao_c_num_op ?? String(op.id)
  const dia = op.dt_conclusao_real?.slice(0, 10)
  const verTudo = dia ? `/movimentacoes?doc=${encodeURIComponent(numero)}&data_inicio=${dia}&data_final=${dia}` : null

  return (
    <>
      {itens.length > 0 && (
        <div className="rounded-[var(--r-lg)] bg-surface p-5 shadow-[var(--shadow-sm)]">
          <h2 className="mb-3 text-[17px] font-semibold text-text">Ficha usada nesta OP</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-[13px]">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-text-muted">
                  <th className="py-2 pr-2 font-medium">Insumo</th>
                  <th className="px-2 py-2 text-right font-medium">Quantidade</th>
                  <th className="px-2 py-2 font-medium">Local de consumo</th>
                </tr>
              </thead>
              <tbody>
                {itens.map((i, n) => {
                  const l = nomes.get(Number(i.nIdProdutoMalha))
                  const consumo = r.linhas.find((x) => x.n_cod_prod === Number(i.nIdProdutoMalha) && x.quantidade < 0)
                  return (
                    <tr key={`${i.nIdProdutoMalha}-${n}`} className="border-t border-[var(--border)]">
                      <td className="py-2 pr-2">
                        <Link href={`/estoque/produto/${i.nIdProdutoMalha}`} className="font-medium text-text hover:underline">{l?.produto ?? `Produto ${i.nIdProdutoMalha}`}</Link>
                        {l?.codigo && <span className="num ml-2 text-[12px] text-text-muted">{l.codigo}</span>}
                      </td>
                      <td className="px-2 py-2 text-right num">{fmtQtd(Number(i.nQtde) || 0)} <span className="text-[12px] text-text-muted">{l?.unidade ?? ''}</span></td>
                      <td className="px-2 py-2 text-text-muted">{consumo?.local ?? '-'}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="space-y-3 rounded-[var(--r-lg)] bg-surface p-5 shadow-[var(--shadow-sm)]">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-[17px] font-semibold text-text">Movimentos de estoque desta OP</h2>
          {verTudo && <Link href={verTudo} className="text-[13px] text-brand hover:underline">ver em Movimentações</Link>}
        </div>
        <p className="flex items-start gap-2 text-[13px] text-text-muted">
          <Info className="mt-0.5 size-3.5 shrink-0 text-brand" />
          {r.fonte === 'kardex'
            ? (r.aviso ?? 'Kardex do Omie: entrada do produto e consumo dos insumos que esta OP lançou.')
            : r.aviso}
        </p>
        <TabelaMovimentos linhas={r.linhas} comSaldo={r.fonte === 'kardex'}
          vazio={{ title: 'Sem movimentos', hint: 'Esta OP não tem produto nem ficha gravada para mostrar.' }} />
      </div>
    </>
  )
}
