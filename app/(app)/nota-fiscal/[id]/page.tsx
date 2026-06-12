import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { buttonVariants } from '@/components/ui/button'
import { QuantidadeInput } from '@/components/nota-fiscal/QuantidadeInput'
import { Printer } from 'lucide-react'

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
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/nota-fiscal" className="text-sm text-blue-600 hover:underline">
            ← Voltar
          </Link>
          <h1 className="text-2xl font-bold mt-1">
            NFe {nf.c_numero_nfe} - {nf.c_razao_social || nf.c_nome}
          </h1>
        </div>
        <a
          href={`/nota-fiscal/${id}/imprimir`}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonVariants()}
        >
          <Printer className="size-4" />
          Imprimir etiquetas
        </a>
      </div>

      <Card className="overflow-hidden p-0">
        <table className="w-full text-sm">
          <thead className="border-b bg-gray-50">
            <tr>
              <th className="text-left p-3 font-medium">Código</th>
              <th className="text-left p-3 font-medium">Produto</th>
              <th className="text-right p-3 font-medium">Qtd NFe</th>
              <th className="text-left p-3 font-medium">Un</th>
              <th className="text-right p-3 font-medium w-48">Qtd p/ etiqueta</th>
            </tr>
          </thead>
          <tbody>
            {itens?.map((item) => (
              <tr key={item.id} className="border-b">
                <td className="p-3">{item.c_codigo_produto}</td>
                <td className="p-3">{item.c_descricao_produto}</td>
                <td className="p-3 text-right">{item.n_qtde_nfe}</td>
                <td className="p-3">{item.c_unidade_nfe}</td>
                <td className="p-3">
                  <QuantidadeInput itemId={item.id} valorInicial={item.quantidade} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  )
}
