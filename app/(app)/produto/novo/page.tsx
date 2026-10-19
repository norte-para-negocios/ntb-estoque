import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import { buscarFamilias } from '@/lib/actions/produto'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { carregarProdutoCatalogo, listarGrupos } from '@/lib/actions/catalogo-proprio'
import { duplicarProduto } from '@/lib/produto/duplicar-puro'
import { FormProdutoProprio } from '@/components/produtos-proprio/FormProdutoProprio'
import { FormNovoProduto } from '@/components/produtos/FormNovoProduto'
import { DetailHeader } from '@/components/ui-kit/DetailHeader'

// Tela dedicada de cadastro de produto (sai do modal apertado): aproveita o
// espaco horizontal, campos organizados em secoes. Familias carregadas no server.
export default async function NovoProdutoPage({ searchParams }: { searchParams: Promise<{ duplicar?: string }> }) {
  const lojaId = await getCurrentLojaId()
  // Tela de criar: exige a permissao de Criar (nao basta o acesso ao modulo),
  // pois pode ser aberta direto pela URL.
  if (!(await requirePermissao(lojaId, 'Produtos - Criar'))) notFound()

  const familias = await buscarFamilias()
  const proprio = (await modoDaLoja(lojaId)) === 'proprio'
  const grupos = proprio ? await listarGrupos() : []
  // Fase G [K9]: "Duplicar" (só estoque próprio) abre este formulário já preenchido com o produto de origem; nada é
  // gravado até a pessoa salvar (código novo automático, sem EAN, que é único por produto).
  const { duplicar } = await searchParams
  const origem = proprio && duplicar ? await carregarProdutoCatalogo(duplicar) : null
  const copia = origem ? duplicarProduto(origem) : undefined

  return (
    <div className="space-y-5">
      <DetailHeader
        href="/produto"
        title={copia ? `Duplicar ${origem?.codigo}` : 'Novo produto'}
        breadcrumb={[
          { label: 'Produtos', href: '/produto' },
          { label: 'Novo produto' },
        ]}
        meta={<span className="text-[13px] text-text-muted">{proprio ? 'Código automático · sincronizado com o Norte Vendas' : 'Criado direto no Omie'}</span>}
      />
      {proprio ? <FormProdutoProprio modo="novo" familias={familias} grupos={grupos} inicial={copia} /> : <FormNovoProduto familias={familias} />}
    </div>
  )
}
