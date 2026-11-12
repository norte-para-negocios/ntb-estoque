import { Settings2 } from 'lucide-react'
import { getCurrentLojaId } from '@/lib/auth'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { FormTaxas } from '@/components/custo-cardapio/FormTaxas'
import { carregarTaxas } from '@/lib/custo-cardapio/carregar'

export default async function TaxasCardapioPage() {
  const { taxas, gravavel } = await carregarTaxas(await getCurrentLojaId())
  return (
    <div className="space-y-4">
      <PageHeader title="Configurações" icon={Settings2}
        description="Meta de CMV e taxas de venda desta loja. Entram no preço sugerido de cada prato, no salão e no delivery." />
      <FormTaxas inicial={taxas} gravavel={gravavel} />
    </div>
  )
}
