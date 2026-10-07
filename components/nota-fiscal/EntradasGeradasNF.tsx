import { createClient } from '@/lib/supabase/server'
import { formatCustoUnit } from '@/lib/num-br'

const fmtQtd = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 })
const fmtBRL = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })

/** Entradas no estoque geradas por esta nota (movimentos COMPRA do ledger), com saldo e custo médio depois de cada uma. */
export async function EntradasGeradasNF({ lojaId, referencias }: { lojaId: number; referencias: string[] }) {
  if (!referencias.length) return null
  const sb = await createClient()
  const { data: movs } = await sb.from('estoque_movimentos').select('id, codigo_produto, codigo_local_estoque, tipo, quantidade, custo_unitario, saldo_apos, cmc_apos, created_at')
    .eq('loja_id', lojaId).eq('origem', 'COMPRA').in('ref', referencias).order('id').limit(500)
  const ids = [...new Set((movs ?? []).map((m) => Number(m.codigo_produto)))]
  const locs = [...new Set((movs ?? []).map((m) => Number(m.codigo_local_estoque)))]
  const [{ data: prods }, { data: locais }] = await Promise.all([
    ids.length ? sb.from('produtos').select('codigo_produto, codigo, descricao, unidade').eq('loja_id', lojaId).in('codigo_produto', ids) : Promise.resolve({ data: [] }),
    locs.length ? sb.from('local_estoques').select('codigo_local_estoque, descricao').eq('loja_id', lojaId).in('codigo_local_estoque', locs) : Promise.resolve({ data: [] }),
  ])
  const p = new Map((prods ?? []).map((x) => [Number(x.codigo_produto), x]))
  const l = new Map((locais ?? []).map((x) => [Number(x.codigo_local_estoque), x.descricao as string]))
  return (
    <section aria-label="Entradas no estoque" className="space-y-2">
      <h3 className="text-[17px] font-semibold text-text">Entradas no estoque geradas por esta nota</h3>
      {!(movs ?? []).length ? (
        <p className="rounded-[var(--r-lg)] bg-surface px-4 py-3 text-[13px] text-text-muted shadow-[var(--shadow-sm)]">Nenhuma entrada ainda. Confira os itens acima e confirme a entrada.</p>
      ) : (
        <ul className="divide-y divide-[var(--border)] rounded-[var(--r-lg)] bg-surface u-card">
          {(movs ?? []).map((m) => {
            const pr = p.get(Number(m.codigo_produto))
            const estorno = m.tipo === 'EST' || Number(m.quantidade) < 0
            return (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[13px]">
                <span className="min-w-0 truncate"><span className="num text-text-muted">{pr?.codigo ?? m.codigo_produto}</span> · {pr?.descricao ?? 'Produto'} <span className="text-text-muted">· {l.get(Number(m.codigo_local_estoque)) ?? 'Local'}</span></span>
                <span className="num text-right"><span className={estorno ? 'text-warn' : 'text-ok'}>{estorno ? '' : '+'}{fmtQtd(Number(m.quantidade))} {pr?.unidade ?? ''}</span>
                  <span className="text-text-muted"> · custo {m.custo_unitario != null ? formatCustoUnit(Number(m.custo_unitario)) : '—'} · saldo {fmtQtd(Number(m.saldo_apos))}</span></span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
