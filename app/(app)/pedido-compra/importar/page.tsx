import { notFound } from 'next/navigation'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { DetailHeader } from '@/components/ui-kit/DetailHeader'
import { ImportarPedidos } from '@/components/compras/ImportarPedidos'

// Importar pedidos de compra por planilha (Fase C2, I5). Só estoque próprio; loja Omie = 404.
export default async function ImportarPedidosPage() {
  const lojaId = await getCurrentLojaId()
  if ((await modoDaLoja(lojaId)) !== 'proprio') notFound()
  if (!(await requirePermissao(lojaId, 'Compras - Pedidos'))) notFound()
  return (
    <div className="space-y-4">
      <DetailHeader href="/pedido-compra" title="Importar pedidos de compra" breadcrumb={[{ label: 'Pedidos de compra', href: '/pedido-compra' }, { label: 'Importar planilha' }]} />
      <ImportarPedidos />
    </div>
  )
}
