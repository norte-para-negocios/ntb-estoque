import { notFound } from 'next/navigation'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { DetailHeader } from '@/components/ui-kit/DetailHeader'
import { ImportarPlanilha } from '@/components/importacao/ImportarPlanilha'

// Fase G [K10]: importar produtos por planilha. Só estoque próprio (no modo Omie o cadastro é do Omie).
export default async function ImportarProdutosPage() {
  const lojaId = await getCurrentLojaId()
  if ((await modoDaLoja(lojaId)) !== 'proprio') notFound()
  if (!(await requirePermissao(lojaId, 'Produtos - Importar planilha'))) notFound()
  return (
    <div className="space-y-4">
      <DetailHeader href="/produto" title="Importar produtos" breadcrumb={[{ label: 'Produtos', href: '/produto' }, { label: 'Importar planilha' }]}
        meta={<span className="text-[13px] text-text-muted">Cria produtos novos e atualiza os que já existem, com prévia antes de gravar.</span>} />
      <ImportarPlanilha tipo="produtos" voltar="/produto" />
    </div>
  )
}
