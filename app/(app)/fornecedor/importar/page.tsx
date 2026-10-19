import { notFound } from 'next/navigation'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { DetailHeader } from '@/components/ui-kit/DetailHeader'
import { ImportarPlanilha } from '@/components/importacao/ImportarPlanilha'

// Fase G [O6]: importar fornecedores por planilha. Só estoque próprio (no modo Omie o cadastro é do Omie).
export default async function ImportarFornecedoresPage() {
  const lojaId = await getCurrentLojaId()
  if ((await modoDaLoja(lojaId)) !== 'proprio') notFound()
  if (!(await requirePermissao(lojaId, 'Fornecedores - Importar planilha'))) notFound()
  return (
    <div className="space-y-4">
      <DetailHeader href="/fornecedor" title="Importar fornecedores" breadcrumb={[{ label: 'Fornecedores', href: '/fornecedor' }, { label: 'Importar planilha' }]}
        meta={<span className="text-[13px] text-text-muted">Cria fornecedores novos e atualiza os que já existem (pelo CNPJ/CPF), com prévia antes de gravar.</span>} />
      <ImportarPlanilha tipo="fornecedores" voltar="/fornecedor" />
    </div>
  )
}
