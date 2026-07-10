import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import { DetailHeader } from '@/components/ui-kit/DetailHeader'
import { ItensNotaFiscal, type ItemNF } from '@/components/nota-fiscal/ItensNotaFiscal'
import { btnClass } from '@/components/ui-kit/Button'
import { FileText, Download } from 'lucide-react'

export default async function NotaFiscalItensPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Notas Fiscais'))) notFound()

  const { id } = await params
  const supabase = await createClient()

  const { data: nf } = await supabase
    .from('notas_fiscais')
    .select('id, c_numero_nfe, c_razao_social, c_nome, c_chave_nfe, d_emissao_nfe, n_valor_nfe, c_etapa, n_id_receb')
    .eq('id', id)
    .eq('loja_id', lojaId)
    .single()

  if (!nf) notFound()

  const [{ data: itens }, { data: categorias }] = await Promise.all([
    supabase
      .from('nota_fiscal_items')
      .select('id, c_codigo_produto, c_descricao_produto, c_cfop, n_qtde_nfe, c_unidade_nfe, n_preco_unit, v_total_item, quantidade, categoria_contabil_id')
      .eq('nota_fiscal_id', id)
      .eq('loja_id', lojaId)
      .order('n_sequencia'),
    supabase
      .from('categorias_contabeis')
      .select('id, nome')
      .eq('loja_id', lojaId)
      .eq('ativa', true)
      .order('nome'),
  ])

  function fmtData(d: string | null) {
    if (!d) return null
    const [y, m, dia] = d.slice(0, 10).split('-')
    return `${dia}/${m}/${y}`
  }

  return (
    <div className="space-y-4">
      <DetailHeader
        href="/nota-fiscal"
        title={`NFe ${nf.c_numero_nfe}`}
        breadcrumb={[
          { label: 'Notas Fiscais', href: '/nota-fiscal' },
          { label: `NFe ${nf.c_numero_nfe}` },
        ]}
        meta={
          <div className="space-y-1">
            {(nf.c_razao_social || nf.c_nome) && (
              <p className="text-[13px] text-text-muted">{nf.c_razao_social || nf.c_nome}</p>
            )}
            <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[12px] text-text-muted">
              {nf.d_emissao_nfe && <span>Emissão: <span className="num">{fmtData(nf.d_emissao_nfe)}</span></span>}
              {nf.n_valor_nfe != null && (
                <span>Valor: <span className="num font-medium text-text">{Number(nf.n_valor_nfe).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}</span></span>
              )}
              {nf.c_etapa && <span>Etapa: <span className="num">{nf.c_etapa}</span></span>}
            </div>
            {nf.c_chave_nfe && (
              <p className="num text-[11px] text-text-muted break-all">{nf.c_chave_nfe}</p>
            )}
            {nf.n_id_receb && (
              <div className="flex flex-wrap gap-2 pt-1">
                <a
                  href={`/api/nota-fiscal/${nf.id}/xml`}
                  download
                  className={btnClass('outline')}
                  title="Baixar XML da NF-e"
                >
                  <Download className="size-4" /> XML
                </a>
                <a
                  href={`/api/nota-fiscal/${nf.id}/danfe`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={btnClass('outline')}
                  title="Abrir DANFE em PDF"
                >
                  <FileText className="size-4" /> DANFE
                </a>
              </div>
            )}
          </div>
        }
      />
      <ItensNotaFiscal notaId={id} itens={(itens ?? []) as ItemNF[]} categorias={categorias ?? []} />
    </div>
  )
}
