import { Landmark } from 'lucide-react'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { acessoFinanceiro, listarContas, PERM } from '@/lib/financeiro/dados'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { FormConta, ListaContas } from '@/components/financeiro/ContasCorrentesUI'

// Finanças, etapa 1: contas correntes por loja (caixa, bancos) com saldo inicial; o saldo anda com os pagamentos registrados.
export default async function ContasCorrentesPage() {
  const { lojaId } = await acessoFinanceiro(PERM.contasCorrentes)
  const hoje = hojeBahiaISO()
  const { contas, semMigration } = await listarContas(lojaId)
  return (
    <div className="space-y-4">
      <PageHeader title="Contas correntes" icon={Landmark}
        description="Onde o dinheiro está: caixa da loja e contas de banco. O saldo parte do saldo inicial e anda com cada pagamento e estorno."
        actions={<FormConta hoje={hoje}>Nova conta</FormConta>} />
      {semMigration && <p className="rounded-[var(--r-lg)] bg-err/10 px-4 py-3 text-[13px] text-err">O financeiro ainda não foi ativado nesta instalação (migrations 285 e 286).</p>}
      {contas.length === 0 && !semMigration
        ? <EmptyState icon={Landmark} title="Nenhuma conta corrente" hint="Crie o caixa da loja e as contas de banco para poder registrar pagamentos." />
        : <ListaContas contas={contas} hoje={hoje} />}
    </div>
  )
}
