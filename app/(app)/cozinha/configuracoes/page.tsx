import { Settings2 } from 'lucide-react'
import { getCurrentLojaId } from '@/lib/auth'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { FormTaxas } from '@/components/custo-cardapio/FormTaxas'
import { carregarConfigCozinha } from '@/lib/custo-cardapio/config'

export default async function TaxasCardapioPage() {
  const { taxas, compras, gravavel, comprasGravavel } = await carregarConfigCozinha(await getCurrentLojaId())
  return (
    <div className="space-y-4">
      <PageHeader title="Configurações" icon={Settings2}
        description="Meta de CMV e taxas de venda desta loja, e como a cozinha compra e conta o estoque." />
      <FormTaxas inicial={taxas} gravavel={gravavel} compras={compras} comprasGravavel={comprasGravavel} />
    </div>
  )
}
