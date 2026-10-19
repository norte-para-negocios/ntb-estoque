import { notFound } from 'next/navigation'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { DetailHeader } from '@/components/ui-kit/DetailHeader'
import { FormRequisicao } from '@/components/compras/FormRequisicao'
import { cadastrosDoPedido } from '../../pedido-compra/cadastros'

export default async function NovaRequisicaoPage() {
  const lojaId = await getCurrentLojaId()
  if ((await modoDaLoja(lojaId)) !== 'proprio') notFound()
  if (!(await requirePermissao(lojaId, 'Compras - Requisicoes'))) notFound()
  const { fornecedores, compradores } = await cadastrosDoPedido(lojaId)
  return (
    <div className="space-y-4">
      <DetailHeader href="/requisicao-compra" title="Nova requisição de compra" breadcrumb={[{ label: 'Requisições de compra', href: '/requisicao-compra' }, { label: 'Nova' }]} />
      <FormRequisicao fornecedores={fornecedores} compradores={compradores} />
    </div>
  )
}
