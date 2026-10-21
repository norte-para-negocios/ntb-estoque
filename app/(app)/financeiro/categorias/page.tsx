import { Tags } from 'lucide-react'
import { acessoFinanceiro, listarCategorias, listarCategoriasContabeis, PERM } from '@/lib/financeiro/dados'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { BotaoCategoriasPadrao, FormCategoria, TabelaCategorias } from '@/components/financeiro/CategoriasUI'

// Categorias financeiras: classificam cada conta a pagar e dizem em qual linha da DRE ela cai (relatório de uma etapa futura).
// Ligam-se (opcionalmente) às categorias contábeis das notas, que continuam no cadastro de Categorias Contábeis.
export default async function CategoriasFinanceirasPage() {
  const { lojaId } = await acessoFinanceiro(PERM.categorias)
  const [categorias, contabeis] = await Promise.all([listarCategorias(lojaId), listarCategoriasContabeis(lojaId)])
  return (
    <div className="space-y-4">
      <PageHeader title="Categorias financeiras" icon={Tags}
        description="Como cada gasto é classificado e em qual linha da DRE ele entra."
        actions={<><BotaoCategoriasPadrao /><FormCategoria contabeis={contabeis}>Nova categoria</FormCategoria></>} />
      {categorias.length === 0
        ? <EmptyState icon={Tags} title="Nenhuma categoria financeira" hint="Use “Criar categorias padrão” para começar com a lista usual de restaurante." />
        : <TabelaCategorias categorias={categorias} contabeis={contabeis} />}
    </div>
  )
}
