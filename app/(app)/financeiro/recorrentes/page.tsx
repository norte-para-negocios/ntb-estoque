import { CalendarClock } from 'lucide-react'
import { hojeBahiaISO } from '@/lib/data-bahia'
import { acessoFinanceiro, listarCategorias, listarFornecedores, listarRecorrentes, PERM } from '@/lib/financeiro/dados'
import { rotuloPeriodicidade } from '@/lib/financeiro/recorrentes-puro'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { Money } from '@/components/ui-kit/Money'
import { dataBR } from '@/components/financeiro/comum'
import { FormRecorrente, GerarRecorrentesBotao } from '@/components/financeiro/RotinaUI'

// Fase 4 passo 2 (migration 370): contas que se repetem (aluguel, energia…). O gerador (cron diário /api/cron/fin-recorrentes e o
// botão "Gerar contas agora") cria as contas a pagar dos próximos dias da configuração; cada vencimento vira uma conta uma vez só.
export default async function RecorrentesPage() {
  const { lojaId } = await acessoFinanceiro(PERM.recorrentes)
  const hoje = hojeBahiaISO()
  const [{ recorrentes, semMigration }, fornecedores, categorias] = await Promise.all([
    listarRecorrentes(lojaId, hoje), listarFornecedores(lojaId), listarCategorias(lojaId),
  ])
  const cats = categorias.filter((c) => c.tipo === 'despesa' && c.ativa).map((c) => ({ id: c.id, nome: c.nome }))
  return (
    <div className="space-y-4">
      <PageHeader title="Contas recorrentes" icon={CalendarClock}
        description="Aluguel, energia, internet: cadastre uma vez e o sistema cria as contas a pagar sozinho, todo dia, para os próximos dias (configurável em Aprovação de pagamentos). Valor estimado gera conta marcada para confirmar o valor antes de pagar."
        actions={!semMigration && <span className="flex gap-2"><GerarRecorrentesBotao /><FormRecorrente fornecedores={fornecedores} categorias={cats} hoje={hoje}>Nova recorrente</FormRecorrente></span>} />
      {semMigration && <p className="rounded-[var(--r-lg)] bg-err/10 px-4 py-3 text-[13px] text-err">Ainda não ativado nesta instalação (migration 370).</p>}
      {recorrentes.length === 0 && !semMigration ? <EmptyState icon={CalendarClock} title="Nenhuma conta recorrente" hint="Cadastre o aluguel, a energia e as outras contas que se repetem." /> : (
        <ul className="space-y-3">
          {recorrentes.map((r) => (
            <li key={r.id} className={`space-y-1 rounded-[var(--r-lg)] bg-surface p-4 text-[13px] u-card ${r.ativa ? '' : 'opacity-60'}`}>
              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
                <span className="text-[15px] font-semibold text-text">{r.descricao}</span>
                <span className="font-semibold text-text"><Money value={r.valor} />{r.valor_estimado ? ' (estimado)' : ''}</span>
                <span className="text-text-muted">{rotuloPeriodicidade(r.periodicidade, r.dia)}</span>
                {!r.ativa && <span className="text-text-muted">desligada</span>}
                <span className="ml-auto"><FormRecorrente recorrente={r} fornecedores={fornecedores} categorias={cats} hoje={hoje}>Editar</FormRecorrente></span>
              </div>
              <p className="text-text-muted">
                {r.fornecedor_nome} · {r.categoria_nome ?? 'categoria a definir'} · de {dataBR(r.data_inicio)}{r.data_fim ? ` até ${dataBR(r.data_fim)}` : ' (sem fim)'}
                {' '}· {r.geradas} conta(s) gerada(s){r.proxima ? ` · próxima ${dataBR(r.proxima)}` : ''}
              </p>
              {r.ultima_falha && <p className="text-err">Última geração falhou: {r.ultima_falha}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
