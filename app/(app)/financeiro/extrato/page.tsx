import Link from 'next/link'
import { ScrollText } from 'lucide-react'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { acessoFinanceiro, extratoConta, listarContas, PERM } from '@/lib/financeiro/dados'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Money } from '@/components/ui-kit/Money'
import { btnClass } from '@/components/ui-kit/Button'
import { campo, dataBR } from '@/components/financeiro/comum'

// Extrato da conta corrente: cada pagamento é uma saída, cada estorno uma entrada (nada é apagado), com o saldo corrido.
type Sp = { conta?: string; de?: string; ate?: string }

export default async function ExtratoPage({ searchParams }: { searchParams: Promise<Sp> }) {
  const { lojaId } = await acessoFinanceiro(PERM.contasCorrentes)
  const sp = await searchParams
  const { contas } = await listarContas(lojaId)
  const data = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null)
  const contaId = Number(sp.conta) || contas[0]?.id
  const de = data(sp.de)
  const ate = data(sp.ate)
  const ex = contaId ? await extratoConta(lojaId, contaId, de, ate) : null
  const hoje = hojeBahiaISO()

  return (
    <div className="space-y-4">
      <PageHeader title="Extrato" icon={ScrollText} voltarHref="/financeiro/contas-correntes"
        description="Movimento da conta corrente, do mais antigo para o mais novo, com o saldo depois de cada lançamento." />
      {contas.length === 0 ? (
        <EmptyState icon={ScrollText} title="Nenhuma conta corrente" hint="Crie uma conta corrente para ver o extrato.">
          <Link href="/financeiro/contas-correntes?criar=1" className={btnClass('primary')}>Nova conta corrente</Link>
        </EmptyState>
      ) : (
        <>
          <form method="get" className="grid gap-3 rounded-[var(--r-lg)] bg-surface p-4 text-[13px] u-card sm:grid-cols-4">
            <label className="space-y-1"><span>Conta</span>
              <select name="conta" defaultValue={String(contaId)} className={campo}>
                {contas.map((c) => <option key={c.id} value={c.id}>{c.nome}{c.ativa ? '' : ' (inativa)'}</option>)}
              </select>
            </label>
            <label className="space-y-1"><span>De</span><input type="date" name="de" defaultValue={sp.de} max={hoje} className={campo} /></label>
            <label className="space-y-1"><span>Até</span><input type="date" name="ate" defaultValue={sp.ate} max={hoje} className={campo} /></label>
            <div className="flex items-end gap-2">
              <button type="submit" className={btnClass('primary')}>Ver</button>
              <Link href="/financeiro/extrato" className={btnClass('outline')}>Limpar</Link>
            </div>
          </form>

          {ex && (
            <div className="overflow-x-auto rounded-[var(--r-lg)] bg-surface u-card">
              <table className="w-full min-w-[640px] text-[13px]">
                <thead>
                  <tr className="text-left text-text-muted">
                    <th className="px-4 py-2.5 font-medium">Data</th>
                    <th className="px-2 py-2.5 font-medium">Descrição</th>
                    <th className="px-2 py-2.5 text-right font-medium">Entrada</th>
                    <th className="px-2 py-2.5 text-right font-medium">Saída</th>
                    <th className="px-4 py-2.5 text-right font-medium">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-t border-[var(--border)] text-text-muted">
                    <td className="px-4 py-2" colSpan={4}>{de ? `Saldo antes de ${dataBR(de)}` : 'Saldo inicial'}</td>
                    <td className="px-4 py-2 text-right"><Money value={ex.saldoAnterior} /></td>
                  </tr>
                  {ex.itens.map((l) => (
                    <tr key={l.id} className="border-t border-[var(--border)]">
                      <td className="px-4 py-2 whitespace-nowrap">{dataBR(l.data)}</td>
                      <td className="px-2 py-2">{l.descricao ?? '—'}{l.estorno_de ? <span className="text-warn"> · estorno</span> : null}</td>
                      <td className="px-2 py-2 text-right">{l.tipo === 'entrada' ? <Money value={l.valor} /> : ''}</td>
                      <td className="px-2 py-2 text-right">{l.tipo === 'saida' ? <Money value={l.valor} /> : ''}</td>
                      <td className="px-4 py-2 text-right"><Money value={l.saldo_apos} /></td>
                    </tr>
                  ))}
                  <tr className="border-t border-[var(--border)] font-semibold">
                    <td className="px-4 py-2.5" colSpan={4}>Saldo {ate ? `em ${dataBR(ate)}` : 'atual'}</td>
                    <td className="px-4 py-2.5 text-right"><Money value={ex.saldoFinal} /></td>
                  </tr>
                </tbody>
              </table>
              {ex.itens.length === 0 && <p className="px-4 pb-4 text-[13px] text-text-muted">Nenhum lançamento no período.</p>}
            </div>
          )}
        </>
      )}
    </div>
  )
}
