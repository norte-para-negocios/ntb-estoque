import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import { QuantidadeInput } from '@/components/nota-fiscal/QuantidadeInput'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { DataTable } from '@/components/ui-kit/DataTable'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Num } from '@/components/ui-kit/Num'
import { btnClass } from '@/components/ui-kit/Button'
import { Printer, FileText } from 'lucide-react'

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
        actions={
          <a
            href={`/nota-fiscal/${id}/imprimir`}
            target="_blank"
            rel="noopener noreferrer"
            className={btnClass('primary')}
          >
            <Printer className="size-4" /> Imprimir etiquetas
          </a>
        }
      />

      {itens?.length ? (
        <DataTable>
          <thead>
            <tr>
              <th>Código</th>
              <th>Produto</th>
              <th className="text-right">Qtd NFe</th>
              <th className="text-right">Qtd p/ etiqueta</th>
            </tr>
          </thead>
          <tbody>
            {itens.map((item) => (
              <tr key={item.id}>
                <td className="num text-text-muted">{item.c_codigo_produto}</td>
                <td className="max-w-md truncate">{item.c_descricao_produto}</td>
                <td className="text-right">
                  <Num value={item.n_qtde_nfe} frac={3} />{' '}
                  <span className="text-text-muted">{item.c_unidade_nfe}</span>
                </td>
                <td className="text-right">
                  <div className="flex justify-end">
                    <QuantidadeInput itemId={item.id} valorInicial={item.quantidade} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      ) : (
        <EmptyState icon={FileText} title="Nenhum item nesta nota" />
      )}
    </div>
  )
}
