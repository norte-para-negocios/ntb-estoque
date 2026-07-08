import { getCurrentLojaId, getAtorGestao } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { rpcTodos } from '@/lib/supabase/rpc-todos'
import { valoresMulti } from '@/components/ui-kit/filtros-utils'
import { gerarPlanilhaMulti, planilhaResponse, abaMatrizMensal, type AbaPlanilha } from '@/lib/excel'

export const dynamic = 'force-dynamic'

type Linha = { rotulo: string; mes: string; valor: number }
const DIMS: { dim: string; label: string; nome: string }[] = [
  { dim: 'tipo', label: 'Tipo', nome: 'Por tipo' },
  { dim: 'familia', label: 'Família', nome: 'Por família' },
  { dim: 'forma_pgto', label: 'Forma de pgto', nome: 'Por forma de pgto' },
]

export async function GET(request: Request) {
  const lojaId = await getCurrentLojaId()
  if (!(await getAtorGestao()).podeGerir) return new Response('Sem permissão', { status: 403 })

  // Mesmos filtros da tela (período customizado + rótulos por dimensão), pra
  // "Baixar" bater com o que está sendo exibido (o título já prometia "com filtros").
  const { searchParams } = new URL(request.url)
  const dataIni = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.get('data_inicio') ?? '') ? searchParams.get('data_inicio')!.slice(0, 7) : null
  const dataFim = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.get('data_final') ?? '') ? searchParams.get('data_final')!.slice(0, 7) : null
  const rotulosPorDim: Record<string, string[]> = {
    tipo: valoresMulti(searchParams.get('tipo') ?? undefined),
    familia: valoresMulti(searchParams.get('familia') ?? undefined),
    forma_pgto: valoresMulti(searchParams.get('forma_pgto') ?? undefined),
  }

  const supabase = createServiceClient()
  const abas: AbaPlanilha[] = []
  for (const d of DIMS) {
    const rotulos = rotulosPorDim[d.dim] ?? []
    const linhas = await rpcTodos<Linha>(supabase, 'relatorio_faturamento_matriz', {
      p_loja_id: lojaId,
      p_dim: d.dim,
      p_mes_ini: dataIni,
      p_mes_fim: dataFim,
      p_rotulos: rotulos.length ? rotulos : null,
    })
    if (linhas.length) {
      abas.push(abaMatrizMensal({ titulo: `Faturamento por ${d.label} (mês a mês)`, dimLabel: d.label, linhas, nome: d.nome }))
    }
  }
  if (!abas.length) return new Response('Sem faturamento no período/filtro selecionado', { status: 404 })

  const buffer = await gerarPlanilhaMulti(abas)
  return planilhaResponse('faturamento', buffer)
}
