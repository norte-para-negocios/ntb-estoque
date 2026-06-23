import { getCurrentLojaId, getAtorGestao } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { gerarPlanilhaMulti, planilhaResponse, abaMatrizMensal, type AbaPlanilha } from '@/lib/excel'

export const dynamic = 'force-dynamic'

type Linha = { rotulo: string; mes: string; valor: number }
const DIMS: { dim: string; label: string; nome: string }[] = [
  { dim: 'tipo', label: 'Tipo', nome: 'Por tipo' },
  { dim: 'familia', label: 'Família', nome: 'Por família' },
  { dim: 'forma_pgto', label: 'Forma de pgto', nome: 'Por forma de pgto' },
]

export async function GET() {
  const lojaId = await getCurrentLojaId()
  if (!(await getAtorGestao()).podeGerir) return new Response('Sem permissão', { status: 403 })

  const supabase = createServiceClient()
  const abas: AbaPlanilha[] = []
  for (const d of DIMS) {
    const { data } = await supabase.rpc('relatorio_faturamento_matriz', { p_loja_id: lojaId, p_dim: d.dim })
    const linhas = (data ?? []) as Linha[]
    if (linhas.length) {
      abas.push(abaMatrizMensal({ titulo: `Faturamento — ${d.label}`, dimLabel: d.label, linhas, nome: d.nome }))
    }
  }
  if (!abas.length) return new Response('Sem faturamento importado', { status: 404 })

  const buffer = await gerarPlanilhaMulti(abas)
  return planilhaResponse('faturamento', buffer)
}
