import { notFound, redirect } from 'next/navigation'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { estadoPedidoCompraLoja } from '@/lib/compras/pedido-compra-loja'
import { DetailHeader } from '@/components/ui-kit/DetailHeader'
import { FormPedidoCompra } from '@/components/compras/FormPedidoCompra'
import { carregarPedido } from '../../dados'
import { cadastrosDoPedido } from '../../cadastros'

export default async function EditarPedidoCompraPage({ params }: { params: Promise<{ id: string }> }) {
  const lojaId = await getCurrentLojaId()
  if (!(await estadoPedidoCompraLoja(lojaId)).onde) notFound()
  if (!(await requirePermissao(lojaId, 'Compras - Pedidos'))) notFound()
  const { id } = await params
  if (!/^\d+$/.test(id)) notFound()
  const [p, { fornecedores, locais, compradores }] = await Promise.all([carregarPedido(lojaId, Number(id)), cadastrosDoPedido(lojaId)])
  if (!p) notFound()
  if (p.cab.etapa !== 'rascunho') redirect(`/pedido-compra/${id}`)
  return (
    <div className="space-y-4">
      <DetailHeader href={`/pedido-compra/${id}`} title={`Editar pedido nº ${p.cab.numero}`}
        breadcrumb={[{ label: 'Pedidos de compra', href: '/pedido-compra' }, { label: `Nº ${p.cab.numero}`, href: `/pedido-compra/${id}` }, { label: 'Editar' }]} />
      <FormPedidoCompra fornecedores={fornecedores} locais={locais} compradores={compradores} inicial={{
        id: p.cab.id, fornecedorId: p.cab.fornecedor_id, fornecedorNome: p.cab.fornecedor_nome, fornecedorCnpj: p.cab.fornecedor_cnpj,
        previsaoEntrega: p.cab.previsao_entrega, frete: Number(p.cab.frete) || 0, outrasDespesas: Number(p.cab.outras_despesas) || 0,
        parcelas: Array.isArray(p.cab.parcelas) ? p.cab.parcelas : [], numeroFornecedor: p.cab.numero_fornecedor, contato: p.cab.contato,
        obs: p.cab.obs, obsInterna: p.cab.obs_interna, compradorId: p.resumo.compradorId,
        itens: p.itens.map((i) => ({ codigoProduto: i.codigoProduto, descricao: i.descricao, unidade: i.unidade, fator: i.fator, quantidade: i.quantidade, precoUnitario: i.precoUnitario, codigoLocal: i.codigoLocal, obs: i.obs })),
        itensProduto: p.itens.map((i) => ({ codigoProduto: i.codigoProduto, codigo: p.codigos.get(i.codigoProduto) ?? String(i.codigoProduto), descricao: i.descricao, unidade: i.unidade ?? 'UN' })),
      }} />
    </div>
  )
}
