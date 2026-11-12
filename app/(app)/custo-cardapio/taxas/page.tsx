import { notFound } from 'next/navigation'
import { Settings2 } from 'lucide-react'
import { getAtorGestao, getCurrentLojaId } from '@/lib/auth'
import { exigirDev } from '@/lib/recursos-dev'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { FormTaxas } from '@/components/custo-cardapio/FormTaxas'
import { carregarTaxas } from '@/lib/custo-cardapio/carregar'

export default async function TaxasCardapioPage() {
  await exigirDev()
  if (!(await getAtorGestao()).podeGerir) notFound()
  const { taxas, gravavel } = await carregarTaxas(await getCurrentLojaId())
  return (
    <div className="space-y-4">
      <PageHeader title="Meta e taxas" icon={Settings2} voltarHref="/custo-cardapio"
        description="Usadas no preço sugerido de cada prato, no salão e no delivery. Valem só para esta loja." />
      <FormTaxas inicial={taxas} gravavel={gravavel} />
    </div>
  )
}
