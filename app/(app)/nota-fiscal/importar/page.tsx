import { notFound } from 'next/navigation'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { ImportarXml } from '@/components/compras-proprio/ImportarXml'
import { carregarLocais } from '@/app/(app)/compras/dados'

export default async function ImportarCompraPage() {
  const lojaId = await getCurrentLojaId()
  if ((await modoDaLoja(lojaId)) !== 'proprio') notFound()
  if (!(await requirePermissao(lojaId, 'Compras - Criar'))) notFound()
  return (
    <div className="space-y-4">
      <PageHeader title="Importar nota (XML)" description="Para a nota que a SEFAZ não trouxe sozinha: leia o XML, ligue os itens aos produtos e dê entrada no estoque" voltarHref="/nota-fiscal" />
      <ImportarXml locais={await carregarLocais(lojaId)} />
    </div>
  )
}
