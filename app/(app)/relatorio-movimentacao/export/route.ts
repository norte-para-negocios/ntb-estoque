import { getCurrentLojaId, getAtorGestao } from '@/lib/auth'
import { createServiceClient } from '@/lib/supabase/server'
import { gerarPlanilhaMulti, planilhaResponse, abaMatrizMensal, type AbaPlanilha } from '@/lib/excel'
import { formatarNomeProduto } from '@/lib/formatar-nome'

export const dynamic = 'force-dynamic'

type Valor = { rotulo: string; mes: string; valor: number }
type Qtd = { rotulo: string; mes: string; qtde: number }

export async function GET(request: Request) {
  const lojaId = await getCurrentLojaId()
  if (!(await getAtorGestao()).podeGerir) return new Response('Sem permissão', { status: 403 })

  const { searchParams } = new URL(request.url)
  const hojeISO = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bahia' })
  const ini = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.get('data_inicio') ?? '') ? searchParams.get('data_inicio')! : `${hojeISO.slice(0, 4)}-01-01`
  const fim = /^\d{4}-\d{2}-\d{2}$/.test(searchParams.get('data_final') ?? '') ? searchParams.get('data_final')! : hojeISO

  const supabase = createServiceClient()
  async function rpcTodos<T>(fn: string, args: Record<string, unknown>): Promise<T[]> {
    const PAGE = 1000
    const todos: T[] = []
    for (let p = 0; ; p++) {
      const { data, error } = await supabase.rpc(fn, args).range(p * PAGE, p * PAGE + PAGE - 1)
      if (error || !data?.length) break
      todos.push(...(data as T[]))
      if (data.length < PAGE) break
    }
    return todos
  }

  const abas: AbaPlanilha[] = []

  // Baixas por tipo SPED em R$ (importado do MOV_DRV).
  const { data: valorRaw } = await supabase.rpc('relatorio_movimentacao_valor_matriz', { p_loja_id: lojaId, p_dim: 'tipo' })
  const valor = (valorRaw ?? []) as Valor[]
  if (valor.length) abas.push(abaMatrizMensal({ titulo: 'Movimentação — baixas por tipo (R$)', dimLabel: 'Tipo (SPED)', linhas: valor, nome: 'Baixas por tipo (R$)' }))

  // Quantidade por produto (saídas e entradas), dado nativo.
  for (const [sentido, nome, label] of [
    ['saidas', 'Saídas por produto', 'Saídas (consumo/venda)'],
    ['entradas', 'Entradas por produto', 'Entradas'],
  ] as const) {
    const q = await rpcTodos<Qtd>('relatorio_movimentacao_matriz', { p_loja_id: lojaId, p_ini: ini, p_fim: fim, p_dim: 'produto', p_sentido: sentido })
    const linhas = q.map((r) => ({ rotulo: formatarNomeProduto(r.rotulo) || r.rotulo, mes: r.mes, valor: Number(r.qtde) || 0 }))
    if (linhas.length) abas.push(abaMatrizMensal({ titulo: `Movimentação — ${label} (quantidade)`, dimLabel: 'Produto', linhas, nome, moeda: false }))
  }

  if (!abas.length) return new Response('Sem movimentação no período', { status: 404 })
  const buffer = await gerarPlanilhaMulti(abas)
  return planilhaResponse('movimentacao', buffer)
}
