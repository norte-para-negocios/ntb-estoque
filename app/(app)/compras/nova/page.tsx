import { notFound } from 'next/navigation'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { CompraManual } from '@/components/compras-proprio/CompraManual'
import { carregarLocais } from '../dados'

export default async function NovaCompraPage() {
  const lojaId = await getCurrentLojaId()
  if ((await modoDaLoja(lojaId)) !== 'proprio') notFound()
  if (!(await requirePermissao(lojaId, 'Compras - Criar'))) notFound()
  return (
    <div className="space-y-4">
      <PageHeader title="Lançar compra sem XML" description="Nota de papel, feira, mercado: digite o fornecedor e os itens" voltarHref="/compras" />
      <CompraManual locais={await carregarLocais(lojaId)} />
    </div>
  )
}
