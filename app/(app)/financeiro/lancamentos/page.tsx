import { ArrowLeftRight } from 'lucide-react'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { acessoFinanceiro, listarAvulsosTransferencias, listarCategorias, listarContas, PERM } from '@/lib/financeiro/dados'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Money } from '@/components/ui-kit/Money'
import { dataBR } from '@/components/financeiro/comum'
import { EstornarAvulso, EstornarTransferencia, FormAvulso, FormTransferencia } from '@/components/financeiro/RotinaUI'

// Fase 4 passo 2 (migration 370): despesa ou receita sem fornecedor nem nota (entra no extrato com categoria, vai para a DRE) e
// transferência entre contas da loja (saída numa conta + entrada na outra, fora da DRE). Correção = estorno com motivo. Só dev.
export default async function LancamentosPage() {
  const { lojaId } = await acessoFinanceiro(PERM.lancamentos)
  const hoje = hojeBahiaISO()
  const [lista, { contas }, categorias] = await Promise.all([listarAvulsosTransferencias(lojaId), listarContas(lojaId), listarCategorias(lojaId)])
  const ativas = contas.filter((c) => c.ativa).map((c) => ({ id: c.id, nome: c.nome }))
  const cats = categorias.filter((c) => c.ativa).map((c) => ({ id: c.id, nome: c.nome, tipo: c.tipo }))
  return (
    <div className="space-y-4">
      <PageHeader title="Lançamentos e transferências" icon={ArrowLeftRight}
        description="Lançamento avulso: dinheiro que entra ou sai sem conta a pagar (gás comprado no mercado, venda de sucata). Transferência: dinheiro que muda de conta (caixa para o banco); o total da loja não muda. Últimos 90 dias."
        actions={!lista.semMigration && ativas.length > 0 && <span className="flex gap-2"><FormTransferencia contas={ativas} hoje={hoje} /><FormAvulso contas={ativas} categorias={cats} hoje={hoje} /></span>} />
      {lista.semMigration && <p className="rounded-[var(--r-lg)] bg-err/10 px-4 py-3 text-[13px] text-err">Ainda não ativado nesta instalação (migration 370).</p>}
      {!lista.semMigration && ativas.length === 0 && <p className="text-[13px] text-warn">Cadastre uma conta corrente ativa antes.</p>}

      <section className="space-y-2 rounded-[var(--r-lg)] bg-surface p-4 text-[13px] u-card">
        <h2 className="text-[15px] font-semibold text-text">Lançamentos avulsos</h2>
        {lista.avulsos.length === 0 ? <EmptyState icon={ArrowLeftRight} title="Nenhum lançamento avulso" hint="Nos últimos 90 dias." /> : (
          <ul className="divide-y divide-[var(--border)]">
            {lista.avulsos.map((l) => (
              <li key={l.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className={l.estorno_id ? 'text-text-muted line-through' : 'text-text'}>
                  {dataBR(l.data)} · {l.tipo === 'entrada' ? 'Entrada' : 'Saída'} <Money value={l.valor} /> · {l.conta_nome} · {l.descricao} · {l.categoria_nome}
                  {l.criado_por_nome ? ` · ${l.criado_por_nome}` : ''}
                </span>
                {l.estorno_id ? <span className="text-warn">Estornado em {dataBR(l.estorno_data)}</span> : <EstornarAvulso id={l.id} />}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-2 rounded-[var(--r-lg)] bg-surface p-4 text-[13px] u-card">
        <h2 className="text-[15px] font-semibold text-text">Transferências entre contas</h2>
        {lista.transferencias.length === 0 ? <EmptyState icon={ArrowLeftRight} title="Nenhuma transferência" hint="Nos últimos 90 dias." /> : (
          <ul className="divide-y divide-[var(--border)]">
            {lista.transferencias.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span className={t.estornada_em ? 'text-text-muted line-through' : 'text-text'}>
                  {dataBR(t.data)} · <Money value={t.valor} /> · {t.conta_origem_nome} → {t.conta_destino_nome}{t.descricao ? ` · ${t.descricao}` : ''}
                  {t.criado_por_nome ? ` · ${t.criado_por_nome}` : ''}
                </span>
                {t.estornada_em ? <span className="text-warn">Estornada{t.estornada_por_nome ? ` por ${t.estornada_por_nome}` : ''}: {t.motivo_estorno}</span> : <EstornarTransferencia id={t.id} />}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}
