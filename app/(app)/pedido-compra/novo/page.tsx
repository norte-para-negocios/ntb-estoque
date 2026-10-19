import { notFound } from 'next/navigation'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { DetailHeader } from '@/components/ui-kit/DetailHeader'
import { FormPedidoCompra } from '@/components/compras/FormPedidoCompra'
import { cadastrosDoPedido } from '../cadastros'

export default async function NovoPedidoCompraPage() {
  const lojaId = await getCurrentLojaId()
  if ((await modoDaLoja(lojaId)) !== 'proprio') notFound()
  if (!(await requirePermissao(lojaId, 'Compras - Pedidos'))) notFound()
  const { fornecedores, locais, compradores } = await cadastrosDoPedido(lojaId)
  return (
    <div className="space-y-4">
      <DetailHeader href="/pedido-compra" title="Novo pedido de compra" breadcrumb={[{ label: 'Pedidos de compra', href: '/pedido-compra' }, { label: 'Novo' }]} />
      <FormPedidoCompra fornecedores={fornecedores} locais={locais} compradores={compradores} />
    </div>
  )
}
