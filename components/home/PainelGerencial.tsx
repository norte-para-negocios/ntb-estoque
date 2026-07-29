import Link from 'next/link'
import { carregarDashboardGerencial } from '@/lib/dashboard-gerencial'
import { ResumoGrafico } from '@/components/resumo/ResumoGrafico'
import { MeterRatio } from '@/components/home/MeterRatio'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { AlertTriangle } from 'lucide-react'

function fmtMoeda(n: number) {
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })
}

export async function PainelGerencial({ lojaId }: { lojaId: number }) {
  const hoje = new Date()
  const anoAtual = hoje.getFullYear()
  const dataIni = `${anoAtual}-01-01`
  const dataFim = hoje.toISOString().slice(0, 10)

  const d = await carregarDashboardGerencial(lojaId, dataIni, dataFim, 10)

  return (
    <section className="space-y-6 border-t border-border pt-6">
      <div className="flex items-baseline justify-between">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-text-muted">Visão gerencial (ano corrente)</h2>
        <Link href="/relatorios" className="text-[13px] text-brand hover:underline">
          ver todos os relatórios →
        </Link>
      </div>

      {/* Rejeitos por tipo */}
      <div>
        <h3 className="mb-2 text-sm font-bold uppercase tracking-[0.12em] text-text">Rejeitos / perdas por tipo</h3>
        {d.rejeitos.length === 0 ? (
          <EmptyState icon={AlertTriangle} title="Sem rejeitos registrados no período" hint="" />
        ) : (
          <>
            <ResumoGrafico
              grafico={{
                titulo: 'Valor perdido por categoria',
                unidade: 'reais',
                itens: d.rejeitos.map((r) => ({ label: r.categoria, valor: r.valorTotal })),
              }}
            />
            <div className="mt-2 flex flex-wrap gap-3 text-[12px] text-text-muted">
              {d.rejeitos.map((r) => (
                <span key={r.categoria}>
                  {r.categoria}: {fmtMoeda(r.valorTotal)}
                  {r.pctDoFaturamento != null && (
                    <span
                      className={
                        r.categoria === 'Revenda'
                          ? r.pctDoFaturamento > 0
                            ? 'text-err font-semibold'
                            : ''
                          : r.pctDoFaturamento > 8
                          ? 'text-err font-semibold'
                          : ''
                      }
                    >
                      {' '}
                      ({r.pctDoFaturamento}% do faturamento{r.categoria === 'Revenda' ? ' — tolerância 0%' : ', ref. 8%'})
                    </span>
                  )}
                </span>
              ))}
            </div>
            <Link href="/transferencia?motivo=TPQ" className="mt-1 inline-block text-[12px] text-brand hover:underline">
              ver lançamentos de perda →
            </Link>
          </>
        )}
      </div>

      {/* Relação compras/faturamento */}
      <div>
        <h3 className="mb-2 text-sm font-bold uppercase tracking-[0.12em] text-text">Relação compras/faturamento</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {d.ratioCompraFaturamento.map((r) => (
            <MeterRatio key={r.categoria} label={r.categoria} pct={r.pct} limite={30} />
          ))}
        </div>
      </div>

      {/* Top faturados / comprados -- faturados separado por tipo (achado
          2026-07-29: a planilha de referencia da consultoria nao mistura
          produto acabado com revenda no "top 10 mais faturados"). */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div>
          <h3 className="mb-2 text-sm font-bold uppercase tracking-[0.12em] text-text">Top 10 mais faturados (produto acabado)</h3>
          {d.topFaturadosAcabado.length === 0 ? (
            <EmptyState icon={AlertTriangle} title="Sem faturamento no período" hint="" />
          ) : (
            <ResumoGrafico grafico={{ titulo: '', unidade: 'reais', itens: d.topFaturadosAcabado }} />
          )}
        </div>
        <div>
          <h3 className="mb-2 text-sm font-bold uppercase tracking-[0.12em] text-text">Top 10 mais faturados (revenda)</h3>
          {d.topFaturadosRevenda.length === 0 ? (
            <EmptyState icon={AlertTriangle} title="Sem faturamento de revenda no período" hint="" />
          ) : (
            <ResumoGrafico grafico={{ titulo: '', unidade: 'reais', itens: d.topFaturadosRevenda }} />
          )}
        </div>
        <div className="lg:col-span-2">
          <h3 className="mb-2 text-sm font-bold uppercase tracking-[0.12em] text-text">Top 10 mais comprados</h3>
          {d.topComprados.length === 0 ? (
            <EmptyState icon={AlertTriangle} title="Sem compras no período" hint="" />
          ) : (
            <ResumoGrafico grafico={{ titulo: '', unidade: 'reais', itens: d.topComprados }} />
          )}
          {d.maiorFornecedor && (
            <p className="mt-2 text-[12px] text-text-muted">
              Maior fornecedor: <span className="font-medium text-text">{d.maiorFornecedor.label}</span> ({fmtMoeda(d.maiorFornecedor.valor)})
            </p>
          )}
        </div>
      </div>

      {/* Produtos parados */}
      <div>
        <div className="flex items-baseline justify-between border-b-2 border-text pb-2 mb-1">
          <h3 className="text-sm font-bold uppercase tracking-[0.12em] text-text">Produtos parados (30+ dias sem movimento)</h3>
        </div>
        {d.produtosParados.length === 0 ? (
          <EmptyState icon={AlertTriangle} title="Nenhum produto parado" hint="Todos os produtos com saldo tiveram movimento recente." />
        ) : (
          <ul className="divide-y divide-border">
            {d.produtosParados.slice(0, 8).map((p) => (
              <li key={p.codigoProduto} className="flex items-center gap-3 py-2.5 text-sm">
                <span className="min-w-0 flex-1 truncate text-text">{p.descricao}</span>
                <span className="num text-[12px] text-text-muted">
                  {p.diasSemMovimento >= 9999 ? 'sem registro' : `${p.diasSemMovimento}d parado`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}
