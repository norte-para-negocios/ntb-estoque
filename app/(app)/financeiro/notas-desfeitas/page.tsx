import Link from 'next/link'
import { FileX } from 'lucide-react'
import { acessoFinanceiro, pendenciasNotaDesfeita, PERM } from '@/lib/financeiro/dados'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Money } from '@/components/ui-kit/Money'
import { dataBR } from '@/components/financeiro/comum'
import { DecidirNotaDesfeita } from '@/components/financeiro/DecisoesNotaUI'

// Decisão do dono (05/11, migration 360): conta já paga (no todo ou em parte) de nota cuja entrada foi desfeita, cancelada ou
// excluída. Nada é apagado sozinho: o GERENTE decide (permissão 'Financeiro - Decidir nota desfeita'; Admin e AdminLoja já têm).
// "Estornar o pagamento" usa o estorno de baixa de sempre e cancela a conta; "Manter a conta" só registra a decisão. Só dev por ora.
export default async function NotasDesfeitasPage() {
  const { lojaId } = await acessoFinanceiro(PERM.decidirNotaDesfeita)
  const { pendencias, semMigration } = await pendenciasNotaDesfeita(lojaId)
  return (
    <div className="space-y-4">
      <PageHeader title="Notas desfeitas com conta paga" icon={FileX}
        description="A entrada da nota foi desfeita, mas a conta já tinha pagamento. Decida: estornar o pagamento (o valor volta ao extrato e a conta é cancelada) ou manter a conta como está." />
      {semMigration ? (
        <p className="text-[13px] text-text-muted">Ainda não ativado nesta instalação (migration 360).</p>
      ) : pendencias.length === 0 ? (
        <EmptyState icon={FileX} title="Nenhuma decisão pendente" hint="Nenhuma conta paga de nota desfeita esperando o gerente." />
      ) : (
        <ul className="space-y-3">
          {pendencias.map((p) => (
            <li key={p.titulo_id} className="space-y-2 rounded-[var(--r-lg)] bg-surface p-4 u-card text-[13px]">
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <Link href={`/financeiro/contas-pagar/${p.titulo_id}`} className="text-[15px] font-semibold text-text hover:underline">Conta nº {p.numero}</Link>
                <span className="text-text">{p.fornecedor_nome}</span>
                <Link href={`/nota-fiscal/${p.nota_id}`} className="text-text-muted hover:underline">{p.documento ?? 'ver a nota'}</Link>
                <span className="text-text-muted">parcela {p.parcela}/{p.total_parcelas} · vence {dataBR(p.data_vencimento)}</span>
              </div>
              <p className="text-text-muted">
                Valor <Money value={p.valor} /> · pago <Money value={p.valor_quitado} /> em {p.pagamentos === 1 ? '1 pagamento' : `${p.pagamentos} pagamentos`} ·
                {' '}entrada {p.status_compra === 'cancelada' || !p.status_compra ? 'cancelada ou excluída' : 'desfeita'} em {dataBR(p.desfeita_em)}
              </p>
              <DecidirNotaDesfeita tituloId={p.titulo_id} rotulo={`a conta nº ${p.numero}`} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
