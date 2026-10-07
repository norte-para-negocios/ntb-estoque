import { notFound } from 'next/navigation'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { buscarFamilias } from '@/lib/actions/produto'
import { carregarProdutoCatalogo, listarGrupos } from '@/lib/actions/catalogo-proprio'
import { FormProdutoProprio } from '@/components/produtos-proprio/FormProdutoProprio'
import { DetailHeader } from '@/components/ui-kit/DetailHeader'

// Edição do produto no estoque próprio: grupo/subgrupo, atributos, mãe e variações. Lojas Omie continuam na tela de lista.
export default async function ProdutoCatalogoPage({ params }: { params: Promise<{ codigo: string }> }) {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Produtos'))) notFound()
  if ((await modoDaLoja(lojaId)) !== 'proprio') notFound()
  const { codigo } = await params
  const produto = await carregarProdutoCatalogo(decodeURIComponent(codigo))
  if (!produto) notFound()
  const [familias, grupos] = await Promise.all([buscarFamilias(), listarGrupos()])

  return (
    <div className="space-y-5">
      <DetailHeader
        href="/produto"
        title={produto.descricao || produto.codigo}
        breadcrumb={[{ label: 'Produtos', href: '/produto' }, { label: produto.codigo }]}
        meta={<span className="text-[13px] text-text-muted">{produto.ehMae ? `Produto mãe · ${produto.variacoes.length} variações` : produto.paiCodigoProduto != null ? 'Variação de um produto mãe' : 'Produto simples'}</span>}
      />
      <FormProdutoProprio modo="editar" familias={familias} grupos={grupos} inicial={produto} />
    </div>
  )
}
