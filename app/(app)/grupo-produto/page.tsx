import { notFound } from 'next/navigation'
import { FolderTree } from 'lucide-react'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { listarGrupos } from '@/lib/actions/catalogo-proprio'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { ArvoreGrupos } from '@/components/grupos-produto/ArvoreGrupos'

// Grupos e subgrupos do catálogo (árvore até 5 níveis). Sincronizam sozinhos com as categorias do Norte Vendas.
export default async function GrupoProdutoPage() {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Familias'))) notFound()
  if ((await modoDaLoja(lojaId)) !== 'proprio') notFound()
  const grupos = await listarGrupos()
  const podeCriar = await requirePermissao(lojaId, 'Familias - Criar')
  const podeEditar = await requirePermissao(lojaId, 'Familias - Editar')
  const podeExcluir = await requirePermissao(lojaId, 'Familias - Excluir')

  return (
    <div className="space-y-5">
      <PageHeader
        title="Grupos e subgrupos"
        icon={FolderTree}
        description="Organize o catálogo do jeito que a loja trabalha. O que você criar aqui aparece como categoria no Norte Vendas, automaticamente."
      />
      <ArvoreGrupos grupos={grupos} podeCriar={podeCriar} podeEditar={podeEditar} podeExcluir={podeExcluir} />
    </div>
  )
}
