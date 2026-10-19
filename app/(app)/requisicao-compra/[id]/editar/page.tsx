import { notFound, redirect } from 'next/navigation'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { DetailHeader } from '@/components/ui-kit/DetailHeader'
import { FormRequisicao } from '@/components/compras/FormRequisicao'
import { cadastrosDoPedido } from '../../../pedido-compra/cadastros'
import { carregarRequisicao } from '../../dados'

export default async function EditarRequisicaoPage({ params }: { params: Promise<{ id: string }> }) {
  const lojaId = await getCurrentLojaId()
  if ((await modoDaLoja(lojaId)) !== 'proprio') notFound()
  if (!(await requirePermissao(lojaId, 'Compras - Requisicoes'))) notFound()
  const { id } = await params
  if (!/^\d+$/.test(id)) notFound()
  const [d, { fornecedores, compradores }] = await Promise.all([carregarRequisicao(lojaId, Number(id)), cadastrosDoPedido(lojaId)])
  if (!d) notFound()
  const { req } = d
  if (req.etapa !== 'aberta') redirect(`/requisicao-compra/${id}`)
  return (
    <div className="space-y-4">
      <DetailHeader href={`/requisicao-compra/${id}`} title={`Editar requisição nº ${req.numero}`}
        breadcrumb={[{ label: 'Requisições de compra', href: '/requisicao-compra' }, { label: `Nº ${req.numero}`, href: `/requisicao-compra/${id}` }, { label: 'Editar' }]} />
      <FormRequisicao fornecedores={fornecedores} compradores={compradores} inicial={{
        id: req.id, sugestaoEntrega: req.sugestaoEntrega, compradorId: req.compradorId, obs: req.obs, obsInterna: req.obsInterna,
        itens: req.itens.map((i) => ({ codigoProduto: i.codigoProduto, descricao: i.descricao, unidade: i.unidade, fator: i.fator, quantidade: i.quantidade,
          precoSugerido: i.precoSugerido, fornecedorId: i.fornecedorId, fornecedorNome: i.fornecedorNome, fornecedorCnpj: i.fornecedorCnpj, obs: i.obs })),
        itensProduto: req.itens.map((i) => ({ codigoProduto: i.codigoProduto, codigo: d.codigos.get(i.codigoProduto) ?? String(i.codigoProduto), descricao: i.descricao, unidade: i.unidade ?? 'UN' })),
      }} />
    </div>
  )
}
