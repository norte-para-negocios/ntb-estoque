import { Percent } from 'lucide-react'
import { acessoFinanceiro, listarContas, listarFormasRecebimento, PERM } from '@/lib/financeiro/dados'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { LinhaFormaRecebimento } from '@/components/financeiro/ContasReceberUI'

// Fase 4 passo 3 (migration 380): taxa e prazo de cada forma de pagamento da loja, por adquirente. Só desenvolvedor
// (rota-mãe /financeiro em ROTAS_SO_DEV). Forma sem cadastro gera a conta a receber com taxa 0 e prazo 0 ("configurar").
export default async function FormasRecebimentoPage() {
  const { lojaId } = await acessoFinanceiro(PERM.contasReceber)
  const [{ formas, semMigration }, { contas }] = await Promise.all([listarFormasRecebimento(lojaId), listarContas(lojaId)])
  const contasAtivas = contas.filter((c) => c.ativa).map((c) => ({ id: c.id, nome: c.nome }))
  return (
    <div className="space-y-4">
      <PageHeader title="Taxas e prazos de recebimento" icon={Percent}
        description="Quanto a adquirente cobra e em quantos dias o dinheiro cai, para cada forma de pagamento. A taxa fixa vale por pagamento. Mudou aqui, as contas ainda não recebidas seguem o valor novo." />
      {semMigration ? (
        <p className="text-[13px] text-text-muted">Ainda não ativado nesta instalação (migration 380).</p>
      ) : (
        <div className="overflow-x-auto rounded-[var(--r-lg)] bg-surface u-card">
          <table className="w-full min-w-[900px] text-[13px]">
            <thead>
              <tr className="text-left text-text-muted">
                <th className="px-4 py-2.5 font-medium">Forma</th>
                <th className="px-2 py-2.5 font-medium">Adquirente</th>
                <th className="px-2 py-2.5 font-medium">Taxa (%)</th>
                <th className="px-2 py-2.5 font-medium">Taxa fixa (R$)</th>
                <th className="px-2 py-2.5 font-medium">Prazo (dias)</th>
                <th className="px-2 py-2.5 font-medium">Cai na conta</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody>
              {formas.map((f) => <LinhaFormaRecebimento key={f.forma} f={f} contas={contasAtivas} />)}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[13px] text-text-muted">Vale-refeição (Alelo, Sodexo, Ticket, VR) chega do caixa como cartão com a bandeira do vale e entra em “Vale-refeição”. Apps de entrega ainda não chegam do Norte Vendas.</p>
    </div>
  )
}
