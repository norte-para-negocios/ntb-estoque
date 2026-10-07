import { notFound } from 'next/navigation'
import { getCurrentLojaId, getAtorGestao } from '@/lib/auth'
import { modoDaLoja } from '@/lib/estoque/ledger'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { EmptyState } from '@/components/ui-kit/EmptyState'
import { TrendingUp } from 'lucide-react'
import { carregarLucro, lerFiltro } from './dados'
import { LucroView } from './LucroView'

export const dynamic = 'force-dynamic'

export default async function RelatorioLucroPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!(await getAtorGestao()).podeGerir) notFound()
  const lojaId = await getCurrentLojaId()
  if ((await modoDaLoja(lojaId)) !== 'proprio') {
    return (
      <div className="space-y-6">
        <PageHeader title="Lucro" description="Faturamento menos o custo das mercadorias vendidas." voltarHref="/relatorios" />
        <EmptyState icon={TrendingUp} title="Este relatório é das lojas com estoque próprio" hint="Nas lojas integradas ao Omie, use o relatório de Margem." />
      </div>
    )
  }
  const f = lerFiltro(await searchParams)
  return <LucroView f={f} d={await carregarLucro(lojaId, f)} />
}
