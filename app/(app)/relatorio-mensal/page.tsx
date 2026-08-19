import { notFound } from 'next/navigation'
import { getAtorGestao, isAdmin } from '@/lib/auth'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { FileBarChart } from 'lucide-react'
import { RelatorioMensalForm } from './relatorio-mensal-form'

const MESES_PT = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

// Últimos 14 meses fechados (o mês corrente ainda não tem faturamento
// completo, então nem entra na lista -- evita gerar relatório de mês em
// andamento por engano).
function mesesDisponiveis(): { ano: number; mes: number; label: string }[] {
  const hoje = new Date()
  const opcoes: { ano: number; mes: number; label: string }[] = []
  for (let i = 1; i <= 14; i++) {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1)
    opcoes.push({ ano: d.getFullYear(), mes: d.getMonth() + 1, label: `${MESES_PT[d.getMonth()]} de ${d.getFullYear()}` })
  }
  return opcoes
}

export default async function RelatorioMensalPage() {
  if (!(await getAtorGestao()).podeGerir) notFound()
  // Sync de ficha técnica bate na Omie de verdade (rate-limit risk) --
  // gate mais restrito que o resto da página (podeGerir, acima), igual
  // ao app/api/sync/estrutura-produto/route.ts que o botão dispara.
  const podeSincronizarEstrutura = await isAdmin()

  // A lista de meses continua sendo calculada no servidor; só a interação
  // (mês selecionado, download e botão de sync compartilhando esse mês) vive
  // no client component.
  const opcoes = mesesDisponiveis()

  return (
    <div className="space-y-6">
      <PageHeader
        title="Relatório gerencial mensal"
        icon={FileBarChart}
        description="Gera o relatório mensal em PowerPoint (faturamento, vendas, família/fornecedores, compras/perdas, baixas de estoque) no mesmo formato já enviado hoje pra consultoria -- pra loja atual."
      />

      <div className="rounded-xl border border-border bg-surface p-5 max-w-md">
        <RelatorioMensalForm opcoes={opcoes} podeSincronizarEstrutura={podeSincronizarEstrutura} />
      </div>
    </div>
  )
}
