import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { ItensNotaFiscal, type ItemNF } from '@/components/nota-fiscal/ItensNotaFiscal'
import { FileText } from 'lucide-react'

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
    .select('id, c_numero_nfe, c_razao_social, c_nome')
    .eq('id', id)
    .eq('loja_id', lojaId)
    .single()

  if (!nf) notFound()

  const { data: itens } = await supabase
    .from('nota_fiscal_items')
    .select('id, c_codigo_produto, c_descricao_produto, n_qtde_nfe, c_unidade_nfe, quantidade')
    .eq('nota_fiscal_id', id)
    .order('n_sequencia')

  return (
    <div className="space-y-4">
      <PageHeader
        title={`NFe ${nf.c_numero_nfe}`}
        icon={FileText}
        description={nf.c_razao_social || nf.c_nome || undefined}
      />
      <ItensNotaFiscal notaId={id} itens={(itens ?? []) as ItemNF[]} />
    </div>
  )
}
