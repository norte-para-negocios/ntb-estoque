import Link from 'next/link'
import { FileText } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { statusNF } from '@/lib/nf-status'

const fmtData = (d: string | null) => (d ? d.slice(0, 10).split('-').reverse().join('/') : '-')
const fmtQtd = (n: number) => n.toLocaleString('pt-BR', { maximumFractionDigits: 3 })

type Item = {
  nota_fiscal_id: number; n_qtde_nfe: number | null; c_unidade_nfe: string | null; v_total_item: number | null
  notas_fiscais: { id: number; c_numero_nfe: string | null; d_emissao_nfe: string | null; c_razao_social: string | null; c_nome: string | null; c_etapa: string | null; deleted_at: string | null; full_object: unknown } | null
}

/** Página do produto: as últimas notas fiscais de entrada com este produto (link para cada nota e para todas). */
export async function NotasDoProduto({ lojaId, codigoProduto, codigo }: { lojaId: number; codigoProduto: number; codigo: string | null }) {
  const supabase = await createClient()
  // Sem filtro no lado da nota embutida (filtro no embed deixa o plano do Postgres instável); filtra e ordena aqui.
  const { data } = await supabase.from('nota_fiscal_items')
    .select('nota_fiscal_id, n_qtde_nfe, c_unidade_nfe, v_total_item, notas_fiscais!inner(id, c_numero_nfe, d_emissao_nfe, c_razao_social, c_nome, c_etapa, deleted_at, full_object)')
    .eq('loja_id', lojaId).eq('n_id_produto', codigoProduto).order('id', { ascending: false }).limit(60)
  const itens = ((data ?? []) as unknown as Item[])
    .map((i) => ({ ...i, nf: Array.isArray(i.notas_fiscais) ? i.notas_fiscais[0] : i.notas_fiscais }))
    .filter((i) => i.nf && !i.nf.deleted_at)
    .sort((a, b) => String(b.nf!.d_emissao_nfe ?? '').localeCompare(String(a.nf!.d_emissao_nfe ?? '')))
    .slice(0, 20)
  const todas = `/nota-fiscal?produto=${encodeURIComponent(codigo ?? String(codigoProduto))}&data_inicio=2025-01-01`

  return (
    <section className="rounded-[var(--r-lg)] bg-surface p-5 shadow-[var(--shadow-sm)]">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[17px] font-semibold text-text"><FileText className="size-4 text-text-muted" /> Notas fiscais deste produto</h2>
        <Link href={todas} className="text-[13px] text-brand hover:underline">ver todas</Link>
      </div>
      {!itens.length ? (
        <p className="text-[13px] text-text-muted">Nenhuma nota fiscal de entrada com este produto.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-[13px]">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-text-muted">
                <th className="py-2 pr-2 font-medium">Emissão</th>
                <th className="px-2 py-2 font-medium">Nota</th>
                <th className="px-2 py-2 font-medium">Fornecedor</th>
                <th className="px-2 py-2 text-right font-medium">Quantidade</th>
                <th className="px-2 py-2 font-medium">Situação</th>
              </tr>
            </thead>
            <tbody>
              {itens.map((i, n) => (
                <tr key={`${i.nota_fiscal_id}-${n}`} className="border-t border-[var(--border)]">
                  <td className="py-2 pr-2 num text-text-muted">{fmtData(i.nf!.d_emissao_nfe)}</td>
                  <td className="px-2 py-2"><Link href={`/nota-fiscal/${i.nota_fiscal_id}`} className="font-medium text-brand hover:underline">NF {i.nf!.c_numero_nfe ?? i.nota_fiscal_id}</Link></td>
                  <td className="max-w-[240px] truncate px-2 py-2 text-text-muted">{i.nf!.c_razao_social || i.nf!.c_nome || '-'}</td>
                  <td className="px-2 py-2 text-right num">{fmtQtd(Number(i.n_qtde_nfe) || 0)} <span className="text-[12px] text-text-muted">{i.c_unidade_nfe ?? ''}</span></td>
                  <td className="px-2 py-2 text-text-muted">{statusNF(i.nf!.c_etapa, i.nf!.full_object).label}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
