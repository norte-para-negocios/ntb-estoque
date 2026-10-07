import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import { buscarFamilias } from '@/lib/actions/produto'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { listarGrupos } from '@/lib/actions/catalogo-proprio'
import { FormProdutoProprio } from '@/components/produtos-proprio/FormProdutoProprio'
import { FormNovoProduto } from '@/components/produtos/FormNovoProduto'
import { DetailHeader } from '@/components/ui-kit/DetailHeader'

// Tela dedicada de cadastro de produto (sai do modal apertado): aproveita o
// espaco horizontal, campos organizados em secoes. Familias carregadas no server.
export default async function NovoProdutoPage() {
  const lojaId = await getCurrentLojaId()
  // Tela de criar: exige a permissao de Criar (nao basta o acesso ao modulo),
  // pois pode ser aberta direto pela URL.
  if (!(await requirePermissao(lojaId, 'Produtos - Criar'))) notFound()

  const familias = await buscarFamilias()
  const proprio = (await modoDaLoja(lojaId)) === 'proprio'
  const grupos = proprio ? await listarGrupos() : []

  return (
    <div className="space-y-5">
      <DetailHeader
        href="/produto"
        title="Novo produto"
        breadcrumb={[
          { label: 'Produtos', href: '/produto' },
          { label: 'Novo produto' },
        ]}
        meta={<span className="text-[13px] text-text-muted">{proprio ? 'Código automático · sincronizado com o Norte Vendas' : 'Criado direto no Omie'}</span>}
      />
      {proprio ? <FormProdutoProprio modo="novo" familias={familias} grupos={grupos} /> : <FormNovoProduto familias={familias} />}
    </div>
  )
}
