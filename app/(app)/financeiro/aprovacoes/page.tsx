import Link from 'next/link'
import { notFound } from 'next/navigation'
import { BadgeCheck } from 'lucide-react'
import { getCurrentLojaId, requirePermissao } from '@/lib/auth'
import { exigirDev } from '@/lib/recursos-dev'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { lerConfigFinanceiro, listarAprovacoes, nivelAprovacaoUsuario, PERM } from '@/lib/financeiro/dados'
import { ROTULO_APROVACAO, ROTULO_NIVEL, type Nivel } from '@/lib/financeiro/aprovacao-puro'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Money } from '@/components/ui-kit/Money'
import { dataBR } from '@/components/financeiro/comum'
import { DecidirAprovacao, FormConfigAprovacao } from '@/components/financeiro/RotinaUI'

// Fase 4 passo 2 (migration 370): contas a pagar aguardando aprovação (por faixa de valor) e a configuração da loja. Só dev.
// Entra quem aprova (gerente ou alto valor) ou quem configura. O nível de cada um vem das permissões; o banco confere a faixa.
const dataHora = (d: string | null) => (d ? new Date(d).toLocaleString('pt-BR', { timeZone: 'America/Bahia' }) : '—')

export default async function AprovacoesPage() {
  await exigirDev()
  const lojaId = await getCurrentLojaId()
  if ((await modoDaLoja(lojaId)) !== 'proprio') notFound()
  const [nivel, podeConfigurar] = await Promise.all([nivelAprovacaoUsuario(lojaId), requirePermissao(lojaId, PERM.configurarAprovacao)])
  if (nivel === 0 && !podeConfigurar) notFound()
  const [cfg, pend, dec] = await Promise.all([lerConfigFinanceiro(lojaId), listarAprovacoes(lojaId, 'pendente'), listarAprovacoes(lojaId, 'decididas')])
  const semMigration = cfg.semMigration || pend.semMigration

  return (
    <div className="space-y-4">
      <PageHeader title="Aprovação de pagamentos" icon={BadgeCheck}
        description="Conta acima do valor configurado fica aguardando aprovação e não pode ser paga antes. Reprovar exige o motivo; tudo fica registrado (quem e quando)." />
      {semMigration && <p className="rounded-[var(--r-lg)] bg-err/10 px-4 py-3 text-[13px] text-err">Ainda não ativado nesta instalação (migration 370).</p>}

      <section className="space-y-3 rounded-[var(--r-lg)] bg-surface p-4 u-card">
        <h2 className="text-[15px] font-semibold text-text">Configuração da loja</h2>
        <FormConfigAprovacao config={cfg.config} podeEditar={podeConfigurar && !semMigration} />
        {cfg.atualizadoPor && <p className="text-[12px] text-text-muted">Última mudança: {cfg.atualizadoPor} em {dataHora(cfg.atualizadoEm)}</p>}
      </section>

      <section className="space-y-3">
        <h2 className="text-[15px] font-semibold text-text">Aguardando aprovação ({pend.itens.length})</h2>
        {pend.itens.length === 0 ? <EmptyState icon={BadgeCheck} title="Nada aguardando" hint="Nenhuma conta esperando aprovação nesta loja." /> : (
          <ul className="space-y-3">
            {pend.itens.map((t) => (
              <li key={t.id} className="space-y-2 rounded-[var(--r-lg)] bg-surface p-4 text-[13px] u-card">
                <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                  <Link href={`/financeiro/contas-pagar/${t.id}`} className="text-[15px] font-semibold text-text hover:underline">Conta nº {t.numero}</Link>
                  <span className="text-text">{t.fornecedor_nome}</span>
                  <span className="font-semibold text-text"><Money value={t.valor} /></span>
                  <span className="text-text-muted">vence {dataBR(t.data_vencimento)}{t.documento ? ` · ${t.documento}` : ''}{t.total_parcelas > 1 ? ` · parcela ${t.parcela}/${t.total_parcelas}` : ''}</span>
                </div>
                <p className="text-text-muted">
                  Quem aprova: {ROTULO_NIVEL[t.aprovacao_nivel as Nivel]} · origem {t.origem_tipo === 'nota_entrada' ? 'nota de entrada' : t.origem_tipo === 'recorrente' ? 'recorrente' : 'manual'}
                  {t.criado_por_nome ? ` · lançada por ${t.criado_por_nome}` : ''}{t.categoria_nome ? ` · ${t.categoria_nome}` : ''}
                  {t.valor_a_confirmar ? ' · valor estimado (confirmar antes de pagar)' : ''}
                </p>
                {nivel >= t.aprovacao_nivel
                  ? <DecidirAprovacao tituloId={t.id} rotulo={`a conta nº ${t.numero}`} />
                  : <p className="text-warn">Passa da faixa do gerente: só admin/dono aprova.</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {dec.itens.length > 0 && (
        <section className="space-y-2 rounded-[var(--r-lg)] bg-surface p-4 text-[13px] u-card">
          <h2 className="text-[15px] font-semibold text-text">Decididas nos últimos 90 dias</h2>
          <ul className="divide-y divide-[var(--border)]">
            {dec.itens.map((t) => (
              <li key={t.id} className="flex flex-wrap items-baseline gap-x-3 py-2">
                <Link href={`/financeiro/contas-pagar/${t.id}`} className="font-medium text-text hover:underline">Nº {t.numero}</Link>
                <span>{t.fornecedor_nome}</span><Money value={t.valor} />
                <span className={t.aprovacao === 'reprovado' ? 'text-err' : 'text-text'}>{ROTULO_APROVACAO[t.aprovacao]}</span>
                <span className="text-text-muted">{t.aprovacao_por_nome ?? ''} · {dataHora(t.aprovacao_em)}{t.aprovacao_motivo ? ` · ${t.aprovacao_motivo}` : ''}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
