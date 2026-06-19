import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { notFound } from 'next/navigation'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { ListaHeader } from '@/components/ui-kit/ListaHeader'
import { SintegraBusca } from '@/components/sintegra/SintegraBusca'
import { ScanLine } from 'lucide-react'

export default async function SintegraPage() {
  const lojaId = await getCurrentLojaId()
  if (!(await requirePermissao(lojaId, 'Fornecedores'))) notFound()

  return (
    <div className="space-y-4">
      <ListaHeader>
        <PageHeader
          title="SINTEGRA"
          icon={ScanLine}
          description="Consultar cadastro por CNPJ/CPF e importar para fornecedor"
        />
      </ListaHeader>

      <div className="rounded-lg border border-border bg-surface p-4 text-[13px] text-text-muted">
        Informe um CNPJ ou CPF para buscar o cadastro no Omie (leitura). Se existir, você pode
        importar os dados para o cadastro local de fornecedor. A consulta acha o que já está
        cadastrado no Omie.
      </div>

      <SintegraBusca />
    </div>
  )
}
