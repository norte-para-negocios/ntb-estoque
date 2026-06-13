import { createClient } from '@/lib/supabase/server'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import Link from 'next/link'
import { QuantidadeInput } from '@/components/nota-fiscal/QuantidadeInput'
import { Printer, ArrowLeft, FileText } from 'lucide-react'

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
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link href="/nota-fiscal" className="text-[#8a8a8a] hover:text-[#5d5d5d]" title="Voltar">
            <ArrowLeft className="size-5" strokeWidth={2} />
          </Link>
          <FileText className="size-5 text-[#2eb5c3]" strokeWidth={2} />
          <h1 className="text-lg font-semibold text-[#5d5d5d]">
            NFe {nf.c_numero_nfe} · {nf.c_razao_social || nf.c_nome}
          </h1>
        </div>
        <a
          href={`/nota-fiscal/${id}/imprimir`}
          target="_blank"
          rel="noopener noreferrer"
          className="ntb-btn-teal"
        >
          <Printer className="size-4" /> Imprimir etiquetas
        </a>
      </div>

      <div className="space-y-4">
        {itens?.map((item) => (
          <div key={item.id} className="ntb-card">
            <div className="ntb-card-header flex items-center justify-between">
              <span>{item.c_codigo_produto}</span>
              <span className="text-sm font-normal text-white/90">
                {item.n_qtde_nfe} {item.c_unidade_nfe}
              </span>
            </div>
            <div className="ntb-card-body flex items-center justify-between gap-4">
              <div className="min-w-0">
                <small className="text-[#8a8a8a]">Produto</small>
                <p className="font-semibold text-[#5d5d5d]">{item.c_descricao_produto}</p>
              </div>
              <div className="shrink-0 text-right">
                <small className="mb-1 block text-[#8a8a8a]">Qtd p/ etiqueta</small>
                <QuantidadeInput itemId={item.id} valorInicial={item.quantidade} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
