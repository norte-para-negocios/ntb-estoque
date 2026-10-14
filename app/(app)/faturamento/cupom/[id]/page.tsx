import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getAtorGestao, getCurrentLojaId } from '@/lib/auth'
import { createClient } from '@/lib/supabase/server'
import { buscarFatCupomDetalhe } from '@/lib/faturamento-frio'
import { DetailHeader } from '@/components/ui-kit/DetailHeader'
import { Money } from '@/components/ui-kit/Money'

const fmtData = (d: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '-')
const fmtQtd = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 })

/** Cupom do PDV (venda): itens e pagamentos, lidos do fato de faturamento (Contabo). Aberto pela tela de Movimentações. */
export default async function CupomPage({ params }: { params: Promise<{ id: string }> }) {
  if (!(await getAtorGestao()).podeGerir) notFound()
  const lojaId = await getCurrentLojaId()
  const { id } = await params
  if (!/^\d+$/.test(id)) notFound()
  const { cupom, itens, pagamentos } = await buscarFatCupomDetalhe(lojaId, Number(id))
  if (!cupom) notFound()

  const supabase = await createClient()
  const ids = [...new Set(itens.map((i) => i.id_produto).filter((x): x is number => x != null))]
  const { data: prods } = ids.length
    ? await supabase.from('produtos').select('codigo_produto, codigo, descricao, unidade').eq('loja_id', lojaId).in('codigo_produto', ids.slice(0, 150))
    : { data: [] as { codigo_produto: number; codigo: string | null; descricao: string | null; unidade: string | null }[] }
  const prod = new Map((prods ?? []).map((p) => [Number(p.codigo_produto), p]))
  const situacao = cupom.cancelado ? 'Cancelado' : cupom.devolvido ? 'Devolvido' : 'Autorizado'

  return (
    <div className="space-y-4">
      <DetailHeader
        href="/faturamento?aba=cupons"
        title={`Cupom ${cupom.num ?? cupom.n_id_cupom}`}
        breadcrumb={[{ label: 'Faturamento', href: '/faturamento?aba=cupons' }, { label: `Cupom ${cupom.num ?? cupom.n_id_cupom}` }]}
        meta={
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-text-muted">
            <span>Data: <span className="num">{fmtData(cupom.data)}{cupom.hora ? ` ${cupom.hora.slice(0, 5)}` : ''}</span></span>
            <span>Valor: <Money value={cupom.valor} className="font-medium text-text" /></span>
            <span className="font-medium text-text">{situacao}</span>
            {cupom.serie && <span>Série <span className="num">{cupom.serie}</span></span>}
          </div>
        }
      />
      {cupom.chave && <p className="font-mono text-[12px] text-text-muted" title="Chave de acesso">{cupom.chave}</p>}

      <div className="overflow-x-auto rounded-[var(--r-lg)] bg-surface u-card">
        <table className="w-full min-w-[640px] text-left text-[13px]">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-text-muted">
              <th className="px-4 py-2.5 font-medium">Produto</th>
              <th className="px-2 py-2.5 text-right font-medium">Quantidade</th>
              <th className="px-2 py-2.5 text-right font-medium">Unitário</th>
              <th className="px-2 py-2.5 text-right font-medium">Desconto</th>
              <th className="px-4 py-2.5 text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {itens.map((i) => {
              const p = i.id_produto != null ? prod.get(Number(i.id_produto)) : undefined
              return (
                <tr key={i.id_item} className="border-t border-[var(--border)]">
                  <td className="px-4 py-2">
                    {i.id_produto != null
                      ? <Link href={`/estoque/produto/${i.id_produto}`} className="font-medium text-text hover:underline">{p?.descricao ?? i.x_prod ?? `Produto ${i.id_produto}`}</Link>
                      : <span className="font-medium text-text">{i.x_prod ?? '-'}</span>}
                    {p?.codigo && <span className="num ml-2 text-[12px] text-text-muted">{p.codigo}</span>}
                    {i.id_produto != null && (
                      <Link href={`/movimentacoes?cod=${i.id_produto}&data_inicio=${cupom.data.slice(0, 10)}&data_final=${cupom.data.slice(0, 10)}`} className="ml-2 text-[12px] text-brand hover:underline">movimentos</Link>
                    )}
                  </td>
                  <td className="px-2 py-2 text-right num">{fmtQtd(i.quant)} <span className="text-[12px] text-text-muted">{p?.unidade ?? ''}</span></td>
                  <td className="px-2 py-2 text-right num"><Money value={i.v_unit} /></td>
                  <td className="px-2 py-2 text-right num">{i.v_desc ? <Money value={i.v_desc} /> : '-'}</td>
                  <td className="px-4 py-2 text-right num font-medium"><Money value={i.v_item || i.v_unit * i.quant - i.v_desc} /></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {pagamentos.length > 0 && (
        <div className="rounded-[var(--r-lg)] bg-surface p-4 u-card">
          <h2 className="mb-2 text-[15px] font-semibold text-text">Pagamentos</h2>
          <ul className="space-y-1 text-[13px] text-text-muted">
            {pagamentos.map((p) => (
              <li key={p.sequencia} className="flex justify-between gap-4"><span>{p.tipo_doc ?? '-'}{p.categoria ? ` · ${p.categoria}` : ''}</span><Money value={p.valor} className="text-text" /></li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
