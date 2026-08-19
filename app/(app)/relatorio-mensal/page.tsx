import { notFound } from 'next/navigation'
import { getAtorGestao, isAdmin } from '@/lib/auth'
import { PageHeader } from '@/components/ui-kit/PageHeader'
import { btnClass } from '@/components/ui-kit/Button'
import { FileBarChart, Download } from 'lucide-react'
import { SincronizarEstruturaBotao } from './sincronizar-estrutura-botao'

const MESES_PT = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

// Duplicado de ultimoDiaMes (lib/relatorio-mensal.ts) -- este arquivo é
// server component (async), mas o botão que consome essas datas é client
// component e não pode importar de um arquivo que usa next/server.
function ultimoDiaMes(ano: number, mes: number): string {
  const dia = new Date(ano, mes, 0).getDate()
  return `${ano}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`
}

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

  const opcoes = mesesDisponiveis()

  return (
    <div className="space-y-6">
      <PageHeader
        title="Relatório gerencial mensal"
        icon={FileBarChart}
        description="Gera o relatório mensal em PowerPoint (faturamento, vendas, família/fornecedores, compras/perdas, baixas de estoque) no mesmo formato já enviado hoje pra consultoria -- pra loja atual."
      />

      <div className="rounded-xl border border-border bg-surface p-5 max-w-md">
        <form method="get" action="/api/relatorio-mensal" className="space-y-4">
          <div>
            <label htmlFor="mes-ano" className="mb-1 block text-[13px] font-medium text-text">
              Mês do relatório
            </label>
            <select
              id="mes-ano"
              name="mesAno"
              defaultValue={`${opcoes[0].ano}-${opcoes[0].mes}`}
              className="w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text"
            >
              {opcoes.map((o) => (
                <option key={`${o.ano}-${o.mes}`} value={`${o.ano}-${o.mes}`}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className={btnClass('primary')}>
            <Download className="size-4" />
            Gerar relatório do mês
          </button>
        </form>
        {podeSincronizarEstrutura && (
          <div className="mt-4 border-t border-border pt-4">
            <SincronizarEstruturaBotao
              dataIni={`${opcoes[0].ano}-${String(opcoes[0].mes).padStart(2, '0')}-01`}
              dataFim={ultimoDiaMes(opcoes[0].ano, opcoes[0].mes)}
            />
          </div>
        )}
      </div>
    </div>
  )
}
